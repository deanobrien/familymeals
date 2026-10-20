/** Which ingredient lines a method step talks about (cook mode's per-step checklist). Pure name matching, no AI. */

export interface StepIngredient {
  id: string;
  name: string;
}

const STOP = new Set(['fresh', 'ground', 'large', 'small', 'medium', 'dried', 'chopped', 'sliced', 'finely', 'frozen', 'tinned', 'canned', 'plain', 'of', 'the', 'and', 'or', 'for', 'to', 'a', 'extra', 'virgin', 'whole']);

const stem = (w: string): string => (w.length > 3 ? w.replace(/ies$/, 'y').replace(/(?:es|s)$/, '') : w);
const words = (s: string): string[] => s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * An ingredient belongs to a step when the step mentions its full name, or its last significant word ("tinned chopped
 * tomatoes" -> "tomato"), matched on word stems so plurals agree. Over-inclusion is cheap here (a checkbox), missing a
 * mention is the worse error, so a single distinctive word is enough.
 */
export function ingredientsForStep(stepText: string, ingredients: readonly StepIngredient[]): StepIngredient[] {
  const stepWords = words(stepText).map(stem);
  const set = new Set(stepWords);
  const flat = ` ${stepWords.join(' ')} `;
  return ingredients.filter((ing) => {
    const sig = words(ing.name).filter((w) => !STOP.has(w));
    if (sig.length === 0) return false;
    if (flat.includes(` ${sig.map(stem).join(' ')} `)) return true;
    const last = stem(sig[sig.length - 1]!);
    return last.length > 2 && set.has(last);
  });
}
