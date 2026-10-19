import { describe, expect, it } from 'vitest';
import { InMemoryConsentSink, consentEvent } from './consent';
import {
  CONSENT_WORDING_V1,
  DEFAULT_PREFERENCES,
  exclusionsSchema,
  preferencesSchema,
} from './schema';

describe('preferencesSchema', () => {
  it('accepts defaults and converts budget to pence', () => {
    const r = preferencesSchema.safeParse({ ...DEFAULT_PREFERENCES, weeklyBudget: '85.50' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.weeklyBudget).toBe(8550);
      expect(r.data.defaultServings).toBe(4);
    }
  });

  it('treats an empty budget as none', () => {
    const r = preferencesSchema.parse(DEFAULT_PREFERENCES);
    expect(r.weeklyBudget).toBeNull();
  });

  it.each(['0', '25', 'abc', '2.5', ''])('rejects servings %j', (v) => {
    expect(preferencesSchema.safeParse({ ...DEFAULT_PREFERENCES, defaultServings: v }).success).toBe(false);
  });

  it.each(['-5', '12.345', 'lots', '£50'])('rejects budget %j', (v) => {
    expect(preferencesSchema.safeParse({ ...DEFAULT_PREFERENCES, weeklyBudget: v }).success).toBe(false);
  });

  it('rejects other currencies, locales and units', () => {
    expect(preferencesSchema.safeParse({ ...DEFAULT_PREFERENCES, currency: 'USD' }).success).toBe(false);
    expect(preferencesSchema.safeParse({ ...DEFAULT_PREFERENCES, locale: 'fr-FR' }).success).toBe(false);
    expect(preferencesSchema.safeParse({ ...DEFAULT_PREFERENCES, units: 'cups' }).success).toBe(false);
  });
});

describe('exclusionsSchema', () => {
  it('requires consent when any exclusion is saved', () => {
    const r = exclusionsSchema.safeParse({ tags: ['peanuts'], consent: false });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['consent']);
  });

  it('allows an empty list without consent and normalises tags', () => {
    expect(exclusionsSchema.safeParse({ tags: [], consent: false }).success).toBe(true);
    const r = exclusionsSchema.parse({ tags: ['  Peanuts '], consent: true });
    expect(r.tags).toEqual(['peanuts']);
  });

  it('rejects free-text that is not a short food name', () => {
    expect(exclusionsSchema.safeParse({ tags: ['x'.repeat(41)], consent: true }).success).toBe(false);
    expect(exclusionsSchema.safeParse({ tags: ['type 1 diabetes!'], consent: true }).success).toBe(false);
  });
});

describe('ConsentSink', () => {
  it('records versioned grant and withdrawal events', async () => {
    const sink = new InMemoryConsentSink();
    await sink.record(consentEvent(true, new Date('2026-10-19T10:00:00Z')));
    await sink.record(consentEvent(false, new Date('2026-10-20T10:00:00Z')));
    expect(sink.events.map((e) => e.granted)).toEqual([true, false]);
    expect(sink.events[0]).toMatchObject({ purpose: 'dietary_restrictions', wordingVersion: 'v1' });
  });

  it('wording matches PRIVACY.md v1', () => {
    expect(CONSENT_WORDING_V1).toContain('health-related information');
  });
});
