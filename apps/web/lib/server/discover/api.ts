import 'server-only';
import { z } from 'zod';
import type { Household } from '@fr/plan-orchestrator';
import type { RecipeSource } from '@fr/recipe-sources';
import type { RecipeRepository } from '../../recipes/repository';
import { loadPlanServices } from '../plan/services';
import { discoverSearch, startDiscoverDraft, type DiscoverOutcome, type DraftOutcome } from './service';
import { getRecipeSource, recipeSourceStatus } from './source';

/**
 * Discover orchestration shared by the web server actions (app/recipes/discover/actions.ts) and the bearer JSON API
 * (app/api/discover/**). No cookies, no redirects: the caller passes the household it has already verified.
 */

const text = (max: number) => z.string().trim().max(max).optional();

export const discoverSearchSchema = z.object({ q: text(80), area: text(40), category: text(40), ingredient: text(60) });
export const discoverIdSchema = z.string().regex(/^\d{1,12}$/);

export const EMPTY_DISCOVER: DiscoverOutcome = { ok: true, cards: [], withheld: 0, withheldUnverifiable: 0, exclusionsActive: false, sourceLabel: '' };

export type DiscoverSearchInput = z.infer<typeof discoverSearchSchema>;

/** The household's hard exclusions always apply (the planner profile of THIS household). */
export async function loadDiscoverHousehold(householdId: string): Promise<Household> {
  return (await loadPlanServices(householdId)).household;
}

/** An empty search returns nothing (never "everything"). */
export async function searchDiscover(
  input: DiscoverSearchInput,
  household: Pick<Household, 'hardExclusions'>,
  source?: RecipeSource,
): Promise<DiscoverOutcome> {
  const { q, area, category, ingredient } = input;
  if (!q && !area && !category && !ingredient) return EMPTY_DISCOVER;
  return discoverSearch(
    { ...(q ? { q } : {}), ...(area ? { area } : {}), ...(category ? { category } : {}), ...(ingredient ? { ingredient } : {}) },
    household,
    {},
    source,
  );
}

export async function draftDiscover(
  id: string,
  owner: { userId: string; householdId: string },
  household: Pick<Household, 'hardExclusions'>,
  repo?: RecipeRepository,
  source?: RecipeSource,
): Promise<DraftOutcome> {
  return startDiscoverDraft(id, owner, household, source, repo);
}

export interface DiscoverFilterOptions {
  categories: string[];
  areas: string[];
  sourceLabel: string;
  /** Allergy exclusions withheld because the recorder's consent was withdrawn (a count only). */
  withheld: number;
}

/** Category / area pick-lists (empty when the source is down) plus the provider label and the withheld count. */
export async function loadDiscoverFilters(householdId: string): Promise<DiscoverFilterOptions> {
  let categories: string[] = [];
  let areas: string[] = [];
  try {
    const source = getRecipeSource();
    [categories, areas] = await Promise.all([source.categories(), source.areas()]);
  } catch {
    // The filters just stay empty; searching by name still reports a readable error if the source is down.
  }
  const withheld = (await loadPlanServices(householdId)).withheldExclusions ?? 0;
  return { categories, areas, sourceLabel: recipeSourceStatus().label, withheld };
}
