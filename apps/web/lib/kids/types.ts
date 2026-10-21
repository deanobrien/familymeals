// Client-safe view types for kids' mode (P3-A, D425-D429). The Android app parses the same shapes.
import type { CandidateTally, Voter, VoteValue } from '@fr/engine/kids';

export type { CandidateTally, Voter, VoteValue };

export interface KidView {
  id: string;
  displayName: string;
  /** An emoji from the fixed palette. */
  avatar: string;
  colour: string;
}

export interface CandidateView {
  recipeId: string;
  title: string;
  /** Cover image reference for `<img>` (already resolved with imageSrc on the server), or null. */
  imagePath: string | null;
  up: number;
  heart: number;
  score: number;
  /** Top score of a closed round (ties all win). */
  winner: boolean;
}

export interface VoteView {
  recipeId: string;
  voter: Voter;
  value: VoteValue;
}

export interface RoundView {
  id: string;
  title: string | null;
  forDate: string;
  days: number;
  /** Stored status; `open` below is what matters (a round past its closing time is closed even if nobody pressed the button). */
  status: 'open' | 'closed';
  open: boolean;
  closesAt: string | null;
  closedAt: string | null;
  candidates: CandidateView[];
  votes: VoteView[];
}

export interface KidsView {
  kids: KidView[];
  /** Open rounds first, then the most recent closed ones. */
  rounds: RoundView[];
  /** The caller's user id, so the screen can mark "my" votes. */
  me: string;
}

export interface RoundSeeds {
  /** Recipes planned in the plan week (deduplicated), as vote candidates. */
  planned: Array<{ recipeId: string; title: string }>;
  /** The household's recipes by name (up to 60), for choosing candidates by hand. */
  recipes: Array<{ recipeId: string; title: string }>;
}

export type KidsError = 'invalid_input' | 'forbidden' | 'read_only' | 'not_found' | 'round_closed' | 'rate_limited' | 'unknown';
export type KidsResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: KidsError; message: string };

export const KIDS_ERROR_MESSAGE: Record<KidsError, string> = {
  invalid_input: 'Some values were not accepted.',
  forbidden: 'You do not have access to that.',
  read_only: 'This household is read-only while it is pending deletion.',
  not_found: 'That could not be found.',
  round_closed: 'This vote has finished.',
  rate_limited: 'Too many tries. Please wait a moment and try again.',
  unknown: 'Something went wrong. Please try again.',
};
