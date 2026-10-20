// Client-side review state for a scanned handwritten list (DECISIONS D260-D265). Pure: no React, no server imports.
import type { Unit } from './engine';
import { ALL_UNITS } from './engine';
import { aisleForCategory } from './aisles';
import type { IngredientRef, ListCommitRow, ListScanRowDto, ScanMatch } from './list-scan-types';

const UNIT_SET = new Set<string>(ALL_UNITS);

export interface ListRow {
  key: string;
  /** What was written, as transcribed. Shown next to the parsed item so a misread is easy to spot. */
  originalText: string;
  /** The item name as the model read it. */
  scannedName: string;
  crossedOut: boolean;
  illegible: boolean;
  confidence: number;
  imageRef: number;
  match: ScanMatch;
  /** The catalogue ingredient this row is linked to (null = free text). */
  ingredient: IngredientRef | null;
  /** Free-text name, used when there is no ingredient. */
  freeName: string;
  /** Written quantity as typed into the field ('' = none). */
  value: string;
  unit: Unit;
  notes: string;
  aisle: string;
  include: boolean;
  /** When the written amount is not an exact number ("2-3", "a bag"): shown as a hint, never silently converted. */
  writtenHint?: string;
}

const trimNum = (n: number): string => String(Math.round(n * 1000) / 1000);
const unitOf = (u: string | undefined): Unit => (u && UNIT_SET.has(u) ? (u as Unit) : 'item');

/** Reviewable row from the scan result. Crossed-out and illegible lines start EXCLUDED (the owner can switch them on). */
export function rowFromDto(dto: ListScanRowDto): ListRow {
  const q = dto.quantity;
  let value = '';
  let unit: Unit = 'item';
  let writtenHint: string | undefined;
  if (q?.kind === 'exact' && typeof q.value === 'number') {
    value = trimNum(q.value);
    unit = unitOf(q.unit);
  } else if (q?.kind === 'range' && typeof q.max === 'number') {
    // The engine plans for the top of a range; say so instead of hiding it.
    value = trimNum(q.max);
    unit = unitOf(q.unit);
    writtenHint = `Written as ${typeof q.min === 'number' ? `${trimNum(q.min)}-` : ''}${trimNum(q.max)}${q.unit && q.unit !== 'item' ? ` ${q.unit}` : ''}: using the larger number.`;
  } else if (q?.kind === 'approximate') {
    writtenHint = `Written as "${q.approxLabel ?? dto.originalText}": add an amount if you want one.`;
  }
  const ingredient = dto.match.status === 'matched' ? dto.match.ingredient : null;
  return {
    key: dto.key,
    originalText: dto.originalText,
    scannedName: dto.name,
    crossedOut: dto.crossedOut,
    illegible: dto.illegible,
    confidence: dto.confidence,
    imageRef: dto.imageRef,
    match: dto.match,
    ingredient,
    freeName: dto.name,
    value,
    unit,
    notes: dto.notes ?? '',
    aisle: dto.aisle,
    include: !dto.crossedOut && !dto.illegible && dto.name.trim().length > 0,
    ...(writtenHint ? { writtenHint } : {}),
  };
}

/** Choose (or clear) the linked ingredient; the aisle follows the ingredient's category. */
export function withIngredient(row: ListRow, ingredient: IngredientRef | null): ListRow {
  return { ...row, ingredient, ...(ingredient ? { aisle: aisleForCategory(ingredient.category) } : {}) };
}

/** The name that will be saved: the canonical name when linked, else what the owner typed. */
export const rowName = (row: ListRow): string => (row.ingredient ? row.ingredient.name : row.freeName.trim());

export type ConfidenceTone = 'success' | 'warning' | 'danger';
export function confidenceTone(c: number): { tone: ConfidenceTone; label: string } {
  if (c >= 0.85) return { tone: 'success', label: 'Clear' };
  if (c >= 0.6) return { tone: 'warning', label: 'Check this one' };
  return { tone: 'danger', label: 'Unsure' };
}

export interface CommitBuild {
  rows: ListCommitRow[];
  /** key -> message, for included rows that cannot be added as they stand. */
  errors: Record<string, string>;
}

/** Included rows -> what is sent to preview / confirm, with a per-row message for anything that cannot be added. */
export function toCommitRows(rows: ListRow[]): CommitBuild {
  const out: ListCommitRow[] = [];
  const errors: Record<string, string> = {};
  for (const r of rows) {
    if (!r.include) continue;
    const name = rowName(r);
    if (!name) { errors[r.key] = 'Give this item a name, or leave it out.'; continue; }
    const row: ListCommitRow = { key: r.key, name, aisle: r.aisle };
    if (r.ingredient) row.ingredientId = r.ingredient.id;
    if (r.value.trim()) {
      const n = Number(r.value);
      if (!Number.isFinite(n) || n <= 0) { errors[r.key] = 'The quantity must be a number greater than zero, or blank.'; continue; }
      row.value = n;
      row.unit = r.unit;
    }
    const notes = r.notes.trim();
    if (notes) row.notes = notes;
    out.push(row);
  }
  return { rows: out, errors };
}
