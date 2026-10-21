// Client-safe view types for calendar-aware planning (P2-C, D410-D415). Only derived flags ever appear here: no event titles.
import type { BusySource } from '@fr/engine/calendar';

export type { BusySource };

/** One busy evening in the week, merged across sources. */
export interface BusyDayView {
  date: string;
  sources: BusySource[];
  /** null = unknown (manual toggle only). */
  minutesAvailable: number | null;
  /** The dinner is skipped (almost no time) instead of made quick. */
  skip: boolean;
  /** "Busy (about 45 min free)" / "Busy" / "Dinner skipped (about 10 min free)". */
  label: string;
}

/** The caller's own calendar connections (never the ICS address itself). */
export interface CalendarStatus {
  icsConfigured: boolean;
  /** Host only, e.g. "calendar.google.com". */
  icsHost: string | null;
  lastSyncedAt: string | null;
  lastStatus: string | null;
  /** The caller's own device flags in the household (Android sync). */
  deviceFlagCount: number;
}

export type CalendarError = 'bad_url' | 'blocked' | 'unreachable' | 'not_calendar' | 'no_secret' | 'not_configured' | 'invalid_input' | 'read_only' | 'forbidden' | 'unknown';

export type CalendarResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: CalendarError; message: string };

export const CALENDAR_ERROR_MESSAGE: Record<CalendarError, string> = {
  bad_url: 'That does not look like a calendar address. Paste the "secret address in iCal format" (a link ending .ics).',
  blocked: 'That address is not a public web address, so it cannot be read.',
  unreachable: 'We could not read that calendar right now. Check the address and try again.',
  not_calendar: 'That address did not return a calendar.',
  no_secret: 'The server is not set up to store calendar addresses (APP_SECRET is missing).',
  not_configured: 'No calendar link is saved.',
  invalid_input: 'Some values were not accepted.',
  read_only: 'This household is read-only while it is pending deletion.',
  forbidden: 'You do not have access to that.',
  unknown: 'Something went wrong. Please try again.',
};
