// P2-C (D410-D415): busy flags, the Android device sync contract, and the ICS subscription (SSRF-safe, encrypted, never logged).
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FetchError, type Transport } from '../import/url/fetch-page';
import type { LookupFn } from '../import/url/ssrf';
import { MemoryCalendarStore, resetMemoryCalendar } from './store';
import {
  calendarStatus, normaliseFeedUrl, refreshIcsFeed, removeIcsFeed, resetIcsThrottle, revokeDeviceCalendar, saveIcsFeed, setManualBusy, syncDeviceBusy,
} from './service';

process.env.APP_SECRET = 'unit-test-secret-0123456789abcdef';

const H = 'household-1';
const caller = { householdId: H, userId: 'alice', client: null, readOnly: false };
const store = new MemoryCalendarStore();
const NOW = Date.parse('2026-10-21T10:00:00Z');
const SECRET_URL = 'https://calendar.example.org/ical/private-token-abc123/basic.ics';

const ics = (extra = ''): string => [
  'BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'UID:1', 'SUMMARY:Oncology appointment', 'DTSTART;TZID=Europe/London:20261022T180000', 'DTEND;TZID=Europe/London:20261022T193000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:2', 'SUMMARY:Short call', 'DTSTART;TZID=Europe/London:20261023T170000', 'DTEND;TZID=Europe/London:20261023T173000', 'END:VEVENT',
  extra, 'END:VCALENDAR', '',
].join('\r\n');

function feed(body: string, opts: { status?: number; type?: string } = {}) {
  const calls: URL[] = [];
  const transport: Transport = async ({ url }) => {
    calls.push(url);
    return { status: opts.status ?? 200, headers: { 'content-type': opts.type ?? 'text/calendar; charset=utf-8' }, body: Readable.from([Buffer.from(body)]) };
  };
  const lookup: LookupFn = async () => [{ address: '93.184.216.34', family: 4 }];
  return { calls, deps: { now: () => NOW, fetchOptions: { transport, lookup } } };
}

beforeEach(() => {
  resetMemoryCalendar();
  resetIcsThrottle();
});
afterEach(() => vi.restoreAllMocks());

const flags = () => store.busyBetween(H, '2026-10-01', '2026-12-01');

describe('manual toggle', () => {
  it('sets and clears a busy day; refuses bad input and read-only households', async () => {
    expect(await setManualBusy(caller, '2026-10-22', true)).toEqual({ ok: true });
    expect(await flags()).toEqual([{ date: '2026-10-22', source: 'manual', minutesAvailable: null }]);
    expect(await setManualBusy(caller, '2026-10-22', false)).toEqual({ ok: true });
    expect(await flags()).toEqual([]);
    expect(await setManualBusy(caller, '2026-02-31', true)).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await setManualBusy(caller, '2026-10-22', 'yes')).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await setManualBusy({ ...caller, readOnly: true }, '2026-10-22', true)).toMatchObject({ ok: false, error: 'read_only' });
  });
});

describe('device sync (Android): derived flags only', () => {
  const day = (date: string, busy: boolean, minutesAvailable: number) => ({ date, busy, minutesAvailable });
  it('stores only busy days with their free minutes and replaces the caller\'s previous flags in the range', async () => {
    const r = await syncDeviceBusy(caller, { from: '2026-10-19', to: '2026-10-25', days: [day('2026-10-20', true, 45), day('2026-10-21', false, 180), day('2026-10-22', true, 10)] });
    expect(r).toEqual({ ok: true, stored: 2 });
    expect(await flags()).toEqual([
      { date: '2026-10-20', source: 'device', minutesAvailable: 45 },
      { date: '2026-10-22', source: 'device', minutesAvailable: 10 },
    ]);
    await syncDeviceBusy(caller, { from: '2026-10-19', to: '2026-10-25', days: [day('2026-10-23', true, 90)] });
    expect(await flags()).toEqual([{ date: '2026-10-23', source: 'device', minutesAvailable: 90 }]);
  });

  it('keeps other members\' flags and other ranges', async () => {
    await syncDeviceBusy({ ...caller, userId: 'bob' }, { from: '2026-10-19', to: '2026-10-25', days: [day('2026-10-20', true, 30)] });
    await syncDeviceBusy(caller, { from: '2026-10-19', to: '2026-10-25', days: [day('2026-10-21', true, 30)] });
    await syncDeviceBusy(caller, { from: '2026-10-26', to: '2026-11-01', days: [] });
    expect((await flags()).map((f) => f.date)).toEqual(['2026-10-20', '2026-10-21']);
  });

  it('ignores anything but the derived numbers (a title in the body is never stored)', async () => {
    const sneaky = { date: '2026-10-20', busy: true, minutesAvailable: 30, title: 'Therapy', attendees: ['dr@example.org'] };
    await syncDeviceBusy(caller, { from: '2026-10-19', to: '2026-10-25', days: [sneaky] });
    expect(JSON.stringify(await flags())).not.toMatch(/therapy|dr@/i);
  });

  it('rejects malformed payloads', async () => {
    const bad = async (input: Parameters<typeof syncDeviceBusy>[1]) => expect(await syncDeviceBusy(caller, input)).toMatchObject({ ok: false, error: 'invalid_input' });
    await bad({ from: 'x', to: '2026-10-25', days: [] });
    await bad({ from: '2026-10-25', to: '2026-10-19', days: [] });
    await bad({ from: '2026-01-01', to: '2026-12-31', days: [] });
    await bad({ from: '2026-10-19', to: '2026-10-25', days: 'nope' });
    await bad({ from: '2026-10-19', to: '2026-10-25', days: [day('2026-11-20', true, 30)] }); // outside the range
    await bad({ from: '2026-10-19', to: '2026-10-25', days: [day('2026-10-20', true, -1)] });
    await bad({ from: '2026-10-19', to: '2026-10-25', days: [day('2026-10-20', true, 99999)] });
    await bad({ from: '2026-10-19', to: '2026-10-25', days: [day('2026-10-20', true, 30), day('2026-10-20', true, 40)] });
    await bad({ from: '2026-10-19', to: '2026-10-25', days: [{ date: '2026-10-20', busy: 'yes', minutesAvailable: 30 }] });
  });

  it('revoking forgets only the caller\'s device flags', async () => {
    await syncDeviceBusy(caller, { from: '2026-10-19', to: '2026-10-25', days: [day('2026-10-20', true, 30)] });
    await syncDeviceBusy({ ...caller, userId: 'bob' }, { from: '2026-10-19', to: '2026-10-25', days: [day('2026-10-21', true, 30)] });
    await setManualBusy(caller, '2026-10-22', true);
    expect((await calendarStatus(caller)) as { ok: true; status: { deviceFlagCount: number } }).toMatchObject({ status: { deviceFlagCount: 1 } });
    expect(await revokeDeviceCalendar(caller)).toEqual({ ok: true });
    expect((await flags()).map((f) => `${f.source}:${f.date}`).sort()).toEqual(['device:2026-10-21', 'manual:2026-10-22']);
  });
});

describe('ICS subscription', () => {
  it('reads busy evenings, stores the address encrypted, and never returns it', async () => {
    const f = feed(ics());
    const r = await saveIcsFeed(caller, SECRET_URL, 'Europe/London', f.deps);
    expect(r).toEqual({ ok: true, busyDays: 1 });
    expect(f.calls[0]!.toString()).toBe(SECRET_URL);
    expect(await flags()).toEqual([{ date: '2026-10-22', source: 'ics', minutesAvailable: 90 }]);
    const row = await store.getFeed(H, 'alice');
    expect(row!.urlEncrypted).not.toContain('private-token');
    expect(row!.urlEncrypted.startsWith('v1.')).toBe(true);
    expect(row!.hostHint).toBe('calendar.example.org');
    const status = await calendarStatus(caller);
    expect(JSON.stringify(status)).not.toContain('private-token');
    expect(status).toMatchObject({ ok: true, status: { icsConfigured: true, icsHost: 'calendar.example.org', lastStatus: 'ok: 1 busy evening' } });
  });

  it('never stores or returns event titles', async () => {
    await saveIcsFeed(caller, SECRET_URL, 'Europe/London', feed(ics()).deps);
    expect(JSON.stringify([await flags(), await store.getFeed(H, 'alice')])).not.toMatch(/oncology|short call/i);
  });

  it('accepts webcal:// addresses', async () => {
    expect(normaliseFeedUrl('webcal://calendar.example.org/x.ics')).toBe('https://calendar.example.org/x.ics');
    const f = feed(ics());
    expect(await saveIcsFeed(caller, 'webcal://calendar.example.org/ical/x/basic.ics', 'Europe/London', f.deps)).toMatchObject({ ok: true });
    expect(f.calls[0]!.protocol).toBe('https:');
  });

  it('blocks internal and non-http addresses before any request is made', async () => {
    const f = feed(ics());
    for (const url of ['http://localhost/cal.ics', 'http://169.254.169.254/latest/meta-data/', 'http://192.168.1.10/cal.ics', 'https://intranet/cal.ics', 'http://[::1]/cal.ics']) {
      const r = await saveIcsFeed(caller, url, 'Europe/London', f.deps);
      expect(r, url).toMatchObject({ ok: false, error: 'blocked' });
    }
    expect(await saveIcsFeed(caller, 'file:///etc/passwd', 'Europe/London', f.deps)).toMatchObject({ ok: false, error: 'bad_url' });
    expect(await saveIcsFeed(caller, 'ftp://example.org/x.ics', 'Europe/London', f.deps)).toMatchObject({ ok: false, error: 'bad_url' });
    expect(await saveIcsFeed(caller, 'https://user:pass@example.org/x.ics', 'Europe/London', f.deps)).toMatchObject({ ok: false, error: 'bad_url' });
    expect(await saveIcsFeed(caller, '', 'Europe/London', f.deps)).toMatchObject({ ok: false, error: 'bad_url' });
    expect(f.calls).toHaveLength(0);
    expect(await store.getFeed(H, 'alice')).toBeNull();
  });

  it('blocks a host whose name resolves to an internal address, and a redirect to one', async () => {
    const f = feed(ics());
    const internal: LookupFn = async () => [{ address: '10.0.0.5', family: 4 }];
    expect(await saveIcsFeed(caller, SECRET_URL, 'Europe/London', { now: () => NOW, fetchOptions: { transport: f.deps.fetchOptions.transport, lookup: internal } })).toMatchObject({ ok: false, error: 'blocked' });
    const redirect: Transport = async () => ({ status: 302, headers: { location: 'http://169.254.169.254/x' }, body: Readable.from([]) });
    const r = await saveIcsFeed(caller, SECRET_URL, 'Europe/London', { now: () => NOW, fetchOptions: { transport: redirect, lookup: f.deps.fetchOptions.lookup } });
    expect(r).toMatchObject({ ok: false, error: 'blocked' });
    expect(await store.getFeed(H, 'alice')).toBeNull();
  });

  it('refuses a page that is not a calendar, and an unreachable host, without saving anything', async () => {
    expect(await saveIcsFeed(caller, SECRET_URL, 'Europe/London', feed('<html>login</html>', { type: 'text/html' }).deps)).toMatchObject({ ok: false, error: 'not_calendar' });
    expect(await saveIcsFeed(caller, SECRET_URL, 'Europe/London', feed('just text', { type: 'text/plain' }).deps)).toMatchObject({ ok: false, error: 'not_calendar' });
    const down: Transport = async () => { throw new FetchError('NETWORK', 'boom'); };
    expect(await saveIcsFeed(caller, SECRET_URL, 'Europe/London', { now: () => NOW, fetchOptions: { transport: down, lookup: feed('').deps.fetchOptions.lookup } })).toMatchObject({ ok: false, error: 'unreachable' });
    expect(await store.getFeed(H, 'alice')).toBeNull();
  });

  it('never writes the address (or its token) to the logs', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const down: Transport = async () => { throw new FetchError('NETWORK', `could not reach ${SECRET_URL}`); };
    await saveIcsFeed(caller, SECRET_URL, 'Europe/London', { now: () => NOW, fetchOptions: { transport: down, lookup: feed('').deps.fetchOptions.lookup } });
    await saveIcsFeed(caller, SECRET_URL, 'Europe/London', feed(ics()).deps);
    await refreshIcsFeed(caller, 'Europe/London', { now: () => NOW + 3_600_000, fetchOptions: { transport: down, lookup: feed('').deps.fetchOptions.lookup } });
    const logged = JSON.stringify([err.mock.calls, log.mock.calls]);
    expect(logged).not.toContain('private-token');
    expect(logged).not.toContain('calendar.example.org');
  });

  it('refresh re-reads the saved address, replaces the flags and throttles repeats', async () => {
    const first = feed(ics());
    await saveIcsFeed(caller, SECRET_URL, 'Europe/London', first.deps);
    // later: the calendar changed (a different evening is now busy)
    const changed = feed(ics().replace('20261022T180000', '20261024T180000').replace('20261022T193000', '20261024T193000'));
    const later = { ...changed.deps, now: () => NOW + 10 * 60_000 };
    expect(await refreshIcsFeed(caller, 'Europe/London', later)).toEqual({ ok: true, busyDays: 1 });
    expect(changed.calls[0]!.toString()).toBe(SECRET_URL); // decrypted from storage
    expect((await flags()).map((f) => f.date)).toEqual(['2026-10-24']);
    // a second refresh inside 5 minutes does nothing
    expect(await refreshIcsFeed(caller, 'Europe/London', { ...changed.deps, now: () => NOW + 12 * 60_000 })).toEqual({ ok: true, busyDays: -1 });
    expect(changed.calls).toHaveLength(1);
  });

  it('onlyIfStale skips a recent read; a failed refresh keeps the old flags and records the failure', async () => {
    await saveIcsFeed(caller, SECRET_URL, 'Europe/London', feed(ics()).deps);
    const spy = feed(ics());
    expect(await refreshIcsFeed(caller, 'Europe/London', { ...spy.deps, now: () => NOW + 10 * 60_000, onlyIfStale: true })).toEqual({ ok: true, busyDays: -1 });
    expect(spy.calls).toHaveLength(0);
    const down: Transport = async () => { throw new FetchError('TIMEOUT', 'slow'); };
    const r = await refreshIcsFeed(caller, 'Europe/London', { now: () => NOW + 10 * 60_000, fetchOptions: { transport: down, lookup: spy.deps.fetchOptions.lookup } });
    expect(r).toMatchObject({ ok: false, error: 'unreachable' });
    expect((await flags()).map((f) => f.date)).toEqual(['2026-10-22']);
    expect(await store.getFeed(H, 'alice')).toMatchObject({ lastStatus: 'error: unreachable' });
  });

  it('refresh without a saved address says so', async () => {
    expect(await refreshIcsFeed(caller, 'Europe/London', { now: () => NOW })).toMatchObject({ ok: false, error: 'not_configured' });
  });

  it('removing deletes the address and every flag that came from it, and nobody else\'s', async () => {
    await saveIcsFeed(caller, SECRET_URL, 'Europe/London', feed(ics()).deps);
    await setManualBusy(caller, '2026-10-21', true);
    expect(await removeIcsFeed(caller)).toEqual({ ok: true });
    expect(await store.getFeed(H, 'alice')).toBeNull();
    expect((await flags()).map((f) => f.source)).toEqual(['manual']);
  });

  it('a feed belongs to its member: another member has none', async () => {
    await saveIcsFeed(caller, SECRET_URL, 'Europe/London', feed(ics()).deps);
    expect(await store.getFeed(H, 'bob')).toBeNull();
    expect(await refreshIcsFeed({ ...caller, userId: 'bob' }, 'Europe/London', { now: () => NOW })).toMatchObject({ ok: false, error: 'not_configured' });
  });

  it('reads times in the stated zone', async () => {
    // 22:00 UTC on the 22nd is 03:30 on the 23rd in Kolkata... use a feed in UTC and compare zones
    const utc = ics().replace(/DTSTART;TZID=Europe\/London:20261022T180000/, 'DTSTART:20261022T170000Z').replace(/DTEND;TZID=Europe\/London:20261022T193000/, 'DTEND:20261022T183000Z');
    await saveIcsFeed(caller, SECRET_URL, 'Europe/London', feed(utc).deps); // 18:00-19:30 BST
    expect((await flags()).map((f) => f.date)).toEqual(['2026-10-22']);
    resetMemoryCalendar();
    resetIcsThrottle();
    await saveIcsFeed(caller, SECRET_URL, 'Asia/Kolkata', feed(utc).deps); // 22:30-00:00 IST: outside the evening window
    expect(await flags()).toEqual([]);
  });

  it('refuses writes on a read-only household', async () => {
    expect(await saveIcsFeed({ ...caller, readOnly: true }, SECRET_URL, 'Europe/London', feed(ics()).deps)).toMatchObject({ ok: false, error: 'read_only' });
  });
});
