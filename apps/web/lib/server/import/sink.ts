import type { FinalisedRecipe, RecipeSummary } from '@fr/recipe-import';

/** Persistence boundary for imported recipes. TODO(Supabase): implement against recipes/recipe_versions tables. */
export interface RecipeSink {
  save(recipe: FinalisedRecipe): Promise<{ id: string }>;
  list(): Promise<RecipeSummary[]>;
  get(id: string): Promise<FinalisedRecipe | undefined>;
}

export class InMemoryRecipeSink implements RecipeSink {
  private readonly items = new Map<string, FinalisedRecipe>();

  async save(recipe: FinalisedRecipe) {
    this.items.set(recipe.recipe.id, structuredClone(recipe));
    return { id: recipe.recipe.id };
  }
  async list(): Promise<RecipeSummary[]> {
    return [...this.items.values()].map((r) => ({
      id: r.recipe.id,
      title: r.recipe.title,
      ingredientNames: r.ingredients.map((i) => i.name),
      ingredientIds: r.ingredients.flatMap((i) => (i.ingredientId ? [i.ingredientId] : [])),
    }));
  }
  async get(id: string) {
    const r = this.items.get(id);
    return r ? structuredClone(r) : undefined;
  }
}

const g = globalThis as unknown as { __frRecipeSink?: RecipeSink };
/** Process-wide sink (survives Next dev module reloads). */
export function getRecipeSink(): RecipeSink {
  return (g.__frRecipeSink ??= new InMemoryRecipeSink());
}
