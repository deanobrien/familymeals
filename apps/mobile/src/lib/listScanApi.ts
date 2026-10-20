/**
 * Client + defensive parsers for the handwritten shopping-list scan (apps/web `/api/shopping/scan`, `/scan/preview`,
 * `/scan/confirm`, D260-D266, D346). The server owns the AI read, the merge logic and the idempotency; the app sends the
 * photos, then the reviewed rows. Types are app-side copies of the contract (never imported from the web app or @fr/ai).
 */
import { buildImagesForm, type UploadImage } from './extraction';
import type { ServerApi } from './serverApi';

/** Mirrors /api/shopping/scan MAX_FILES (4). */
export const MAX_LIST_PHOTOS = 4;

/** Units the server accepts (the web form's ALL_UNITS). */
export const LIST_UNITS = ['item', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'pint', 'can', 'pack', 'bunch', 'clove', 'slice', 'sprig', 'stick'] as const;

export interface ScanRow {
  key: string;
  originalText: string;
  /** The item name as the model read it. */
  name: string;
  /** Written amount as typed text ('' = none). */
  value: string;
  unit: string;
  notes: string;
  aisle: string;
  crossedOut: boolean;
  illegible: boolean;
  confidence: number;
  imageRef: number;
  /** Catalogue ingredient the server matched (kept only while the name is unchanged). */
  ingredientId?: string;
  ingredientName?: string;
  /** Shown when the written amount was a range or approximate; never silently converted. */
  hint?: string;
  /** Whether the row will be added. */
  include: boolean;
}

export interface ScanOutcome {
  rows: ScanRow[];
  title?: string;
  warnings: string[];
}

export interface CommitRow {
  key: string;
  ingredientId?: string;
  name: string;
  value?: number;
  unit?: string;
  notes?: string;
  aisle?: string;
}

export type Destination = { kind: 'current' } | { kind: 'new'; name: string };

export interface PreviewLine {
  key: string;
  name: string;
  kind: 'merge' | 'new' | 'exists' | 'skip';
  before?: string;
  after: string;
  aisle: string;
  note?: string;
}

export interface ScanPreview {
  destination: { kind: 'current' | 'new'; name: string };
  lines: PreviewLine[];
  added: number;
  merged: number;
  skipped: number;
}

export interface ConfirmOutcome {
  message: string;
  listName: string;
  created: boolean;
  added: number;
  merged: number;
  skipped: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const trimNum = (n: number): string => String(Math.round(n * 1000) / 1000);
const unitOf = (u: unknown): string => (typeof u === 'string' && (LIST_UNITS as readonly string[]).includes(u) ? u : 'item');

export class BadResponseError extends Error {
  constructor() {
    super('The server returned an unexpected response.');
    this.name = 'BadResponseError';
  }
}

/** One scanned line -> editable row. Crossed-out and illegible lines start excluded (as on the web). */
export function parseScanRow(raw: unknown, index: number): ScanRow | null {
  if (!isObj(raw)) return null;
  const name = str(raw.name).trim();
  const q = isObj(raw.quantity) ? raw.quantity : undefined;
  let value = '';
  let unit = 'item';
  let hint: string | undefined;
  if (q?.kind === 'exact' && typeof q.value === 'number') {
    value = trimNum(q.value);
    unit = unitOf(q.unit);
  } else if (q?.kind === 'range' && typeof q.max === 'number') {
    value = trimNum(q.max);
    unit = unitOf(q.unit);
    hint = `Written as ${typeof q.min === 'number' ? `${trimNum(q.min)}-` : ''}${trimNum(q.max)}: using the larger number.`;
  } else if (q?.kind === 'approximate') {
    hint = `Written as "${str(q.approxLabel, str(raw.originalText))}": add an amount if you want one.`;
  }
  const match = isObj(raw.match) ? raw.match : undefined;
  const ing = match?.status === 'matched' && isObj(match.ingredient) ? match.ingredient : undefined;
  const crossedOut = raw.crossedOut === true;
  const illegible = raw.illegible === true;
  return {
    key: str(raw.key, `row-${index + 1}`) || `row-${index + 1}`,
    originalText: str(raw.originalText),
    name,
    value,
    unit,
    notes: str(raw.notes),
    aisle: str(raw.aisle, 'Other'),
    crossedOut,
    illegible,
    confidence: num(raw.confidence, 1),
    imageRef: num(raw.imageRef, 1),
    ...(ing && typeof ing.id === 'string' ? { ingredientId: ing.id, ingredientName: str(ing.name, name) } : {}),
    ...(hint ? { hint } : {}),
    include: !crossedOut && !illegible && name.length > 0,
  };
}

export function parseScanOutcome(raw: unknown): ScanOutcome {
  if (!isObj(raw) || !Array.isArray(raw.rows)) throw new BadResponseError();
  const rows = raw.rows.map(parseScanRow).filter((r): r is ScanRow => r !== null);
  const seen = new Set<string>();
  for (const r of rows) {
    // Keys must be unique (the server refuses duplicates).
    let k = r.key;
    let n = 2;
    while (seen.has(k)) k = `${r.key}-${n++}`;
    r.key = k;
    seen.add(k);
  }
  return {
    rows,
    ...(typeof raw.title === 'string' && raw.title.trim() ? { title: raw.title.trim() } : {}),
    warnings: (Array.isArray(raw.warnings) ? raw.warnings : []).filter((w): w is string => typeof w === 'string'),
  };
}

export const rowDisplayName = (r: ScanRow): string => r.name.trim();

export interface CommitBuild {
  rows: CommitRow[];
  /** key -> message for included rows that cannot be added as they stand. */
  errors: Record<string, string>;
}

/** Included rows -> the payload for preview / confirm. The ingredient link is dropped once the name is edited. */
export function toCommitRows(rows: ScanRow[]): CommitBuild {
  const out: CommitRow[] = [];
  const errors: Record<string, string> = {};
  for (const r of rows) {
    if (!r.include) continue;
    const name = rowDisplayName(r);
    if (!name) {
      errors[r.key] = 'Give this item a name, or leave it out.';
      continue;
    }
    const row: CommitRow = { key: r.key, name, aisle: r.aisle };
    if (r.ingredientId && r.ingredientName && r.ingredientName.toLowerCase() === name.toLowerCase()) row.ingredientId = r.ingredientId;
    if (r.value.trim()) {
      const n = Number(r.value.trim().replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) {
        errors[r.key] = 'The quantity must be a number greater than zero, or blank.';
        continue;
      }
      row.value = n;
      row.unit = r.unit;
    }
    const notes = r.notes.trim();
    if (notes) row.notes = notes;
    out.push(row);
  }
  return { rows: out, errors };
}

/** A fresh idempotency id for one review session: reuse it for every preview / confirm retry of that session. */
export function newBatchId(): string {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `m${Date.now().toString(36)}${rand()}${rand()}`.slice(0, 40);
}

export const defaultListName = (now = new Date()): string =>
  `Shopping list - ${now.getDate()} ${now.toLocaleString('en-GB', { month: 'short' })}`;

export function parsePreview(raw: unknown): ScanPreview {
  const p = isObj(raw) && isObj(raw.preview) ? raw.preview : undefined;
  if (!p || !Array.isArray(p.lines)) throw new BadResponseError();
  const dest = isObj(p.destination) ? p.destination : {};
  const lines = p.lines.filter(isObj).map((l): PreviewLine => ({
    key: str(l.key),
    name: str(l.name),
    kind: l.kind === 'merge' || l.kind === 'exists' || l.kind === 'skip' ? l.kind : 'new',
    ...(typeof l.before === 'string' ? { before: l.before } : {}),
    after: str(l.after),
    aisle: str(l.aisle),
    ...(typeof l.note === 'string' ? { note: l.note } : {}),
  }));
  return {
    destination: { kind: dest.kind === 'new' ? 'new' : 'current', name: str(dest.name) },
    lines,
    added: num(p.added),
    merged: num(p.merged),
    skipped: num(p.skipped),
  };
}

export function parseConfirm(raw: unknown): ConfirmOutcome {
  if (!isObj(raw) || raw.ok !== true) throw new BadResponseError();
  return {
    message: str(raw.message, 'Added to your list.'),
    listName: str(raw.listName),
    created: raw.created === true,
    added: num(raw.added),
    merged: num(raw.merged),
    skipped: num(raw.skipped),
  };
}

export async function scanList(api: ServerApi, householdId: string, images: UploadImage[]): Promise<ScanOutcome> {
  return parseScanOutcome(await api.postForm<unknown>('/api/shopping/scan', buildImagesForm(householdId, images)));
}

export async function previewScan(api: ServerApi, householdId: string, rows: CommitRow[], destination: Destination, batchId: string): Promise<ScanPreview> {
  return parsePreview(await api.post<unknown>('/api/shopping/scan/preview', { householdId, rows, destination, batchId }));
}

export async function confirmScan(api: ServerApi, householdId: string, rows: CommitRow[], destination: Destination, batchId: string): Promise<ConfirmOutcome> {
  return parseConfirm(await api.post<unknown>('/api/shopping/scan/confirm', { householdId, rows, destination, batchId }));
}
