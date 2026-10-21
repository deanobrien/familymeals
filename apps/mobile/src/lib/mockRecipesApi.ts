import type { NutrientKey, Quantity } from '@fr/domain';
import { computeIssues, type DraftIssue } from '@fr/recipe-import';
import { RECIPES, type HOUSEHOLDS } from '@/data/mockDataSource';
import type { CookEntry, RecipeCooking } from './cookingTypes';
import { newId } from './format';
import type {
  Candidate,
  CalculatedNutrient,
  CostResult,
  DiscoverCard,
  DiscoverFilterOptions,
  DiscoverFilters,
  DiscoverOutcome,
  DraftOutcome,
  DuplicateHit,
  IngredientLineView,
  LinkSuggestion,
  NutritionResult,
  RecipeDetailData,
  RecipeFull,
  RecipeInputWire,
  RecipeListItem,
  RecipeListResponse,
  RecipeQueryState,
  RecipesApi,
  RematchResult,
  SaveResult,
} from './recipesApi';

/** Demo-mode implementation of RecipesApi (no EXPO_PUBLIC_SUPABASE_URL): in memory, deterministic, no network. */

const CATALOGUE: Candidate[] = [
  { id: 'ing-beef-mince', name: 'Beef mince' },
  { id: 'ing-onion', name: 'Onion' },
  { id: 'ing-salt', name: 'Salt' },
  { id: 'ing-kidney-beans', name: 'Kidney beans (tinned)' },
  { id: 'ing-bread', name: 'Bread (white, sliced)' },
  { id: 'ing-cheddar', name: 'Cheddar cheese' },
  { id: 'ing-coriander', name: 'Coriander (fresh)' },
];

const DISCOVER: DiscoverCard[] = [
  {
    id: '52772',
    title: 'Teriyaki Chicken Casserole',
    area: 'Japanese',
    category: 'Chicken',
    diet: 'meat',
    dietNote: 'Contains chicken (not verified).',
    ingredients: [{ name: 'Soy sauce', measure: '3/4 cup' }, { name: 'Chicken thighs', measure: '2' }],
    steps: ['Mix the sauce.', 'Bake until cooked through.'],
    attribution: { publisher: 'TheMealDB', url: 'https://www.themealdb.com/meal/52772', id: '52772' },
  },
  {
    id: '52977',
    title: 'Corba',
    area: 'Turkish',
    category: 'Side',
    diet: 'vegan',
    dietNote: 'No animal ingredients found (not verified).',
    ingredients: [{ name: 'Red lentils', measure: '1 cup' }],
    steps: ['Simmer the lentils.'],
    attribution: { publisher: 'TheMealDB', url: 'https://www.themealdb.com/meal/52977', id: '52977' },
  },
];

const NUTRIENT_UNITS: Record<string, string> = { energy_kcal: 'kcal', energy_kj: 'kJ', sodium: 'mg' };

type Stored = RecipeFull & { householdId: string };

function toFull(r: (typeof RECIPES)[number]): Stored {
  return {
    id: r.id,
    householdId: r.householdId,
    title: r.title,
    description: '',
    imageUrl: null,
    sourceAttribution: '',
    sourceUrl: '',
    originalText: '',
    prepMinutes: r.id === 'r-1' ? 15 : null,
    cookMinutes: r.id === 'r-1' ? 40 : null,
    servings: r.servings,
    cuisine: r.id === 'r-1' ? 'Italian' : '',
    mealType: 'dinner',
    diet: r.dietCategory ?? 'meat',
    tags: r.id === 'r-2' ? ['batch'] : [],
    ingredients: r.ingredients.map((i) => ({
      id: i.id,
      name: i.name,
      quantity: i.quantity,
      ...(i.preparation ? { preparation: i.preparation } : {}),
      optional: i.optional,
      order: i.order,
      ...(i.name === 'Onion' ? { ingredientId: 'ing-onion' } : {}),
    })),
    steps: r.steps.map((text, n) => ({ id: `${r.id}-s${n + 1}`, order: n + 1, text })),
    favourite: false,
    rating: null,
    updatedAt: '2026-10-20T10:00:00Z',
  };
}

function nutritionFor(r: Stored): NutritionResult {
  const src = RECIPES.find((x) => x.id === r.id)?.nutrition ?? [];
  const perServing: Partial<Record<NutrientKey, CalculatedNutrient>> = {};
  for (const n of src) {
    perServing[n.nutrient] = {
      status: n.status,
      ...(n.value !== undefined ? { value: n.value } : {}),
      unit: NUTRIENT_UNITS[n.nutrient] ?? n.unit,
      estimate: n.estimate,
    };
  }
  return {
    servings: r.servings,
    perServing,
    coveragePct: src.length ? 75 : 0,
    missing: src.length ? [{ name: 'Salt', reason: 'to_taste', reasonLabel: 'to taste' }] : [],
    warnings: [],
    hasEstimates: false,
    attribution: 'Nutrition values from McCance and Widdowson (CoFID), Public Health England. Demo data.',
    disclaimer: 'Estimates for information only; not medical advice.',
  };
}

function costFor(r: Stored): CostResult {
  const priced = r.ingredients.filter((i) => i.quantity.kind === 'exact' && !i.optional);
  const total = priced.length * 150;
  const uncosted = r.ingredients
    .filter((i) => !priced.includes(i))
    .map((i) => ({ lineId: i.id, name: i.name, status: 'uncosted' as const, reasonLabel: i.quantity.kind === 'to_taste' ? 'to taste' : 'amount is approximate' }));
  if (priced.length === 0) {
    return { totalPence: null, perServingPence: null, servings: r.servings, coveragePct: 0, isPartial: false, includesEstimates: false, kind: null, sources: [], lines: [], uncosted };
  }
  return {
    totalPence: total,
    perServingPence: Math.round(total / r.servings),
    servings: r.servings,
    coveragePct: Math.round((priced.length / r.ingredients.length) * 100),
    isPartial: uncosted.length > 0,
    includesEstimates: true,
    kind: 'generic_estimate',
    sources: [{ kind: 'generic_estimate', source: 'Demo price list', observedOn: '2026-10-01' }],
    lines: [...priced.map((i) => ({ lineId: i.id, name: i.name, status: 'costed' as const })), ...uncosted],
    uncosted,
  };
}

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

export function createMockRecipesApi(opts: { households?: typeof HOUSEHOLDS } = {}): RecipesApi & { reset(): void } {
  void opts;
  let store: Stored[] = RECIPES.map(toFull);
  // Demo cooking state (P1-A): per recipe, in memory. The real rules (private notes, exclusion re-checks) live on the server.
  let cooked: CookEntry[] = [];
  const flagged = new Set<string>();
  const myRatings = new Map<string, number>();
  const cookingOf = (id: string): RecipeCooking => {
    const all = cooked.filter((c) => c.recipeId === id).sort((a, b) => b.cookedAt.localeCompare(a.cookedAt));
    return { cookedCount: all.length, lastCookedAt: all[0]?.cookedAt ?? null, history: all.slice(0, 20), myRating: myRatings.get(id) ?? null, dontSuggest: flagged.has(id), dontSuggestCount: flagged.has(id) ? 1 : 0 };
  };
  const SUBS: Record<string, Array<{ substitute: string; quantityGuidance: string; effect: string }>> = {
    butter: [
      { substitute: 'olive oil', quantityGuidance: 'Use about 3/4 of the amount.', effect: 'Slightly less rich.' },
      { substitute: 'margarine', quantityGuidance: 'Swap 1:1.', effect: 'Very close in texture.' },
    ],
    onion: [{ substitute: 'leek', quantityGuidance: 'About the same weight.', effect: 'Milder and sweeter.' }],
  };
  const own = (householdId: string) => store.filter((r) => r.householdId === householdId);

  const toItem = (r: Stored): RecipeListItem => {
    const cost = costFor(r);
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
      rating: myRatings.get(r.id) ?? r.rating,
      ...(cooked.some((c) => c.recipeId === r.id) ? { cooked: { cookedCount: cookingOf(r.id).cookedCount, lastCookedAt: cookingOf(r.id).lastCookedAt } } : {}),
      cost: { totalPence: cost.totalPence, kind: cost.kind ?? 'generic_estimate', ...(cost.isPartial ? { partial: true } : {}) },
      costPerServingPence: cost.perServingPence,
    };
  };

  function matchOne(name: string): LinkSuggestion {
    const f = fold(name);
    const hit = CATALOGUE.find((c) => fold(c.name) === f || fold(c.name).startsWith(f));
    if (hit) return { status: 'matched', ingredientId: hit.id, ingredientName: hit.name, candidates: [] };
    return { status: 'unmatched', candidates: CATALOGUE.filter((c) => f.length >= 3 && fold(c.name).includes(f.slice(0, 3))).slice(0, 3) };
  }

  return {
    reset() {
      store = RECIPES.map(toFull);
      cooked = [];
      flagged.clear();
      myRatings.clear();
    },
    async list(householdId, q: RecipeQueryState): Promise<RecipeListResponse> {
      const all = own(householdId);
      let rows = all.filter((r) => {
        const total = (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0);
        if (q.q && !fold(`${r.title} ${r.tags.join(' ')} ${r.ingredients.map((i) => i.name).join(' ')}`).includes(fold(q.q))) return false;
        if (q.cuisine && r.cuisine !== q.cuisine) return false;
        if (q.mealType && r.mealType !== q.mealType) return false;
        if (q.maxPrepMinutes && (r.prepMinutes ?? 9999) > q.maxPrepMinutes) return false;
        if (q.diet && r.diet !== q.diet) return false;
        if (q.tags.length && !q.tags.every((t) => r.tags.includes(t))) return false;
        if (q.collection === 'favourites' && !r.favourite) return false;
        if (q.collection === 'vegetarian' && r.diet !== 'vegetarian' && r.diet !== 'vegan') return false;
        if (q.collection === 'quick' && !(total > 0 && total <= 30)) return false;
        return true;
      });
      rows = rows.sort((a, b) => (q.sort === 'recent' ? b.updatedAt.localeCompare(a.updatedAt) : a.title.localeCompare(b.title)));
      const tags = new Map<string, number>();
      for (const r of all) for (const t of r.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
      return {
        items: rows.map(toItem),
        total: rows.length,
        page: 1,
        pageSize: 20,
        pageCount: 1,
        cuisines: [...new Set(all.map((r) => r.cuisine).filter(Boolean))].sort(),
        tags: [...tags].map(([tag, count]) => ({ tag, count })),
        hasAny: all.length > 0,
      };
    },
    async get(householdId, id): Promise<RecipeDetailData | null> {
      const r = own(householdId).find((x) => x.id === id);
      if (!r) return null;
      const { householdId: _h, ...recipe } = r;
      void _h;
      const linkNames = Object.fromEntries(CATALOGUE.map((c) => [c.id, c.name]));
      return {
        recipe: myRatings.has(r.id) ? { ...recipe, rating: myRatings.get(r.id) ?? null } : recipe,
        cooking: cookingOf(r.id),
        calc: { cost: costFor(r), nutrition: nutritionFor(r) },
        householdServings: 4,
        linkNames,
        unlinkedCount: r.ingredients.filter((i) => !i.ingredientId).length,
      };
    },
    async save(householdId, id, input: RecipeInputWire, force): Promise<SaveResult> {
      const fieldErrors: Record<string, string> = {};
      if (!input.title.trim()) fieldErrors.title = 'Title is required';
      if (input.ingredients.length === 0) fieldErrors.ingredients = 'Add at least one ingredient';
      if (input.steps.length === 0) fieldErrors.steps = 'Add at least one step';
      if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
      if (!force) {
        const dup = own(householdId).find((r) => r.id !== id && fold(r.title) === fold(input.title));
        if (dup) return { ok: false, fieldErrors: {}, duplicates: [{ id: dup.id, title: dup.title }] };
      }
      const rid = id ?? newId();
      const lines: IngredientLineView[] = input.ingredients.map((i, n) => {
        const sug = i.ingredientId === undefined ? matchOne(i.name) : undefined;
        const ingredientId = typeof i.ingredientId === 'string' ? i.ingredientId : sug?.status === 'matched' ? sug.ingredientId : undefined;
        return {
          id: `${rid}-i${n + 1}`,
          name: i.name,
          ...(ingredientId ? { ingredientId } : {}),
          quantity: i.quantity as Quantity,
          ...(i.preparation ? { preparation: i.preparation } : {}),
          optional: i.optional,
          order: n + 1,
        };
      });
      const prev = store.find((r) => r.id === rid);
      const next: Stored = {
        ...(prev ?? { favourite: false, rating: null }),
        id: rid,
        householdId,
        title: input.title,
        description: input.description,
        imageUrl: input.imageUrl,
        sourceAttribution: input.sourceAttribution,
        sourceUrl: input.sourceUrl,
        originalText: prev?.originalText || input.originalText,
        prepMinutes: input.prepMinutes,
        cookMinutes: input.cookMinutes,
        servings: input.servings,
        cuisine: input.cuisine,
        mealType: input.mealType,
        diet: input.diet,
        tags: input.tags,
        ingredients: lines,
        steps: input.steps.map((text, n) => ({ id: `${rid}-s${n + 1}`, order: n + 1, text })),
        updatedAt: new Date().toISOString(),
      };
      store = prev ? store.map((r) => (r.id === rid ? next : r)) : [...store, next];
      return {
        ok: true,
        id: rid,
        links: lines.map((l, index) => ({
          index,
          name: l.name,
          status: l.ingredientId ? 'matched' : 'unmatched',
          source: l.ingredientId ? 'auto' : 'none',
          ...(l.ingredientId ? { ingredientId: l.ingredientId } : {}),
          candidates: [],
        })),
      };
    },
    async remove(householdId, id) {
      store = store.filter((r) => !(r.id === id && r.householdId === householdId));
    },
    async toggleFavourite(householdId, id) {
      const r = own(householdId).find((x) => x.id === id);
      if (!r) throw new Error('Recipe not found');
      r.favourite = !r.favourite;
      return r.favourite;
    },
    async markCooked(householdId, id, input) {
      const r = own(householdId).find((x) => x.id === id);
      if (!r) throw new Error('Recipe not found');
      if (!Number.isInteger(input.servings) || input.servings < 1 || input.servings > 100) {
        return { ok: false, message: 'Some values were not accepted.', fieldErrors: { servings: 'At least 1 serving' } };
      }
      const note = input.note?.trim();
      const entry: CookEntry = {
        id: newId(), recipeId: id, cookedAt: new Date().toISOString(), servings: input.servings, rating: input.rating ?? null,
        cookedBy: 'You', mine: true, note: note ? { text: note, isPrivate: input.notePrivate !== false } : null,
      };
      cooked = [...cooked, entry];
      if (input.rating) myRatings.set(id, input.rating);
      // Demo mode has no leftovers ledger (it lives on the server): report what the server would record, nothing is stored.
      const spare = input.batch ? input.servings * (input.batch.multiplier - 1) : 0;
      return { ok: true, entry, cooking: cookingOf(id), ...(spare > 0 && input.batch ? { leftover: { portionsMade: spare, storedIn: input.batch.storedIn, useBy: input.today ?? '' } } : {}) };
    },
    async setDontSuggest(_householdId, id, value) {
      if (value) flagged.add(id);
      else flagged.delete(id);
      return cookingOf(id);
    },
    async suggestSubstitutions(householdId, id, lineId) {
      const r = own(householdId).find((x) => x.id === id);
      const line = r?.ingredients.find((i) => i.id === lineId);
      if (!r || !line) return { ok: false, message: 'That ingredient is not in this recipe.' };
      const key = Object.keys(SUBS).find((k) => line.name.toLowerCase().includes(k));
      const suggestions = (key ? (SUBS[key] ?? []) : []).map((s) => ({ ...s, dietSafe: true as boolean | null }));
      return { ok: true, ingredient: { lineId, name: line.name }, suggestions, withheld: 0, withheldUnverifiable: 0, exclusionsActive: false };
    },
    async saveVariant(householdId, id, swaps) {
      const r = own(householdId).find((x) => x.id === id);
      if (!r) return { ok: false, message: 'Recipe not found.' };
      const rid = newId();
      const by = new Map(swaps.map((s) => [s.lineId, s]));
      const copy: Stored = {
        ...r,
        id: rid,
        title: `${r.title} (variant)`,
        favourite: false,
        rating: null,
        ingredients: r.ingredients.map((i) => {
          const sw = by.get(i.id);
          const { ingredientId: _drop, ...rest } = i;
          void _drop;
          return sw ? { ...rest, id: `${rid}-${i.id}`, name: sw.name, preparation: `instead of ${i.name}` } : { ...i, id: `${rid}-${i.id}` };
        }),
        steps: r.steps.map((s) => ({ ...s, id: `${rid}-${s.id}` })),
      };
      store = [...store, copy];
      return { ok: true, id: rid, title: copy.title };
    },
    async rematch(householdId, id): Promise<RematchResult> {
      const r = own(householdId).find((x) => x.id === id);
      if (!r) return { ok: false, message: 'Recipe not found' };
      let linked = 0;
      for (const l of r.ingredients) {
        if (l.ingredientId) continue;
        const s = matchOne(l.name);
        if (s.status === 'matched' && s.ingredientId) {
          l.ingredientId = s.ingredientId;
          linked++;
        }
      }
      const left = r.ingredients.filter((i) => !i.ingredientId).length;
      return { ok: true, summary: { recipes: 1, updated: linked ? 1 : 0, linked, ambiguous: 0, unmatched: left } };
    },
    async checkDuplicates(householdId, title, _names, excludeId): Promise<DuplicateHit[]> {
      return own(householdId)
        .filter((r) => r.id !== excludeId && fold(r.title) === fold(title))
        .map((r) => ({ id: r.id, title: r.title }));
    },
    async searchCatalogue(_h, q) {
      const f = fold(q);
      return f.length < 2 ? [] : CATALOGUE.filter((c) => fold(c.name).includes(f));
    },
    async matchNames(_h, names) {
      return names.map(matchOne);
    },
    async discoverFilters(): Promise<DiscoverFilterOptions> {
      return { categories: ['Chicken', 'Side', 'Vegan'], areas: ['Japanese', 'Turkish'], sourceLabel: 'TheMealDB (demo data)', withheld: 0 };
    },
    async discoverSearch(_h, f: DiscoverFilters): Promise<DiscoverOutcome> {
      const q = fold(f.q ?? '');
      const cards = DISCOVER.filter((c) => (!q || fold(c.title).includes(q)) && (!f.area || c.area === f.area) && (!f.category || c.category === f.category));
      return { ok: true, cards, withheld: 0, withheldUnverifiable: 0, exclusionsActive: false, sourceLabel: 'TheMealDB (demo data)' };
    },
    async discoverDraft(_h, id): Promise<DraftOutcome> {
      const card = DISCOVER.find((c) => c.id === id);
      if (!card) return { ok: false, message: 'That recipe could not be found at the source any more.' };
      const field = <T,>(value: T) => ({ value, status: 'ok' as const, warnings: [] as string[] });
      const draft = {
        title: field(card.title),
        titleProposed: false,
        servings: field<number | undefined>(undefined),
        tags: [],
        ingredients: card.ingredients.map((i, n) => ({
          key: `ing-${n + 1}`,
          originalText: `${i.measure} ${i.name}`.trim(),
          name: field(i.name),
          quantity: { value: { kind: 'unparsed', originalText: i.measure }, status: 'unparsed', warnings: [] },
          optional: false,
          ingredientId: { value: undefined, status: 'needs_clarification', warnings: [] },
          matchAlternatives: [],
          confidence: 0.8,
          affectsCost: false,
        })),
        steps: card.steps.map((text, n) => ({ key: `step-${n + 1}`, text })),
        warnings: [],
        issues: [] as DraftIssue[],
        source: `${card.attribution.publisher} - ${card.attribution.url}`,
        sourceImageRefs: [],
        original: { pages: [] },
        extractedAt: '2026-10-20T10:00:00Z',
      };
      // The real server computes the issues; the demo uses the same function.
      draft.issues = computeIssues(draft as never);
      return { ok: true, uploadId: `mock-${id}`, draft, existing: [] };
    },
    async imageSource() {
      return null;
    },
    webUrl: () => null,
  };
}
