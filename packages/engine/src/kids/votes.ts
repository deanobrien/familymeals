// "Help pick dinner" rounds (P3-A, D425-D428): pure rules for kid profiles, candidate lists, who may vote how, the tally and the
// soft preference a closed round gives the planner. No I/O: the web server, the Supabase store and the Android app all use these.

export const ROUND_MIN_CANDIDATES = 3;
export const ROUND_MAX_CANDIDATES = 6;
export const MAX_KIDS = 8;

export type VoteValue = 'up' | 'heart';
export const VOTE_VALUES: readonly VoteValue[] = ['up', 'heart'];
/** A heart counts double: it is the "yes please!" tap. */
export const VOTE_WEIGHT: Record<VoteValue, number> = { up: 1, heart: 2 };

export type VoterKind = 'member' | 'kid';
export interface Voter {
  kind: VoterKind;
  /** Member: the user id. Kid: the kid profile id. */
  id: string;
}
export const voterKey = (v: Voter): string => `${v.kind === 'kid' ? 'k' : 'm'}:${v.id}`;

/** Avatar choices: an emoji and a colour, nothing that identifies a child. */
export const KID_AVATARS: readonly string[] = ['🦊', '🐼', '🐸', '🦁', '🐙', '🦄', '🐢', '🐝', '🐧', '🦖', '🚀', '🌈'];
export const KID_COLOURS: readonly string[] = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];

export interface KidProfile {
  id: string;
  displayName: string;
  avatar: string;
  colour: string;
}

export type KidProfileCheck = { ok: true; value: { displayName: string; avatar: string; colour: string } } | { ok: false; message: string };

/**
 * A kid profile is a first name or nickname plus an emoji and a colour. Nothing else is accepted or stored: no email, no
 * date of birth, no photo, no surname.
 */
export function checkKidProfile(input: { displayName?: unknown; avatar?: unknown; colour?: unknown }): KidProfileCheck {
  const name = typeof input.displayName === 'string' ? input.displayName.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 1 || name.length > 24) return { ok: false, message: 'Use a name or nickname of 1 to 24 characters.' };
  if (/[@<>/\\]|https?:/i.test(name) || /\d{4,}/.test(name)) return { ok: false, message: 'Use just a first name or nickname (no email, link or numbers).' };
  const avatar = typeof input.avatar === 'string' ? input.avatar : '';
  if (!KID_AVATARS.includes(avatar)) return { ok: false, message: 'Pick one of the pictures.' };
  const colour = typeof input.colour === 'string' ? input.colour : '';
  if (!KID_COLOURS.includes(colour)) return { ok: false, message: 'Pick one of the colours.' };
  return { ok: true, value: { displayName: name, avatar, colour } };
}

export type CandidateCheck = { ok: true; ids: string[] } | { ok: false; message: string };

/** 3 to 6 different recipes. */
export function checkCandidates(ids: unknown): CandidateCheck {
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string' || !i)) return { ok: false, message: 'Pick the recipes to vote on.' };
  const unique = [...new Set(ids as string[])];
  if (unique.length < ROUND_MIN_CANDIDATES) return { ok: false, message: `Pick at least ${ROUND_MIN_CANDIDATES} different recipes.` };
  if (unique.length > ROUND_MAX_CANDIDATES) return { ok: false, message: `Pick at most ${ROUND_MAX_CANDIDATES} recipes.` };
  return { ok: true, ids: unique };
}

export interface RoundLike {
  status: 'open' | 'closed';
  /** ISO timestamp; the round closes by itself at this time. */
  closesAt?: string | null | undefined;
}

/** A round is open until someone closes it or its closing time passes. The time is the truth: nothing has to run to close it. */
export function isRoundOpen(round: RoundLike, now: Date): boolean {
  if (round.status !== 'open') return false;
  if (round.closesAt && Date.parse(round.closesAt) <= now.getTime()) return false;
  return true;
}

export interface VoteLike {
  recipeId: string;
  voter: Voter;
  value: VoteValue;
}

export interface CandidateTally {
  recipeId: string;
  up: number;
  heart: number;
  score: number;
  /** Everyone who voted for it (kid ids and member ids), for the "who liked it" dots. */
  voters: Voter[];
}

/** One tally row per candidate, in candidate order. A voter's later vote on the same recipe replaces the earlier one. */
export function tallyVotes(candidateIds: readonly string[], votes: readonly VoteLike[]): CandidateTally[] {
  const latest = new Map<string, VoteLike>();
  for (const v of votes) latest.set(`${voterKey(v.voter)}|${v.recipeId}`, v);
  return candidateIds.map((recipeId) => {
    const mine = [...latest.values()].filter((v) => v.recipeId === recipeId);
    const up = mine.filter((v) => v.value === 'up').length;
    const heart = mine.filter((v) => v.value === 'heart').length;
    return { recipeId, up, heart, score: up * VOTE_WEIGHT.up + heart * VOTE_WEIGHT.heart, voters: mine.map((v) => v.voter) };
  });
}

/** The candidates with the highest score (ties all win). Nobody voting means no winner. */
export function winners(tally: readonly CandidateTally[]): string[] {
  const top = Math.max(0, ...tally.map((t) => t.score));
  return top > 0 ? tally.filter((t) => t.score === top).map((t) => t.recipeId) : [];
}

/**
 * What a CLOSED round tells the planner: every liked recipe is a soft preference (the planner treats it like a favourite, so it
 * can still be overridden by allergies, budget or variety), best first. Recipes nobody voted for say nothing either way.
 */
export function softPreference(tally: readonly CandidateTally[]): string[] {
  return tally.filter((t) => t.score > 0).sort((a, b) => b.score - a.score).map((t) => t.recipeId);
}

/** Has everyone in `voters` voted on every candidate (a "done" tick; never required to close). */
export function allVoted(candidateIds: readonly string[], votes: readonly VoteLike[], voters: readonly Voter[]): boolean {
  const seen = new Set(votes.map((v) => `${voterKey(v.voter)}|${v.recipeId}`));
  return voters.every((v) => candidateIds.every((c) => seen.has(`${voterKey(v)}|${c}`)));
}

export const isVoteValue = (v: unknown): v is VoteValue => v === 'up' || v === 'heart';

/** The dates (ISO) a round covers: one day, or from `start` for `days` (a "week" round is 7). */
export function roundDates(start: string, days: number): string[] {
  const out: string[] = [];
  const t0 = Date.parse(`${start}T00:00:00Z`);
  for (let i = 0; i < Math.max(1, Math.min(days, 14)); i++) out.push(new Date(t0 + i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** Does a round (covering `forDate` .. `forDate + days - 1`) overlap a plan week starting `weekStart` for `planDays`? */
export function roundOverlapsWeek(forDate: string, days: number, weekStart: string, planDays: number): boolean {
  const a0 = Date.parse(`${forDate}T00:00:00Z`);
  const a1 = a0 + (Math.max(1, days) - 1) * 86_400_000;
  const b0 = Date.parse(`${weekStart}T00:00:00Z`);
  const b1 = b0 + (Math.max(1, planDays) - 1) * 86_400_000;
  return a0 <= b1 && b0 <= a1;
}
