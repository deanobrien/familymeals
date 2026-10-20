// View models and inputs for minimum-stock (par level) restocking (PR1, D280-D289). Client-safe: plain data only.
import type { RestockUnit } from '@fr/engine/pantry';

export interface RestockSettings {
  /** Add restock items to the shopping list automatically whenever the pantry changes. Default false (suggestions only). */
  autoAdd: boolean;
}
export const DEFAULT_RESTOCK_SETTINGS: RestockSettings = { autoAdd: false };

/** Days a snoozed suggestion stays hidden. */
export const SNOOZE_DAYS = 7;

export interface ParView {
  id: string;
  /** Matches `parKey` of the engine: `ing:<id>` or `name:<normalised>`. */
  key: string;
  name: string;
  ingredientId?: string;
  unit: RestockUnit;
  minValue: number;
  restockToValue?: number;
  pack?: { value: number; unit: RestockUnit };
  enabled: boolean;
  snoozedUntil?: string;
  /** "Minimum 6 cans, restock to 8" */
  label: string;
  /** Trusted stock right now, in the minimum's unit. */
  available: number;
  /** Short status for the minimums list, e.g. "2 cans in stock - below minimum". */
  status: string;
  belowMin: boolean;
}

export interface RestockSuggestionView {
  parId: string;
  kind: 'below_min' | 'will_run_low';
  name: string;
  /** "4 cans" */
  quantityLabel: string;
  quantity: number;
  unit: RestockUnit;
  explanation: string;
  checkQuantity: boolean;
  notes: string[];
}

export interface RestockView {
  settings: RestockSettings;
  pars: ParView[];
  /** Below minimum now. */
  suggestions: RestockSuggestionView[];
  /** Fine now, but this week's approved plan will take stock below the minimum (labelled separately). */
  willRunLow: RestockSuggestionView[];
  snoozedCount: number;
}

/** Everything the banner (Shopping, Home) needs. */
export interface RestockBannerData {
  items: { parId: string; name: string; quantityLabel: string; checkQuantity: boolean }[];
  /** Changes whenever the set of suggestions changes; a dismissed banner stays hidden until it does. */
  signature: string;
  autoAdd: boolean;
}

export interface SetParInput {
  /** Existing minimum to change; otherwise the household's minimum for this ingredient / name is replaced. */
  ingredientId?: string;
  name?: string;
  unit: string;
  min: number;
  /** Omit / null = restock to the minimum. */
  restockTo?: number | null;
  packValue?: number | null;
  packUnit?: string | null;
  enabled?: boolean;
}

export type RestockResult = { ok: true; message?: string; added?: number } | { ok: false; error: string };
