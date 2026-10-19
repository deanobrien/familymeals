import type { NutrientKey } from '../contract';
import {
  KJ_PER_KCAL, NUTRIENT_KEYS, SALT_PER_SODIUM, type NutrientProfile, type ProfileNutrient,
} from './types';

export type NormalisedProfile = Record<NutrientKey, ProfileNutrient>;

const usable = (n: ProfileNutrient) => n.status === 'known' || n.status === 'zero';

/** Validate each entry: known needs a finite value >= 0; known 0 becomes 'zero'; zero forces value 0. */
function clean(n: ProfileNutrient | undefined, fallbackSource?: string): ProfileNutrient {
  if (!n) return { status: 'unavailable' };
  const source = n.source ?? fallbackSource;
  if (n.status === 'zero') return { ...n, value: 0, source };
  if (n.status === 'known') {
    if (typeof n.value !== 'number' || !Number.isFinite(n.value) || n.value < 0) return { status: 'unknown', source };
    if (n.value === 0) return { ...n, status: 'zero', value: 0, source };
    return { ...n, source };
  }
  return { status: n.status, source };
}

function derive(from: ProfileNutrient, factor: number, label: string): ProfileNutrient {
  const v = (from.value ?? 0) * factor;
  return {
    status: v === 0 ? 'zero' : 'known', value: v,
    source: `derived from ${label}${from.source ? ` (${from.source})` : ''}`,
    estimate: from.estimate ?? false, derived: true,
  };
}

/**
 * Fill every key, derive kJ<->kcal (x4.184) and salt<->sodium (salt g = sodium mg x 2.5 / 1000) when only
 * one side of a pair has usable data. Derived values are flagged `derived`. If both exist but disagree by
 * more than 10% a warning is pushed (the supplied values are kept).
 */
export function normaliseProfile(
  profile: NutrientProfile | undefined, warnings: string[] = [], label = 'ingredient',
): NormalisedProfile {
  const out = {} as NormalisedProfile;
  for (const k of NUTRIENT_KEYS) out[k] = clean(profile?.per100g[k], profile?.source);

  const pair = (a: NutrientKey, b: NutrientKey, aToB: number) => {
    const A = out[a], B = out[b];
    if (usable(A) && !usable(B)) out[b] = derive(A, aToB, a);
    else if (usable(B) && !usable(A)) out[a] = derive(B, 1 / aToB, b);
    else if (usable(A) && usable(B)) {
      const expected = (A.value ?? 0) * aToB, actual = B.value ?? 0;
      const ref = Math.max(expected, actual);
      if (ref > 0 && Math.abs(expected - actual) / ref > 0.1)
        warnings.push(`${label}: ${a} and ${b} are inconsistent (>10% apart)`);
    }
  };
  pair('energy_kcal', 'energy_kj', KJ_PER_KCAL);
  pair('sodium', 'salt', SALT_PER_SODIUM / 1000);
  return out;
}
