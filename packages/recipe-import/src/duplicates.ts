import type { RecipeSummary } from './types.js';
import { jaccard, normText } from './util.js';

export interface DuplicateCandidate { title: string; ingredientNames?: string[]; ingredientIds?: string[]; }
export interface DuplicateMatch { recipeId: string; title: string; titleSimilarity: number; ingredientSimilarity: number; score: number; }

const tokens = (s: string) => new Set(normText(s).split(' ').filter(Boolean));
const nameSet = (names: string[] = []) => new Set(names.map(normText).filter(Boolean));

/** Normalised-title + ingredient-set Jaccard against existing recipes, best match first. */
export function findDuplicates(
  candidate: DuplicateCandidate, existing: RecipeSummary[], opts: { threshold?: number } = {},
): DuplicateMatch[] {
  const threshold = opts.threshold ?? 0.7;
  const cTitle = normText(candidate.title);
  const cTokens = tokens(candidate.title);
  const out: DuplicateMatch[] = [];
  for (const r of existing) {
    const rTitle = normText(r.title);
    const titleSim = cTitle === rTitle ? 1 : jaccard(cTokens, tokens(r.title));
    const useIds = !!candidate.ingredientIds?.length && !!r.ingredientIds?.length;
    const ingSim = useIds
      ? jaccard(new Set(candidate.ingredientIds), new Set(r.ingredientIds))
      : jaccard(nameSet(candidate.ingredientNames), nameSet(r.ingredientNames));
    const score = 0.4 * titleSim + 0.6 * ingSim;
    const same = (cTitle === rTitle && ingSim >= 0.5) || ingSim >= 0.9 || score >= threshold;
    if (same) out.push({ recipeId: r.id, title: r.title, titleSimilarity: titleSim, ingredientSimilarity: ingSim, score });
  }
  return out.sort((a, b) => b.score - a.score);
}
