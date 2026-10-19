/**
 * snake_case DB rows <-> camelCase domain rows.
 * Flattened quantity columns fold into `quantity: Quantity` (NULL -> absent) and unfold back.
 */
import type { z } from 'zod';
import type { Quantity } from './primitives';

const QUANTITY_COLUMNS = ['quantity_kind', 'quantity_value', 'quantity_min', 'quantity_max', 'unit', 'approx_label', 'original_text'] as const;

export const snakeToCamel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
export const camelToSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export type DbRow = Record<string, unknown>;

/** Build a Quantity from flattened columns (null -> undefined). */
export function quantityFromColumns(row: DbRow): Quantity {
  const q: Record<string, unknown> = { kind: row.quantity_kind, originalText: row.original_text ?? '' };
  const num = (v: unknown) => (v === null || v === undefined ? undefined : Number(v)); // numeric may arrive as string
  if (num(row.quantity_value) !== undefined) q.value = num(row.quantity_value);
  if (num(row.quantity_min) !== undefined) q.min = num(row.quantity_min);
  if (num(row.quantity_max) !== undefined) q.max = num(row.quantity_max);
  if (row.unit !== null && row.unit !== undefined) q.unit = row.unit;
  if (row.approx_label !== null && row.approx_label !== undefined) q.approxLabel = row.approx_label;
  return q as Quantity;
}

export function quantityToColumns(q: Quantity): DbRow {
  return {
    quantity_kind: q.kind,
    quantity_value: q.value ?? null,
    quantity_min: q.min ?? null,
    quantity_max: q.max ?? null,
    unit: q.unit ?? null,
    approx_label: q.approxLabel ?? null,
    original_text: q.originalText,
  };
}

/**
 * Convert a raw DB row to camelCase, folding quantity columns when present, then validate with `schema`.
 * Not for the progress view (its `unit`/`quantity_kind` are plain columns): pass `{ foldQuantity: false }`.
 */
export function fromDbRow<S extends z.ZodType>(schema: S, row: DbRow, opts: { foldQuantity?: boolean } = {}): z.infer<S> {
  const fold = (opts.foldQuantity ?? true) && 'quantity_kind' in row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (fold && (QUANTITY_COLUMNS as readonly string[]).includes(k)) continue;
    out[snakeToCamel(k)] = v;
  }
  if (fold) out.quantity = quantityFromColumns(row);
  return schema.parse(out);
}

/** Inverse of fromDbRow for inserts/updates (undefined keys are dropped). */
export function toDbRow(obj: Record<string, unknown>): DbRow {
  const out: DbRow = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (k === 'quantity' && v && typeof v === 'object') Object.assign(out, quantityToColumns(v as Quantity));
    else out[camelToSnake(k)] = v;
  }
  return out;
}
