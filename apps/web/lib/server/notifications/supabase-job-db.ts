import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttemptRow, DeviceRow, NotifyJobDb, PendingPush, PushUpdate } from './job';
import {
  DISABLED_DEVICE_RETENTION_DAYS,
  NOTIFICATION_RETENTION_DAYS,
  recipientFromRow,
  type ActivityRow,
  type NewNotification,
  type RecipientRow,
} from './schedule';
import type { NotificationType, PushChannel } from './types';

/**
 * NotifyJobDb over the SERVICE-ROLE client: only /api/jobs/notify uses it (the sanctioned non-user path, D100/D256).
 * Errors carry the operation name only (no row data).
 */
export function supabaseNotifyJobDb(admin: SupabaseClient): NotifyJobDb {
  const fail = (op: string): never => {
    throw new Error(`${op} failed`);
  };
  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await admin.rpc(fn, args);
    if (error) fail(fn);
    return data as T;
  }
  const chunks = <T>(xs: readonly T[], n: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
    return out;
  };

  return {
    async recipients() {
      const rows = await rpc<RecipientRow[]>('jobs_notification_recipients', {});
      return (rows ?? []).map(recipientFromRow);
    },
    async expiryCandidates(until) {
      const rows = await rpc<{ household_id: string; item_id: string; display_name: string; expires_on: string; category: string | null; source: string | null }[]>(
        'jobs_expiry_candidates', { p_until: until });
      return (rows ?? []).map((r) => ({
        householdId: r.household_id, itemId: r.item_id, name: r.display_name, expiresOn: String(r.expires_on).slice(0, 10),
        category: r.category, source: r.source,
      }));
    },
    async getCursor(key) {
      const { data, error } = await admin.from('notification_job_state').select('value').eq('key', key).maybeSingle();
      if (error) fail('get cursor');
      return data ? new Date(String((data as { value: string }).value)).toISOString() : null;
    },
    async setCursor(key, value) {
      const { error } = await admin.from('notification_job_state').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) fail('set cursor');
    },
    async activity(since, until, limit) {
      const rows = await rpc<ActivityRow[]>('activity_events', { p_household_id: null, p_since: since, p_until: until, p_limit: limit });
      return rows ?? [];
    },
    async recentShoppers(since) {
      const rows = await rpc<{ household_id: string; list_id: string; user_id: string; last_at: string }[]>('jobs_recent_shoppers', { p_since: since });
      return (rows ?? []).map((r) => ({ householdId: r.household_id, listId: r.list_id, userId: r.user_id, lastAt: r.last_at }));
    },
    async insertNotifications(rows: readonly NewNotification[]) {
      let inserted = 0;
      for (const batch of chunks(rows, 200)) {
        const { data, error } = await admin
          .from('notifications')
          .upsert(
            batch.map((n) => ({
              household_id: n.householdId, user_id: n.userId, type: n.type, title: n.title, body: n.body,
              push_title: n.pushTitle, push_body: n.pushBody, link: n.link, dedupe_key: n.dedupeKey, data: n.data,
              deliver_after: n.deliverAfter, push_status: n.pushStatus,
            })),
            { onConflict: 'user_id,household_id,dedupe_key', ignoreDuplicates: true },
          )
          .select('id');
        if (error) fail('insert notifications');
        inserted += (data ?? []).length;
      }
      return inserted;
    },
    async pendingPushes(now, limit) {
      const { data, error } = await admin
        .from('notifications')
        .select('id, household_id, user_id, type, push_title, push_body, link, push_attempts, created_at')
        .eq('push_status', 'pending')
        .lte('deliver_after', now)
        .order('deliver_after', { ascending: true })
        .limit(limit);
      if (error) fail('pending pushes');
      return ((data ?? []) as Record<string, unknown>[]).map((r): PendingPush => ({
        id: String(r.id), householdId: String(r.household_id), userId: String(r.user_id), type: r.type as NotificationType,
        pushTitle: String(r.push_title), pushBody: String(r.push_body ?? ''), link: String(r.link), attempts: Number(r.push_attempts ?? 0),
        createdAt: String(r.created_at),
      }));
    },
    async devicesFor(userIds) {
      const out: DeviceRow[] = [];
      for (const batch of chunks(userIds, 100)) {
        const { data, error } = await admin
          .from('notification_devices')
          .select('id, user_id, household_id, channel, token, keys')
          .in('user_id', batch)
          .is('disabled_at', null);
        if (error) fail('devices');
        for (const r of (data ?? []) as Record<string, unknown>[]) {
          const keys = r.keys && typeof r.keys === 'object' ? (r.keys as { p256dh?: unknown; auth?: unknown }) : null;
          out.push({
            deviceId: String(r.id), userId: String(r.user_id), householdId: String(r.household_id), channel: r.channel as PushChannel,
            token: String(r.token),
            keys: keys && typeof keys.p256dh === 'string' && typeof keys.auth === 'string' ? { p256dh: keys.p256dh, auth: keys.auth } : null,
          });
        }
      }
      return out;
    },
    async recordAttempts(rows: readonly AttemptRow[]) {
      for (const batch of chunks(rows, 500)) {
        const { error } = await admin.from('notification_delivery_attempts').insert(
          batch.map((a) => ({
            notification_id: a.notificationId, device_id: a.deviceId, channel: a.channel, outcome: a.outcome,
            error_code: a.errorCode ?? null, provider_ref: a.providerRef ?? null,
          })),
        );
        if (error) fail('record attempts');
      }
    },
    async updatePushes(rows: readonly PushUpdate[]) {
      const at = new Date().toISOString();
      for (const u of rows) {
        const { error } = await admin
          .from('notifications')
          .update({
            push_status: u.status, push_attempts: u.attempts, last_attempt_at: at,
            ...(u.sentAt ? { sent_at: u.sentAt } : {}), ...(u.deliverAfter ? { deliver_after: u.deliverAfter } : {}),
          })
          .eq('id', u.id);
        if (error) fail('update push');
      }
    },
    async disableDevices(ids, reason) {
      if (!ids.length) return;
      const { error } = await admin
        .from('notification_devices')
        .update({ disabled_at: new Date().toISOString(), disabled_reason: reason.slice(0, 60) })
        .in('id', [...ids]);
      if (error) fail('disable devices');
    },
    async receiptsToCheck(olderThan, limit) {
      const { data, error } = await admin
        .from('notification_delivery_attempts')
        .select('id, device_id, provider_ref')
        .eq('channel', 'expo')
        .eq('outcome', 'sent')
        .is('receipt_checked_at', null)
        .not('provider_ref', 'is', null)
        .lte('attempted_at', olderThan)
        .order('attempted_at', { ascending: true })
        .limit(limit);
      if (error) fail('receipts to check');
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        attemptId: Number(r.id), deviceId: r.device_id ? String(r.device_id) : null, ticketId: String(r.provider_ref),
      }));
    },
    async markReceiptsChecked(ids) {
      if (!ids.length) return;
      const { error } = await admin.from('notification_delivery_attempts').update({ receipt_checked_at: new Date().toISOString() }).in('id', [...ids]);
      if (error) fail('mark receipts');
    },
    async prune(now) {
      const t = Date.parse(now);
      const oldN = new Date(t - NOTIFICATION_RETENTION_DAYS * 86_400_000).toISOString();
      const oldD = new Date(t - DISABLED_DEVICE_RETENTION_DAYS * 86_400_000).toISOString();
      const n = await admin.from('notifications').delete({ count: 'exact' }).lt('created_at', oldN);
      if (n.error) fail('prune notifications');
      const d = await admin.from('notification_devices').delete({ count: 'exact' }).lt('disabled_at', oldD);
      if (d.error) fail('prune devices');
      return { notifications: n.count ?? 0, devices: d.count ?? 0 };
    },
  };
}
