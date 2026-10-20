// The notification job (P1-C, D388): POST /api/jobs/notify runs this. Every step is idempotent (dedupe keys in the
// database, push status per row) and isolated: one failing step does not stop the others. Counts only in the result.
import {
  MAX_PUSH_ATTEMPTS,
  PUSH_EXPIRY_HOURS,
  addDays,
  expiryCollapsed,
  planActivityNotifications,
  planExpiryAlerts,
  planRestockAlerts,
  restockHouseholds,
  SHOPPING_WINDOW_MS,
  type ActivityRow,
  type ExpiryCandidate,
  type NewNotification,
  type Recipient,
  type ShopperRow,
} from './schedule';
import type { PushMessage, PushOutcome, PushSender, PushTarget, ReceiptChecker } from './senders';
import type { NotificationType, PushChannel } from './types';

export interface PendingPush {
  id: string;
  householdId: string;
  userId: string;
  type: NotificationType;
  pushTitle: string;
  pushBody: string;
  link: string;
  attempts: number;
  createdAt: string;
}

export interface DeviceRow extends PushTarget {
  userId: string;
  householdId: string;
}

export type FinalPushStatus = 'pending' | 'sent' | 'failed' | 'no_devices' | 'expired';

export interface PushUpdate {
  id: string;
  status: FinalPushStatus;
  attempts: number;
  /** Next try (retries back off); only with status 'pending'. */
  deliverAfter?: string;
  sentAt?: string;
}

export interface AttemptRow {
  notificationId: string;
  deviceId: string;
  channel: PushChannel;
  outcome: PushOutcome;
  errorCode?: string;
  providerRef?: string;
}

export interface NotifyJobDb {
  recipients(): Promise<Recipient[]>;
  expiryCandidates(until: string): Promise<ExpiryCandidate[]>;
  getCursor(key: string): Promise<string | null>;
  setCursor(key: string, value: string): Promise<void>;
  activity(since: string, until: string, limit: number): Promise<ActivityRow[]>;
  recentShoppers(since: string): Promise<ShopperRow[]>;
  /** Insert, skipping rows whose (user, household, dedupe key) exists. Returns how many were new. */
  insertNotifications(rows: readonly NewNotification[]): Promise<number>;
  pendingPushes(now: string, limit: number): Promise<PendingPush[]>;
  devicesFor(userIds: readonly string[]): Promise<DeviceRow[]>;
  recordAttempts(rows: readonly AttemptRow[]): Promise<void>;
  updatePushes(rows: readonly PushUpdate[]): Promise<void>;
  disableDevices(ids: readonly string[], reason: string): Promise<void>;
  receiptsToCheck(olderThan: string, limit: number): Promise<{ attemptId: number; deviceId: string | null; ticketId: string }[]>;
  markReceiptsChecked(attemptIds: readonly number[]): Promise<void>;
  prune(now: string): Promise<{ notifications: number; devices: number }>;
}

export interface NotifyJobDeps {
  db: NotifyJobDb;
  senders: Partial<Record<PushChannel, PushSender>>;
  receipts?: ReceiptChecker;
  /** Below-minimum item counts per household (PR1 restock), only for the households asked for. */
  restockCounts?: (householdIds: readonly string[]) => Promise<Map<string, number>>;
  now?: () => Date;
}

export interface NotifyJobResult {
  ok: boolean;
  created: { expiry: number; activity: number; restock: number };
  push: { sent: number; retried: number; failed: number; noDevices: number; expired: number };
  devicesDisabled: number;
  receiptsChecked: number;
  pruned: { notifications: number; devices: number };
  failedSteps: string[];
}

export const ACTIVITY_CURSOR = 'activity_cursor';
const ACTIVITY_LIMIT = 500;
const PUSH_BATCH = 500;
const RETRY_BACKOFF_MS = 5 * 60_000;
const RECEIPT_DELAY_MS = 15 * 60_000;

/** One push per device per notification, except several expiry alerts for one person: collapsed into one (D386). */
export function buildMessages(rows: readonly PendingPush[]): { ids: string[]; message: PushMessage }[] {
  const out: { ids: string[]; message: PushMessage }[] = [];
  const expiry = rows.filter((r) => r.type === 'expiry');
  if (expiry.length > 1) {
    out.push({ ids: expiry.map((r) => r.id), message: { ...titleBody(expiryCollapsed(expiry.length)), link: '/pantry', tag: 'expiry' } });
  } else if (expiry.length === 1) {
    const r = expiry[0]!;
    out.push({ ids: [r.id], message: { title: r.pushTitle, body: r.pushBody, link: r.link, tag: 'expiry' } });
  }
  for (const r of rows) {
    if (r.type === 'expiry') continue;
    out.push({ ids: [r.id], message: { title: r.pushTitle, body: r.pushBody, link: r.link, ...(r.type === 'list_changed_while_shopping' ? { tag: 'shopping' } : {}) } });
  }
  return out;
}
const titleBody = (c: { pushTitle: string; pushBody: string }) => ({ title: c.pushTitle, body: c.pushBody });

/** Deliver pending pushes. Exported for the test-notification path too (single row, the caller's own devices). */
export async function deliver(
  pending: readonly PendingPush[],
  devices: readonly DeviceRow[],
  senders: Partial<Record<PushChannel, PushSender>>,
  now: Date,
): Promise<{ updates: PushUpdate[]; attempts: AttemptRow[]; invalidDevices: string[] }> {
  const updates: PushUpdate[] = [];
  const attempts: AttemptRow[] = [];
  const invalid = new Set<string>();
  const live: PendingPush[] = [];
  for (const p of pending) {
    if (now.getTime() - Date.parse(p.createdAt) > PUSH_EXPIRY_HOURS * 3_600_000) updates.push({ id: p.id, status: 'expired', attempts: p.attempts });
    else live.push(p);
  }
  const groups = new Map<string, PendingPush[]>();
  for (const p of live) {
    const k = `${p.userId}|${p.householdId}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  // notification id -> outcomes across its devices
  const outcomes = new Map<string, PushOutcome[]>();
  const work = new Map<PushChannel, { target: PushTarget; message: PushMessage; ids: string[] }[]>();
  for (const rows of groups.values()) {
    const { userId, householdId } = rows[0]!;
    const mine = devices.filter((d) => d.userId === userId && d.householdId === householdId && senders[d.channel]);
    if (!mine.length) {
      for (const r of rows) updates.push({ id: r.id, status: 'no_devices', attempts: r.attempts });
      continue;
    }
    for (const m of buildMessages(rows)) {
      for (const d of mine) {
        const list = work.get(d.channel) ?? [];
        list.push({ target: { deviceId: d.deviceId, channel: d.channel, token: d.token, keys: d.keys ?? null }, message: m.message, ids: m.ids });
        work.set(d.channel, list);
      }
    }
  }
  for (const [channel, items] of work) {
    const sender = senders[channel]!;
    let results: Awaited<ReturnType<PushSender['send']>>;
    try {
      results = await sender.send(items.map(({ target, message }) => ({ target, message })));
    } catch {
      results = items.map((i) => ({ deviceId: i.target.deviceId, outcome: 'retry' as const, errorCode: 'sender_failed' }));
    }
    items.forEach((item, idx) => {
      const r = results[idx] ?? { deviceId: item.target.deviceId, outcome: 'retry' as const, errorCode: 'no_result' };
      if (r.outcome === 'invalid_token') invalid.add(item.target.deviceId);
      for (const id of item.ids) {
        outcomes.set(id, [...(outcomes.get(id) ?? []), r.outcome]);
        attempts.push({
          notificationId: id, deviceId: item.target.deviceId, channel, outcome: r.outcome,
          ...(r.errorCode ? { errorCode: r.errorCode } : {}), ...(r.providerRef ? { providerRef: r.providerRef } : {}),
        });
      }
    });
  }
  for (const p of live) {
    const o = outcomes.get(p.id);
    if (!o) continue; // already 'no_devices'
    const n = p.attempts + 1;
    if (o.includes('sent')) updates.push({ id: p.id, status: 'sent', attempts: n, sentAt: now.toISOString() });
    else if (o.every((x) => x === 'invalid_token')) updates.push({ id: p.id, status: 'no_devices', attempts: n });
    else if (o.includes('retry') && n < MAX_PUSH_ATTEMPTS) {
      updates.push({ id: p.id, status: 'pending', attempts: n, deliverAfter: new Date(now.getTime() + RETRY_BACKOFF_MS * n).toISOString() });
    } else updates.push({ id: p.id, status: 'failed', attempts: n });
  }
  return { updates, attempts, invalidDevices: [...invalid] };
}

export async function runNotifyJob(deps: NotifyJobDeps): Promise<NotifyJobResult> {
  const now = (deps.now ?? (() => new Date()))();
  const nowIso = now.toISOString();
  const { db } = deps;
  const result: NotifyJobResult = {
    ok: true,
    created: { expiry: 0, activity: 0, restock: 0 },
    push: { sent: 0, retried: 0, failed: 0, noDevices: 0, expired: 0 },
    devicesDisabled: 0,
    receiptsChecked: 0,
    pruned: { notifications: 0, devices: 0 },
    failedSteps: [],
  };
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      result.failedSteps.push(name);
      console.error(`[jobs/notify] ${name} failed`, e instanceof Error ? e.name : 'unknown');
    }
  };

  let recipients: Recipient[] = [];
  await step('recipients', async () => {
    recipients = await db.recipients();
  });

  if (recipients.length) {
    await step('expiry', async () => {
      const candidates = await db.expiryCandidates(addDays(nowIso.slice(0, 10), 4));
      result.created.expiry = await db.insertNotifications(planExpiryAlerts(candidates, recipients, now));
    });

    if (deps.restockCounts) {
      const households = restockHouseholds(recipients);
      if (households.length) {
        await step('restock', async () => {
          const counts = await deps.restockCounts!(households);
          result.created.restock = await db.insertNotifications(planRestockAlerts(counts, recipients, now));
        });
      }
    }

    await step('activity', async () => {
      const until = new Date(now.getTime() - 5_000).toISOString();
      const since = await db.getCursor(ACTIVITY_CURSOR);
      // First run: start from now; history is in the feed, not worth a burst of notifications.
      if (since && since < until) {
        const events = await db.activity(since, until, ACTIVITY_LIMIT);
        if (events.some((e) => e.type === 'item_added')) {
          const shoppers = await db.recentShoppers(new Date(Date.parse(since) - SHOPPING_WINDOW_MS).toISOString());
          result.created.activity = await db.insertNotifications(planActivityNotifications(events, recipients, shoppers, now));
        } else {
          result.created.activity = await db.insertNotifications(planActivityNotifications(events, recipients, [], now));
        }
      }
      await db.setCursor(ACTIVITY_CURSOR, until);
    });
  }

  await step('deliver', async () => {
    const pending = await db.pendingPushes(nowIso, PUSH_BATCH);
    if (!pending.length) return;
    const devices = await db.devicesFor([...new Set(pending.map((p) => p.userId))]);
    const { updates, attempts, invalidDevices } = await deliver(pending, devices, deps.senders, now);
    if (attempts.length) await db.recordAttempts(attempts);
    if (invalidDevices.length) await db.disableDevices(invalidDevices, 'invalid_token');
    await db.updatePushes(updates);
    result.devicesDisabled += invalidDevices.length;
    for (const u of updates) {
      if (u.status === 'sent') result.push.sent++;
      else if (u.status === 'pending') result.push.retried++;
      else if (u.status === 'failed') result.push.failed++;
      else if (u.status === 'no_devices') result.push.noDevices++;
      else if (u.status === 'expired') result.push.expired++;
    }
  });

  if (deps.receipts) {
    await step('receipts', async () => {
      const rows = await db.receiptsToCheck(new Date(now.getTime() - RECEIPT_DELAY_MS).toISOString(), 300);
      if (!rows.length) return;
      const receipts = await deps.receipts!.check(rows.map((r) => r.ticketId));
      const byTicket = new Map(receipts.map((r) => [r.ticketId, r]));
      const bad = rows.filter((r) => byTicket.get(r.ticketId)?.invalidToken && r.deviceId).map((r) => r.deviceId!);
      if (bad.length) await db.disableDevices([...new Set(bad)], 'device_not_registered');
      const done = rows.filter((r) => byTicket.has(r.ticketId)).map((r) => r.attemptId);
      if (done.length) await db.markReceiptsChecked(done);
      result.receiptsChecked = done.length;
      result.devicesDisabled += new Set(bad).size;
    });
  }

  await step('prune', async () => {
    result.pruned = await db.prune(nowIso);
  });

  result.ok = result.failedSteps.length === 0;
  return result;
}
