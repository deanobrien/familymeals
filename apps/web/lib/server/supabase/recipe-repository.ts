// Supabase-backed RecipeRepository (lane S1, DECISIONS D50-D59).
// Reads/writes go through the 0015 RPCs (list_recipes, get_recipes, save_recipe, recipe_facets, find_recipe_duplicates)
// so search/filter/sort/paging happen in SQL and every recipe write is one transaction
// (recipes + recipe_ingredients + recipe_steps + tags + a new recipe_versions row).
import { priceBandOf, sortRecipes, withSummary, type RecipeSummariser } from '../../recipes/memory-repository';
import type { RecipeListResult, RecipeRepository, TagCount } from '../../recipes/repository';
import type { RecipeInput, RecipeQuery } from '../../recipes/schema';
import type { RecipeView } from '../../recipes/types';
import type { DbRow } from '@fr/domain';
import { recipeInputFromView, recipeViewFromDoc } from './recipe-mapper';
import { SupabaseRepositoryError, callRpc, isUuid, unwrap, type PgResult, type SupabaseClient } from './rpc';

export interface RecipeRepositoryOptions {
  client: SupabaseClient;
  householdId: string;
  /** Signed-in member: drives favourites (per member) and created_by. null = service context, no favourites. */
  userId: string | null;
  /**
   * Derived cost + nutrition, computed on every read and never stored (D53, D100). Pass the SAME summariser the
   * in-memory repository uses so both backends report identical costs. Omitted = cost unknown.
   */
  summariser?: RecipeSummariser | undefined;
}

export class SupabaseRecipeRepository implements RecipeRepository {
  private readonly client: SupabaseClient;
  private readonly householdId: string;
  private readonly userId: string | null;
  private readonly summariser: RecipeSummariser | undefined;

  constructor(opts: RecipeRepositoryOptions) {
    this.client = opts.client;
    this.householdId = opts.householdId;
    this.userId = opts.userId;
    this.summariser = opts.summariser;
  }

  private summarise(items: RecipeView[]): Promise<RecipeView[]> {
    return Promise.all(items.map((r) => withSummary(r, this.summariser)));
  }

  private scope() {
    return { p_household_id: this.householdId, p_user_id: this.userId };
  }

  private async fetchPage(query: RecipeQuery, page: number, pageSize: number): Promise<{ items: RecipeView[]; total: number }> {
    const doc = await callRpc<{ total: number; items: DbRow[] }>(this.client, 'list_recipes', {
      ...this.scope(),
      p_query: query.q,
      p_cuisine: query.cuisine ?? null,
      p_meal_type: query.mealType ?? null,
      p_max_prep: query.maxPrepMinutes ?? null,
      p_diet: query.diet ?? null,
      p_tags: query.tags,
      p_collection: query.collection ?? null,
      p_sort: query.sort,
      p_limit: pageSize,
      p_offset: (page - 1) * pageSize,
    });
    return { items: (doc?.items ?? []).map(recipeViewFromDoc), total: Number(doc?.total ?? 0) };
  }

  async list(query: RecipeQuery): Promise<RecipeListResult> {
    const pageSize = Math.max(1, query.pageSize);
    // Cost is computed on read, not stored (D100), so anything that depends on it (price band, the budget collection,
    // sort by cost) is resolved here over the SQL-filtered set instead of in SQL.
    if (query.collection === 'budget' || query.priceBand || query.sort === 'cost') return this.listByComputedCost(query, pageSize);

    let page = Math.max(1, query.page);
    let res = await this.fetchPage(query, page, pageSize);
    const pageCount = Math.max(1, Math.ceil(res.total / pageSize));
    if (page > pageCount) {
      page = pageCount;
      res = await this.fetchPage(query, page, pageSize);
    }
    return { items: await this.summarise(res.items), total: res.total, page, pageSize, pageCount };
  }

  /** Every recipe matching the non-cost filters (SQL), costed, then band / budget filter, sort and paging as in memory. */
  private async listByComputedCost(query: RecipeQuery, pageSize: number): Promise<RecipeListResult> {
    const { priceBand, collection, ...rest } = query;
    const sql: RecipeQuery = { ...rest, sort: 'name', ...(collection && collection !== 'budget' ? { collection } : {}) };
    const all = await this.summarise((await this.fetchPage(sql, 1, 10_000)).items);
    const wanted = all.filter((r) => (collection !== 'budget' || priceBandOf(r) === 'low') && (!priceBand || priceBandOf(r) === priceBand));
    const sorted = sortRecipes(wanted, query.sort);
    const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
    const page = Math.min(Math.max(1, query.page), pageCount);
    return { items: sorted.slice((page - 1) * pageSize, page * pageSize), total: sorted.length, page, pageSize, pageCount };
  }

  async get(id: string): Promise<RecipeView | null> {
    if (!isUuid(id)) return null;
    return (await this.getMany([id]))[0] ?? null;
  }

  /** Several recipes in one round trip (plan source). Non-uuid ids cannot exist and are skipped. */
  async getMany(ids: string[]): Promise<RecipeView[]> {
    const valid = [...new Set(ids.filter(isUuid))];
    if (valid.length === 0) return [];
    const docs = await callRpc<DbRow[]>(this.client, 'get_recipes', { ...this.scope(), p_ids: valid });
    return this.summarise((docs ?? []).map(recipeViewFromDoc));
  }

  async create(input: RecipeInput, opts: { id?: string } = {}): Promise<RecipeView> {
    if (opts.id !== undefined && !isUuid(opts.id)) throw new Error(`Recipe id must be a UUID (got "${opts.id}")`);
    try {
      const doc = await callRpc<DbRow>(this.client, 'save_recipe', {
        ...this.scope(),
        p_id: opts.id ?? null,
        p_input: input,
        p_mode: 'create',
      });
      if (!doc) throw new SupabaseRepositoryError('rpc save_recipe', 'no recipe returned');
      return (await this.summarise([recipeViewFromDoc(doc)]))[0]!;
    } catch (e) {
      if (e instanceof SupabaseRepositoryError && e.code === '23505' && opts.id) throw new Error(`Recipe ${opts.id} already exists`);
      throw e;
    }
  }

  async update(id: string, input: RecipeInput): Promise<RecipeView | null> {
    if (!isUuid(id)) return null;
    const doc = await callRpc<DbRow>(this.client, 'save_recipe', { ...this.scope(), p_id: id, p_input: input, p_mode: 'update' });
    return doc ? (await this.summarise([recipeViewFromDoc(doc)]))[0]! : null;
  }

  /**
   * Archives the recipe (status = 'archived'): planned meals reference recipes with NO ACTION, so history must survive.
   * Archived recipes disappear from list/get/search/duplicates.
   */
  async delete(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const res = (await this.client
      .from('recipes')
      .update({ status: 'archived' })
      .eq('id', id)
      .eq('household_id', this.householdId)
      .neq('status', 'archived')
      .select('id')) as PgResult<{ id: string }[]>;
    return (unwrap('archive recipe', res) ?? []).length > 0;
  }

  async duplicate(id: string): Promise<RecipeView | null> {
    const src = await this.get(id);
    if (!src) return null;
    return this.create(recipeInputFromView(src, { title: `${src.title} (copy)` }));
  }

  async toggleFavourite(id: string): Promise<RecipeView | null> {
    if (!this.userId) throw new Error('toggleFavourite needs a signed-in member (favourites are per member)');
    const recipe = await this.get(id);
    if (!recipe) return null;
    const match = { recipe_id: id, user_id: this.userId, household_id: this.householdId };
    if (recipe.favourite) {
      const res = (await this.client.from('recipe_favourites').delete().match(match)) as PgResult<unknown>;
      unwrap('remove favourite', res);
    } else {
      const res = (await this.client
        .from('recipe_favourites')
        .upsert(match, { onConflict: 'recipe_id,user_id', ignoreDuplicates: true })) as PgResult<unknown>;
      unwrap('add favourite', res);
    }
    return this.get(id);
  }

  private async facets(): Promise<{ tags: TagCount[]; cuisines: string[] }> {
    const doc = await callRpc<{ tags?: TagCount[]; cuisines?: string[] }>(this.client, 'recipe_facets', { p_household_id: this.householdId });
    return {
      tags: (doc?.tags ?? []).map((t) => ({ tag: t.tag, count: Number(t.count) })),
      cuisines: doc?.cuisines ?? [],
    };
  }

  async listTags(): Promise<TagCount[]> {
    return (await this.facets()).tags;
  }

  async listCuisines(): Promise<string[]> {
    return (await this.facets()).cuisines;
  }

  async findDuplicates(candidate: { title: string; ingredientNames?: string[] }, excludeId?: string): Promise<RecipeView[]> {
    const docs = await callRpc<DbRow[]>(this.client, 'find_recipe_duplicates', {
      ...this.scope(),
      p_title: candidate.title,
      p_names: candidate.ingredientNames ?? [],
      p_exclude: excludeId && isUuid(excludeId) ? excludeId : null,
    });
    return this.summarise((docs ?? []).map(recipeViewFromDoc));
  }
}
