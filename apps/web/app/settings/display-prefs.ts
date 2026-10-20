import { LOCALES, UNIT_SYSTEMS } from './schema';

/** Display-only choices (units, locale) live in a plain cookie on this browser, like the Android app keeps them on the phone (D325/D352). */
export const DISPLAY_PREFS_COOKIE = 'fr_display';

export interface DisplayPrefs {
  units: (typeof UNIT_SYSTEMS)[number];
  locale: (typeof LOCALES)[number];
}

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = { units: 'metric', locale: 'en-GB' };

export function serializeDisplayPrefs(p: DisplayPrefs): string {
  return `${p.units}|${p.locale}`;
}

/** Anything unexpected falls back to the defaults. */
export function parseDisplayPrefs(raw: string | undefined | null): DisplayPrefs {
  const [units, locale] = (raw ?? '').split('|');
  return {
    units: (UNIT_SYSTEMS as readonly string[]).includes(units ?? '') ? (units as DisplayPrefs['units']) : DEFAULT_DISPLAY_PREFS.units,
    locale: (LOCALES as readonly string[]).includes(locale ?? '') ? (locale as DisplayPrefs['locale']) : DEFAULT_DISPLAY_PREFS.locale,
  };
}
