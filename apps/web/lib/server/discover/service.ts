import 'server-only';
import { buildDraft, type RecipeDraft, type RecipeSummary } from '@fr/recipe-import';
import {
  RecipeSourceError, filterByExclusions, inferDiet, isActive, splitInstructions, toExtraction,
  type ExclusionRules, type InferredDiet, type RecipeSource, type SourceRecipe,
} from '@fr/recipe-sources';
import { termMatches } from '@fr/engine/planner';
import type { Household, RecipeIdeaNeed } from '@fr/plan-orchestrator';
import { ingredientMatcher, ingredientParser } from '../import/engine-adapter';
import { RepositoryRecipeSink } from '../import/sink';
import { putUpload, type UploadOwner } from '../import/upload-store';
import { getRecipeRepository } from '../../recipes/factory';
import type { RecipeRepository } from '../../recipes/repository';
import { createExclusionResolver, textHitsAllergenGroups } from '../plan/exclusions';
import { getIngredientCatalogue, type IngredientCatalogue } from '../refdata/catalogue';
import { getRecipeSource } from './source';

export interface DiscoverCard {
  id: string;
  title: string;
  imageUrl?: string;
  area?: string;
  category?: string;
  diet: InferredDiet;
  /** Why the diet label is what it is (always unverified). */
  dietNote: string;
  ingredients: { name: string; measure: string }[];
  steps: string[];
  attribution: { publisher: string; url: string; id: string };
  youtubeUrl?: string;
  creativeCommons?: string;
}

export interface DiscoverFilters { q?: string; area?: string; category?: string; ingredient?: string }

/** The extra exclusions a caller may ADD (never remove): the planner request's own terms / allergens / diets. */
export interface ExtraExclusions { terms?: string[]; allergens?: string[]; excludeDiets?: InferredDiet[] }

export type DiscoverOutcome =
  | { ok: true; cards: DiscoverCard[]; withheld: number; withheldUnverifiable: number; exclusionsActive: boolean; sourceLabel: string }
  | { ok: false; message: string };

const MAX_CARDS = 12;

/** Household hard exclusions + extras -> the rules the filter enforces (names resolved server-side, D132). */
export function buildRules(household: Pick<Household, 'hardExclusions'>, extra: ExtraExclusions = {}, cat: IngredientCatalogue = getIngredientCatalogue()): { rules: ExclusionRules; active: boolean } {
  const terms = [...new Set([...household.hardExclusions.map((x) => x.ingredientName), ...(extra.terms ?? [])].map((t) => t.trim()).filter(Boolean))];
  const allergens = [...new Set((extra.allergens ?? []).map((t) => t.trim()).filter(Boolean))];
  const resolved = createExclusionResolver(cat)({ terms, allergens });
  const ids = new Set<string>(resolved.excludeIngredientIds);
  for (const groupIds of Object.values(resolved.allergenGroups)) for (const id of groupIds) ids.add(id);
  const groups = Object.keys(resolved.allergenGroups);
  const allTerms = [...new Set([...terms, ...allergens])];
  const rules: ExclusionRules = {
    terms: allTerms,
    excludeIngredientIds: ids,
    excludeDiets: extra.excludeDiets ?? [],
    resolveIngredientId: (name) => {
      const m = cat.matcher.match(name);
      return m.status === 'matched' ? m.ingredientId : undefined;
    },
    textHitsAllergen: (text) => textHitsAllergenGroups(text, groups),
    termMatches,
  };
  return { rules, active: isActive({ terms: allTerms, excludeIngredientIds: ids, allergensActive: groups.length > 0 }) };
}

const categoryResolver = (cat: IngredientCatalogue) => (name: string): string | undefined => {
  const m = cat.matcher.match(name);
  return m.status === 'matched' && m.ingredientId ? cat.get(m.ingredientId)?.category : undefined;
};

export function toCard(r: SourceRecipe, cat: IngredientCatalogue = getIngredientCatalogue()): DiscoverCard {
  const d = inferDiet(r, categoryResolver(cat));
  return {
    id: r.id,
    title: r.title,
    ...(r.imageUrl ? { imageUrl: r.imageUrl } : {}),
    ...(r.area ? { area: r.area } : {}),
    ...(r.category ? { category: r.category } : {}),
    diet: d.diet,
    dietNote: d.reason,
    ingredients: r.ingredients.map((i) => ({ name: i.name, measure: i.measure })),
    steps: splitInstructions(r.instructions),
    attribution: { ...r.attribution },
    ...(r.youtubeUrl ? { youtubeUrl: r.youtubeUrl } : {}),
    ...(r.creativeCommons ? { creativeCommons: r.creativeCommons } : {}),
  };
}

function failure(e: unknown): { ok: false; message: string } {
  if (e instanceof RecipeSourceError) {
    return { ok: false, message: e.code === 'RATE_LIMITED' ? e.message : 'The recipe source is not reachable right now. Your own recipes are unaffected; please try again later.' };
  }
  console.error('[discover] unexpected error', e);
  return { ok: false, message: 'Something went wrong looking for recipes. Please try again.' };
}

/** Run the exclusion filter over a pool and turn the survivors into cards. */
function finish(pool: SourceRecipe[], household: Pick<Household, 'hardExclusions'>, extra: ExtraExclusions, sourceLabel: string, accept?: (d: InferredDiet) => boolean, cat = getIngredientCatalogue()): DiscoverOutcome {
  const { rules, active } = buildRules(household, extra, cat);
  const dietOf = (r: SourceRecipe) => inferDiet(r, categoryResolver(cat)).diet;
  const seen = new Set<string>();
  const unique = pool.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  const safe = filterByExclusions(unique, rules, dietOf, active);
  const kept = accept ? safe.kept.filter((r) => accept(dietOf(r))) : safe.kept;
  return {
    ok: true,
    cards: kept.slice(0, MAX_CARDS).map((r) => toCard(r, cat)),
    withheld: safe.withheld,
    withheldUnverifiable: safe.withheldUnverifiable,
    exclusionsActive: active,
    sourceLabel,
  };
}

export async function discoverSearch(
  filters: DiscoverFilters, household: Pick<Household, 'hardExclusions'>, extra: ExtraExclusions = {}, source: RecipeSource = getRecipeSource(),
): Promise<DiscoverOutcome> {
  try {
    const pool = await source.search(filters.q ?? '', {
      ...(filters.area ? { area: filters.area } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.ingredient ? { ingredient: filters.ingredient } : {}),
      limit: 30,
    });
    return finish(pool, household, extra, source.name);
  } catch (e) {
    return failure(e);
  }
}

/** TheMealDB categories that can satisfy a planner need. The diet label is re-derived from the ingredients regardless. */
export function categoriesFor(c: RecipeIdeaNeed['criteria']): string[] {
  if (c.mealType === 'breakfast') return ['Breakfast'];
  switch (c.dietCategory) {
    case 'fish': return ['Seafood'];
    case 'vegan': return ['Vegan'];
    case 'vegetarian': return ['Vegetarian', 'Vegan'];
    case 'meat': return ['Chicken', 'Beef', 'Pork', 'Lamb'];
    default: return ['Chicken', 'Vegetarian', 'Seafood', 'Pasta'];
  }
}

const acceptsDiet = (want: RecipeIdeaNeed['criteria']['dietCategory']) => (d: InferredDiet): boolean =>
  want === undefined ? true : want === 'vegetarian' ? d === 'vegetarian' || d === 'vegan' : d === want;

/** "Find ideas" for a planner shortfall. Exclusions are re-derived here from the household; the client adds, never removes. */
export async function discoverIdeas(
  criteria: RecipeIdeaNeed['criteria'], household: Pick<Household, 'hardExclusions'>, extra: ExtraExclusions = {}, source: RecipeSource = getRecipeSource(),
): Promise<DiscoverOutcome> {
  try {
    const cats = categoriesFor(criteria);
    const per = cats.length === 1 ? MAX_CARDS : 6;
    const pool: SourceRecipe[] = [];
    for (const c of cats) pool.push(...(await source.byCategory(c, per)));
    return finish(pool, household, extra, source.name, acceptsDiet(criteria.dietCategory));
  } catch (e) {
    return failure(e);
  }
}

export type DraftOutcome =
  | { ok: true; uploadId: string; draft: RecipeDraft; existing: RecipeSummary[] }
  | { ok: false; message: string };

/**
 * Turn a discovered recipe into the SAME reviewable draft a photo import produces (no AI). Held in the upload store
 * (no images) under the caller's identity and saved by /api/extract/save after the user has reviewed it.
 */
export async function startDiscoverDraft(
  id: string, owner: UploadOwner, household: Pick<Household, 'hardExclusions'>, source: RecipeSource = getRecipeSource(),
  repo: RecipeRepository = getRecipeRepository(),
): Promise<DraftOutcome> {
  try {
    const r = await source.byId(id);
    if (!r) return { ok: false, message: 'That recipe could not be found at the source any more.' };
    const cat = getIngredientCatalogue();
    const res = finish([r], household, {}, source.name, undefined, cat);
    if (res.ok && res.cards.length === 0) {
      return { ok: false, message: 'This recipe contains something your household excludes (or an ingredient we cannot check against your exclusions), so it cannot be added.' };
    }
    const diet = inferDiet(r, categoryResolver(cat));
    const extraction = toExtraction(r, ingredientParser, diet);
    const draft = buildDraft(extraction, { parser: ingredientParser, matcher: ingredientMatcher }, {
      source: `${r.attribution.publisher} - ${r.attribution.url}`,
      sourceImageRefs: [],
    });
    if (r.imageUrl) draft.coverImageRef = r.imageUrl;
    const rec = putUpload([], r.title, owner);
    rec.draft = draft;
    const existing = await new RepositoryRecipeSink(repo).list();
    return { ok: true, uploadId: rec.id, draft, existing };
  } catch (e) {
    return failure(e);
  }
}
