import type { NutrientKey, Quantity } from '@fr/domain';
import { ApiError, createApiClient, type ApiClient } from './apiClient';
import type { CookSummary, MarkCookedInput, MarkCookedResult, RecipeCooking, SubstitutionResult, SwapInput, VariantResult } from './cookingTypes';

export type { CookEntry, CookNote, CookSummary, MarkCookedInput, MarkCookedResult, RecipeCooking, SubstitutionResult, SubstitutionSuggestion, SwapInput, VariantResult } from './cookingTypes';

/**
 * Wire contract of the web app's bearer JSON routes for recipes, the ingredient catalogue and discover (D330, D331).
 * The shapes mirror apps/web (lib/recipes/types.ts, lib/calc/types.ts, lib/server/recipes/service.ts); change them together.
 */

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealType = (typeof MEAL_TYPES)[number];
export const DIET_CATEGORIES = ['meat', 'fish', 'vegetarian', 'vegan'] as const;
export type DietCategory = (typeof DIET_CATEGORIES)[number];
export const SORTS = ['name', 'recent', 'cost', 'rating', 'prep'] as const;
export type RecipeSort = (typeof SORTS)[number];
export const COLLECTIONS = ['favourites', 'quick', 'budget', 'vegetarian'] as const;
export type RecipeCollection = (typeof COLLECTIONS)[number];
export const PRICE_BANDS = ['low', 'mid', 'high', 'unknown'] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];
export const PREP_LIMITS = [15, 30, 60] as const;
export const QUANTITY_KINDS = ['exact', 'range', 'approximate', 'to_taste', 'unparsed'] as const;
export const UNITS = [
  'mg', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'floz', 'pint',
  'item', 'clove', 'slice', 'can', 'pack', 'bunch', 'sprig', 'stick',
] as const;

export type PriceKind = 'user_confirmed' | 'receipt' | 'retailer_verified' | 'generic_estimate';

export interface RecipeQueryState {
  q: string;
  cuisine?: string | undefined;
  mealType?: MealType | undefined;
  maxPrepMinutes?: number | undefined;
  diet?: DietCategory | undefined;
  priceBand?: PriceBand | undefined;
  tags: string[];
  collection?: RecipeCollection | undefined;
  sort: RecipeSort;
  page: number;
}

export const EMPTY_QUERY: RecipeQueryState = { q: '', tags: [], sort: 'name', page: 1 };

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
  /** Household cook count and last cooked (P1-A); absent = never cooked. */
  cooked?: CookSummary | undefined;
  cost: { totalPence: number | null; kind: PriceKind; partial?: boolean };
  costPerServingPence: number | null;
}

export interface RecipeListResponse {
  items: RecipeListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  cuisines: string[];
  tags: Array<{ tag: string; count: number }>;
  hasAny: boolean;
}

export interface IngredientLineView {
  id: string;
  name: string;
  ingredientId?: string | undefined;
  quantity: Quantity;
  preparation?: string | undefined;
  optional: boolean;
  order: number;
}

export interface PrintedNutrition {
  basis: string;
  values: Array<{ nutrient: string; amount: number; unit: string }>;
  note?: string | undefined;
  source: 'recipe card';
}

export interface RecipeFull {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  sourceAttribution: string;
  sourceUrl: string;
  originalText: string;
  prepMinutes: number | null;
  cookMinutes: number | null;
  servings: number;
  cuisine: string;
  mealType: MealType;
  diet: DietCategory;
  tags: string[];
  ingredients: IngredientLineView[];
  steps: Array<{ id: string; order: number; text: string }>;
  favourite: boolean;
  rating: number | null;
  printedNutrition?: PrintedNutrition | undefined;
  printedAllergens?: string[] | undefined;
  updatedAt: string;
}

export interface CostLine {
  lineId: string;
  name: string;
  status: 'costed' | 'uncosted' | 'skipped_optional';
  basis?: 'exact' | 'range_max';
  reasonLabel?: string;
}

export interface CostResult {
  totalPence: number | null;
  perServingPence: number | null;
  servings: number;
  coveragePct: number;
  isPartial: boolean;
  includesEstimates: boolean;
  kind: PriceKind | null;
  sources: Array<{ kind: PriceKind; source: string; observedOn: string }>;
  lines: CostLine[];
  uncosted: CostLine[];
}

export type ValueStatus = 'known' | 'zero' | 'unknown' | 'unavailable';
export interface CalculatedNutrient {
  status: ValueStatus;
  value?: number;
  unit: string;
  estimate: boolean;
  incomplete?: boolean;
  lowerBound?: number;
}

export interface NutritionResult {
  servings: number;
  perServing: Partial<Record<NutrientKey, CalculatedNutrient>>;
  totals?: Partial<Record<NutrientKey, CalculatedNutrient>>;
  coveragePct: number;
  missing: Array<{ name: string; reason: string; reasonLabel: string }>;
  warnings: string[];
  hasEstimates: boolean;
  attribution: string;
  productSources?: Array<{ ingredientId: string; ingredientName: string; productName: string; barcode: string; url: string }>;
  disclaimer: string;
}

type CookEntryWire = import('./cookingTypes').CookEntry;

export interface RecipeDetailData {
  recipe: RecipeFull;
  /** History, your rating and the planner flag (P1-A); null when it could not be read. */
  cooking?: RecipeCooking | null | undefined;
  calc: { cost: CostResult; nutrition: NutritionResult };
  /** households.default_servings: recipes open scaled to this. */
  householdServings: number;
  /** Display names of the recipe's linked ingredient ids (the catalogue is server-only). */
  linkNames: Record<string, string>;
  unlinkedCount: number;
}

/** The body the create/edit form sends; validated on the server (lib/recipes/schema.ts). */
export interface RecipeInputWire {
  title: string;
  description: string;
  imageUrl: string | null;
  sourceAttribution: string;
  sourceUrl: string;
  originalText: string;
  prepMinutes: number | null;
  cookMinutes: number | null;
  servings: number;
  cuisine: string;
  mealType: MealType;
  diet: DietCategory;
  tags: string[];
  ingredients: Array<{
    name: string;
    /** string = linked; null = explicitly "not in the ingredient list"; absent = match automatically. */
    ingredientId?: string | null;
    quantity: Quantity;
    preparation?: string;
    optional: boolean;
  }>;
  steps: string[];
  printedNutrition?: PrintedNutrition;
  printedAllergens?: string[];
}

export interface Candidate {
  id: string;
  name: string;
}
export interface LinkSuggestion {
  status: 'matched' | 'ambiguous' | 'unmatched';
  ingredientId?: string;
  ingredientName?: string;
  candidates: Candidate[];
}
export interface DuplicateHit {
  id: string;
  title: string;
}
export interface LineLinkReport {
  index: number;
  name: string;
  status: 'matched' | 'ambiguous' | 'unmatched';
  source: 'chosen' | 'kept' | 'auto' | 'none';
  ingredientId?: string;
  ingredientName?: string;
  candidates: Candidate[];
}
export type SaveResult =
  | { ok: true; id: string; links: LineLinkReport[] }
  | { ok: false; fieldErrors: Record<string, string>; duplicates?: DuplicateHit[]; message?: string };

export interface RematchSummary {
  recipes: number;
  updated: number;
  linked: number;
  ambiguous: number;
  unmatched: number;
}
export type RematchResult = { ok: true; summary: RematchSummary } | { ok: false; message: string };

export interface DiscoverFilters {
  q?: string;
  area?: string;
  category?: string;
  ingredient?: string;
}
export interface DiscoverFilterOptions {
  categories: string[];
  areas: string[];
  sourceLabel: string;
  withheld: number;
}
export interface DiscoverCard {
  id: string;
  title: string;
  imageUrl?: string;
  area?: string;
  category?: string;
  diet: 'meat' | 'fish' | 'vegetarian' | 'vegan' | 'unknown';
  dietNote: string;
  ingredients: Array<{ name: string; measure: string }>;
  steps: string[];
  attribution: { publisher: string; url: string; id: string };
  youtubeUrl?: string;
  creativeCommons?: string;
}
export type DiscoverOutcome =
  | { ok: true; cards: DiscoverCard[]; withheld: number; withheldUnverifiable: number; exclusionsActive: boolean; sourceLabel: string }
  | { ok: false; message: string };
export type DraftOutcome =
  | { ok: true; uploadId: string; draft: unknown; existing: Array<{ id: string; title: string; ingredientNames?: string[]; ingredientIds?: string[] }> }
  | { ok: false; message: string };

/** Everything the recipe screens need from the server. `MockRecipesApi` implements it for the no-env demo mode. */
export interface RecipesApi {
  list(householdId: string, query: RecipeQueryState): Promise<RecipeListResponse>;
  get(householdId: string, id: string): Promise<RecipeDetailData | null>;
  save(householdId: string, id: string | null, recipe: RecipeInputWire, force: boolean): Promise<SaveResult>;
  remove(householdId: string, id: string): Promise<void>;
  toggleFavourite(householdId: string, id: string): Promise<boolean>;
  rematch(householdId: string, id: string): Promise<RematchResult>;
  // ---- cooking (P1-A) ----
  markCooked(householdId: string, id: string, input: MarkCookedInput): Promise<MarkCookedResult>;
  setDontSuggest(householdId: string, id: string, value: boolean): Promise<RecipeCooking>;
  /** AI suggestions, re-checked on the server against the household exclusions. */
  suggestSubstitutions(householdId: string, id: string, lineId: string): Promise<SubstitutionResult>;
  /** Saves a COPY of the recipe with the swaps applied; the original is never changed. */
  saveVariant(householdId: string, id: string, swaps: SwapInput[]): Promise<VariantResult>;
  checkDuplicates(householdId: string, title: string, names: string[], excludeId?: string): Promise<DuplicateHit[]>;
  searchCatalogue(householdId: string, q: string): Promise<Candidate[]>;
  matchNames(householdId: string, names: string[]): Promise<LinkSuggestion[]>;
  discoverFilters(householdId: string): Promise<DiscoverFilterOptions>;
  discoverSearch(householdId: string, filters: DiscoverFilters): Promise<DiscoverOutcome>;
  discoverDraft(householdId: string, id: string): Promise<DraftOutcome>;
  /** Source + auth headers for a stored cover image (null = no image). Storage paths go through /api/images (bearer). */
  imageSource(ref: string | null | undefined): Promise<{ uri: string; headers: Record<string, string> } | null>;
  /** Absolute web URL (hand-offs such as "Add to plan"); null when unknown. */
  webUrl(path: string): string | null;
}

/** Same rule as the web `imageSrc`: a storage path is `<household>/<kind>/<id>/<file>`; everything else is used as is. */
const STORAGE_PATH = /^[0-9a-f-]{36}\/(page|cover|receipt)\/[0-9a-f-]{36}\/[\w.-]+$/i;
export const isStoragePath = (v: string): boolean => STORAGE_PATH.test(v);

export function createRecipesApi(opts: { baseUrl?: string | undefined; getToken: () => Promise<string | null>; fetchImpl?: typeof fetch }): RecipesApi {
  const api: ApiClient = createApiClient(opts);

  return {
    list(householdId, q) {
      return api.get<RecipeListResponse>('/api/recipes', {
        householdId,
        q: q.q || undefined,
        cuisine: q.cuisine,
        meal: q.mealType,
        prep: q.maxPrepMinutes,
        diet: q.diet,
        price: q.priceBand,
        tag: q.tags,
        collection: q.collection,
        sort: q.sort === 'name' ? undefined : q.sort,
        page: q.page > 1 ? q.page : undefined,
      });
    },
    async get(householdId, id) {
      try {
        return await api.get<RecipeDetailData>(`/api/recipes/${encodeURIComponent(id)}`, { householdId });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    async save(householdId, id, recipe, force) {
      const body = { householdId, recipe, ...(force ? { force: true } : {}) };
      // 404 (recipe gone) and 422 (validation / duplicates) carry a SaveResult body, not an error envelope.
      const res = await api.send<SaveResult | { error?: { message?: string } }>(id ? 'PUT' : 'POST', id ? `/api/recipes/${encodeURIComponent(id)}` : '/api/recipes', body, [404, 422]);
      if ('ok' in res) return res;
      return { ok: false, fieldErrors: {}, message: res.error?.message ?? 'Recipe not found' };
    },
    async remove(householdId, id) {
      await api.send('DELETE', `/api/recipes/${encodeURIComponent(id)}?householdId=${encodeURIComponent(householdId)}`);
    },
    async toggleFavourite(householdId, id) {
      const r = await api.send<{ ok: boolean; favourite?: boolean }>('POST', `/api/recipes/${encodeURIComponent(id)}/favourite`, { householdId });
      return !!r.favourite;
    },
    async markCooked(householdId, id, input) {
      const res = await api.send<{ entry: CookEntryWire; cooking: RecipeCooking } | { error?: { message?: string; fieldErrors?: Record<string, string> } }>('POST', `/api/recipes/${encodeURIComponent(id)}/cooked`, { householdId, ...input }, [422]);
      if ('entry' in res) return { ok: true, entry: res.entry, cooking: res.cooking };
      return { ok: false, message: res.error?.message ?? 'Some values were not accepted.', fieldErrors: res.error?.fieldErrors ?? {} };
    },
    async setDontSuggest(householdId, id, value) {
      return (await api.send<{ cooking: RecipeCooking }>('POST', `/api/recipes/${encodeURIComponent(id)}/dont-suggest`, { householdId, value })).cooking;
    },
    async suggestSubstitutions(householdId, id, lineId) {
      try {
        const r = await api.send<Extract<SubstitutionResult, { ok: true }>>('POST', `/api/recipes/${encodeURIComponent(id)}/substitutions`, { householdId, lineId });
        return { ...r, ok: true };
      } catch (e) {
        if (e instanceof ApiError) return { ok: false, message: e.message };
        throw e;
      }
    },
    async saveVariant(householdId, id, swaps) {
      try {
        const r = await api.send<{ id: string; title: string }>('POST', `/api/recipes/${encodeURIComponent(id)}/variant`, { householdId, swaps });
        return { ok: true, id: r.id, title: r.title };
      } catch (e) {
        if (e instanceof ApiError) return { ok: false, message: e.message };
        throw e;
      }
    },
    async rematch(householdId, id) {
      return api.send<RematchResult>('POST', `/api/recipes/${encodeURIComponent(id)}/rematch`, { householdId }, [404]);
    },
    async checkDuplicates(householdId, title, names, excludeId) {
      const r = await api.send<{ hits: DuplicateHit[] }>('POST', '/api/recipes/duplicates', { householdId, title, names, ...(excludeId ? { excludeId } : {}) });
      return r.hits;
    },
    async searchCatalogue(householdId, q) {
      const r = await api.get<{ candidates: Candidate[] }>('/api/catalogue/search', { householdId, q });
      return r.candidates;
    },
    async matchNames(householdId, names) {
      const r = await api.send<{ suggestions: LinkSuggestion[] }>('POST', '/api/catalogue/match', { householdId, names });
      return r.suggestions;
    },
    discoverFilters: (householdId) => api.get<DiscoverFilterOptions>('/api/discover/filters', { householdId }),
    discoverSearch: (householdId, f) => api.send<DiscoverOutcome>('POST', '/api/discover/search', { householdId, ...f }),
    discoverDraft: (householdId, id) => api.send<DraftOutcome>('POST', '/api/discover/draft', { householdId, id }, [422]),
    async imageSource(ref) {
      if (!ref) return null;
      if (/^https?:\/\//i.test(ref)) return { uri: ref, headers: {} };
      const uri = api.url(isStoragePath(ref) ? `/api/images/${ref}` : ref);
      return uri ? { uri, headers: await api.authHeaders() } : null;
    },
    webUrl: (path) => api.url(path),
  };
}
