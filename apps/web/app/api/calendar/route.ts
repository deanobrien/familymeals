import { NextResponse } from 'next/server';
import { apiError, bodyHousehold, guarded, isRecord, json, queryHousehold, readJson } from '../../../lib/server/api/bearer-route';
import { callerOf } from '../../../lib/server/cooking/api';
import {
  calendarStatus, refreshIcsFeed, removeIcsFeed, revokeDeviceCalendar, saveIcsFeed, setManualBusy, syncDeviceBusy,
} from '../../../lib/server/calendar/service';
import { loadBusyViews, weekEnd } from '../../../lib/server/calendar/planner';
import type { CalendarResult } from '../../../lib/calendar/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS: Record<string, number> = { read_only: 403, forbidden: 403, not_configured: 404, invalid_input: 422, bad_url: 422, blocked: 422, not_calendar: 422, unreachable: 502, no_secret: 503, unknown: 500 };

function respond(r: CalendarResult<object>): NextResponse {
  if (r.ok) {
    const rest: Record<string, unknown> = { ...r };
    delete rest.ok;
    return json(rest);
  }
  return apiError(STATUS[r.error] ?? 500, r.error.toUpperCase(), r.message, r.error === 'unreachable' || r.error === 'unknown');
}

/** GET ?householdId=&week=YYYY-MM-DD -> { status, busy? }: the caller's own calendar connections (never the ICS address) and, with `week`, that week's busy evenings. */
export async function GET(req: Request) {
  return guarded(req, queryHousehold(req), {}, async (auth) => {
    const caller = callerOf(auth);
    const status = await calendarStatus(caller);
    if (!status.ok) return respond(status);
    const week = new URL(req.url).searchParams.get('week');
    const busy = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? await loadBusyViews(auth.householdId, caller.client, week, weekEnd(week)) : undefined;
    return json({ status: status.status, ...(busy ? { busy } : {}) });
  });
}

/**
 * POST { householdId?, action, ... }:
 *   busy_set      { date, busy }                   manual toggle (any member)
 *   device_sync   { from, to, days:[{date,busy,minutesAvailable}] }   Android: derived flags only, computed on the phone
 *   device_revoke {}                               forget everything the device calendar contributed
 *   ics_save      { url, timeZone? }               save + read an ICS subscription (address stored encrypted, never returned)
 *   ics_refresh   { timeZone?, onlyIfStale? }      re-read it
 *   ics_remove    {}                               delete the address and its flags
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), { write: true }, async (auth) => {
    if (!isRecord(body)) return apiError(400, 'BAD_REQUEST', 'Send a JSON object.');
    const caller = callerOf(auth);
    switch (body.action) {
      case 'busy_set': return respond(await setManualBusy(caller, body.date, body.busy));
      case 'device_sync': return respond(await syncDeviceBusy(caller, { from: body.from, to: body.to, days: body.days }));
      case 'device_revoke': return respond(await revokeDeviceCalendar(caller));
      case 'ics_save': return respond(await saveIcsFeed(caller, body.url, body.timeZone));
      case 'ics_refresh': return respond(await refreshIcsFeed(caller, body.timeZone, { onlyIfStale: body.onlyIfStale === true }));
      case 'ics_remove': return respond(await removeIcsFeed(caller));
      default: return apiError(400, 'BAD_REQUEST', 'Unknown action.');
    }
  });
}
