import { describe, expect, it } from 'vitest';
import {
  expiryCopy,
  expiryKindFor,
  inQuietHours,
  localParts,
  nextPushTime,
  planActivityNotifications,
  planExpiryAlerts,
  planRestockAlerts,
  recipientFromRow,
  restockHouseholds,
  zonedTimeToUtc,
  type ActivityRow,
  type ExpiryCandidate,
  type Recipient,
} from './schedule';
import { defaultSettings, resolveTypes, type NotificationSettings } from './types';

const HH = 'aa000000-0000-4000-8000-0000000000aa';
const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const rcpt = (userId: string, over: Partial<NotificationSettings> = {}): Recipient => ({ householdId: HH, userId, settings: { ...defaultSettings(), ...over } });
const item = (over: Partial<ExpiryCandidate> = {}): ExpiryCandidate => ({
  householdId: HH, itemId: '11111111-1111-4111-8111-111111111111', name: 'Chicken thighs', expiresOn: '2026-10-21', category: 'meat_poultry', source: 'manual', ...over,
});

describe('time zones', () => {
  it('reads local wall time in London across BST and GMT', () => {
    expect(localParts(new Date('2026-07-01T07:30:00Z'), 'Europe/London')).toEqual({ date: '2026-07-01', hour: 8, minute: 30 });
    expect(localParts(new Date('2026-12-01T07:30:00Z'), 'Europe/London')).toEqual({ date: '2026-12-01', hour: 7, minute: 30 });
  });
  it('converts a local time to UTC, DST-aware', () => {
    expect(zonedTimeToUtc('2026-07-01', '07:30', 'Europe/London').toISOString()).toBe('2026-07-01T06:30:00.000Z');
    expect(zonedTimeToUtc('2026-12-01', '07:30', 'Europe/London').toISOString()).toBe('2026-12-01T07:30:00.000Z');
    // the morning after the clocks go back (25 Oct 2026)
    expect(zonedTimeToUtc('2026-10-26', '07:30', 'Europe/London').toISOString()).toBe('2026-10-26T07:30:00.000Z');
  });
  it('falls back to Europe/London for an unknown zone', () => {
    expect(localParts(new Date('2026-07-01T07:30:00Z'), 'Not/AZone').hour).toBe(8);
  });
});

describe('quiet hours', () => {
  const s = { quietEnabled: true, quietStart: '21:30', quietEnd: '07:30', timeZone: 'Europe/London' };
  it('wraps midnight', () => {
    expect(inQuietHours(new Date('2026-12-01T22:00:00Z'), s)).toBe(true);
    expect(inQuietHours(new Date('2026-12-01T03:00:00Z'), s)).toBe(true);
    expect(inQuietHours(new Date('2026-12-01T07:30:00Z'), s)).toBe(false); // end is exclusive
    expect(inQuietHours(new Date('2026-12-01T12:00:00Z'), s)).toBe(false);
  });
  it('a same-day window, disabled, and start == end', () => {
    expect(inQuietHours(new Date('2026-12-01T13:00:00Z'), { ...s, quietStart: '12:00', quietEnd: '14:00' })).toBe(true);
    expect(inQuietHours(new Date('2026-12-01T22:00:00Z'), { ...s, quietEnabled: false })).toBe(false);
    expect(inQuietHours(new Date('2026-12-01T22:00:00Z'), { ...s, quietStart: '07:00', quietEnd: '07:00' })).toBe(false);
  });
  it('defers a push to the end of the quiet period (tonight -> tomorrow morning; small hours -> this morning)', () => {
    expect(nextPushTime(new Date('2026-12-01T22:00:00Z'), s).toISOString()).toBe('2026-12-02T07:30:00.000Z');
    expect(nextPushTime(new Date('2026-12-02T03:00:00Z'), s).toISOString()).toBe('2026-12-02T07:30:00.000Z');
    expect(nextPushTime(new Date('2026-12-02T12:00:00Z'), s).toISOString()).toBe('2026-12-02T12:00:00.000Z');
    // summer: 07:30 BST is 06:30Z
    expect(nextPushTime(new Date('2026-07-01T23:00:00Z'), s).toISOString()).toBe('2026-07-02T06:30:00.000Z');
  });
});

describe('expiry alerts', () => {
  const morning = new Date('2026-10-20T08:15:00Z'); // 09:15 BST
  it('chooses use by for chilled food and leftovers, best before for the rest, use by when unknown', () => {
    expect(expiryKindFor('meat_poultry', 'manual')).toBe('use_by');
    expect(expiryKindFor('bakery', 'manual')).toBe('best_before');
    expect(expiryKindFor('bakery', 'leftover')).toBe('use_by');
    expect(expiryKindFor(null, 'manual')).toBe('use_by');
  });
  it('wording: names stay in-app; the push is generic', () => {
    const u = expiryCopy('Chicken', 1, '2026-10-21', 'use_by');
    expect(u.title).toBe('Chicken: use by tomorrow');
    expect(u.pushBody).not.toContain('Chicken');
    const b = expiryCopy('Bread', 0, '2026-10-20', 'best_before');
    expect(b.title).toBe('Bread is best before today');
    expect(b.body).toMatch(/quality, not safety/);
    expect(expiryCopy('Milk', 3, '2026-10-23', 'use_by').title).toBe('Milk: use by on Fri 23 Oct');
  });
  it('one per item per local day, within the lead days, from the morning hour', () => {
    const out = planExpiryAlerts([item(), item({ itemId: '22222222-2222-4222-8222-222222222222', expiresOn: '2026-10-25' })], [rcpt(ALICE)], morning);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'expiry', title: 'Chicken thighs: use by tomorrow', dedupeKey: 'expiry:11111111-1111-4111-8111-111111111111:2026-10-20',
      link: '/pantry?item=11111111-1111-4111-8111-111111111111', pushStatus: 'pending', deliverAfter: morning.toISOString(),
    });
    expect(out[0]!.pushBody).not.toContain('Chicken');
  });
  it('nothing before the morning hour, nothing for expired items, nothing when switched off', () => {
    expect(planExpiryAlerts([item()], [rcpt(ALICE)], new Date('2026-10-20T05:00:00Z'))).toHaveLength(0); // 06:00 BST
    expect(planExpiryAlerts([item({ expiresOn: '2026-10-19' })], [rcpt(ALICE)], morning)).toHaveLength(0);
    const off = rcpt(ALICE, { types: resolveTypes({ expiry: { inApp: false } }) });
    expect(planExpiryAlerts([item()], [off], morning)).toHaveLength(0);
  });
  it('in-app only when push is off; lead days 0 = only the day itself', () => {
    const inAppOnly = rcpt(ALICE, { types: resolveTypes({ expiry: { inApp: true, push: false } }) });
    expect(planExpiryAlerts([item()], [inAppOnly], morning)[0]!.pushStatus).toBe('not_requested');
    expect(planExpiryAlerts([item()], [rcpt(ALICE, { expiryLeadDays: 0 })], morning)).toHaveLength(0);
    expect(planExpiryAlerts([item({ expiresOn: '2026-10-20' })], [rcpt(ALICE, { expiryLeadDays: 0 })], morning)).toHaveLength(1);
  });
  it('a morning hour inside quiet hours holds the push until quiet hours end', () => {
    const r = rcpt(ALICE, { morningHour: 6, quietStart: '22:00', quietEnd: '07:00' });
    const at = new Date('2026-10-20T05:10:00Z'); // 06:10 BST
    expect(planExpiryAlerts([item()], [r], at)[0]!.deliverAfter).toBe('2026-10-20T06:00:00.000Z');
  });
  it('re-running the same day yields the same dedupe keys (idempotent with the unique index)', () => {
    const a = planExpiryAlerts([item()], [rcpt(ALICE)], morning).map((n) => n.dedupeKey);
    const b = planExpiryAlerts([item()], [rcpt(ALICE)], new Date('2026-10-20T15:00:00Z')).map((n) => n.dedupeKey);
    expect(a).toEqual(b);
  });
});

describe('recipients from the job row', () => {
  it('nulls become the defaults; push without in-app is dropped', () => {
    const r = recipientFromRow({
      household_id: HH, user_id: ALICE, quiet_enabled: null, quiet_start: '22:00:00', quiet_end: null, time_zone: 'Bad/Zone',
      morning_hour: null, expiry_lead_days: 2, prefs: { recipe_added: { inApp: false, push: true }, item_added: { inApp: true } },
    });
    expect(r.settings).toMatchObject({ quietEnabled: true, quietStart: '22:00', quietEnd: '07:30', timeZone: 'Europe/London', morningHour: 8, expiryLeadDays: 2 });
    expect(r.settings.types.recipe_added).toEqual({ inApp: false, push: false });
    expect(r.settings.types.item_added).toEqual({ inApp: true, push: false });
    expect(r.settings.types.expiry).toEqual({ inApp: true, push: true });
  });
});

describe('activity-derived alerts', () => {
  const at = '2026-10-20T12:00:00.000Z';
  const now = new Date('2026-10-20T12:05:00Z');
  const ev = (over: Partial<ActivityRow> = {}): ActivityRow => ({
    id: 'scl:10', household_id: HH, type: 'item_added', actor_id: BOB, actor_name: 'Bob', subject: 'Milk', list_id: 'list-1', ref_id: null, at, ...over,
  });
  it('quiet defaults: nothing for ordinary activity until a member opts in', () => {
    expect(planActivityNotifications([ev(), ev({ id: 'recipe:1', type: 'recipe_added', subject: 'Soup' })], [rcpt(ALICE)], [], now)).toHaveLength(0);
  });
  it('opted-in types notify everyone but the actor, with generic push text', () => {
    const r = rcpt(ALICE, { types: resolveTypes({ recipe_added: { inApp: true, push: true } }) });
    const out = planActivityNotifications([ev({ id: 'recipe:1', type: 'recipe_added', subject: 'Secret soup', ref_id: 'r-1' })], [r, rcpt(BOB, r.settings)], [], now);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ userId: ALICE, title: 'Bob added the recipe Secret soup', link: '/recipes/r-1', dedupeKey: 'activity:recipe:1', pushStatus: 'pending' });
    expect(out[0]!.pushBody).toBe('Bob added a recipe.');
  });
  it('"list changed while you are shopping" only for someone ticking that list recently, one per 10 minutes', () => {
    const shopping = [{ householdId: HH, listId: 'list-1', userId: ALICE, lastAt: '2026-10-20T11:50:00.000Z' }];
    const out = planActivityNotifications([ev(), ev({ id: 'scl:11', subject: 'Eggs', at: '2026-10-20T12:01:00.000Z' })], [rcpt(ALICE)], shopping, now);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'list_changed_while_shopping', link: '/shopping', pushStatus: 'pending' });
    expect(out[0]!.pushBody).not.toContain('Milk');
    expect(planActivityNotifications([ev()], [rcpt(ALICE)], [{ ...shopping[0]!, lastAt: '2026-10-20T10:00:00.000Z' }], now)).toHaveLength(0);
    expect(planActivityNotifications([ev()], [rcpt(ALICE)], [{ ...shopping[0]!, listId: 'other' }], now)).toHaveLength(0);
  });
});

describe('restock nudges (PR1 minimum stock)', () => {
  it('opt-in only, one per member per local day', () => {
    const on = rcpt(ALICE, { types: resolveTypes({ restock: { inApp: true, push: false } }) });
    expect(restockHouseholds([rcpt(BOB), on])).toEqual([HH]);
    const out = planRestockAlerts(new Map([[HH, 3]]), [on, rcpt(BOB)], new Date('2026-10-20T09:00:00Z'));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: '3 items are below your minimum stock', dedupeKey: 'restock:2026-10-20', pushStatus: 'not_requested' });
    expect(planRestockAlerts(new Map([[HH, 0]]), [on], new Date('2026-10-20T09:00:00Z'))).toHaveLength(0);
  });
});
