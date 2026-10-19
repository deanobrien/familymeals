// Recipe persistence boundary. The UI only talks to this interface.
// TODO(L1): add a Supabase-backed implementation once the DB schema lane merges and select it in factory.ts.
import type { RecipeInput, RecipeQuery } from './schema';
import type { RecipeView } from './types';

export interface RecipeListResult {
  items: RecipeView[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface RecipeRepository {
  list(query: RecipeQuery): Promise<RecipeListResult>;
  get(id: string): Promise<RecipeView | null>;
  create(input: RecipeInput): Promise<RecipeView>;
  /** Returns null when the recipe does not exist. originalText is preserved if the input's is empty. */
  update(id: string, input: RecipeInput): Promise<RecipeView | null>;
  /** Returns true when a recipe was removed. */
  delete(id: string): Promise<boolean>;
  /** Copies a recipe with a "(copy)" title; favourite and rating are not carried over. */
  duplicate(id: string): Promise<RecipeView | null>;
  toggleFavourite(id: string): Promise<RecipeView | null>;
  listTags(): Promise<TagCount[]>;
  listCuisines(): Promise<string[]>;
  /** Recipes that look like the candidate (same normalised title, or near-identical ingredient set). */
  findDuplicates(candidate: { title: string; ingredientNames?: string[] }, excludeId?: string): Promise<RecipeView[]>;
}
