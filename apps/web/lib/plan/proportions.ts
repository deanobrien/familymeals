// Diet proportions over a fixed number of meals. A 7-day plan cannot always honour percentages exactly,
// so counts are rounded with the largest-remainder method and the rounding is explained to the user.
import type { DietCategory } from './types';

export const DIET_CATEGORIES: readonly DietCategory[] = ['meat', 'fish', 'vegetarian', 'vegan'];
export type Proportions = Partial<Record<DietCategory, number>>; // fractions 0..1

export interface RoundedProportions {
  counts: Record<DietCategory, number>;
  /** Fractions after normalising to a total of 1 (empty when nothing was requested). */
  normalised: Record<DietCategory, number>;
  explanations: string[];
}

const pct = (f: number) => `${Math.round(f * 1000) / 10}%`;

export function roundProportions(input: Proportions, meals: number): RoundedProportions {
  const zero = { meat: 0, fish: 0, vegetarian: 0, vegan: 0 } as Record<DietCategory, number>;
  const clean = DIET_CATEGORIES.map((c) => [c, Math.max(0, input[c] ?? 0)] as const);
  const total = clean.reduce((s, [, v]) => s + v, 0);
  if (total <= 0 || meals <= 0) return { counts: { ...zero }, normalised: { ...zero }, explanations: [] };

  const explanations: string[] = [];
  if (Math.abs(total - 1) > 0.001) {
    explanations.push(`Your shares add up to ${pct(total)}, so they were scaled to 100%.`);
  }
  const normalised = { ...zero };
  const exact = { ...zero };
  const counts = { ...zero };
  for (const [c, v] of clean) {
    normalised[c] = v / total;
    exact[c] = normalised[c] * meals;
    counts[c] = Math.floor(exact[c] + 1e-9);
  }
  let remaining = meals - DIET_CATEGORIES.reduce((s, c) => s + counts[c], 0);
  const byRemainder = [...DIET_CATEGORIES].sort((a, b) => exact[b] - Math.floor(exact[b]) - (exact[a] - Math.floor(exact[a])) || DIET_CATEGORIES.indexOf(a) - DIET_CATEGORIES.indexOf(b));
  for (const c of byRemainder) {
    if (remaining <= 0) break;
    if (exact[c] - Math.floor(exact[c]) > 1e-9) {
      counts[c]++;
      remaining--;
    }
  }
  for (const c of DIET_CATEGORIES) {
    if (Math.abs(counts[c] - exact[c]) > 1e-6) {
      explanations.push(
        `${pct(normalised[c])} of ${meals} meals is ${Math.round(exact[c] * 100) / 100}, which cannot be cooked, so ${c} is rounded to ${counts[c]} meal${counts[c] === 1 ? '' : 's'}.`,
      );
    }
  }
  if (explanations.length === 0 || explanations.every((e) => e.startsWith('Your shares'))) {
    explanations.push(`These shares divide exactly into ${meals} meals.`);
  } else {
    explanations.push('Whole meals are shared out by the largest remainder, so the actual split can differ slightly from the percentages.');
  }
  return { counts, normalised, explanations };
}

/** Sentence appended to the planning prompt so the AI parser picks the shares up. */
export function proportionsSentence(input: Proportions): string {
  const parts = DIET_CATEGORIES.filter((c) => (input[c] ?? 0) > 0).map((c) => `${Math.round((input[c] ?? 0) * 100)}% ${c}`);
  return parts.length ? `Aim for roughly ${parts.join(', ')}.` : '';
}
