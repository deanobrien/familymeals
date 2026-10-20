/**
 * Client + defensive parsers for the receipts JSON API (apps/web `/api/receipts`, D345). The server owns the parse, the
 * matching and the reconciliation; the app renders the review model and sends back ONLY the lines the user explicitly
 * confirmed. Types are app-side copies of the contract (never imported from the web app or @fr/ai).
 */
import { ServerApiError, type ServerApi } from './serverApi';
import type { UploadImage } from './extraction';
import { buildImagesForm } from './extraction';

export type ReceiptStatus = 'needs_review' | 'reconciled';
export type MatchClass = 'confident' | 'uncertain' | 'none';

export interface ReceiptListEntry {
  id: string;
  retailer?: string;
  date?: string;
  totalPence?: number;
  status: ReceiptStatus;
  lineCount: number;
}

export interface ReviewCandidate { itemId: string; name: string; score: number; reasons: string[] }

export interface ReviewLine {
  lineId: string;
  raw: string;
  description: string;
  count: number;
  packLabel?: string;
  pricePence?: number;
  discountPence: number;
  discountLines: string[];
  netPence?: number;
  classification: MatchClass;
  /** Only for confident matches: pre-selected in the UI, never auto-confirmed. */
  preselectedItemId?: string;
  candidates: ReviewCandidate[];
  defaultQuantity: { value: number; unit: string };
}

export interface ReviewModel {
  receiptId: string;
  retailer?: string;
  date?: string;
  totalPence?: number;
  computedPence: number;
  discrepancyPence?: number;
  totalOk: boolean;
  linesMissingPrice: number;
  status: ReceiptStatus;
  lines: ReviewLine[];
  items: Array<{ shoppingListItemId: string; name: string }>;
  ignored: string[];
  warnings: string[];
}

/** What the user decided for one line (exactly the web's LineDecision). */
export interface LineDecision {
  lineId: string;
  outcome: 'purchase' | 'extra';
  shoppingListItemId?: string;
  quantityValue?: number;
  addToPantry?: boolean;
}

export interface StoredDecision extends LineDecision { itemName?: string }

export interface ReceiptDetail {
  review: ReviewModel;
  decisions: StoredDecision[];
  purchaseCount: number;
  hasPhoto: boolean;
  photoPath?: string;
}

export interface ConfirmSummary { purchases: number; extras: number; pantryAdds: number; leftOutstanding: number }

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const status = (v: unknown): ReceiptStatus => (v === 'reconciled' ? 'reconciled' : 'needs_review');
const bad = (): never => {
  throw new ServerApiError('The server returned an unexpected response.', 200, false, 'BAD_RESPONSE');
};

/** Money is integer pence. */
export function formatPence(pence: number): string {
  const abs = Math.abs(Math.round(pence));
  return `${pence < 0 ? '-' : ''}£${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function parseReceiptList(json: unknown): ReceiptListEntry[] {
  const raw = isObj(json) && Array.isArray(json.receipts) ? json.receipts : [];
  const out: ReceiptListEntry[] = [];
  for (const r of raw) {
    if (!isObj(r)) continue;
    const id = str(r.id);
    if (!id) continue;
    out.push({
      id,
      ...(str(r.retailer) ? { retailer: str(r.retailer)! } : {}),
      ...(str(r.date) ? { date: str(r.date)! } : {}),
      ...(num(r.totalPence) !== undefined ? { totalPence: num(r.totalPence)! } : {}),
      status: status(r.status),
      lineCount: num(r.lineCount) ?? 0,
    });
  }
  return out;
}

function parseLine(l: unknown): ReviewLine | null {
  if (!isObj(l)) return null;
  const lineId = str(l.lineId);
  if (!lineId) return null;
  const classification: MatchClass = l.classification === 'confident' || l.classification === 'uncertain' ? l.classification : 'none';
  const candidates: ReviewCandidate[] = [];
  for (const c of Array.isArray(l.candidates) ? l.candidates : []) {
    if (isObj(c) && str(c.itemId) && str(c.name)) candidates.push({ itemId: str(c.itemId)!, name: str(c.name)!, score: num(c.score) ?? 0, reasons: strs(c.reasons) });
  }
  const dq = isObj(l.defaultQuantity) ? l.defaultQuantity : {};
  const count = num(l.count) ?? 1;
  return {
    lineId,
    raw: str(l.raw) ?? str(l.description) ?? '(unreadable line)',
    description: str(l.description) ?? str(l.raw) ?? '',
    count,
    ...(str(l.packLabel) ? { packLabel: str(l.packLabel)! } : {}),
    ...(num(l.pricePence) !== undefined ? { pricePence: num(l.pricePence)! } : {}),
    discountPence: num(l.discountPence) ?? 0,
    discountLines: strs(l.discountLines),
    ...(num(l.netPence) !== undefined ? { netPence: num(l.netPence)! } : {}),
    classification,
    // A pre-selection is only honoured for a confident match.
    ...(classification === 'confident' && str(l.preselectedItemId) ? { preselectedItemId: str(l.preselectedItemId)! } : {}),
    candidates,
    defaultQuantity: { value: num(dq.value) !== undefined && num(dq.value)! > 0 ? num(dq.value)! : count, unit: str(dq.unit) ?? 'item' },
  };
}

export function parseReview(json: unknown): ReviewModel {
  if (!isObj(json)) return bad();
  const receiptId = str(json.receiptId);
  if (!receiptId) return bad();
  const items: ReviewModel['items'] = [];
  for (const i of Array.isArray(json.items) ? json.items : []) {
    if (isObj(i) && str(i.shoppingListItemId) && str(i.name)) items.push({ shoppingListItemId: str(i.shoppingListItemId)!, name: str(i.name)! });
  }
  const computed = num(json.computedPence) ?? 0;
  const discrepancy = num(json.discrepancyPence);
  return {
    receiptId,
    ...(str(json.retailer) ? { retailer: str(json.retailer)! } : {}),
    ...(str(json.date) ? { date: str(json.date)! } : {}),
    ...(num(json.totalPence) !== undefined ? { totalPence: num(json.totalPence)! } : {}),
    computedPence: computed,
    ...(discrepancy !== undefined ? { discrepancyPence: discrepancy } : {}),
    totalOk: json.totalOk === true,
    linesMissingPrice: num(json.linesMissingPrice) ?? 0,
    status: status(json.status),
    lines: (Array.isArray(json.lines) ? json.lines : []).map(parseLine).filter((l): l is ReviewLine => l !== null),
    items,
    ignored: strs(json.ignored),
    warnings: strs(json.warnings),
  };
}

export function parseReceiptDetail(json: unknown): ReceiptDetail {
  if (!isObj(json)) return bad();
  const review = parseReview(json.review);
  const rec = isObj(json.reconciliation) ? json.reconciliation : undefined;
  const decisions: StoredDecision[] = [];
  for (const d of Array.isArray(rec?.decisions) ? (rec!.decisions as unknown[]) : []) {
    if (!isObj(d) || !str(d.lineId) || (d.outcome !== 'purchase' && d.outcome !== 'extra')) continue;
    decisions.push({
      lineId: str(d.lineId)!,
      outcome: d.outcome,
      ...(str(d.shoppingListItemId) ? { shoppingListItemId: str(d.shoppingListItemId)! } : {}),
      ...(str(d.itemName) ? { itemName: str(d.itemName)! } : {}),
      ...(d.addToPantry === true ? { addToPantry: true } : {}),
    });
  }
  const photoPath = str(json.photoPath);
  return {
    review,
    decisions,
    purchaseCount: Array.isArray(rec?.purchaseEventIds) ? (rec!.purchaseEventIds as unknown[]).length : 0,
    hasPhoto: json.hasPhoto === true && !!photoPath,
    ...(photoPath ? { photoPath } : {}),
  };
}

export function parseConfirmSummary(json: unknown): ConfirmSummary {
  if (!isObj(json)) return bad();
  return {
    purchases: num(json.purchases) ?? 0,
    extras: num(json.extras) ?? 0,
    pantryAdds: num(json.pantryAdds) ?? 0,
    leftOutstanding: num(json.leftOutstanding) ?? 0,
  };
}

export async function listReceipts(api: ServerApi, householdId: string): Promise<ReceiptListEntry[]> {
  return parseReceiptList(await api.get<unknown>('/api/receipts', { householdId }));
}

/** One photo, field `receipt` (the web route's name), plus `householdId`. Returns the new receipt id. */
export async function uploadReceipt(api: ServerApi, householdId: string, image: UploadImage): Promise<string> {
  const json = await api.postForm<unknown>('/api/receipts', buildImagesForm(householdId, [image], {}, 'receipt'));
  const id = isObj(json) ? str(json.receiptId) : undefined;
  if (!id) return bad();
  return id;
}

export async function getReceipt(api: ServerApi, householdId: string, id: string): Promise<ReceiptDetail> {
  return parseReceiptDetail(await api.get<unknown>(`/api/receipts/${encodeURIComponent(id)}`, { householdId }));
}

export async function confirmReceipt(api: ServerApi, householdId: string, id: string, decisions: LineDecision[]): Promise<ConfirmSummary> {
  return parseConfirmSummary(await api.post<unknown>(`/api/receipts/${encodeURIComponent(id)}/confirm`, { householdId, decisions }));
}

/** Source for React Native's Image: the photo URL on the server plus the Bearer header (null when not available). */
export async function photoSource(api: ServerApi, householdId: string, photoPath: string): Promise<{ uri: string; headers: Record<string, string> } | null> {
  const url = api.webUrl(`${photoPath}?householdId=${encodeURIComponent(householdId)}`);
  if (!url) return null;
  return { uri: url, headers: await api.authHeaders() };
}
