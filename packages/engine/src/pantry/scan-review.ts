/**
 * Pantry scan review (PRJ-018 D84-D88, BS1 D270-D276, Android parity D343-D344): the wire shapes of a photo / barcode
 * scan and the pure review-row state with its transitions. Shared by the web scan page (apps/web/lib/pantry/scan-rows.ts
 * re-exports it) and the Android app, so both review, estimate, merge a close-up and build the confirm payload the same
 * way. Pure and deterministic: no I/O, no clock (callers pass `today`).
 */
import { addDays } from './common';
import type { LookupState } from './rapid-scan';

// ---------------------------------------------------------------------------------------------------------------------
// Wire shapes (POST /api/pantry/scan, /preview, /confirm). Plain serialisable data only.
// ---------------------------------------------------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------------------------------------------------
// Typical shelf life (D87): opt-in, always labelled as an estimate.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Typical unopened / stored shelf life in days, by catalogue category. A deliberately small, conservative table: it is
 * only used when the owner turns on "Suggest typical shelf life when no date" and every value it produces is shown as
 * an ESTIMATE the owner can clear. It is never applied silently and never overrides a read date.
 */
const SHELF_BY_CATEGORY: Record<string, { days: number; basis: string }> = {
  fruit_veg: { days: 7, basis: 'fresh fruit and veg' },
  meat_poultry: { days: 2, basis: 'fresh meat (cook or freeze quickly)' },
  fish_seafood: { days: 2, basis: 'fresh fish (cook or freeze quickly)' },
  dairy_eggs: { days: 7, basis: 'chilled dairy and eggs' },
  dairy_alternatives: { days: 7, basis: 'chilled dairy alternatives' },
  meat_alternatives: { days: 7, basis: 'chilled meat alternatives' },
  bakery: { days: 4, basis: 'fresh bread and bakery' },
  frozen: { days: 90, basis: 'frozen food' },
  tinned_jarred: { days: 365, basis: 'tinned and jarred food' },
  pasta_rice_grains: { days: 365, basis: 'dry pasta, rice and grains' },
  baking: { days: 365, basis: 'baking ingredients' },
  herbs_spices: { days: 365, basis: 'dried herbs and spices' },
  oils_vinegars: { days: 365, basis: 'oils and vinegars' },
  sauces_condiments: { days: 180, basis: 'sauces and condiments' },
  sweeteners_spreads: { days: 365, basis: 'sweeteners and spreads' },
  nuts_seeds: { days: 180, basis: 'nuts and seeds' },
  cereals: { days: 180, basis: 'breakfast cereals' },
  snacks: { days: 120, basis: 'snacks' },
  drinks: { days: 180, basis: 'drinks' },
  world_foods: { days: 365, basis: 'store-cupboard world foods' },
};

const SHELF_BY_FORM: Partial<Record<ScanForm, { days: number; basis: string }>> = {
  frozen: { days: 90, basis: 'frozen food' },
  canned: { days: 365, basis: 'tinned food' },
  dried: { days: 365, basis: 'dried food' },
};

export interface ShelfLifeEstimate {
  days: number;
  /** ISO date: today + days. */
  date: string;
  /** Shown to the owner, e.g. "typical for fresh fruit and veg (about 7 days)". */
  label: string;
}

/** Typical shelf life for an ingredient category + form, or null when there is nothing sensible to suggest. */
export function estimateShelfLife(category: string | undefined, form: ScanForm, today: string): ShelfLifeEstimate | null {
  const hit = SHELF_BY_FORM[form] ?? (category ? SHELF_BY_CATEGORY[category] : undefined);
  if (!hit) return null;
  return { days: hit.days, date: addDays(today, hit.days), label: `typical for ${hit.basis} (about ${hit.days} days)` };
}

// ---------------------------------------------------------------------------------------------------------------------
// Review rows
// ---------------------------------------------------------------------------------------------------------------------

export type DateSource = 'none' | 'scan' | 'closeup' | 'user' | 'estimate';
export type CloseUpState = 'idle' | 'busy' | 'unread' | 'done';

/**
 * The parts of a product record the review reads. The web passes the full `@fr/product-sources` Product; the phone
 * passes its own parsed copy of the same JSON. Whatever was passed comes back on `row.product`.
 */
export interface ScanProductLike {
  barcode: string;
  name: string;
  brand?: string;
  packSizeText?: string;
  packSize?: { value?: number; unit?: string };
  categories: readonly string[];
  nutrition: { per: 'g' | 'ml' };
}

/** A product lookup answer (GET /api/products/<barcode> or a POST /api/products batch entry). */
export interface ScanLookupLike<P extends ScanProductLike = ScanProductLike> {
  product: P;
  match: ScanMatch;
}

export interface ScanRow<P extends ScanProductLike = ScanProductLike> {
  key: string;
  /** The model's name for the item (kept for display and as the free-text default). */
  scannedName: string;
  form: ScanForm;
  packaging: ScanPackaging;
  packSizeText?: string;
  packSize?: { value: number; unit: string };
  confidence: number;
  frameRefs: number[];
  notes?: string;
  match: ScanMatch;
  needsCloseUp: boolean;

  include: boolean;
  /** Chosen canonical ingredient (auto for a clean match). Null = free text. */
  ingredient: IngredientRef | null;
  freeName: string;
  /** Text inputs, so the owner can type freely. */
  count: string;
  value: string;
  unit: string;
  /** Once the owner edits quantity / unit by hand, changing the count no longer rewrites them. */
  valueEdited: boolean;
  useBy: string;
  bestBefore: string;
  useBySource: DateSource;
  bestBeforeSource: DateSource;
  closeUp: CloseUpState;
  closeUpMessage?: string;
  /** Set when the row came from a barcode (X2): the product to show provenance for and link on confirm. */
  barcode?: string;
  product?: P;
  /** Rapid scan (BS1): the code this row was scanned from (kept even while its product is unknown)... */
  scanBarcode?: string;
  /** ...and where its lookup stands. pending = still looking (blocks confirm); notfound / failed = type a name; manual = the owner named it. */
  lookup?: 'pending' | 'notfound' | 'failed' | 'manual';
  lookupMessage?: string;
  /** Came from a continuous scan: dates are optional and collapsed in the review. */
  rapid?: boolean;
}

const LOW_CONFIDENCE = 0.5;
const MASS_VOLUME = new Set(['g', 'kg', 'ml', 'l']);

export const fmtNum = (n: number): string => String(Math.round(n * 1e6) / 1e6);

/**
 * Total quantity to stock for a scanned item (D86):
 *  - tins -> count of `can` (the pantry and recipes count tins; the printed size is shown, not multiplied);
 *  - other packs with a legible mass / volume -> count x pack size in that unit;
 *  - otherwise loose -> `item`, anything packaged -> `pack`.
 */
export function defaultQuantity(i: { count: number; packaging: ScanPackaging; packSize?: { value: number; unit: string } }): { value: number; unit: string } {
  const count = Number.isFinite(i.count) && i.count > 0 ? i.count : 1;
  if (i.packaging === 'tin') return { value: count, unit: 'can' };
  if (i.packSize && MASS_VOLUME.has(i.packSize.unit)) return { value: Math.round(i.packSize.value * count * 1e6) / 1e6, unit: i.packSize.unit };
  return { value: count, unit: i.packaging === 'loose' ? 'item' : 'pack' };
}

export function rowFromDto<P extends ScanProductLike = ScanProductLike>(dto: ScanRowDto): ScanRow<P> {
  const q = defaultQuantity(dto);
  const row: ScanRow<P> = {
    key: dto.key, scannedName: dto.name, form: dto.form, packaging: dto.packaging, confidence: dto.confidence,
    frameRefs: dto.frameRefs, match: dto.match, needsCloseUp: dto.needsCloseUp,
    include: dto.confidence >= LOW_CONFIDENCE,
    ingredient: dto.match.status === 'matched' ? dto.match.ingredient : null,
    freeName: dto.name,
    count: fmtNum(dto.count), value: fmtNum(q.value), unit: q.unit, valueEdited: false,
    useBy: dto.useBy ?? '', bestBefore: dto.bestBefore ?? '',
    useBySource: dto.useBy ? 'scan' : 'none', bestBeforeSource: dto.bestBefore ? 'scan' : 'none',
    closeUp: 'idle',
  };
  if (dto.packSizeText) row.packSizeText = dto.packSizeText;
  if (dto.packSize) row.packSize = dto.packSize;
  if (dto.notes) row.notes = dto.notes;
  return row;
}

/**
 * A barcode lookup as a review row (X2). Name, pack size, matched ingredient and allergens come from the product record;
 * dates are NOT on the product, so they start empty and come from a close-up photo, the owner, or the opt-in estimate.
 * Only a clean ingredient match is pre-selected; an ambiguous or missing one is left for the owner to choose.
 */
export function rowFromProduct<P extends ScanProductLike>(lookup: ScanLookupLike<P>, key: string): ScanRow<P> {
  const p = lookup.product;
  const canned = p.categories.some((c) => /canned|tinned/.test(c));
  const packaging: ScanPackaging = canned ? 'tin' : p.nutrition.per === 'ml' ? 'bottle' : 'pack';
  const packSize = p.packSize && (p.packSize.unit === 'g' || p.packSize.unit === 'ml') && p.packSize.value !== undefined
    ? { value: p.packSize.value, unit: p.packSize.unit }
    : undefined;
  // A multipack ("6 x 125 g") is ONE pack of the whole size; the owner can edit the count.
  const q = defaultQuantity({ count: 1, packaging, ...(packSize ? { packSize } : {}) });
  const row: ScanRow<P> = {
    key, scannedName: p.brand && !p.name.toLowerCase().startsWith(p.brand.toLowerCase()) ? `${p.brand} ${p.name}` : p.name,
    form: canned ? 'canned' : 'ambient', packaging, confidence: 1, frameRefs: [], match: lookup.match, needsCloseUp: false,
    include: true,
    ingredient: lookup.match.status === 'matched' ? lookup.match.ingredient : null,
    freeName: p.name, count: '1', value: fmtNum(q.value), unit: q.unit, valueEdited: false,
    useBy: '', bestBefore: '', useBySource: 'none', bestBeforeSource: 'none', closeUp: 'idle',
    barcode: p.barcode, product: p,
  };
  if (p.packSizeText) row.packSizeText = p.packSizeText;
  if (packSize) row.packSize = packSize;
  return row;
}

/** Row key for a continuous-scan row: stable per barcode so a lookup that resolves later finds its row. */
export const rapidKey = (barcode: string): string => `rp-${barcode}`;

/**
 * A row for a barcode from a continuous scan (BS1), in whatever state its lookup is in. A known product becomes the
 * normal product row (name, pack size, matched ingredient, allergens); an unresolved code is a placeholder the owner can
 * still count and date, and name by hand ("Name it myself") without waiting for the lookup.
 */
export function rowFromRapid<P extends ScanProductLike>(barcode: string, count: number, state: LookupState<ScanLookupLike<P>> | undefined): ScanRow<P> {
  const key = rapidKey(barcode);
  const n = fmtNum(Math.max(1, Math.round(count)));
  if (state?.state === 'done') {
    const row = withCount(rowFromProduct(state.value, key), n);
    return { ...row, rapid: true, scanBarcode: barcode };
  }
  const q = defaultQuantity({ count: Number(n), packaging: 'pack' });
  const base: ScanRow<P> = {
    key, scannedName: `Barcode ${barcode}`, form: 'ambient', packaging: 'pack', confidence: 1, frameRefs: [],
    match: { status: 'unmatched', suggestions: [] }, needsCloseUp: false, include: true, ingredient: null, freeName: '',
    count: n, value: fmtNum(q.value), unit: q.unit, valueEdited: false, useBy: '', bestBefore: '',
    useBySource: 'none', bestBeforeSource: 'none', closeUp: 'idle', rapid: true, scanBarcode: barcode,
    lookup: 'pending',
  };
  if (state?.state === 'notfound') return { ...base, lookup: 'notfound', lookupMessage: 'Not found in Open Food Facts. Type a name or pick an ingredient.' };
  if (state?.state === 'error') return { ...base, lookup: 'failed', lookupMessage: state.error.message };
  return base;
}

/**
 * A lookup finished for a row that was waiting on it. Count, include, dates and any close-up already done are kept; a row
 * the owner has named by hand ('manual') or whose product is already known is never touched.
 */
export function mergeLookup<P extends ScanProductLike>(row: ScanRow<P>, state: LookupState<ScanLookupLike<P>> | undefined): ScanRow<P> {
  if (!row.rapid || !row.scanBarcode || row.product || row.lookup === 'manual' || !state) return row;
  if (state.state === 'pending') return row.lookup === 'pending' ? row : { ...row, lookup: 'pending' };
  const fresh = rowFromRapid(row.scanBarcode, Number(row.count) || 1, state);
  if (state.state !== 'done') return { ...row, lookup: fresh.lookup!, ...(fresh.lookupMessage ? { lookupMessage: fresh.lookupMessage } : {}) };
  return {
    ...fresh, include: row.include,
    useBy: row.useBy, bestBefore: row.bestBefore, useBySource: row.useBySource, bestBeforeSource: row.bestBeforeSource,
    closeUp: row.closeUp, ...(row.closeUpMessage ? { closeUpMessage: row.closeUpMessage } : {}),
  };
}

/** "Name it myself": stop waiting for (or retrying) the lookup. */
export const nameItMyself = <P extends ScanProductLike>(row: ScanRow<P>): ScanRow<P> => ({ ...row, lookup: 'manual' });

export const rowName = (r: Pick<ScanRow, 'ingredient' | 'freeName'>): string => (r.ingredient?.name ?? r.freeName).trim();

/** Changing the count re-derives the quantity unless the owner already typed their own. */
export function withCount<P extends ScanProductLike>(row: ScanRow<P>, count: string): ScanRow<P> {
  const next = { ...row, count };
  const n = Number(count);
  if (!row.valueEdited && count.trim() !== '' && Number.isFinite(n) && n > 0) {
    const q = defaultQuantity({ count: n, packaging: row.packaging, ...(row.packSize ? { packSize: row.packSize } : {}) });
    next.value = fmtNum(q.value);
    next.unit = q.unit;
  }
  return next;
}

export function withQuantity<P extends ScanProductLike>(row: ScanRow<P>, patch: { value?: string; unit?: string }): ScanRow<P> {
  return { ...row, ...patch, valueEdited: true };
}

export function withDate<P extends ScanProductLike>(row: ScanRow<P>, field: 'useBy' | 'bestBefore', value: string): ScanRow<P> {
  return field === 'useBy'
    ? { ...row, useBy: value, useBySource: value ? 'user' : 'none' }
    : { ...row, bestBefore: value, bestBeforeSource: value ? 'user' : 'none' };
}

/**
 * Fold a single-photo close-up of one item into its row (D88): only dates (and a pack size when the row had none)
 * are taken. Dates already typed by the owner are never overwritten. When nothing legible came back the row stays
 * flagged and the owner is told to type the date.
 */
export function mergeCloseUp<P extends ScanProductLike>(row: ScanRow<P>, result: ScanRowDto | undefined): ScanRow<P> {
  const found = !!result && (!!result.useBy || !!result.bestBefore);
  if (!result || !found) {
    return { ...row, closeUp: 'unread', closeUpMessage: 'Still could not read a date from that photo. Try again closer, or type the date.' };
  }
  const next: ScanRow<P> = { ...row, closeUp: 'done', closeUpMessage: 'Date read from the close-up. Check it before you confirm.', needsCloseUp: false };
  if (result.useBy && row.useBySource !== 'user') { next.useBy = result.useBy; next.useBySource = 'closeup'; }
  if (result.bestBefore && row.bestBeforeSource !== 'user') { next.bestBefore = result.bestBefore; next.bestBeforeSource = 'closeup'; }
  // A leftover estimate must not sit beside a date that has now actually been read.
  if (next.bestBeforeSource === 'estimate') { next.bestBefore = ''; next.bestBeforeSource = 'none'; }
  if (!row.packSize && result.packSize && result.packSizeText) {
    next.packSize = result.packSize;
    next.packSizeText = result.packSizeText;
    if (!row.valueEdited) {
      const q = defaultQuantity({ count: Number(row.count) || 1, packaging: row.packaging, packSize: result.packSize });
      next.value = fmtNum(q.value);
      next.unit = q.unit;
    }
  }
  return next;
}

/**
 * Opt-in typical shelf life (D87). ON: rows with no date at all get a visibly labelled ESTIMATE in the best-before
 * field. OFF: estimates are removed again. A date from the label or typed by the owner is never touched.
 */
export function applyEstimates<P extends ScanProductLike>(rows: readonly ScanRow<P>[], enabled: boolean, today: string): ScanRow<P>[] {
  return rows.map((r) => {
    if (!enabled) {
      return r.bestBeforeSource === 'estimate' ? { ...r, bestBefore: '', bestBeforeSource: 'none' as const } : r;
    }
    if (r.useBy || r.bestBefore) return r;
    const category = r.ingredient?.category ?? (r.match.status === 'matched' ? r.match.ingredient.category : undefined);
    const est = estimateShelfLife(category, r.form, today);
    return est ? { ...r, bestBefore: est.date, bestBeforeSource: 'estimate' as const } : r;
  });
}

export function confidenceTone(c: number): { tone: 'success' | 'warning' | 'danger'; label: string } {
  if (c >= 0.85) return { tone: 'success', label: 'High confidence' };
  if (c >= 0.6) return { tone: 'warning', label: 'Check this one' };
  return { tone: 'danger', label: 'Low confidence' };
}

/** The single pantry expiry for a row: use by wins over best before (the safety date is the stricter one). */
export const rowExpiry = (r: Pick<ScanRow, 'useBy' | 'bestBefore'>): string | undefined => r.useBy || r.bestBefore || undefined;

export interface CommitResult {
  rows: ScanCommitRow[];
  /** Included rows that cannot be added yet, keyed by row key. */
  errors: Record<string, string>;
}

/** Included rows -> what preview / confirm send. Rows that are excluded are never sent. */
export function toCommitRows<P extends ScanProductLike>(rows: readonly ScanRow<P>[]): CommitResult {
  const out: ScanCommitRow[] = [];
  const errors: Record<string, string> = {};
  for (const r of rows) {
    if (!r.include) continue;
    if (r.lookup === 'pending') { errors[r.key] = 'Still looking this product up. Wait a moment, or name it yourself.'; continue; }
    const name = rowName(r);
    const value = Number(r.value);
    if (!name) { errors[r.key] = 'Choose an ingredient or type a name.'; continue; }
    if (!(r.value.trim() !== '' && Number.isFinite(value) && value > 0)) { errors[r.key] = 'Enter a quantity above zero.'; continue; }
    if (!r.unit) { errors[r.key] = 'Choose a unit.'; continue; }
    const expiry = rowExpiry(r);
    out.push({
      key: r.key, value, unit: r.unit,
      ...(r.ingredient ? { ingredientId: r.ingredient.id } : { name: name.slice(0, 80) }),
      ...(expiry ? { expiry } : {}),
      ...(r.barcode ? { barcode: r.barcode } : {}),
    });
  }
  return { rows: out, errors };
}
