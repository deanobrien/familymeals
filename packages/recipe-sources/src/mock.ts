import { FIXTURE_AREAS, FIXTURE_CATEGORIES, FIXTURE_MEALS } from './fixtures.js';
import { normaliseMeal } from './themealdb/schema.js';
import { DEFAULT_LIMIT, type RecipeSource, type SearchFilters, type SourceRecipe } from './types.js';

const eq = (a: string | undefined, b: string): boolean => (a ?? '').toLowerCase() === b.trim().toLowerCase();

/** Fixture-backed provider: same contract as the real adapter, no network. Used for dev, e2e and unit tests. */
export class MockRecipeSource implements RecipeSource {
  readonly name = 'Sample recipes (offline)';
  private readonly all: SourceRecipe[];
  private n = 0;

  constructor(recipes: SourceRecipe[] = FIXTURE_MEALS.map((m) => normaliseMeal(m)).filter((m): m is SourceRecipe => m !== null)) {
    // Attribute to TheMealDB exactly like the real adapter so the UI and saved recipes behave identically.
    this.all = recipes;
  }

  async byId(id: string) { return this.all.find((r) => r.id === id) ?? null; }
  async random() { return this.all[this.n++ % this.all.length] ?? null; }

  private pick(pred: (r: SourceRecipe) => boolean, limit = DEFAULT_LIMIT): SourceRecipe[] {
    return this.all.filter(pred).slice(0, limit);
  }
  async byIngredient(name: string, limit?: number) {
    const q = name.trim().toLowerCase();
    return q ? this.pick((r) => r.ingredients.some((i) => i.name.toLowerCase().includes(q)), limit) : [];
  }
  async byCategory(category: string, limit?: number) { return this.pick((r) => eq(r.category, category), limit); }
  async byArea(area: string, limit?: number) { return this.pick((r) => eq(r.area, area), limit); }

  async search(q: string, filters: SearchFilters = {}): Promise<SourceRecipe[]> {
    const query = q.trim().toLowerCase();
    const any = query || filters.ingredient?.trim() || filters.category?.trim() || filters.area?.trim();
    if (!any) return [];
    return this.pick((r) =>
      (!query || r.title.toLowerCase().includes(query)) &&
      (!filters.area?.trim() || eq(r.area, filters.area)) &&
      (!filters.category?.trim() || eq(r.category, filters.category)) &&
      (!filters.ingredient?.trim() || r.ingredients.some((i) => i.name.toLowerCase().includes(filters.ingredient!.trim().toLowerCase()))),
    filters.limit ?? DEFAULT_LIMIT);
  }

  async categories() { return [...FIXTURE_CATEGORIES]; }
  async areas() { return [...FIXTURE_AREAS]; }
}
