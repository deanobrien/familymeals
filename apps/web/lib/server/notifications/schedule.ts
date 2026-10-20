// Pure scheduling for notifications (P1-C, D381-D386): time zones, quiet hours, daily expiry alerts, activity-derived
// alerts and their wording. No I/O; `now` is always passed in so tests control the clock.
import {
  DEFAULT_SETTINGS,
  resolveTypes,
  type ActivityType,
  type ConfigurableType,
  type NotificationSettings,
  type NotificationType,
  type TypePref,
} from './types';

/* ---------------------------------------------------------------- time zones */

export interface LocalParts {
  /** YYYY-MM-DD in the zone. */
  date: string;
  hour: number;
  minute: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length < 1 || tz.length > 64) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

const safeZone = (tz: string): string => (isValidTimeZone(tz) ? tz : DEFAULT_SETTINGS.timeZone);

export function localParts(at: Date, tz: string): LocalParts {
  const parts = Object.fromEntries(formatter(safeZone(tz)).formatToParts(at).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const isHhmm = (v: unknown): v is string => typeof v === 'string' && HHMM.test(v);
export function toMinutes(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** The UTC instant of a local wall-clock time in `tz` (DST-safe to the minute; a skipped hour resolves forward). */
export function zonedTimeToUtc(date: string, hhmm: string, tz: string): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const mins = toMinutes(hhmm);
  const wall = Date.UTC(y, mo - 1, d, Math.floor(mins / 60), mins % 60);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(guess), tz);
    const [py, pm, pd] = p.date.split('-').map(Number) as [number, number, number];
    const seen = Date.UTC(py, pm - 1, pd, p.hour, p.minute);
    const diff = wall - seen;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/* ---------------------------------------------------------------- quiet hours */

export type QuietSettings = Pick<NotificationSettings, 'quietEnabled' | 'quietStart' | 'quietEnd' | 'timeZone'>;

/** Quiet window [start, end) in local time; it may wrap midnight. start == end means no quiet hours. */
export function inQuietHours(at: Date, s: QuietSettings): boolean {
  if (!s.quietEnabled) return false;
  const start = toMinutes(s.quietStart);
  const end = toMinutes(s.quietEnd);
  if (start === end) return false;
  const p = localParts(at, s.timeZone);
  const m = p.hour * 60 + p.minute;
  return start < end ? m >= start && m < end : m >= start || m < end;
}

/** When a push created at `at` may go out: now, or the end of the current quiet period. */
export function nextPushTime(at: Date, s: QuietSettings): Date {
  if (!inQuietHours(at, s)) return at;
  const p = localParts(at, s.timeZone);
  const m = p.hour * 60 + p.minute;
  const end = toMinutes(s.quietEnd);
  const day = m < end ? p.date : addDays(p.date, 1);
  return zonedTimeToUtc(day, s.quietEnd, s.timeZone);
}

/* ---------------------------------------------------------------- recipients */

/** A member who may receive notifications, with settings resolved over the defaults. */
export interface Recipient {
  householdId: string;
  userId: string;
  settings: NotificationSettings;
}

/** Row shape of jobs_notification_recipients(): nulls mean "never saved", i.e. the defaults. */
export interface RecipientRow {
  household_id: string;
  user_id: string;
  quiet_enabled: boolean | null;
  quiet_start: string | null;
  quiet_end: string | null;
  time_zone: string | null;
  morning_hour: number | null;
  expiry_lead_days: number | null;
  prefs: unknown;
}

const hhmmOf = (v: string | null, d: string): string => {
  const s = typeof v === 'string' ? v.slice(0, 5) : '';
  return isHhmm(s) ? s : d;
};

export function recipientFromRow(r: RecipientRow): Recipient {
  const d = DEFAULT_SETTINGS;
  return {
    householdId: r.household_id,
    userId: r.user_id,
    settings: {
      quietEnabled: r.quiet_enabled ?? d.quietEnabled,
      quietStart: hhmmOf(r.quiet_start, d.quietStart),
      quietEnd: hhmmOf(r.quiet_end, d.quietEnd),
      timeZone: r.time_zone && isValidTimeZone(r.time_zone) ? r.time_zone : d.timeZone,
      morningHour: typeof r.morning_hour === 'number' ? r.morning_hour : d.morningHour,
      expiryLeadDays: typeof r.expiry_lead_days === 'number' ? r.expiry_lead_days : d.expiryLeadDays,
      types: resolveTypes(r.prefs && typeof r.prefs === 'object' ? (r.prefs as Record<string, Partial<TypePref>>) : null),
    },
  };
}

/* ---------------------------------------------------------------- new notifications */

export type PushStatus = 'not_requested' | 'pending';

export interface NewNotification {
  householdId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Lock-screen text: generic, never item names, allergy details or receipt contents (D384). */
  pushTitle: string;
  pushBody: string;
  link: string;
  dedupeKey: string;
  data: Record<string, string>;
  deliverAfter: string;
  pushStatus: PushStatus;
}

function make(r: Recipient, type: ConfigurableType, now: Date, n: Omit<NewNotification, 'householdId' | 'userId' | 'type' | 'deliverAfter' | 'pushStatus'>): NewNotification {
  const pref = r.settings.types[type];
  return {
    householdId: r.householdId,
    userId: r.userId,
    type,
    ...n,
    deliverAfter: nextPushTime(now, r.settings).toISOString(),
    pushStatus: pref.push ? 'pending' : 'not_requested',
  };
}

/* ---------------------------------------------------------------- expiry */

export type ExpiryKind = 'use_by' | 'best_before';

/**
 * The pantry keeps ONE date per item (use by wins over best before when both were scanned, D87), so the wording is chosen
 * from the food (D383): chilled, high-risk foods and leftovers say "use by"; everything else gets the softer "best before".
 * Unknown (free-text) items say "use by": the stricter wording is the safe default.
 */
const USE_BY_CATEGORIES: ReadonlySet<string> = new Set(['meat_poultry', 'fish_seafood', 'dairy_eggs', 'dairy_alternatives', 'meat_alternatives']);

export function expiryKindFor(category: string | null | undefined, source: string | null | undefined): ExpiryKind {
  if (source === 'leftover') return 'use_by';
  if (!category) return 'use_by';
  return USE_BY_CATEGORIES.has(category) ? 'use_by' : 'best_before';
}

export function formatShortDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function whenWord(daysLeft: number, date: string): string {
  if (daysLeft <= 0) return 'today';
  if (daysLeft === 1) return 'tomorrow';
  return `on ${formatShortDay(date)}`;
}

export function expiryCopy(name: string, daysLeft: number, date: string, kind: ExpiryKind): { title: string; body: string; pushTitle: string; pushBody: string } {
  const when = whenWord(daysLeft, date);
  const clean = name.trim().slice(0, 80) || 'An item';
  if (kind === 'use_by') {
    return {
      title: `${clean}: use by ${when}`,
      body: 'Cook it, freeze it if the pack says you can, or plan it into a meal. See what you can make with it.',
      pushTitle: 'Food to use soon',
      pushBody: `Something in your pantry has a use-by date ${when}.`,
    };
  }
  return {
    title: `${clean} is best before ${when}`,
    body: 'Best before is about quality, not safety: it is usually fine for a while after, so check it before using.',
    pushTitle: 'Food to use soon',
    pushBody: `Something in your pantry is best before ${when}.`,
  };
}

/** Collapsed push text when several expiry alerts go to one person in one run. */
export const expiryCollapsed = (n: number): { pushTitle: string; pushBody: string } => ({
  pushTitle: 'Food to use soon',
  pushBody: `${n} items in your pantry need using soon.`,
});

export interface ExpiryCandidate {
  householdId: string;
  itemId: string;
  name: string;
  /** YYYY-MM-DD */
  expiresOn: string;
  category: string | null;
  source: string | null;
}

/**
 * Daily expiry alerts: from the recipient's local morning hour onwards, one notification per item per local day
 * (dedupe key `expiry:<item>:<local date>`), for dates from today up to today + lead days. The push is held until quiet
 * hours end. Re-running the job on the same day creates nothing new (the key already exists).
 */
export function planExpiryAlerts(candidates: readonly ExpiryCandidate[], recipients: readonly Recipient[], now: Date): NewNotification[] {
  const byHousehold = new Map<string, ExpiryCandidate[]>();
  for (const c of candidates) {
    const list = byHousehold.get(c.householdId) ?? [];
    list.push(c);
    byHousehold.set(c.householdId, list);
  }
  const out: NewNotification[] = [];
  for (const r of recipients) {
    if (!r.settings.types.expiry.inApp) continue;
    const items = byHousehold.get(r.householdId);
    if (!items?.length) continue;
    const local = localParts(now, r.settings.timeZone);
    if (local.hour < r.settings.morningHour) continue;
    for (const c of items) {
      const daysLeft = daysBetween(local.date, c.expiresOn);
      if (daysLeft < 0 || daysLeft > r.settings.expiryLeadDays) continue;
      const kind = expiryKindFor(c.category, c.source);
      const copy = expiryCopy(c.name, daysLeft, c.expiresOn, kind);
      out.push(make(r, 'expiry', now, {
        ...copy,
        link: `/pantry?item=${c.itemId}`,
        dedupeKey: `expiry:${c.itemId}:${local.date}`,
        data: { itemId: c.itemId, expiresOn: c.expiresOn, kind },
      }));
    }
  }
  return out;
}

/* ---------------------------------------------------------------- restock (PR1 minimum stock) */

/** Households that have at least one recipient opted in to restock alerts (only those are computed: it is not free). */
export function restockHouseholds(recipients: readonly Recipient[]): string[] {
  return [...new Set(recipients.filter((r) => r.settings.types.restock.inApp).map((r) => r.householdId))];
}

/** One "N items below minimum" per opted-in member per local day, from their morning hour (dedupe `restock:<date>`). */
export function planRestockAlerts(belowMin: ReadonlyMap<string, number>, recipients: readonly Recipient[], now: Date): NewNotification[] {
  const out: NewNotification[] = [];
  for (const r of recipients) {
    if (!r.settings.types.restock.inApp) continue;
    const n = belowMin.get(r.householdId) ?? 0;
    if (n <= 0) continue;
    const local = localParts(now, r.settings.timeZone);
    if (local.hour < r.settings.morningHour) continue;
    const what = n === 1 ? '1 item is' : `${n} items are`;
    out.push(make(r, 'restock', now, {
      title: `${what} below your minimum stock`,
      body: 'Add them to the shopping list from the pantry or shopping page.',
      pushTitle: 'Running low',
      pushBody: `${what} below your minimum stock.`,
      link: '/pantry',
      dedupeKey: `restock:${local.date}`,
      data: { count: String(n) },
    }));
  }
  return out;
}

/* ---------------------------------------------------------------- activity */

/** Row shape of activity_events(). */
export interface ActivityRow {
  id: string;
  household_id: string;
  type: string;
  actor_id: string | null;
  actor_name: string | null;
  subject: string | null;
  list_id: string | null;
  ref_id: string | null;
  at: string;
}

const ACTIVITY: ReadonlySet<string> = new Set(['purchase_by_other', 'item_added', 'plan_approved', 'recipe_added', 'member_joined']);
export const isActivityType = (t: string): t is ActivityType => ACTIVITY.has(t);

export function activityText(type: ActivityType, subject: string | null): string {
  const s = subject?.trim().slice(0, 80);
  switch (type) {
    case 'purchase_by_other':
      return `ticked off ${s || 'an item'}`;
    case 'item_added':
      return `added ${s || 'an item'} to the shopping list`;
    case 'plan_approved':
      return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `approved the meal plan for the week of ${formatShortDay(s)}` : 'approved the meal plan';
    case 'recipe_added':
      return s ? `added the recipe ${s}` : 'added a recipe';
    case 'member_joined':
      return 'joined the household';
  }
}

/** Generic lock-screen wording: no item or recipe names (D384). */
function activityPush(type: ActivityType, actor: string): { pushTitle: string; pushBody: string } {
  const verb = {
    purchase_by_other: 'ticked something off the shopping list',
    item_added: 'added to the shopping list',
    plan_approved: 'approved the meal plan',
    recipe_added: 'added a recipe',
    member_joined: 'joined the household',
  }[type];
  return { pushTitle: 'Household update', pushBody: `${actor} ${verb}.` };
}

export function activityLink(type: ActivityType, refId: string | null): string {
  switch (type) {
    case 'purchase_by_other':
    case 'item_added':
      return '/shopping';
    case 'plan_approved':
      return '/plan';
    case 'recipe_added':
      return refId ? `/recipes/${refId}` : '/recipes';
    case 'member_joined':
      return '/household';
  }
}

const actorOf = (r: ActivityRow): string => (r.actor_name?.trim() || 'A member').slice(0, 60);

export interface ShopperRow {
  householdId: string;
  listId: string;
  userId: string;
  lastAt: string;
}

/** Someone who ticked an item on this list in the last 30 minutes is "shopping now" (D385). */
export const SHOPPING_WINDOW_MS = 30 * 60_000;
/** One "list changed" push per list per shopper per 10 minutes, however many items are added. */
export const SHOPPING_BUCKET_MS = 10 * 60_000;

export function planActivityNotifications(
  events: readonly ActivityRow[],
  recipients: readonly Recipient[],
  shoppers: readonly ShopperRow[],
  now: Date,
): NewNotification[] {
  const out: NewNotification[] = [];
  for (const e of events) {
    if (!isActivityType(e.type)) continue;
    const type = e.type;
    const actor = actorOf(e);
    const at = Date.parse(e.at);
    for (const r of recipients) {
      if (r.householdId !== e.household_id || r.userId === e.actor_id) continue;
      if (r.settings.types[type].inApp) {
        out.push(make(r, type, now, {
          title: `${actor} ${activityText(type, e.subject)}`,
          body: '',
          ...activityPush(type, actor),
          link: activityLink(type, e.ref_id),
          dedupeKey: `activity:${e.id}`,
          data: { eventId: e.id },
        }));
      }
      if (type === 'item_added' && e.list_id && r.settings.types.list_changed_while_shopping.inApp) {
        const shopping = shoppers.some((s) => s.householdId === r.householdId && s.listId === e.list_id && s.userId === r.userId
          && Date.parse(s.lastAt) >= at - SHOPPING_WINDOW_MS && Date.parse(s.lastAt) <= at + SHOPPING_WINDOW_MS);
        if (!shopping) continue;
        out.push(make(r, 'list_changed_while_shopping', now, {
          title: 'The shopping list changed',
          body: `${actor} ${activityText('item_added', e.subject)}.`,
          pushTitle: 'Shopping list changed',
          pushBody: 'The list you are shopping from has just changed.',
          link: '/shopping',
          dedupeKey: `shopping:${e.list_id}:${Math.floor(at / SHOPPING_BUCKET_MS)}`,
          data: { listId: e.list_id },
        }));
      }
    }
  }
  // Two adds in the same bucket produce the same dedupe key: keep the first (the database would also refuse the second).
  const seen = new Set<string>();
  return out.filter((n) => {
    const k = `${n.userId}|${n.householdId}|${n.dedupeKey}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ---------------------------------------------------------------- retention */

export const NOTIFICATION_RETENTION_DAYS = 90;
export const DISABLED_DEVICE_RETENTION_DAYS = 30;
export const MAX_PUSH_ATTEMPTS = 3;
/** A push that could not be sent within this long is dropped (status 'expired'): stale reminders help nobody. */
export const PUSH_EXPIRY_HOURS = 24;
