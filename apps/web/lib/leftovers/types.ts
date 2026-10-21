// Client-safe view types for leftovers and batch cooking (P2-C, D416-D419).
import type { BatchStatus, LeftoverSuggestion, StoredIn } from '@fr/engine/leftovers';

export type { BatchStatus, LeftoverSuggestion, StoredIn };

export interface BatchView {
  id: string;
  title: string;
  recipeId?: string;
  storedIn: StoredIn;
  portionsMade: number;
  /** After everything eaten or discarded (the ledger). */
  portionsLeft: number;
  /** Promised to plan slots that have not been eaten yet. */
  portionsPlanned: number;
  /** Left and not promised: what can still be planned. */
  portionsFree: number;
  cookedOn: string;
  useBy: string;
  status: BatchStatus;
  /** "Use by Fri 23 Oct" (fridge) / "Best by Thu 21 Jan" (freezer). */
  useByLabel: string;
}

export interface LeftoversView {
  /** Batches with portions left, fridge first then freezer, soonest use-by first. */
  batches: BatchView[];
  suggestions: LeftoverSuggestion[];
  /** Every batch id -> title (including used-up batches), so a plan slot can always be named. */
  titles: Record<string, string>;
}

export type LeftoverError = 'not_found' | 'forbidden' | 'read_only' | 'invalid_input' | 'not_enough' | 'past_use_by' | 'already_frozen' | 'unknown';

export type LeftoverResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: LeftoverError; message: string };

export const LEFTOVER_ERROR_MESSAGE: Record<LeftoverError, string> = {
  not_found: 'That leftover could not be found.',
  forbidden: 'You do not have access to that.',
  read_only: 'This household is read-only while it is pending deletion.',
  invalid_input: 'Some values were not accepted.',
  not_enough: 'There are not enough portions left.',
  past_use_by: 'That is past its use-by date, so it cannot be frozen.',
  already_frozen: 'That is already in the freezer.',
  unknown: 'Something went wrong. Please try again.',
};
