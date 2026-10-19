import { randomUUID } from 'node:crypto';
import type { RecipeInput, RecipeQuery } from './schema';
import type { RecipeListResult, RecipeRepository, TagCount } from './repository';
import { costPerServing, totalMinutes, type RecipeView } from './types';

/** Cost-per-serving bands in pence: low < £1.50, mid £1.50-£3.00, high > £3.00. */
export const BUDGET_PENCE = 150;
export const MID_PENCE = 300;
export const QUICK_MINUTES = 30;

const clone = <T,>(v: T): T => structuredClone(v);

export function normaliseTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/\(copy\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normaliseIngredient(n: string): string {
  return n.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

function matchesSearch(r: RecipeView, q: string): boolean {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = [r.title, ...r.tags, ...r.ingredients.map((i) => i.name)].join(' \n ').toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

function priceBandOf(r: RecipeView): 'low' | 'mid' | 'high' | 'unknown' {
  const c = costPerServing(r);
  if (c == null) return 'unknown';
  if (c < BUDGET_PENCE) return 'low';
  if (c <= MID_PENCE) return 'mid';
  return 'high';
}

function applyFilters(all: RecipeView[], q: RecipeQuery): RecipeView[] {
  return all.filter((r) => {
    if (!matchesSearch(r, q.q)) return false;
    if (q.cuisine && r.cuisine.toLowerCase() !== q.cuisine.toLowerCase()) return false;
    if (q.mealType && r.mealType !== q.mealType) return false;
    if (q.maxPrepMinutes != null && (r.prepMinutes == null || r.prepMinutes > q.maxPrepMinutes)) return false;
    if (q.diet && r.diet !== q.diet) return false;
    if (q.priceBand && priceBandOf(r) !== q.priceBand) return false;
    if (q.tags.length > 0) {
      const have = r.tags.map((t) => t.toLowerCase());
      if (!q.tags.every((t) => have.includes(t))) return false;
    }
    switch (q.collection) {
      case 'favourites':
        if (!r.favourite) return false;
        break;
      case 'quick': {
        const m = totalMinutes(r);
        if (m == null || m > QUICK_MINUTES) return false;
        break;
      }
      case 'budget':
        if (priceBandOf(r) !== 'low') return false;
        break;
      case 'vegetarian':
        if (r.diet !== 'vegetarian' && r.diet !== 'vegan') return false;
        break;
      default:
    }
    return true;
  });
}

/** Unknown values always sort last, regardless of direction. */
function byNullable(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
}

function sortRecipes(items: RecipeView[], sort: RecipeQuery['sort']): RecipeView[] {
  const byName = (a: RecipeView, b: RecipeView) => a.title.localeCompare(b.title, 'en-GB', { sensitivity: 'base' });
  const out = [...items];
  out.sort((a, b) => {
    let c = 0;
    switch (sort) {
      case 'recent':
        c = b.createdAt.localeCompare(a.createdAt);
        break;
      case 'cost':
        c = byNullable(costPerServing(a), costPerServing(b), 1);
        break;
      case 'rating':
        c = byNullable(a.rating, b.rating, -1);
        break;
      case 'prep':
        c = byNullable(a.prepMinutes, b.prepMinutes, 1);
        break;
      default:
    }
    return c !== 0 ? c : byName(a, b);
  });
  return out;
}

/** Printed card data is carried through edits unless the caller sends new values. */
function printedFields(input: RecipeInput, prev: RecipeView | null): Pick<RecipeView, 'printedNutrition' | 'printedAllergens'> {
  const nutrition = input.printedNutrition ?? prev?.printedNutrition;
  const allergens = input.printedAllergens ?? prev?.printedAllergens;
  return {
    ...(nutrition ? { printedNutrition: clone(nutrition) } : {}),
    ...(allergens ? { printedAllergens: [...allergens] } : {}),
  };
}

function build(id: string, input: RecipeInput, prev: RecipeView | null, now: string): RecipeView {
  return {
    id,
    title: input.title,
    description: input.description,
    imageUrl: input.imageUrl,
    sourceAttribution: input.sourceAttribution,
    sourceUrl: input.sourceUrl,
    // Original text is write-once: edits never overwrite what was first captured.
    originalText: prev?.originalText || input.originalText,
    prepMinutes: input.prepMinutes,
    cookMinutes: input.cookMinutes,
    servings: input.servings,
    cuisine: input.cuisine,
    mealType: input.mealType,
    diet: input.diet,
    tags: [...new Set(input.tags.map((t) => t.toLowerCase()))],
    ingredients: input.ingredients.map((i, idx) => ({
      id: randomUUID(),
      name: i.name,
      // Keep the canonical match across edits when the form does not send it back (same name = same line).
      ingredientId: i.ingredientId ?? prev?.ingredients.find((p) => p.name === i.name)?.ingredientId,
      quantity: clone(i.quantity),
      preparation: i.preparation || undefined,
      optional: i.optional,
      order: idx,
    })),
    steps: input.steps.map((text, idx) => ({ id: randomUUID(), order: idx, text })),
    favourite: prev?.favourite ?? false,
    rating: prev?.rating ?? null,
    // Cost/nutrition are placeholders until the engines merge; edits to ingredients invalidate them.
    cost: prev && sameIngredients(prev, input) ? prev.cost : { totalPence: null, kind: 'generic_estimate' },
    nutritionPerServing: prev && sameIngredients(prev, input) ? prev.nutritionPerServing : [],
    ...printedFields(input, prev),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
}

function sameIngredients(prev: RecipeView, input: RecipeInput): boolean {
  if (prev.ingredients.length !== input.ingredients.length) return false;
  return prev.ingredients.every((p, i) => {
    const n = input.ingredients[i];
    return !!n && p.name === n.name && JSON.stringify(p.quantity) === JSON.stringify(n.quantity);
  });
}

export class InMemoryRecipeRepository implements RecipeRepository {
  private readonly store = new Map<string, RecipeView>();

  constructor(seed: RecipeView[] = []) {
    for (const r of seed) this.store.set(r.id, clone(r));
  }

  async list(query: RecipeQuery): Promise<RecipeListResult> {
    const matched = sortRecipes(applyFilters([...this.store.values()], query), query.sort);
    const pageSize = Math.max(1, query.pageSize);
    const pageCount = Math.max(1, Math.ceil(matched.length / pageSize));
    const page = Math.min(Math.max(1, query.page), pageCount);
    return {
      items: clone(matched.slice((page - 1) * pageSize, page * pageSize)),
      total: matched.length,
      page,
      pageSize,
      pageCount,
    };
  }

  async get(id: string): Promise<RecipeView | null> {
    const r = this.store.get(id);
    return r ? clone(r) : null;
  }

  async create(input: RecipeInput, opts: { id?: string } = {}): Promise<RecipeView> {
    if (opts.id && this.store.has(opts.id)) throw new Error(`Recipe ${opts.id} already exists`);
    const r = build(opts.id ?? randomUUID(), input, null, new Date().toISOString());
    this.store.set(r.id, r);
    return clone(r);
  }

  async update(id: string, input: RecipeInput): Promise<RecipeView | null> {
    const prev = this.store.get(id);
    if (!prev) return null;
    const r = build(id, input, prev, new Date().toISOString());
    this.store.set(id, r);
    return clone(r);
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async duplicate(id: string): Promise<RecipeView | null> {
    const src = this.store.get(id);
    if (!src) return null;
    const now = new Date().toISOString();
    const copy: RecipeView = {
      ...clone(src),
      id: randomUUID(),
      title: `${src.title} (copy)`,
      favourite: false,
      rating: null,
      ingredients: src.ingredients.map((i) => ({ ...clone(i), id: randomUUID() })),
      steps: src.steps.map((s) => ({ ...s, id: randomUUID() })),
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(copy.id, copy);
    return clone(copy);
  }

  async toggleFavourite(id: string): Promise<RecipeView | null> {
    const r = this.store.get(id);
    if (!r) return null;
    r.favourite = !r.favourite;
    r.updatedAt = new Date().toISOString();
    return clone(r);
  }

  async listTags(): Promise<TagCount[]> {
    const counts = new Map<string, number>();
    for (const r of this.store.values()) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  async listCuisines(): Promise<string[]> {
    const set = new Set<string>();
    for (const r of this.store.values()) if (r.cuisine) set.add(r.cuisine);
    return [...set].sort((a, b) => a.localeCompare(b, 'en-GB'));
  }

  async findDuplicates(candidate: { title: string; ingredientNames?: string[] }, excludeId?: string): Promise<RecipeView[]> {
    const title = normaliseTitle(candidate.title);
    const names = new Set((candidate.ingredientNames ?? []).map(normaliseIngredient).filter(Boolean));
    const out: RecipeView[] = [];
    for (const r of this.store.values()) {
      if (r.id === excludeId) continue;
      if (title && normaliseTitle(r.title) === title) {
        out.push(clone(r));
        continue;
      }
      if (names.size >= 3) {
        const theirs = new Set(r.ingredients.map((i) => normaliseIngredient(i.name)));
        const inter = [...names].filter((n) => theirs.has(n)).length;
        const union = new Set([...names, ...theirs]).size;
        if (union > 0 && inter / union >= 0.8) out.push(clone(r));
      }
    }
    return out;
  }
}
