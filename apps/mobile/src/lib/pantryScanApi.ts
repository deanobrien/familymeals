/**
 * Pantry scan on the phone (D343 photos, D344 continuous barcodes) against the web server:
 *   POST /api/pantry/scan          multipart images[] (+ focus for a close-up) -> reviewable rows (writes nothing)
 *   POST /api/pantry/scan/preview  { rows } -> merge-vs-new lines (writes nothing)
 *   POST /api/pantry/scan/confirm  { rows, submissionId } -> the ONLY write
 * The review logic (rows, close-up merge, estimates, commit payload) is the web's own, from @fr/engine/pantry. Every
 * response is parsed defensively: a malformed row is dropped, never shown half-filled.
 */
import type {
  IngredientRef, ScanCommitRow, ScanForm, ScanLookupLike, ScanMatch, ScanPackaging, ScanPreviewLine, ScanProductLike, ScanRow, ScanRowDto,
} from '@fr/engine/pantry';
import { buildImagesForm, type UploadImage } from './extraction';
import { ServerApiError, type ServerApi } from './serverApi';

/** Mirrors apps/web/app/api/pantry/scan/route.ts MAX_FILES. Change together. */
export const MAX_SCAN_PHOTOS = 10;

/** A product record as the phone's review keeps it: what the engine reads plus what the row card shows. */
export interface ReviewProduct extends ScanProductLike {
  /** "Contains: Milk, Soya" / "Allergens not listed": never "allergen free". */
  allergenText: string;
  sourceUrl: string;
}

export type PhoneScanRow = ScanRow<ReviewProduct>;

export interface ScanProvider {
  label: string;
  isMock: boolean;
  configured: boolean;
}

export interface ScanResult {
  rows: ScanRowDto[];
  warnings: string[];
  provider?: ScanProvider;
}

export interface ConfirmResult {
  message: string;
  linked: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

const FORMS: readonly ScanForm[] = ['fresh', 'chilled', 'frozen', 'canned', 'dried', 'ambient', 'other'];
const PACKAGING: readonly ScanPackaging[] = ['loose', 'pack', 'tin', 'jar', 'bag', 'bottle'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD and a real calendar day (2026-02-30 is not). */
export function isIsoDate(d: string): boolean {
  if (!ISO_DATE.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

function ingredientRef(v: unknown): IngredientRef | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.name !== 'string') return null;
  return { id: v.id, name: v.name, category: str(v.category) ?? 'other' };
}
const refs = (v: unknown): IngredientRef[] => (Array.isArray(v) ? v.map(ingredientRef).filter((x): x is IngredientRef => !!x) : []);

export function parseMatch(v: unknown): ScanMatch {
  if (isObj(v)) {
    if (v.status === 'matched') {
      const ing = ingredientRef(v.ingredient);
      if (ing) return { status: 'matched', ingredient: ing };
    }
    if (v.status === 'ambiguous') {
      const candidates = refs(v.candidates);
      if (candidates.length) return { status: 'ambiguous', candidates };
    }
    if (v.status === 'unmatched') return { status: 'unmatched', suggestions: refs(v.suggestions) };
  }
  return { status: 'unmatched', suggestions: [] };
}

/** One scan row from the server, or null when it lacks what the review needs. */
export function parseScanRow(v: unknown): ScanRowDto | null {
  if (!isObj(v) || typeof v.key !== 'string' || typeof v.name !== 'string' || !v.name.trim()) return null;
  const form = FORMS.includes(v.form as ScanForm) ? (v.form as ScanForm) : 'other';
  const packaging = PACKAGING.includes(v.packaging as ScanPackaging) ? (v.packaging as ScanPackaging) : 'pack';
  const count = num(v.count);
  const confidence = num(v.confidence);
  const ps = isObj(v.packSize) && num(v.packSize.value) !== undefined && typeof v.packSize.unit === 'string'
    ? { value: v.packSize.value as number, unit: v.packSize.unit }
    : undefined;
  const useBy = str(v.useBy);
  const bestBefore = str(v.bestBefore);
  return {
    key: v.key, name: v.name.trim(), form, packaging,
    count: count !== undefined && count > 0 ? count : 1,
    ...(str(v.packSizeText) ? { packSizeText: v.packSizeText as string } : {}),
    ...(ps ? { packSize: ps } : {}),
    ...(useBy && isIsoDate(useBy) ? { useBy } : {}),
    ...(bestBefore && isIsoDate(bestBefore) ? { bestBefore } : {}),
    datesLegible: v.datesLegible === true,
    needsCloseUp: v.needsCloseUp === true,
    confidence: confidence !== undefined ? Math.min(1, Math.max(0, confidence)) : 0,
    frameRefs: Array.isArray(v.frameRefs) ? v.frameRefs.filter((n): n is number => typeof n === 'number') : [],
    ...(str(v.notes) ? { notes: v.notes as string } : {}),
    match: parseMatch(v.match),
  };
}

export function parseScanResult(body: unknown): ScanResult {
  if (!isObj(body) || !Array.isArray(body.rows)) throw new ServerApiError('The server returned an unexpected response.', 200, false, 'BAD_RESPONSE');
  const p = isObj(body.provider) && typeof body.provider.label === 'string' ? body.provider : undefined;
  return {
    rows: body.rows.map(parseScanRow).filter((r): r is ScanRowDto => !!r),
    warnings: Array.isArray(body.warnings) ? body.warnings.filter((w): w is string => typeof w === 'string') : [],
    ...(p ? { provider: { label: p.label as string, isMock: p.isMock === true, configured: p.configured !== false } } : {}),
  };
}

export function parsePreview(body: unknown): ScanPreviewLine[] {
  if (!isObj(body) || !Array.isArray(body.lines)) throw new ServerApiError('The server returned an unexpected response.', 200, false, 'BAD_RESPONSE');
  return body.lines.flatMap((l): ScanPreviewLine[] => {
    if (!isObj(l) || typeof l.key !== 'string' || typeof l.after !== 'string' || (l.kind !== 'merge' && l.kind !== 'new')) return [];
    return [{
      key: l.key, name: str(l.name) ?? '', kind: l.kind, after: l.after,
      ...(str(l.before) !== undefined ? { before: l.before as string } : {}),
      ...(str(l.note) ? { note: l.note as string } : {}),
    }];
  });
}

export function parseConfirm(body: unknown): ConfirmResult {
  if (!isObj(body) || body.ok !== true) throw new ServerApiError('The server returned an unexpected response.', 200, false, 'BAD_RESPONSE');
  return { message: str(body.message) ?? 'Added to your pantry', linked: num(body.linked) ?? 0 };
}

const ALLERGEN: Record<string, string> = {
  celery: 'Celery', cereals_gluten: 'Cereals containing gluten', crustaceans: 'Crustaceans', eggs: 'Eggs', fish: 'Fish',
  lupin: 'Lupin', milk: 'Milk', molluscs: 'Molluscs', mustard: 'Mustard', peanuts: 'Peanuts', sesame: 'Sesame',
  soya: 'Soya', sulphites: 'Sulphites', tree_nuts: 'Tree nuts',
};

/**
 * A product lookup body (GET /api/products/<code>, or a batch `done` entry) as review input, or null when malformed.
 * Only what the review reads is kept; the ingredient match is the server's conservative one.
 */
export function parseScanLookup(body: unknown): ScanLookupLike<ReviewProduct> | null {
  const p = isObj(body) && isObj(body.product) ? body.product : undefined;
  if (!p || typeof p.barcode !== 'string' || typeof p.name !== 'string') return null;
  const a = isObj(p.allergens) ? p.allergens : {};
  const contains = Array.isArray(a.contains) ? a.contains.filter((x): x is string => typeof x === 'string').map((g) => ALLERGEN[g] ?? g) : [];
  const allergenText = a.status === 'listed' ? (contains.length ? `Contains: ${contains.join(', ')}` : 'No allergens listed on the record') : 'Allergens not listed';
  const per = isObj(p.nutrition) && p.nutrition.per === 'ml' ? 'ml' : 'g';
  const ps = isObj(p.packSize) && typeof p.packSize.unit === 'string'
    ? { unit: p.packSize.unit, ...(num(p.packSize.value) !== undefined ? { value: p.packSize.value as number } : {}) }
    : undefined;
  const product: ReviewProduct = {
    barcode: p.barcode,
    name: p.name,
    ...(str(p.brand) ? { brand: p.brand as string } : {}),
    ...(str(p.packSizeText) ? { packSizeText: p.packSizeText as string } : {}),
    ...(ps ? { packSize: ps } : {}),
    categories: Array.isArray(p.categories) ? p.categories.filter((c): c is string => typeof c === 'string') : [],
    nutrition: { per },
    allergenText,
    sourceUrl: isObj(p.source) && typeof p.source.url === 'string' ? p.source.url : `https://world.openfoodfacts.org/product/${p.barcode}`,
  };
  return { product, match: parseMatch(isObj(body) ? body.match : undefined) };
}

/** A fresh id per review, sent with confirm so a double tap or a retried request is written once (D343). */
export const newSubmissionId = (): string => `ps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export interface PantryScanClient {
  scan(householdId: string, images: UploadImage[], focus?: string): Promise<ScanResult>;
  preview(householdId: string, rows: ScanCommitRow[]): Promise<ScanPreviewLine[]>;
  confirm(householdId: string, rows: ScanCommitRow[], submissionId: string): Promise<ConfirmResult>;
}

export function createPantryScanClient(api: ServerApi): PantryScanClient {
  return {
    async scan(householdId, images, focus) {
      if (images.length === 0) throw new ServerApiError('Add at least one photo.', 0, false, 'NO_IMAGES');
      if (images.length > MAX_SCAN_PHOTOS) throw new ServerApiError(`You can scan up to ${MAX_SCAN_PHOTOS} photos at a time.`, 0, false, 'TOO_MANY_IMAGES');
      const form = buildImagesForm(householdId, images, focus ? { focus } : {});
      return parseScanResult(await api.postForm<unknown>('/api/pantry/scan', form));
    },
    async preview(householdId, rows) {
      return parsePreview(await api.post<unknown>('/api/pantry/scan/preview', { householdId, rows }));
    },
    async confirm(householdId, rows, submissionId) {
      return parseConfirm(await api.post<unknown>('/api/pantry/scan/confirm', { householdId, rows, submissionId }));
    },
  };
}
