import { describe, expect, it } from 'vitest';
import { CONSENT_REVIEW_HREF, consentNoticeText } from './notice';

describe('consentNoticeText', () => {
  it('is null when nothing is withheld (or the count is invalid)', () => {
    expect(consentNoticeText(0)).toBeNull();
    expect(consentNoticeText(-3)).toBeNull();
    expect(consentNoticeText(Number.NaN)).toBeNull();
  });
  it('words singular and plural without naming any allergen or member', () => {
    expect(consentNoticeText(1)).toBe("1 allergy exclusion isn't being applied because consent hasn't been given");
    expect(consentNoticeText(3)).toBe("3 allergy exclusions aren't being applied because consent hasn't been given");
  });
  it('links to the settings allergies section', () => {
    expect(CONSENT_REVIEW_HREF).toBe('/settings#h-diet');
  });
});
