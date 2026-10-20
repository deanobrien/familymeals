import 'server-only';
import type { RecipeRepository } from '../../recipes/repository';
import { parseRecipeQuery } from '../../recipes/schema';
import type { DietCategory, MealType, RecipeCost, RecipeView } from '../../recipes/types';
import type { IngredientCatalogue } from '../refdata/catalogue';

/** JSON shapes of the bearer recipe API (the Android app is written against exactly these). */

export interface RecipeListItem {
  id: string;
  title: string;
  imageUrl: string | null;
  cuisine: string;
  mealType: MealType;
  diet: DietCategory;
  tags: string[];
  prepMinutes: number | null;
  cookMinutes: number | null;
  servings: number;
  favourite: boolean;
  rating: number | null;
  /** How often and when the household last cooked it (P1-A); absent = never cooked. */
  cooked?: { cookedCount: number; lastCookedAt: string | null };
  cost: Pick<RecipeCost, 'totalPence' | 'kind' | 'partial'>;
  costPerServingPence: number | null;
}

export interface RecipeListResponse {
  items: RecipeListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  cuisines: string[];
  tags: { tag: string; count: number }[];
  hasAny: boolean;
}

export const API_DEFAULT_PAGE_SIZE = 20;
export const API_MAX_PAGE_SIZE = 50;

/** Strips ingredients, steps and the original text: the list only needs the card. */
export function toListItem(r: RecipeView): RecipeListItem {
  return {
    id: r.id,
    title: r.title,
    imageUrl: r.imageUrl,
    cuisine: r.cuisine,
    mealType: r.mealType,
    diet: r.diet,
    tags: r.tags,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    servings: r.servings,
    favourite: r.favourite,
    rating: r.rating,
    cost: { totalPence: r.cost.totalPence, kind: r.cost.kind, ...(r.cost.partial ? { partial: true } : {}) },
    costPerServingPence: r.cost.totalPence == null || r.servings < 1 ? null : Math.round(r.cost.totalPence / r.servings),
  };
}

/** The web list's query (URL params, parsed leniently) plus an API-only `pageSize` (default 20, max 50). */
export function parseApiRecipeQuery(searchParams: URLSearchParams) {
  const params: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const all = searchParams.getAll(key);
    params[key] = key === 'tag' ? all : (all[0] ?? '');
  }
  const query = parseRecipeQuery(params);
  const size = Math.floor(Number(searchParams.get('pageSize')));
  query.pageSize = Number.isFinite(size) && size >= 1 ? Math.min(size, API_MAX_PAGE_SIZE) : API_DEFAULT_PAGE_SIZE;
  return query;
}

export async function buildRecipeList(repo: RecipeRepository, searchParams: URLSearchParams): Promise<RecipeListResponse> {
  const query = parseApiRecipeQuery(searchParams);
  const [list, cuisines, tags, all] = await Promise.all([
    repo.list(query),
    repo.listCuisines(),
    repo.listTags(),
    repo.list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 1 }),
  ]);
  return {
    items: list.items.map(toListItem),
    total: list.total,
    page: list.page,
    pageSize: list.pageSize,
    pageCount: list.pageCount,
    cuisines,
    tags,
    hasAny: all.total > 0,
  };
}

/** Display names of the catalogue ingredients the recipe's lines are linked to, and how many lines are not linked. */
export function linkSummary(recipe: RecipeView, catalogue: IngredientCatalogue): { linkNames: Record<string, string>; unlinkedCount: number } {
  const linkNames: Record<string, string> = {};
  for (const line of recipe.ingredients) {
    if (!line.ingredientId) continue;
    const name = catalogue.get(line.ingredientId)?.name;
    if (name) linkNames[line.ingredientId] = name;
  }
  return { linkNames, unlinkedCount: recipe.ingredients.filter((i) => !i.ingredientId).length };
}
