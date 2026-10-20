// Wire shapes for the handwritten shopping list scan (DECISIONS D260-D268). Client-safe: plain serialisable data only.
// The server (lib/server/shopping/list-scan.ts) maps the @fr/ai ShoppingListScan onto these; the browser never sees @fr/ai.
import type { IngredientRef, ScanApiError, ScanMatch, ScanProviderInfo } from '../pantry/scan-types';

export type { IngredientRef, ScanApiError, ScanMatch, ScanProviderInfo };

/** The amount as WRITTEN on the line (never inferred). */
export interface ListScanQuantityDto {
  kind: 'exact' | 'range' | 'approximate';
  value?: number;
  min?: number;
  max?: number;
  unit?: string;
  approxLabel?: string;
}

export interface ListScanRowDto {
  /** Stable id for this scan (client keys, preview lines, idempotent command ids). */
  key: string;
  /** The line exactly as written (the model's transcription). */
  originalText: string;
  /** Item name as the model expanded it ("spuds" -> "potatoes"). Empty for an illegible line. */
  name: string;
  quantity?: ListScanQuantityDto;
  notes?: string;
  /** Struck through / ticked off: excluded by default. */
  crossedOut: boolean;
  /** Could not be read: excluded by default, the owner types what it says or leaves it out. */
  illegible: boolean;
  confidence: number;
  /** 1-based photo the line is on. */
  imageRef: number;
  match: ScanMatch;
  /** Aisle (category) the item will be filed under, from the matched ingredient or a keyword guess. */
  aisle: string;
}

export interface ListScanApiOk {
  rows: ListScanRowDto[];
  /** A heading written on the list ("Saturday shop"), used to name a new list. */
  title?: string;
  warnings: string[];
  provider?: ScanProviderInfo;
}

/** One reviewed row sent to preview / confirm. Nothing is written until confirm. */
export interface ListCommitRow {
  key: string;
  /** Canonical ingredient id, or absent for a free-text item. */
  ingredientId?: string;
  /** Item name (the canonical name when matched, else what the owner typed). */
  name: string;
  /** Written amount; absent = no quantity ("one of"). */
  value?: number;
  unit?: string;
  notes?: string;
  aisle?: string;
}

export type ListDestination = { kind: 'current' } | { kind: 'new'; name: string };

export interface ListScanPreviewLine {
  key: string;
  name: string;
  /** merge = folded into an existing item; new = a new line; exists = already on the list and no amount to add; skip = could not be added. */
  kind: 'merge' | 'new' | 'exists' | 'skip';
  /** Quantity of the existing item before, for merges. */
  before?: string;
  /** Quantity after (merge) or the new line's quantity. */
  after: string;
  aisle: string;
  note?: string;
}

export interface ListScanPreview {
  destination: { kind: 'current' | 'new'; name: string };
  lines: ListScanPreviewLine[];
  added: number;
  merged: number;
  skipped: number;
}

export type ListScanActionResult<T> = ({ ok: true } & T) | { ok: false; error: string };
