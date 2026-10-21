// Kids' mode and "help pick dinner" rounds (P3-A, D425-D429). One module, two callers: web server actions and the bearer routes
// under /api/kids (Android). A kid profile is a first name / nickname + emoji + colour and nothing else; kids vote through a parent's
// signed-in device (no login of their own), and the parent PIN that keeps a child inside kids' mode is device-local (never here).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  checkCandidates, checkKidProfile, isRoundOpen, isVoteValue, roundOverlapsWeek, softPreference, tallyVotes, winners, type VoteLike, type VoteValue,
} from '@fr/engine/kids';
import { getRecipeRepositoryFor } from '../../recipes/factory';
import { isIsoDate, mondayOf } from '../../plan/dates';
import { KIDS_ERROR_MESSAGE, type KidsError, type KidsResult, type KidsView, type RoundSeeds, type RoundView } from '../../kids/types';
import { imageSrc } from '../images/paths';
import type { MealPlanRepository } from '../plan/repository';
import { KidsStoreError, MemoryKidsStore, SupabaseKidsStore, type KidsStore, type RoundRow } from './store';

export interface KidsCaller {
  householdId: string;
  userId: string;
  client: SupabaseClient | null;
  readOnly: boolean;
}

export const storeFor = (client: SupabaseClient | null): KidsStore => (client ? new SupabaseKidsStore(client) : new MemoryKidsStore());

const err = (error: KidsError): { ok: false; error: KidsError; message: string } => ({ ok: false, error, message: KIDS_ERROR_MESSAGE[error] });
const mapErr = (e: unknown) => err(e instanceof KidsStoreError ? e.code : 'unknown');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Build the screen view of one round: candidate details, the tally and (when closed) the winners. */
export function roundView(row: RoundRow, recipes: Map<string, { title: string; imageUrl: string | null }>, now: Date): RoundView {
  const open = isRoundOpen(row, now);
  const tally = tallyVotes(row.candidateIds, row.votes);
  const top = open ? [] : winners(tally);
  return {
    id: row.id, title: row.title, forDate: row.forDate, days: row.days, status: row.status, open, closesAt: row.closesAt, closedAt: row.closedAt,
    candidates: tally.map((t) => ({
      recipeId: t.recipeId, title: recipes.get(t.recipeId)?.title ?? 'A recipe that has been removed', imagePath: imageSrc(recipes.get(t.recipeId)?.imageUrl ?? null),
      up: t.up, heart: t.heart, score: t.score, winner: top.includes(t.recipeId),
    })),
    votes: row.votes.map((v) => ({ recipeId: v.recipeId, voter: v.voter, value: v.value })),
  };
}

export async function loadKids(caller: KidsCaller, now: Date = new Date()): Promise<KidsResult<{ kids: KidsView }>> {
  try {
    const store = storeFor(caller.client);
    const [kids, rows] = await Promise.all([store.listKids(caller.householdId), store.listRounds(caller.householdId, 12)]);
    const repo = getRecipeRepositoryFor(caller.householdId);
    const ids = [...new Set(rows.flatMap((r) => r.candidateIds))];
    const recipes = new Map<string, { title: string; imageUrl: string | null }>();
    await Promise.all(ids.map(async (id) => {
      const r = await repo.get(id).catch(() => null);
      if (r) recipes.set(id, { title: r.title, imageUrl: r.imageUrl });
    }));
    const rounds = rows.map((r) => roundView(r, recipes, now)).sort((a, b) => Number(b.open) - Number(a.open));
    return { ok: true, kids: { kids: kids.map((k) => ({ id: k.id, displayName: k.displayName, avatar: k.avatar, colour: k.colour })), rounds, me: caller.userId } };
  } catch (e) {
    return mapErr(e);
  }
}

export async function addKid(caller: KidsCaller, raw: unknown): Promise<KidsResult<{ kid: { id: string; displayName: string; avatar: string; colour: string } }>> {
  if (caller.readOnly) return err('read_only');
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const checked = checkKidProfile(o);
  if (!checked.ok) return { ok: false, error: 'invalid_input', message: checked.message };
  try {
    return { ok: true, kid: await storeFor(caller.client).addKid(caller.householdId, caller.userId, checked.value) };
  } catch (e) {
    return mapErr(e);
  }
}

export async function removeKid(caller: KidsCaller, kidId: unknown): Promise<KidsResult> {
  if (caller.readOnly) return err('read_only');
  if (typeof kidId !== 'string' || !UUID.test(kidId)) return err('not_found');
  try {
    await storeFor(caller.client).removeKid(caller.householdId, kidId);
    return { ok: true };
  } catch (e) {
    return mapErr(e);
  }
}

/** Open a round: 3 to 6 different recipes, for a day or a week, closing by hand or at a time. */
export async function openRound(caller: KidsCaller, raw: unknown, now: Date = new Date()): Promise<KidsResult<{ roundId: string }>> {
  if (caller.readOnly) return err('read_only');
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const c = checkCandidates(o.recipeIds);
  if (!c.ok) return { ok: false, error: 'invalid_input', message: c.message };
  if (c.ids.some((id) => !UUID.test(id))) return err('invalid_input');
  const forDate = isIsoDate(o.forDate) ? o.forDate : now.toISOString().slice(0, 10);
  const days = typeof o.days === 'number' && Number.isInteger(o.days) && o.days >= 1 && o.days <= 7 ? o.days : 1;
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim().slice(0, 60) : null;
  let closesAt: string | null = null;
  if (o.closesAt !== undefined && o.closesAt !== null && o.closesAt !== '') {
    const t = typeof o.closesAt === 'string' ? Date.parse(o.closesAt) : NaN;
    if (!Number.isFinite(t) || t <= now.getTime() || t > now.getTime() + 14 * 86_400_000) return { ok: false, error: 'invalid_input', message: 'Pick a closing time within the next 14 days.' };
    closesAt = new Date(t).toISOString();
  }
  try {
    if (!caller.client) {
      const repo = getRecipeRepositoryFor(caller.householdId);
      for (const id of c.ids) if (!(await repo.get(id))) return err('invalid_input');
    }
    return { ok: true, roundId: await storeFor(caller.client).createRound(caller.householdId, caller.userId, { forDate, days, title, recipeIds: c.ids, closesAt }) };
  } catch (e) {
    return mapErr(e);
  }
}

export async function closeRound(caller: KidsCaller, roundId: unknown): Promise<KidsResult> {
  if (caller.readOnly) return err('read_only');
  if (typeof roundId !== 'string' || !UUID.test(roundId)) return err('not_found');
  try {
    return (await storeFor(caller.client).closeRound(caller.householdId, roundId)) ? { ok: true } : err('not_found');
  } catch (e) {
    return mapErr(e);
  }
}

/** One tap: a member (kidId null) or a kid profile on a parent's device votes thumbs-up or heart; `value` null takes the vote back. */
export async function castVote(caller: KidsCaller, raw: unknown): Promise<KidsResult> {
  if (caller.readOnly) return err('read_only');
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof o.roundId !== 'string' || !UUID.test(o.roundId) || typeof o.recipeId !== 'string' || !UUID.test(o.recipeId)) return err('not_found');
  const kidId = o.kidId === undefined || o.kidId === null ? null : typeof o.kidId === 'string' && UUID.test(o.kidId) ? o.kidId : undefined;
  if (kidId === undefined) return err('invalid_input');
  const value: VoteValue | null | undefined = o.value === null || o.value === undefined ? null : isVoteValue(o.value) ? o.value : undefined;
  if (value === undefined) return err('invalid_input');
  try {
    return (await storeFor(caller.client).castVote(caller.householdId, caller.userId, { roundId: o.roundId, recipeId: o.recipeId, kidId, value })) ? { ok: true } : err('not_found');
  } catch (e) {
    return mapErr(e);
  }
}

/** Recipes already in the plan for a week, as ready-made candidates ("from the planner"). */
export async function roundSeeds(caller: Pick<KidsCaller, 'householdId'>, plans: Pick<MealPlanRepository, 'getByWeek'>, week?: string): Promise<RoundSeeds> {
  const weekStart = mondayOf(isIsoDate(week) ? week : new Date().toISOString().slice(0, 10));
  const doc = await plans.getByWeek(caller.householdId, weekStart).catch(() => null);
  const ids: string[] = [];
  for (const e of Object.values(doc?.entries ?? {})) if (e.kind === 'recipe' && !ids.includes(e.recipeId)) ids.push(e.recipeId);
  const repo = getRecipeRepositoryFor(caller.householdId);
  const planned: RoundSeeds['planned'] = [];
  for (const id of ids.slice(0, 12)) {
    const r = await repo.get(id).catch(() => null);
    if (r) planned.push({ recipeId: id, title: r.title });
  }
  return { planned };
}

/**
 * The planner's soft preference from closed rounds that overlap the plan's dates (D428): liked recipes, best first. Advisory: any
 * failure is "no preference".
 */
export async function votePreference(caller: Pick<KidsCaller, 'householdId' | 'client'>, dates: readonly string[], now: Date = new Date()): Promise<string[]> {
  if (dates.length === 0) return [];
  try {
    const rows = await storeFor(caller.client).listRounds(caller.householdId, 30);
    const out: string[] = [];
    for (const r of rows) {
      if (isRoundOpen(r, now) || !roundOverlapsWeek(r.forDate, r.days, dates[0]!, dates.length)) continue;
      for (const id of softPreference(tallyVotes(r.candidateIds, r.votes as VoteLike[]))) if (!out.includes(id)) out.push(id);
    }
    return out;
  } catch {
    return [];
  }
}
