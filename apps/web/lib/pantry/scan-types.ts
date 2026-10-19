// Wire shapes for the pantry scan (DECISIONS D83-D84). Client-safe: plain serialisable data only.
// The server (lib/server/pantry/scan.ts) maps the @fr/ai PantryScan onto these; the browser never sees @fr/ai.

export type ScanForm = 'fresh' | 'chilled' | 'frozen' | 'canned' | 'dried' | 'ambient' | 'other';
export type ScanPackaging = 'loose' | 'pack' | 'tin' | 'jar' | 'bag' | 'bottle';

export interface IngredientRef {
  id: string;
  name: string;
  category: string;
}

/** How the scanned name matched the canonical catalogue (engine normalise: exact name / alias only, never fuzzy). */
export type ScanMatch =
  | { status: 'matched'; ingredient: IngredientRef }
  | { status: 'ambiguous'; candidates: IngredientRef[] }
  | { status: 'unmatched'; suggestions: IngredientRef[] };

export interface ScanRowDto {
  /** Stable id for this scan (client keys, preview lines). */
  key: string;
  /** Name as the model wrote it. */
  name: string;
  form: ScanForm;
  packaging: ScanPackaging;
  count: number;
  packSizeText?: string;
  /** Per pack, as read from the label. */
  packSize?: { value: number; unit: string };
  useBy?: string;
  bestBefore?: string;
  /** A date was actually read from a label. */
  datesLegible: boolean;
  /** A date label is visible but could not be read: offer a close-up. */
  needsCloseUp: boolean;
  confidence: number;
  /** 1-based photos / frames the item was seen in. */
  frameRefs: number[];
  notes?: string;
  match: ScanMatch;
}

export interface ScanProviderInfo {
  label: string;
  isMock: boolean;
  configured: boolean;
}

export interface ScanApiOk {
  rows: ScanRowDto[];
  warnings: string[];
  provider?: ScanProviderInfo;
}

export interface ScanApiError {
  error: { code: string; message: string; retryable: boolean };
}

/** One reviewed row sent to preview / confirm. Nothing is written until confirm. */
export interface ScanCommitRow {
  key: string;
  /** Canonical ingredient id, or absent for free text. */
  ingredientId?: string;
  /** Free-text name (used when there is no ingredient id). */
  name?: string;
  value: number;
  unit: string;
  /** use by, else best before, else (opt-in) an estimate: the single pantry expiry date. */
  expiry?: string;
  /** The barcode this row was scanned from (X2): on confirm the product is linked to `ingredientId`. */
  barcode?: string;
}

export interface ScanPreviewLine {
  key: string;
  name: string;
  /** merge = folded into an existing line (engine addStock); new = a new pantry line. */
  kind: 'merge' | 'new';
  /** Quantity of the existing line before, for merges. */
  before?: string;
  /** Quantity after (merge) or the new line's quantity. */
  after: string;
  note?: string;
}
