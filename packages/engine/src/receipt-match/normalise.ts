import type { Pence, Quantity } from '../contract';
import { toBaseAmount } from '../units';

/** Everything here is pure and deterministic. Money is integer pence. */

/** Retailer / range words that carry no product meaning. */
const BRAND = new Set([
  'tsco', 'tesco', 'ts', 'asda', 'sainsburys', 'sains', 'sbry', 'js', 'morrisons', 'morr', 'waitrose',
  'wtrose', 'coop', 'aldi', 'lidl', 'finest', 'everyday', 'basics', 'essential', 'ttd', 'own',
]);
const STOP = new Set([
  'of', 'the', 'and', 'in', 'with', 'x', 'pk', 'pack', 'each', 'ea', 'per', 'kg', 'g', 'ml', 'l', 'pt', 'cl',
  'british', 'for', 'a',
]);

/** UK till-abbreviation expansion (token level). Keys are lowercase raw tokens. */
export const ABBREV: Readonly<Record<string, string>> = {
  skmd: 'skimmed', skim: 'skimmed', mlk: 'milk', whl: 'whole', wh: 'whole', bnnas: 'banana', bnna: 'banana',
  bnn: 'banana', org: 'organic', orgnc: 'organic', chkn: 'chicken', chk: 'chicken', brst: 'breast',
  brsts: 'breast', chs: 'cheese', chse: 'cheese', chddr: 'cheddar', chedd: 'cheddar', btr: 'butter',
  toms: 'tomato', tomatos: 'tomato', onns: 'onion', ons: 'onion', grnd: 'ground', drd: 'dried',
  frsh: 'fresh', frzn: 'frozen', frz: 'frozen', tin: 'canned', tinned: 'canned', tnd: 'canned',
  chpd: 'chopped', mshrms: 'mushroom', mshrm: 'mushroom', mush: 'mushroom', crts: 'carrot', carr: 'carrot',
  crrts: 'carrot', cucmbr: 'cucumber', yog: 'yoghurt', yogrt: 'yoghurt', ygt: 'yoghurt', ygrt: 'yoghurt',
  nat: 'natural', flr: 'flour', sgr: 'sugar', spgh: 'spaghetti', spag: 'spaghetti', ppr: 'pepper',
  pepr: 'pepper', grn: 'green', rd: 'red', wht: 'white', brwn: 'brown', ex: 'extra', vrgn: 'virgin',
  lrg: 'large', sml: 'small', slcd: 'sliced', sli: 'sliced', ptos: 'potato',
};

/** Words that qualify a product but are not the product (count half in precision). */
export const DESCRIPTORS: ReadonlySet<string> = new Set([
  'semi', 'skimmed', 'whole', 'organic', 'fresh', 'dried', 'ground', 'frozen', 'canned', 'large', 'small',
  'medium', 'loose', 'extra', 'free', 'range', 'chopped', 'sliced', 'red', 'green', 'white', 'brown',
  'natural', 'fat', 'reduced', 'mild', 'mature', 'virgin',
]);

export type Form = 'fresh' | 'dried' | 'ground' | 'frozen' | 'canned';
export const FORM_WORDS: ReadonlySet<string> = new Set(['fresh', 'dried', 'ground', 'frozen', 'canned']);

export function singular(t: string): string {
  if (t.length > 3 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 4 && t.endsWith('oes')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us')) return t.slice(0, -1);
  return t;
}

/** Tokenise free text (receipt description or item name) into canonical product words. */
export function tokenise(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')) {
    if (!raw || /^\d/.test(raw)) continue;
    const t = ABBREV[raw] ?? ABBREV[singular(raw)] ?? singular(raw);
    if (!t || BRAND.has(raw) || BRAND.has(t) || STOP.has(t)) continue;
    out.push(t);
  }
  return out;
}

export function formOf(tokens: readonly string[]): Form | undefined {
  for (const t of tokens) if (FORM_WORDS.has(t)) return t as Form;
  return undefined;
}

/** Stable key for learned household mappings: the ordered product tokens of the receipt description. */
export function learnedKey(descriptionOrTokens: string | readonly string[]): string {
  const toks = typeof descriptionOrTokens === 'string' ? tokenise(descriptionOrTokens) : descriptionOrTokens;
  return toks.join(' ');
}

// ---------- pack size ----------

const UNIT_MAP: Record<string, { unit: 'kg' | 'g' | 'ml' | 'l' | 'pint'; mult: number }> = {
  KG: { unit: 'kg', mult: 1 }, G: { unit: 'g', mult: 1 }, ML: { unit: 'ml', mult: 1 }, CL: { unit: 'ml', mult: 10 },
  L: { unit: 'l', mult: 1 }, LTR: { unit: 'l', mult: 1 }, PT: { unit: 'pint', mult: 1 },
  PINT: { unit: 'pint', mult: 1 }, PINTS: { unit: 'pint', mult: 1 },
};
const SIZE = '(KG|G|ML|CL|LTR|L|PINTS|PINT|PT)';

/** Extract a pack quantity ("2PT", "500G", "4 X 125G", "6PK") from an uppercase description. */
export function parsePack(upper: string): { quantity?: Quantity; rest: string } {
  let m = new RegExp(`(\\d+)\\s?X\\s?(\\d+(?:\\.\\d+)?)\\s?${SIZE}\\b`).exec(upper);
  if (m) {
    const u = UNIT_MAP[m[3]!]!;
    return {
      quantity: { kind: 'exact', value: Number(m[1]) * Number(m[2]) * u.mult, unit: u.unit, originalText: m[0] },
      rest: upper.replace(m[0], ' '),
    };
  }
  m = new RegExp(`(\\d+(?:\\.\\d+)?)\\s?${SIZE}\\b`).exec(upper);
  if (m) {
    const u = UNIT_MAP[m[2]!]!;
    return {
      quantity: { kind: 'exact', value: Number(m[1]) * u.mult, unit: u.unit, originalText: m[0] },
      rest: upper.replace(m[0], ' '),
    };
  }
  m = /(\d+)\s?(PK|PACK|S)\b/.exec(upper);
  if (m) {
    return { quantity: { kind: 'exact', value: Number(m[1]), unit: 'item', originalText: m[0] }, rest: upper.replace(m[0], ' ') };
  }
  return { rest: upper };
}

/** Convert to a comparable base (g / ml / count) using the shared L3 unit table (pint = 568.26125 ml). */
export function toBase(q: Quantity | undefined): { dim: 'mass' | 'volume' | 'count'; value: number } | undefined {
  if (!q || q.kind !== 'exact' || q.value === undefined) return undefined;
  const b = toBaseAmount(q);
  return b ? { dim: b.dimension, value: b.min } : undefined;
}

// ---------- line parsing ----------

export interface ReceiptItemLine {
  id: string;
  raw: string;
  /** Product words after abbreviation expansion, brands/sizes removed. */
  tokens: string[];
  description: string;
  count: number;
  /** Pack size per unit bought (or the weighed weight for weighted lines). */
  packQuantity?: Quantity;
  weightG?: number;
  /** Gross line price (before discounts). */
  pricePence?: Pence;
  discountPence: Pence;
  /** pricePence - discountPence, when a price is known. */
  netPence?: Pence;
  discountLines: string[];
}

export type ClassifiedLine =
  | { kind: 'item'; raw: string; description: string; tokens: string[]; count: number; packQuantity?: Quantity; weightG?: number; pricePence?: Pence }
  | { kind: 'modifier'; raw: string; count?: number; weightG?: number; ratePencePerKg?: number; pricePence?: Pence }
  | { kind: 'discount'; raw: string; amountPence: Pence }
  | { kind: 'total' | 'subtotal'; raw: string; pricePence?: Pence }
  | { kind: 'ignore'; raw: string };

const PRICE_RE = /(?:^|\s)(-)?\s*£?\s*(\d{1,5})\.(\d{2})(-)?(?:\s+[A-Z*])?\s*$/;
const WEIGHT_AT_RE = /(\d+(?:\.\d+)?)\s*KG\s*@\s*£?\s*(\d+(?:\.\d+)?)\s*\/\s*KG/;
const MULTI_RE = /(\d+)\s*(?:@|X)\s*£?(\d+\.\d{2})(?![\dA-Z])/;
const DISCOUNT_RE = /\b(MULTI-?BUY|SAVINGS?|OFFER|PROMO(?:TION)?|DISCOUNT|CLUBCARD PRICE|NECTAR PRICE|COUPON|[23] FOR|ANY \d)\b/;
const IGNORE_RE = /\b(VAT|VISA|MASTERCARD|DEBIT|CREDIT|CARD|CHANGE|CASH|POINTS|ITEMS? SOLD|NO\.? OF ITEMS|THANK|RECEIPT|STORE|TEL|NECTAR|BALANCE|SELF.?SERVICE|CUSTOMER)\b/;

const pence = (whole: string, frac: string): Pence => Number(whole) * 100 + Number(frac);

/** Classify one raw receipt line without context. */
export function normaliseReceiptLine(rawLine: string): ClassifiedLine {
  const raw = rawLine.trim();
  const upper = raw.toUpperCase();
  if (!raw) return { kind: 'ignore', raw };

  let work = upper;
  let weightG: number | undefined;
  let rate: number | undefined;
  let count: number | undefined;
  let unitPrice: Pence | undefined;

  const w = WEIGHT_AT_RE.exec(work);
  if (w) {
    weightG = Math.round(Number(w[1]) * 1000);
    rate = Math.round(Number(w[2]) * 100);
    work = work.replace(w[0], ' ');
  }
  const mm = w ? null : MULTI_RE.exec(work);
  if (mm) {
    count = Number(mm[1]);
    unitPrice = Math.round(Number(mm[2]) * 100);
    work = work.replace(mm[0], ' ');
  }

  let price: Pence | undefined;
  let negative = false;
  const p = PRICE_RE.exec(work);
  if (p) {
    price = pence(p[2]!, p[3]!);
    negative = !!(p[1] || p[4]);
    work = work.slice(0, p.index);
  }

  if (/^SUB\s?TOTAL\b/.test(upper)) return { kind: 'subtotal', raw, pricePence: price };
  if (/^(TOTAL|BALANCE DUE|AMOUNT DUE|TO PAY|TOTAL TO PAY)\b/.test(upper)) return { kind: 'total', raw, pricePence: price };

  if (price !== undefined && (negative || DISCOUNT_RE.test(upper)) && !weightG) {
    return { kind: 'discount', raw, amountPence: price };
  }
  if (IGNORE_RE.test(upper)) return { kind: 'ignore', raw };

  const { quantity: packQuantity, rest } = parsePack(work);
  let desc = rest;
  const lead = /^\s*(\d+)\s?X\s+/.exec(desc);
  if (lead) {
    count = Number(lead[1]);
    desc = desc.slice(lead[0].length);
  }
  const tokens = tokenise(desc);

  const computed =
    price ??
    (weightG !== undefined && rate !== undefined
      ? Math.round((weightG / 1000) * rate)
      : count !== undefined && unitPrice !== undefined
        ? count * unitPrice
        : undefined);

  if (tokens.length === 0) {
    if (weightG !== undefined || count !== undefined) {
      return { kind: 'modifier', raw, count, weightG, ratePencePerKg: rate, pricePence: computed };
    }
    return { kind: 'ignore', raw };
  }

  const pack: Quantity | undefined = weightG !== undefined
    ? { kind: 'exact', value: weightG / 1000, unit: 'kg', originalText: raw }
    : packQuantity;
  return {
    kind: 'item', raw, description: tokens.join(' '), tokens, count: count ?? 1,
    packQuantity: pack, weightG, pricePence: computed,
  };
}

export interface ParsedReceipt {
  items: ReceiptItemLine[];
  totalPence?: Pence;
  subtotalPence?: Pence;
  /** Discount lines that appeared before any item (positive pence saved). */
  orphanDiscountPence: Pence;
  /** Lines that were not understood as products (header/footer, unpriced names). */
  ignored: string[];
}

/**
 * Parse a whole receipt (already OCR'd text lines). Discount lines attach to the previous item;
 * weight/multiple continuation lines ("0.536kg @ £1.20/kg", "2 @ £1.50") attach to the previous item.
 */
export function parseReceipt(lines: readonly string[], opts: { idPrefix?: string } = {}): ParsedReceipt {
  const prefix = opts.idPrefix ?? 'line';
  const items: ReceiptItemLine[] = [];
  const ignored: string[] = [];
  let totalPence: Pence | undefined;
  let subtotalPence: Pence | undefined;
  let orphan = 0;
  const unpriced = new Set<ReceiptItemLine>();

  for (const rawLine of lines) {
    const c = normaliseReceiptLine(rawLine);
    const last = items[items.length - 1];
    switch (c.kind) {
      case 'item': {
        const it: ReceiptItemLine = {
          id: `${prefix}-${items.length + 1}`, raw: c.raw, tokens: c.tokens, description: c.description,
          count: c.count, packQuantity: c.packQuantity, weightG: c.weightG, pricePence: c.pricePence,
          discountPence: 0, discountLines: [],
        };
        items.push(it);
        if (it.pricePence === undefined) unpriced.add(it);
        break;
      }
      case 'modifier':
        if (!last) { ignored.push(c.raw); break; }
        if (c.weightG !== undefined) {
          last.weightG = c.weightG;
          last.packQuantity = { kind: 'exact', value: c.weightG / 1000, unit: 'kg', originalText: c.raw };
        }
        if (c.count !== undefined) last.count = c.count;
        if (c.pricePence !== undefined && last.pricePence === undefined) {
          last.pricePence = c.pricePence;
          unpriced.delete(last);
        }
        break;
      case 'discount':
        if (last) { last.discountPence += c.amountPence; last.discountLines.push(c.raw); } else orphan += c.amountPence;
        break;
      case 'total': totalPence = c.pricePence ?? totalPence; break;
      case 'subtotal': subtotalPence = c.pricePence ?? subtotalPence; break;
      default: if (c.raw) ignored.push(c.raw);
    }
  }

  const kept = items.filter((i) => {
    if (unpriced.has(i)) { ignored.push(i.raw); return false; }
    return true;
  });
  for (const i of kept) i.netPence = i.pricePence !== undefined ? i.pricePence - i.discountPence : undefined;
  return { items: kept, totalPence, subtotalPence, orphanDiscountPence: orphan, ignored };
}
