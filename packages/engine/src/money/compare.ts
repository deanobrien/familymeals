import type { PriceObservation } from '../contract';
import { ageLabel, daysBetween } from './time';
import { formatUnitPrice, unitPriceOf, type UnitBasis, type UnitPrice } from './unitprice';

/**
 * Price comparison per shop (P2-B, D401-D403).
 *
 * Inputs are the household's OWN observations only (confirmed receipt lines and prices the user entered): never the
 * generic estimates, which carry no shop. Every figure keeps its date, so a badge always says how old the price is.
 */

/** Prices that can say anything about a particular shop: the household's own. */
export const SHOP_PRICE_KINDS: ReadonlySet<string> = new Set(['receipt', 'user_confirmed']);

/** A price older than this no longer counts towards a "cheapest at" badge (it is still shown in the history). */
export const RECENT_DAYS = 60;

export interface StoreLike { id: string; name: string; chain?: string | null }

/** One shop a price can be attributed to: a household Store record, or a retailer name that is not linked to one yet. */
export interface ShopRef {
  /** Stable grouping key: `store:<id>` for a linked store, else `name:<normalised retailer>`. */
  key: string;
  label: string;
  storeId?: string;
  linked: boolean;
}

/** Normalised retailer text: lower case, punctuation to spaces, "Tesco Stores Ltd" and "TESCO" are the same key. */
export function retailerKey(text: string | undefined | null): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(stores?|supermarkets?|ltd|limited|plc|uk)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const wordsOf = (k: string): string[] => (k ? k.split(' ') : []);
const containsWords = (hay: string[], needle: string[]): boolean => {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((w, j) => hay[i + j] === w)) return true;
  return false;
};

/**
 * A SUGGESTION of which household store a receipt's retailer text probably is, or null. Matches on the store name or its
 * chain as whole words ("Tesco Extra" and "TESCO" -> a store called "Tesco"); an ambiguous result (two stores match
 * equally well) is null. Never applied without the user's confirmation.
 */
export function suggestStore(retailer: string | undefined | null, stores: readonly StoreLike[]): StoreLike | null {
  const rw = wordsOf(retailerKey(retailer));
  if (rw.length === 0) return null;
  const scored: { s: StoreLike; score: number }[] = [];
  for (const s of stores) {
    let score = 0;
    for (const cand of [s.name, s.chain]) {
      const cw = wordsOf(retailerKey(cand));
      if (cw.length === 0) continue;
      if (cw.join(' ') === rw.join(' ')) score = Math.max(score, 3 + cw.length);
      else if (containsWords(rw, cw) || containsWords(cw, rw)) score = Math.max(score, 1 + Math.min(cw.length, rw.length));
    }
    if (score > 0) scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0]!.score === scored[1]!.score) return null;
  return scored[0]!.s;
}

/**
 * Retailer text -> store id: the user's confirmed links, plus the one thing that needs no confirmation: text that is exactly
 * a store's own name (a price entered "at Tesco" is the store Tesco). Confirmed links win.
 */
export function effectiveLinks(stores: readonly StoreLike[], links: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of stores) {
    const k = retailerKey(s.name);
    if (k && out[k] === undefined) out[k] = s.id;
  }
  const ids = new Set(stores.map((s) => s.id));
  for (const [k, id] of Object.entries(links)) if (ids.has(id)) out[k] = id;
  return out;
}

export type ShopResolver = (retailer: string | undefined | null) => ShopRef | null;

/**
 * Turns retailer text into a shop. A retailer the user has confirmed against a Store (a link) shows as that store, so
 * "TESCO EXTRA" and "Tesco" group together; otherwise it stays its own shop under the printed name.
 * `links` maps a normalised retailer key to a store id.
 */
export function buildShopResolver(stores: readonly StoreLike[], links: Readonly<Record<string, string>>): ShopResolver {
  const byId = new Map(stores.map((s) => [s.id, s]));
  const all = effectiveLinks(stores, links);
  return (retailer) => {
    const key = retailerKey(retailer);
    if (!key) return null;
    const store = byId.get(all[key] ?? '');
    if (store) return { key: `store:${store.id}`, label: store.name, storeId: store.id, linked: true };
    return { key: `name:${key}`, label: (retailer ?? '').trim().slice(0, 80) || key, linked: false };
  };
}

export interface ShopObservation {
  shop: ShopRef;
  pricePence: number;
  observedOn: string;
  kind: 'receipt' | 'user_confirmed';
  source: string;
  unit: UnitPrice | null;
  raw: PriceObservation;
}

const KIND_RANK: Record<string, number> = { user_confirmed: 0, receipt: 1 };

/** Newest first; on the same day a price the user entered beats a receipt; then source for a stable order. */
function newestFirst(a: ShopObservation, b: ShopObservation): number {
  return (a.observedOn < b.observedOn ? 1 : a.observedOn > b.observedOn ? -1 : 0)
    || (KIND_RANK[a.kind]! - KIND_RANK[b.kind]!)
    || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
}

/** The household's shop-attributed observations of one ingredient (receipt / user_confirmed with a retailer). */
export function shopObservations(
  observations: readonly PriceObservation[], ingredientId: string, resolve: ShopResolver,
): { obs: ShopObservation[]; withoutRetailer: number } {
  const obs: ShopObservation[] = [];
  let withoutRetailer = 0;
  for (const o of observations) {
    if (o.ingredientId !== ingredientId || o.productPackId !== undefined || !SHOP_PRICE_KINDS.has(o.kind)) continue;
    if (!Number.isInteger(o.pricePence) || o.pricePence < 0) continue;
    const shop = resolve(o.retailer);
    if (!shop) { withoutRetailer++; continue; }
    obs.push({ shop, pricePence: o.pricePence, observedOn: o.observedOn, kind: o.kind as 'receipt' | 'user_confirmed', source: o.source, unit: unitPriceOf(o.pricePence, o.packQuantity), raw: o });
  }
  return { obs: obs.sort(newestFirst), withoutRetailer };
}

export interface ShopPrice {
  shop: ShopRef;
  latest: { pricePence: number; observedOn: string; kind: 'receipt' | 'user_confirmed'; unit: UnitPrice | null };
  /** Observations of this ingredient at this shop (all dates). */
  count: number;
  ageDays: number;
  ageText: string;
  /** Older than RECENT_DAYS: shown, but never used for a "cheapest" call. */
  stale: boolean;
  /** Same basis as the comparison (so it takes part in the ranking). */
  comparable: boolean;
  /** Unit price text, e.g. "£1.20 per kg", when there is one. */
  unitText: string | null;
}

export interface IngredientComparison {
  ingredientId: string;
  /** The basis the ranking is in; null when fewer than two shops have a recent comparable price. */
  basis: UnitBasis | null;
  /** Every shop with a price, comparable and recent first, cheapest first. */
  shops: ShopPrice[];
  cheapest: ShopPrice | null;
  /** More than one shop at the cheapest unit price: no single shop is called cheapest. */
  tied: boolean;
  /** Saving of the cheapest versus the dearest compared shop, in whole percent. */
  savingPct: number | null;
  /** Why there is no badge (for the history view), or null when there is one. */
  note: string | null;
  withoutRetailer: number;
}

const BASIS_PREFERENCE: UnitBasis[] = ['kg', 'l', 'each'];

export interface CompareOptions {
  /** Today's date in the household's time zone (YYYY-MM-DD). */
  today: string;
  recentDays?: number;
}

/** Latest observation per shop, with age/stale flags, in the order the observations came in (newest first). */
function latestPerShop(obs: readonly ShopObservation[], today: string, recentDays: number): ShopPrice[] {
  const seen = new Map<string, ShopPrice>();
  for (const o of obs) {
    const cur = seen.get(o.shop.key);
    if (cur) { cur.count++; continue; }
    const ageDays = Math.max(0, daysBetween(o.observedOn, today));
    seen.set(o.shop.key, {
      shop: o.shop, latest: { pricePence: o.pricePence, observedOn: o.observedOn, kind: o.kind, unit: o.unit }, count: 1, ageDays,
      ageText: ageLabel(ageDays), stale: ageDays > recentDays, comparable: false, unitText: o.unit ? formatUnitPrice(o.unit) : null,
    });
  }
  return [...seen.values()];
}

/**
 * Compare one ingredient across shops. A "cheapest at" call needs at least TWO shops with a recent price in the SAME basis
 * (per kg / per litre / per item). With one shop, old prices only, or prices that cannot be put on one basis, there is
 * no badge and `note` says why. The basis chosen is the one the most recent shops share (kg, then litre, then item).
 */
export function compareIngredient(
  observations: readonly PriceObservation[], ingredientId: string, resolve: ShopResolver, opts: CompareOptions,
): IngredientComparison {
  const recentDays = opts.recentDays ?? RECENT_DAYS;
  const { obs, withoutRetailer } = shopObservations(observations, ingredientId, resolve);
  const shops = latestPerShop(obs, opts.today, recentDays);
  const out: IngredientComparison = { ingredientId, basis: null, shops, cheapest: null, tied: false, savingPct: null, note: null, withoutRetailer };

  const recent = shops.filter((s) => !s.stale && s.latest.unit !== null);
  const counts = new Map<UnitBasis, number>();
  for (const s of recent) counts.set(s.latest.unit!.basis, (counts.get(s.latest.unit!.basis) ?? 0) + 1);
  let basis: UnitBasis | null = null;
  for (const b of BASIS_PREFERENCE) if ((counts.get(b) ?? 0) > (basis ? counts.get(basis)! : 0)) basis = b;

  if (shops.length === 0) { out.note = 'No shop prices yet. Confirm a receipt or add a price you saw.'; return out; }
  if (shops.length === 1) out.note = `Only ${shops[0]!.shop.label} has a price so far, so there is nothing to compare.`;
  else if (!basis || counts.get(basis)! < 2) {
    out.note = recent.length < 2
      ? `Fewer than two shops have a price from the last ${recentDays} days.`
      : 'The recent prices are for different pack types (weight, volume, count) and cannot be compared.';
  }

  if (basis && counts.get(basis)! >= 2) {
    out.basis = basis;
    for (const s of shops) s.comparable = !s.stale && s.latest.unit?.basis === basis;
    const ranked = shops.filter((s) => s.comparable).sort((a, b) => a.latest.unit!.pencePerUnit - b.latest.unit!.pencePerUnit);
    const rest = shops.filter((s) => !s.comparable);
    out.shops = [...ranked, ...rest];
    const best = ranked[0]!;
    const worst = ranked[ranked.length - 1]!;
    // equal to the penny per unit: a tie, not a winner
    out.tied = ranked.filter((s) => Math.abs(s.latest.unit!.pencePerUnit - best.latest.unit!.pencePerUnit) < 0.005).length > 1;
    out.cheapest = best;
    out.savingPct = worst.latest.unit!.pencePerUnit > 0 ? Math.round((1 - best.latest.unit!.pencePerUnit / worst.latest.unit!.pencePerUnit) * 100) : null;
    out.note = null;
  }
  return out;
}

/** Newest-first price history of one ingredient (every observation, with the shop and unit price). */
export function priceHistory(observations: readonly PriceObservation[], ingredientId: string, resolve: ShopResolver, today: string): {
  shop: ShopRef; pricePence: number; observedOn: string; kind: 'receipt' | 'user_confirmed'; ageText: string; unitText: string | null; packLabel: string | null;
}[] {
  return shopObservations(observations, ingredientId, resolve).obs.map((o) => ({
    shop: o.shop, pricePence: o.pricePence, observedOn: o.observedOn, kind: o.kind,
    ageText: ageLabel(Math.max(0, daysBetween(o.observedOn, today))), unitText: o.unit ? formatUnitPrice(o.unit) : null, packLabel: o.unit?.packLabel ?? null,
  }));
}

/** The short badge text: "Cheapest at ALDI: £1.20 per kg (3 days ago)", or "Joint cheapest at ...". */
export function cheapestBadgeText(c: IngredientComparison): string | null {
  if (!c.cheapest || !c.basis) return null;
  const s = c.cheapest;
  const tied = c.tied ? c.shops.filter((x) => x.comparable && Math.abs(x.latest.unit!.pencePerUnit - s.latest.unit!.pencePerUnit) < 0.005).map((x) => x.shop.label) : [];
  const where = c.tied ? `Joint cheapest at ${tied.join(' and ')}` : `Cheapest at ${s.shop.label}`;
  return `${where}: ${s.unitText ?? ''} (${s.ageText})`;
}
