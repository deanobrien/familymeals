// Storage for kid profiles and "help pick dinner" rounds (P3-A, D425-D428). Supabase as the signed-in user (RLS reads, the
// SECURITY DEFINER RPCs of migration 20261021003010 write) or an in-memory demo store with the same rules.
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MAX_KIDS, isRoundOpen, type VoteLike, type VoteValue } from '@fr/engine/kids';

export class KidsStoreError extends Error {
  constructor(readonly code: 'forbidden' | 'invalid_input' | 'not_found' | 'round_closed' | 'unknown') {
    super(code);
    this.name = 'KidsStoreError';
  }
}

export interface KidRow {
  id: string;
  displayName: string;
  avatar: string;
  colour: string;
}

export interface RoundRow {
  id: string;
  title: string | null;
  forDate: string;
  days: number;
  status: 'open' | 'closed';
  closesAt: string | null;
  closedAt: string | null;
  createdAt: string;
  candidateIds: string[];
  votes: VoteLike[];
}

export interface NewRound {
  forDate: string;
  days: number;
  title: string | null;
  recipeIds: string[];
  closesAt: string | null;
}

export interface KidsStore {
  listKids(householdId: string): Promise<KidRow[]>;
  addKid(householdId: string, userId: string, kid: Omit<KidRow, 'id'>): Promise<KidRow>;
  removeKid(householdId: string, id: string): Promise<void>;
  listRounds(householdId: string, limit: number): Promise<RoundRow[]>;
  createRound(householdId: string, userId: string, round: NewRound): Promise<string>;
  closeRound(householdId: string, id: string): Promise<boolean>;
  /** `value` null removes the vote. `kidId` null = the member votes as themselves. */
  castVote(householdId: string, userId: string, v: { roundId: string; recipeId: string; kidId: string | null; value: VoteValue | null }): Promise<boolean>;
}

type Row = Record<string, unknown>;

function fail(e: unknown): never {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code === '42501' || err?.code === 'PGRST301') throw new KidsStoreError('forbidden');
  if (/closed/i.test(err?.message ?? '')) throw new KidsStoreError('round_closed');
  if (err?.code === '22023' || err?.code === '22P02' || err?.code === '23514' || err?.code === '23502') throw new KidsStoreError('invalid_input');
  if (err?.code === '23503') throw new KidsStoreError('not_found');
  throw new KidsStoreError('unknown');
}

const toKid = (r: Row): KidRow => ({ id: String(r.id), displayName: String(r.display_name), avatar: String(r.avatar), colour: String(r.colour) });

export class SupabaseKidsStore implements KidsStore {
  constructor(private readonly db: SupabaseClient) {}

  async listKids(h: string): Promise<KidRow[]> {
    const { data, error } = await this.db.from('kid_profiles').select('id, display_name, avatar, colour').eq('household_id', h).order('created_at', { ascending: true });
    if (error) fail(error);
    return ((data ?? []) as Row[]).map(toKid);
  }

  async addKid(h: string, userId: string, kid: Omit<KidRow, 'id'>): Promise<KidRow> {
    const id = randomUUID();
    const { error } = await this.db.from('kid_profiles').insert({ id, household_id: h, display_name: kid.displayName, avatar: kid.avatar, colour: kid.colour, created_by: userId });
    if (error) fail(error);
    return { id, ...kid };
  }

  async removeKid(h: string, id: string): Promise<void> {
    const { error } = await this.db.from('kid_profiles').delete().eq('household_id', h).eq('id', id);
    if (error) fail(error);
  }

  async listRounds(h: string, limit: number): Promise<RoundRow[]> {
    const { data, error } = await this.db.from('dinner_rounds').select('id, title, for_date, days, status, closes_at, closed_at, created_at').eq('household_id', h).order('created_at', { ascending: false }).limit(limit);
    if (error) fail(error);
    const rounds = (data ?? []) as Row[];
    if (rounds.length === 0) return [];
    const ids = rounds.map((r) => String(r.id));
    const [c, v] = await Promise.all([
      this.db.from('dinner_round_candidates').select('round_id, recipe_id, position').in('round_id', ids).order('position', { ascending: true }),
      this.db.from('dinner_round_votes').select('round_id, recipe_id, voter_user_id, voter_kid_id, value').in('round_id', ids),
    ]);
    if (c.error) fail(c.error);
    if (v.error) fail(v.error);
    return rounds.map((r) => {
      const id = String(r.id);
      return {
        id, title: typeof r.title === 'string' ? r.title : null, forDate: String(r.for_date), days: Number(r.days ?? 1), status: r.status === 'closed' ? 'closed' : 'open',
        closesAt: typeof r.closes_at === 'string' ? r.closes_at : null, closedAt: typeof r.closed_at === 'string' ? r.closed_at : null, createdAt: String(r.created_at),
        candidateIds: ((c.data ?? []) as Row[]).filter((x) => x.round_id === id).map((x) => String(x.recipe_id)),
        votes: ((v.data ?? []) as Row[]).filter((x) => x.round_id === id).map((x) => ({
          recipeId: String(x.recipe_id),
          voter: x.voter_kid_id ? { kind: 'kid' as const, id: String(x.voter_kid_id) } : { kind: 'member' as const, id: String(x.voter_user_id) },
          value: x.value === 'heart' ? ('heart' as const) : ('up' as const),
        })),
      };
    });
  }

  async createRound(h: string, _userId: string, r: NewRound): Promise<string> {
    const { data, error } = await this.db.rpc('create_dinner_round', {
      p_household_id: h, p_for_date: r.forDate, p_days: r.days, p_title: r.title, p_recipe_ids: r.recipeIds, p_closes_at: r.closesAt,
    });
    if (error) fail(error);
    if (typeof data !== 'string') throw new KidsStoreError('unknown');
    return data;
  }

  async closeRound(_h: string, id: string): Promise<boolean> {
    const { data, error } = await this.db.rpc('close_dinner_round', { p_round_id: id });
    if (error) fail(error);
    return data === true;
  }

  async castVote(_h: string, _u: string, v: { roundId: string; recipeId: string; kidId: string | null; value: VoteValue | null }): Promise<boolean> {
    const { data, error } = await this.db.rpc('cast_dinner_vote', { p_round_id: v.roundId, p_recipe_id: v.recipeId, p_kid_id: v.kidId, p_value: v.value });
    if (error) fail(error);
    return data === true;
  }
}

// ---------------------------------------------------------------------------------------------------------------- memory

interface MemHousehold {
  kids: KidRow[];
  rounds: RoundRow[];
}
const g = globalThis as { __frKids?: Map<string, MemHousehold> };
const mem = (h: string): MemHousehold => {
  const m = (g.__frKids ??= new Map());
  let v = m.get(h);
  if (!v) m.set(h, (v = { kids: [], rounds: [] }));
  return v;
};

export function resetMemoryKids(): void {
  g.__frKids = undefined;
}

export class MemoryKidsStore implements KidsStore {
  async listKids(h: string): Promise<KidRow[]> {
    return mem(h).kids.map((k) => ({ ...k }));
  }
  async addKid(h: string, _u: string, kid: Omit<KidRow, 'id'>): Promise<KidRow> {
    const m = mem(h);
    if (m.kids.length >= MAX_KIDS) throw new KidsStoreError('invalid_input');
    const row = { id: randomUUID(), ...kid };
    m.kids.push(row);
    return { ...row };
  }
  async removeKid(h: string, id: string): Promise<void> {
    const m = mem(h);
    m.kids = m.kids.filter((k) => k.id !== id);
    for (const r of m.rounds) r.votes = r.votes.filter((v) => !(v.voter.kind === 'kid' && v.voter.id === id));
  }
  async listRounds(h: string, limit: number): Promise<RoundRow[]> {
    return [...mem(h).rounds].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((r) => structuredClone(r));
  }
  async createRound(h: string, _u: string, r: NewRound): Promise<string> {
    const m = mem(h);
    if (m.rounds.filter((x) => isRoundOpen(x, new Date())).length >= 5) throw new KidsStoreError('invalid_input');
    const id = randomUUID();
    m.rounds.push({ id, title: r.title, forDate: r.forDate, days: r.days, status: 'open', closesAt: r.closesAt, closedAt: null, createdAt: new Date().toISOString(), candidateIds: [...r.recipeIds], votes: [] });
    return id;
  }
  async closeRound(h: string, id: string): Promise<boolean> {
    const r = mem(h).rounds.find((x) => x.id === id);
    if (!r) return false;
    if (r.status === 'open') {
      r.status = 'closed';
      r.closedAt = new Date().toISOString();
    }
    return true;
  }
  async castVote(h: string, userId: string, v: { roundId: string; recipeId: string; kidId: string | null; value: VoteValue | null }): Promise<boolean> {
    const m = mem(h);
    const r = m.rounds.find((x) => x.id === v.roundId);
    if (!r || !r.candidateIds.includes(v.recipeId)) return false;
    if (!isRoundOpen(r, new Date())) throw new KidsStoreError('round_closed');
    if (v.kidId && !m.kids.some((k) => k.id === v.kidId)) return false;
    const voter = v.kidId ? { kind: 'kid' as const, id: v.kidId } : { kind: 'member' as const, id: userId };
    r.votes = r.votes.filter((x) => !(x.recipeId === v.recipeId && x.voter.kind === voter.kind && x.voter.id === voter.id));
    if (v.value) r.votes.push({ recipeId: v.recipeId, voter, value: v.value });
    return true;
  }
}
