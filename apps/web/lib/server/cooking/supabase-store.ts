import type { SupabaseClient } from '@supabase/supabase-js';
import { CookingError, HISTORY_LIMIT, type CookEntry, type CookSummary, type CookingStore, type MarkCookedInput, type RecipeCookingView } from './types';

type Row = Record<string, unknown>;

/** Postgres / PostgREST failures become fixed codes (never raw provider text). 42501 = RLS refusal, 23503 = no such recipe here. */
function fail(e: unknown): never {
  const code = (e as { code?: string } | null)?.code;
  if (code === '42501' || code === 'PGRST301') throw new CookingError('forbidden');
  if (code === '23503') throw new CookingError('not_found');
  if (code === '23514' || code === '22P02') throw new CookingError('invalid_input');
  throw new CookingError('unknown');
}

async function run<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  const { data, error } = await p;
  if (error) fail(error);
  return data;
}

/**
 * recipe_cooked / recipe_cook_notes / recipe_dont_suggest / recipe_ratings as the signed-in user. RLS is the authority:
 * rows are written as yourself, private notes are never returned to anyone else, and writes need a writable household.
 * Nothing here needs the service role.
 */
export class SupabaseCookingStore implements CookingStore {
  constructor(private readonly db: SupabaseClient) {}

  async markCooked(householdId: string, userId: string, recipeId: string, input: Required<Pick<MarkCookedInput, 'servings'>> & MarkCookedInput): Promise<CookEntry> {
    const rating = input.rating ?? null;
    const rows = await run<Row[]>(
      this.db.from('recipe_cooked').insert({ household_id: householdId, recipe_id: recipeId, user_id: userId, servings: input.servings, rating }).select('id, cooked_at'),
    );
    const row = rows?.[0];
    if (!row) throw new CookingError('unknown');
    const id = String(row.id);
    const text = input.note?.trim();
    if (text) {
      await run(
        this.db.from('recipe_cook_notes').insert({ cooked_id: id, household_id: householdId, user_id: userId, note: text, is_private: input.notePrivate !== false }),
      );
    }
    // The member's current rating of the recipe (the household mean and the sort-by-rating read from here).
    if (rating !== null) {
      await run(
        this.db.from('recipe_ratings').upsert({ recipe_id: recipeId, household_id: householdId, user_id: userId, rating }, { onConflict: 'recipe_id,user_id' }),
      );
    }
    return {
      id,
      recipeId,
      cookedAt: String(row.cooked_at),
      servings: input.servings,
      rating,
      cookedBy: 'You',
      mine: true,
      note: text ? { text, isPrivate: input.notePrivate !== false } : null,
    };
  }

  async view(householdId: string, userId: string, recipeId: string): Promise<RecipeCookingView> {
    const [cooked, members, mine, flags] = await Promise.all([
      run<Row[]>(
        this.db.from('recipe_cooked').select('id, user_id, cooked_at, servings, rating').eq('household_id', householdId).eq('recipe_id', recipeId).order('cooked_at', { ascending: false }),
      ),
      run<Row[]>(this.db.from('household_members').select('user_id, display_name').eq('household_id', householdId)),
      run<Row>(this.db.from('recipe_ratings').select('rating').eq('recipe_id', recipeId).eq('user_id', userId).maybeSingle()),
      run<Row[]>(this.db.from('recipe_dont_suggest').select('user_id').eq('household_id', householdId).eq('recipe_id', recipeId)),
    ]);
    const all = cooked ?? [];
    const recent = all.slice(0, HISTORY_LIMIT);
    const ids = recent.map((r) => String(r.id));
    // RLS returns only the notes this member may see (their own private ones, everyone's household ones).
    const notes = ids.length ? ((await run<Row[]>(this.db.from('recipe_cook_notes').select('cooked_id, note, is_private').in('cooked_id', ids))) ?? []) : [];
    const noteBy = new Map(notes.map((n) => [String(n.cooked_id), n]));
    const names = new Map((members ?? []).map((m) => [String(m.user_id), typeof m.display_name === 'string' && m.display_name ? m.display_name : null]));
    const history: CookEntry[] = recent.map((r) => {
      const isMine = String(r.user_id) === userId;
      const n = noteBy.get(String(r.id));
      return {
        id: String(r.id),
        recipeId,
        cookedAt: String(r.cooked_at),
        servings: Number(r.servings),
        rating: typeof r.rating === 'number' ? r.rating : null,
        cookedBy: isMine ? 'You' : (names.get(String(r.user_id)) ?? 'A household member'),
        mine: isMine,
        note: n && typeof n.note === 'string' ? { text: n.note, isPrivate: n.is_private === true } : null,
      };
    });
    const flagged = (flags ?? []).map((f) => String(f.user_id));
    return {
      cookedCount: all.length,
      lastCookedAt: all[0] ? String(all[0].cooked_at) : null,
      history,
      myRating: mine && typeof mine.rating === 'number' ? mine.rating : null,
      dontSuggest: flagged.includes(userId),
      dontSuggestCount: flagged.length,
    };
  }

  async summaries(householdId: string): Promise<Map<string, CookSummary>> {
    const { data, error } = await this.db.rpc('recipe_cook_summaries', { p_household_id: householdId });
    if (error) fail(error);
    const out = new Map<string, CookSummary>();
    for (const r of (Array.isArray(data) ? data : []) as Row[]) {
      out.set(String(r.recipeId), { cookedCount: Number(r.cookedCount ?? 0), lastCookedAt: typeof r.lastCookedAt === 'string' ? r.lastCookedAt : null });
    }
    return out;
  }

  async setDontSuggest(householdId: string, userId: string, recipeId: string, value: boolean): Promise<void> {
    if (value) {
      await run(this.db.from('recipe_dont_suggest').upsert({ recipe_id: recipeId, household_id: householdId, user_id: userId }, { onConflict: 'recipe_id,user_id', ignoreDuplicates: true }));
    } else {
      await run(this.db.from('recipe_dont_suggest').delete().eq('recipe_id', recipeId).eq('user_id', userId).eq('household_id', householdId));
    }
  }

  async dontSuggestIds(householdId: string): Promise<Set<string>> {
    const rows = (await run<Row[]>(this.db.from('recipe_dont_suggest').select('recipe_id').eq('household_id', householdId))) ?? [];
    return new Set(rows.map((r) => String(r.recipe_id)));
  }

  async ratingMeans(): Promise<Map<string, number>> {
    return new Map();
  }
}
