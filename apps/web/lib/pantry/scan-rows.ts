// Review-row state and its pure transitions for /pantry/scan (DECISIONS D84-D88). Client-safe, no I/O.
import { estimateShelfLife } from './shelf-life';
import type { IngredientRef, ScanCommitRow, ScanForm, ScanPackaging, ScanRowDto } from './scan-types';

export type DateSource = 'none' | 'scan' | 'closeup' | 'user' | 'estimate';
export type CloseUpState = 'idle' | 'busy' | 'unread' | 'done';

export interface ScanRow {
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
  match: ScanRowDto['match'];
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

export function rowFromDto(dto: ScanRowDto): ScanRow {
  const q = defaultQuantity(dto);
  const row: ScanRow = {
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

export const rowName = (r: ScanRow): string => (r.ingredient?.name ?? r.freeName).trim();

/** Changing the count re-derives the quantity unless the owner already typed their own. */
export function withCount(row: ScanRow, count: string): ScanRow {
  const next = { ...row, count };
  const n = Number(count);
  if (!row.valueEdited && count.trim() !== '' && Number.isFinite(n) && n > 0) {
    const q = defaultQuantity({ count: n, packaging: row.packaging, ...(row.packSize ? { packSize: row.packSize } : {}) });
    next.value = fmtNum(q.value);
    next.unit = q.unit;
  }
  return next;
}

export function withQuantity(row: ScanRow, patch: { value?: string; unit?: string }): ScanRow {
  return { ...row, ...patch, valueEdited: true };
}

export function withDate(row: ScanRow, field: 'useBy' | 'bestBefore', value: string): ScanRow {
  return field === 'useBy'
    ? { ...row, useBy: value, useBySource: value ? 'user' : 'none' }
    : { ...row, bestBefore: value, bestBeforeSource: value ? 'user' : 'none' };
}

/**
 * Fold a single-photo close-up of one item into its row (D88): only dates (and a pack size when the row had none)
 * are taken. Dates already typed by the owner are never overwritten. When nothing legible came back the row stays
 * flagged and the owner is told to type the date.
 */
export function mergeCloseUp(row: ScanRow, result: ScanRowDto | undefined): ScanRow {
  const found = !!result && (!!result.useBy || !!result.bestBefore);
  if (!result || !found) {
    return { ...row, closeUp: 'unread', closeUpMessage: 'Still could not read a date from that photo. Try again closer, or type the date.' };
  }
  const next: ScanRow = { ...row, closeUp: 'done', closeUpMessage: 'Date read from the close-up. Check it before you confirm.', needsCloseUp: false };
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
export function applyEstimates(rows: readonly ScanRow[], enabled: boolean, today: string): ScanRow[] {
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
export function toCommitRows(rows: readonly ScanRow[]): CommitResult {
  const out: ScanCommitRow[] = [];
  const errors: Record<string, string> = {};
  for (const r of rows) {
    if (!r.include) continue;
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
    });
  }
  return { rows: out, errors };
}
