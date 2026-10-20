/**
 * Notice for allergy exclusions withheld because the member who recorded them has not given (or has withdrawn) consent
 * (D125, D129). Shows a COUNT only: no allergen names or member names, so no health detail reaches other members.
 */
export function consentNoticeText(withheld: number): string | null {
  const n = Math.max(0, Math.floor(withheld));
  if (!(n > 0)) return null;
  const subject = n === 1 ? "1 allergy exclusion isn't" : `${n} allergy exclusions aren't`;
  return `${subject} being applied because consent hasn't been given`;
}

/** Where "review in Settings" points: the allergies section, which holds the consent checkbox. */
export const CONSENT_REVIEW_HREF = '/settings#h-diet';
