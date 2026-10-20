import { HISTORY_LIMIT, type CookEntry, type CookSummary, type CookingStore, type MarkCookedInput, type RecipeCookingView } from './types';

interface Stored extends CookEntry {
  userId: string;
}

interface Household {
  cooked: Stored[];
  /** `${recipeId}|${userId}` -> rating */
  ratings: Map<string, number>;
  dontSuggest: Set<string>;
}

const g = globalThis as { __frCookingMemory?: Map<string, Household> };
const map = (): Map<string, Household> => (g.__frCookingMemory ??= new Map());

export function resetMemoryCooking(): void {
  g.__frCookingMemory = undefined;
}

function household(id: string): Household {
  let h = map().get(id);
  if (!h) map().set(id, (h = { cooked: [], ratings: new Map(), dontSuggest: new Set() }));
  return h;
}

/** In-memory demo store (mock auth mode): per household, lost on restart, cleared by the dev reset. */
export class MemoryCookingStore implements CookingStore {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async markCooked(householdId: string, userId: string, recipeId: string, input: Required<Pick<MarkCookedInput, 'servings'>> & MarkCookedInput): Promise<CookEntry> {
    const h = household(householdId);
    const note = input.note?.trim() ? { text: input.note.trim(), isPrivate: input.notePrivate !== false } : null;
    const entry: Stored = {
      id: crypto.randomUUID(),
      recipeId,
      userId,
      cookedAt: this.now().toISOString(),
      servings: input.servings,
      rating: input.rating ?? null,
      cookedBy: 'You',
      mine: true,
      note,
    };
    h.cooked.push(entry);
    if (input.rating) h.ratings.set(`${recipeId}|${userId}`, input.rating);
    return this.out(entry, userId);
  }

  private out(e: Stored, userId: string): CookEntry {
    const mine = e.userId === userId;
    const { userId: _u, ...rest } = e;
    return { ...rest, mine, cookedBy: mine ? 'You' : 'A household member', note: e.note && (!e.note.isPrivate || mine) ? { ...e.note } : null };
  }

  async view(householdId: string, userId: string, recipeId: string): Promise<RecipeCookingView> {
    const h = household(householdId);
    const all = h.cooked.filter((c) => c.recipeId === recipeId).sort((a, b) => b.cookedAt.localeCompare(a.cookedAt));
    return {
      cookedCount: all.length,
      lastCookedAt: all[0]?.cookedAt ?? null,
      history: all.slice(0, HISTORY_LIMIT).map((c) => this.out(c, userId)),
      myRating: h.ratings.get(`${recipeId}|${userId}`) ?? null,
      dontSuggest: h.dontSuggest.has(`${recipeId}|${userId}`),
      dontSuggestCount: [...h.dontSuggest].filter((k) => k.startsWith(`${recipeId}|`)).length,
    };
  }

  async summaries(householdId: string): Promise<Map<string, CookSummary>> {
    const out = new Map<string, CookSummary>();
    for (const c of household(householdId).cooked) {
      const s = out.get(c.recipeId);
      out.set(c.recipeId, { cookedCount: (s?.cookedCount ?? 0) + 1, lastCookedAt: s && s.lastCookedAt && s.lastCookedAt > c.cookedAt ? s.lastCookedAt : c.cookedAt });
    }
    return out;
  }

  async setDontSuggest(householdId: string, userId: string, recipeId: string, value: boolean): Promise<void> {
    const h = household(householdId);
    if (value) h.dontSuggest.add(`${recipeId}|${userId}`);
    else h.dontSuggest.delete(`${recipeId}|${userId}`);
  }

  async dontSuggestIds(householdId: string): Promise<Set<string>> {
    return new Set([...household(householdId).dontSuggest].map((k) => k.split('|')[0]!));
  }

  async ratingMeans(householdId: string): Promise<Map<string, number>> {
    const sums = new Map<string, { sum: number; n: number }>();
    for (const [k, r] of household(householdId).ratings) {
      const id = k.split('|')[0]!;
      const s = sums.get(id) ?? { sum: 0, n: 0 };
      sums.set(id, { sum: s.sum + r, n: s.n + 1 });
    }
    return new Map([...sums].map(([id, s]) => [id, Math.round((s.sum / s.n) * 10) / 10]));
  }
}
