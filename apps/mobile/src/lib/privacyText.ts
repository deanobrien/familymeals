/**
 * Special-category consent text and allergen list, copied VERBATIM from the web settings
 * (apps/web/app/settings/schema.ts, PRIVACY.md section 2). `__tests__/privacyText.test.ts` reads the web file and fails
 * if either copy drifts; bump the wording version in both places if the text ever changes.
 */
export const CONSENT_WORDING_VERSION = 'v1';

export const CONSENT_WORDING_V1 =
  'You can tell us about allergies or foods your household avoids so we can leave them out of meal suggestions. This is health-related information, which the law treats as especially sensitive. We will only use it to filter recipes and plans for your household, and we will only share it with other members of your household. We may send an anonymous list such as ‘peanuts, sesame’ (never your name or account) to our AI provider when you ask it to suggest meals. You can change or remove this at any time in Settings.';

export const CONSENT_CHECKBOX_LABEL = 'I agree to this use of my dietary information.';

/** UK major allergens (plus common exclusions). Stored as tags, never free-text health notes. */
export const COMMON_EXCLUSIONS = [
  'celery',
  'cereals containing gluten',
  'crustaceans',
  'eggs',
  'fish',
  'lupin',
  'milk',
  'molluscs',
  'mustard',
  'peanuts',
  'sesame',
  'soya',
  'sulphites',
  'tree nuts',
] as const;

export const DIETARY_HELP =
  'Optional. The app works without this. Please do not enter medical conditions or medication. This helps filter plans but is not an allergen safety guarantee: always check product labels.';

/** Mirrors apps/web/lib/consent/notice.ts: a COUNT only, never allergen or member names. */
export function consentNoticeText(withheld: number): string | null {
  const n = Math.max(0, Math.floor(withheld));
  if (!(n > 0)) return null;
  const subject = n === 1 ? "1 allergy exclusion isn't" : `${n} allergy exclusions aren't`;
  return `${subject} being applied because consent hasn't been given`;
}

/** Public web pages the app links to instead of duplicating (always current, one source of truth). */
export const PRIVACY_PATH = '/privacy';
export const SOURCES_PATH = '/about/sources';
export const WEB_SETTINGS_PATH = '/settings';
