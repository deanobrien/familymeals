import { z } from 'zod';

export const LOCALES = ['en-GB', 'en-IE'] as const;
export const UNIT_SYSTEMS = ['metric', 'imperial'] as const;

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

/** Wording version recorded with the consent. Text lives in CONSENT_WORDING_V1. */
export const CONSENT_WORDING_VERSION = 'v1';

// From PRIVACY.md section 2 (v1). Keep verbatim; bump the version if it changes.
export const CONSENT_WORDING_V1 =
  'You can tell us about allergies or foods your household avoids so we can leave them out of meal suggestions. This is health-related information, which the law treats as especially sensitive. We will only use it to filter recipes and plans for your household, and we will only share it with other members of your household. We may send an anonymous list such as ‘peanuts, sesame’ (never your name or account) to our AI provider when you ask it to suggest meals. You can change or remove this at any time in Settings.';

export const CONSENT_CHECKBOX_LABEL = 'I agree to this use of my dietary information.';

/** Form values are raw strings as typed; the schema parses them into typed values. */
export const preferencesSchema = z.object({
  defaultServings: z
    .string()
    .trim()
    .regex(/^\d+$/, 'Enter a whole number of servings')
    .transform(Number)
    .refine((n) => n >= 1 && n <= 24, 'Servings must be between 1 and 24'),
  currency: z.literal('GBP'),
  locale: z.enum(LOCALES),
  units: z.enum(UNIT_SYSTEMS),
  /** Pounds as typed (e.g. "85" or "85.50"); empty means no budget. Converted to integer pence. */
  weeklyBudget: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{1,5}(\.\d{1,2})?$/.test(v), 'Enter an amount in pounds, e.g. 85 or 85.50')
    .transform((v) => (v === '' ? null : Math.round(parseFloat(v) * 100))),
});

export type PreferencesInput = z.input<typeof preferencesSchema>;
export type Preferences = z.output<typeof preferencesSchema>;

const exclusionTag = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Enter a food to exclude')
  .max(40, 'Keep it short, 40 characters at most')
  .regex(/^[a-z][a-z' -]*$/, 'Use letters only');

export const exclusionsSchema = z
  .object({
    tags: z.array(exclusionTag).max(40, 'Too many exclusions'),
    consent: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.tags.length > 0 && !v.consent) {
      ctx.addIssue({
        code: 'custom',
        path: ['consent'],
        message: 'Please tick the box to agree before saving dietary information',
      });
    }
  });

export type ExclusionsInput = z.input<typeof exclusionsSchema>;

/** A soft dislike (P1-B, D378): plain words like "mushrooms" or "blue cheese". Never an allergy, so no consent is involved. */
export const dislikeTag = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Enter a food')
  .max(60, 'Keep it short, 60 characters at most')
  .regex(/^[a-z][a-z' -]*$/, 'Use letters only');

export const dislikesSchema = z.object({
  memberId: z.string().trim().min(1).max(64),
  terms: z.array(dislikeTag).max(30, 'Too many foods (30 at most)'),
});
export type DislikesInput = z.input<typeof dislikesSchema>;

export const DEFAULT_PREFERENCES: PreferencesInput = {
  defaultServings: '4',
  currency: 'GBP',
  locale: 'en-GB',
  units: 'metric',
  weeklyBudget: '',
};
