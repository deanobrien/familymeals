import type { AllergenGroup, NutrientKey, NutrientValue, Quantity } from '@fr/domain';
import { parseIngredientLine } from '@fr/engine/parse';
import type {
  IngredientSuggestion,
  NameMatcher,
  Product,
  ProductAllergens,
  ProductNutrition,
} from '../types';
import type { OffProduct } from './schema';

export const OFF_PUBLISHER = 'Open Food Facts';
export const OFF_LICENCE = 'ODbL 1.0 (database), DbCL 1.0 (contents)';
export const OFF_IMAGE_LICENCE_NOTE = 'Photo: Open Food Facts contributors, CC BY-SA';
export const OFF_ATTRIBUTION = 'Product data © Open Food Facts contributors, ODbL';
export const productPageUrl = (code: string): string => `https://world.openfoodfacts.org/product/${code}`;

export interface MapOptions {
  /** Canonical-ingredient matcher (engine IngredientMatcher). Omitted = no suggestion. */
  matcher?: NameMatcher;
  /** Display name for an ingredient id (needed to name ambiguous candidates). */
  nameOf?: (id: string) => string | undefined;
  now?: () => Date;
}

// ---- allergens (UK-14) ----

const ALLERGEN_TAGS: Record<string, AllergenGroup> = {
  'en:celery': 'celery',
  'en:gluten': 'cereals_gluten',
  'en:crustaceans': 'crustaceans',
  'en:eggs': 'eggs',
  'en:fish': 'fish',
  'en:lupin': 'lupin',
  'en:milk': 'milk',
  'en:molluscs': 'molluscs',
  'en:mustard': 'mustard',
  'en:peanuts': 'peanuts',
  'en:sesame-seeds': 'sesame',
  'en:soybeans': 'soya',
  'en:sulphur-dioxide-and-sulphites': 'sulphites',
  'en:nuts': 'tree_nuts',
};

function mapAllergenTags(tags: readonly string[] | undefined): { groups: AllergenGroup[]; unmapped: string[] } {
  const groups = new Set<AllergenGroup>();
  const unmapped: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw.trim().toLowerCase();
    const g = ALLERGEN_TAGS[tag];
    if (g) groups.add(g);
    else if (tag) unmapped.push(tag);
  }
  return { groups: [...groups].sort(), unmapped };
}

export function mapAllergens(p: Pick<OffProduct, 'allergens_tags' | 'traces_tags' | 'ingredients_text'>): ProductAllergens {
  const a = mapAllergenTags(p.allergens_tags);
  const t = mapAllergenTags(p.traces_tags);
  // An empty list only counts as "listed" when the record also has an ingredients list: otherwise nobody has told us.
  const listed = (p.allergens_tags?.length ?? 0) > 0 || (!!p.ingredients_text && p.ingredients_text.trim().length > 0);
  return {
    status: listed ? 'listed' : 'unknown',
    contains: a.groups,
    traces: t.groups.filter((g) => !a.groups.includes(g)),
    unmapped: [...new Set([...a.unmapped, ...t.unmapped])],
  };
}

// ---- nutrition ----

const KJ_PER_KCAL = 4.184;
const SALT_PER_SODIUM_G = 2.5;

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};
const round = (n: number): number => Math.round(n * 100) / 100;

const UNITS: Record<NutrientKey, NutrientValue['unit']> = {
  energy_kcal: 'kcal', energy_kj: 'kJ', protein: 'g', carbohydrate: 'g', sugars: 'g',
  fat: 'g', saturates: 'g', fibre: 'g', salt: 'g', sodium: 'mg',
};
const ORDER: NutrientKey[] = ['energy_kcal', 'energy_kj', 'protein', 'carbohydrate', 'sugars', 'fat', 'saturates', 'fibre', 'salt', 'sodium'];

/** Per-100 nutrition. Absent = unknown (never 0); an explicit 0 = zero; a nonsense block is withheld whole. */
export function mapNutrition(nutriments: Record<string, unknown> | undefined, per: 'g' | 'ml'): ProductNutrition {
  const n = nutriments ?? {};
  const read = (k: string): number | undefined => {
    const v = num(n[k]);
    return v !== undefined && v >= 0 ? v : undefined;
  };
  const vals: Partial<Record<NutrientKey, number>> = {};
  const derived: NutrientKey[] = [];
  const put = (k: NutrientKey, v: number | undefined) => { if (v !== undefined) vals[k] = v; };
  put('energy_kcal', read('energy-kcal_100g'));
  put('energy_kj', read('energy-kj_100g') ?? read('energy_100g'));
  put('protein', read('proteins_100g'));
  put('carbohydrate', read('carbohydrates_100g'));
  put('sugars', read('sugars_100g'));
  put('fat', read('fat_100g'));
  put('saturates', read('saturated-fat_100g'));
  put('fibre', read('fiber_100g') ?? read('fibre_100g'));
  put('salt', read('salt_100g'));
  const sodiumG = read('sodium_100g');
  if (sodiumG !== undefined) vals.sodium = sodiumG * 1000; // OFF gives sodium in grams; we hold mg.

  // Derivations (each flagged): salt <-> sodium, kcal <-> kJ.
  if (vals.salt === undefined && vals.sodium !== undefined) { vals.salt = (vals.sodium / 1000) * SALT_PER_SODIUM_G; derived.push('salt'); }
  if (vals.sodium === undefined && vals.salt !== undefined) { vals.sodium = (vals.salt / SALT_PER_SODIUM_G) * 1000; derived.push('sodium'); }
  if (vals.energy_kcal === undefined && vals.energy_kj !== undefined) { vals.energy_kcal = vals.energy_kj / KJ_PER_KCAL; derived.push('energy_kcal'); }
  if (vals.energy_kj === undefined && vals.energy_kcal !== undefined) { vals.energy_kj = vals.energy_kcal * KJ_PER_KCAL; derived.push('energy_kj'); }

  if (Object.keys(vals).length === 0) {
    return { per, per100: [], derived: [], withheldReason: 'no nutrition data on the product record' };
  }
  // Sanity: crowd-sourced entries are sometimes per serving or mistyped. Withhold rather than show wrong numbers.
  const solids = (vals.protein ?? 0) + (vals.carbohydrate ?? 0) + (vals.fat ?? 0) + (vals.fibre ?? 0) + (vals.salt ?? 0);
  if (solids > 105) return { per, per100: [], derived: [], withheldReason: 'implausible: macronutrients exceed 100 g per 100 g' };
  if ((vals.energy_kcal ?? 0) > 950) return { per, per100: [], derived: [], withheldReason: 'implausible: energy above 950 kcal per 100 g' };

  const source = OFF_PUBLISHER;
  const per100: NutrientValue[] = ORDER.map((k) => {
    const v = vals[k];
    if (v === undefined) return { nutrient: k, status: 'unknown', unit: UNITS[k], source, estimate: false };
    const value = round(v);
    return value === 0
      ? { nutrient: k, status: 'zero', value: 0, unit: UNITS[k], source, estimate: false }
      : { nutrient: k, status: 'known', value, unit: UNITS[k], source, estimate: derived.includes(k) };
  });
  return { per, per100, derived };
}

// ---- pack size ----

const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*(kg|kilograms?|g|grams?|gr|mg|l|litres?|liters?|ml|millilitres?|cl|dl)\b/i;
const MULTI_RE = /(\d+)\s*(?:x|×)\s*(\d+(?:[.,]\d+)?)\s*(kg|kilograms?|g|grams?|gr|l|litres?|liters?|ml|millilitres?|cl|dl)\b/i;

function unitToken(u: string): string {
  const x = u.toLowerCase();
  if (x.startsWith('kilo')) return 'kg';
  if (x.startsWith('gram') || x === 'gr') return 'g';
  if (x.startsWith('lit')) return 'l';
  if (x.startsWith('milli')) return 'ml';
  return x;
}

/** One size token ("400 g", "75cl") -> g/ml via the engine parser (cl/dl handled there). */
function parseOne(value: string, unit: string): { value: number; unit: 'g' | 'ml' } | undefined {
  const parsed = parseIngredientLine(`${value.replace(',', '.')} ${unitToken(unit)} item`).quantity;
  if (parsed.kind !== 'exact' || parsed.value === undefined) return undefined;
  if (parsed.unit === 'g') return { value: parsed.value, unit: 'g' };
  if (parsed.unit === 'kg') return { value: parsed.value * 1000, unit: 'g' };
  if (parsed.unit === 'mg') return { value: parsed.value / 1000, unit: 'g' };
  if (parsed.unit === 'ml') return { value: parsed.value, unit: 'ml' };
  if (parsed.unit === 'l') return { value: parsed.value * 1000, unit: 'ml' };
  return undefined;
}

export interface PackSizeResult { packSize?: Quantity; packCount?: number; unit?: 'g' | 'ml' }

/** "400 g", "2 x 400g", "6 x 125 g", "1 L", "400g (drained 240g)". Whole-pack total in g or ml; undefined when unreadable. */
export function parsePackSize(text: string | undefined, fallbackQuantity?: unknown, fallbackUnit?: string): PackSizeResult {
  const t = text?.trim() ?? '';
  const multi = MULTI_RE.exec(t);
  if (multi) {
    const one = parseOne(multi[2]!, multi[3]!);
    const count = Number(multi[1]);
    if (one && count > 0 && count <= 100) {
      const total = Math.round(one.value * count * 1e6) / 1e6;
      return { packSize: { kind: 'exact', value: total, unit: one.unit, originalText: t }, packCount: count, unit: one.unit };
    }
  }
  const single = SIZE_RE.exec(t);
  if (single) {
    const one = parseOne(single[1]!, single[2]!);
    if (one && one.value > 0) return { packSize: { kind: 'exact', value: Math.round(one.value * 1e6) / 1e6, unit: one.unit, originalText: t }, unit: one.unit };
  }
  const pq = num(fallbackQuantity);
  if (pq !== undefined && pq > 0) {
    const unit = fallbackUnit?.toLowerCase() === 'ml' ? 'ml' : 'g';
    return { packSize: { kind: 'exact', value: pq, unit, originalText: t || `${pq} ${unit}` }, unit };
  }
  return {};
}

// ---- ingredient suggestion ----

const tagToName = (tag: string): string => tag.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ').trim();

function stripBrand(name: string, brands: string | undefined): string {
  let out = name.trim();
  for (const b of (brands ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    if (out.toLowerCase().startsWith(b.toLowerCase() + ' ')) out = out.slice(b.length).trim();
  }
  return out;
}

/**
 * Conservative: EXACT name/alias matches only (the engine matcher never fuzzes). Tries the generic name, the product
 * name without its brand, then category tags most-specific first. The first matched OR ambiguous result wins; an
 * ambiguous one is returned as candidates for the owner to choose between, never auto-picked.
 */
export function suggestIngredient(p: OffProduct, opts: MapOptions): IngredientSuggestion {
  const matcher = opts.matcher;
  if (!matcher) return { status: 'none' };
  const nameOf = opts.nameOf ?? (() => undefined);
  const tries: { text: string; via: 'name' | 'category' }[] = [];
  const productName = (p.product_name ?? p.product_name_en ?? '').trim();
  if (p.generic_name?.trim()) tries.push({ text: p.generic_name.trim(), via: 'name' });
  if (productName) tries.push({ text: stripBrand(productName, p.brands), via: 'name' });
  for (const tag of [...(p.categories_tags ?? [])].reverse().slice(0, 4)) tries.push({ text: tagToName(tag), via: 'category' });
  for (const t of tries) {
    if (!t.text) continue;
    const m = matcher.match(t.text);
    if (m.status === 'matched' && m.ingredientId) {
      return { status: 'matched', ingredientId: m.ingredientId, ingredientName: m.ingredient?.name ?? nameOf(m.ingredientId) ?? t.text, via: t.via, matchedOn: t.text };
    }
    if (m.status === 'ambiguous' && m.candidates.length > 0) {
      return {
        status: 'ambiguous',
        candidates: m.candidates.map((id) => ({ ingredientId: id, ingredientName: nameOf(id) ?? id })),
        matchedOn: t.text,
      };
    }
  }
  return { status: 'none' };
}

// ---- product ----

/** Map a validated OFF product onto our shape. Returns null when it is not usable at all (no name). */
export function mapOffProduct(code: string, p: OffProduct, opts: MapOptions = {}): Product | null {
  const name = (p.product_name ?? p.product_name_en ?? '').trim() || (p.generic_name ?? '').trim();
  if (!name) return null;
  const brand = p.brands?.split(',')[0]?.trim();
  const pack = parsePackSize(p.quantity, p.product_quantity, p.product_quantity_unit);
  const imageUrl = p.image_front_url ?? p.image_front_small_url ?? p.image_url;
  const retrievedAt = (opts.now ?? (() => new Date()))().toISOString();
  const product: Product = {
    barcode: code,
    name,
    nutrition: mapNutrition(p.nutriments, pack.unit === 'ml' ? 'ml' : 'g'),
    allergens: mapAllergens(p),
    categories: [...(p.categories_tags ?? [])],
    suggestion: suggestIngredient(p, opts),
    source: { publisher: OFF_PUBLISHER, url: productPageUrl(code), code, retrievedAt, licence: OFF_LICENCE },
  };
  if (brand) product.brand = brand;
  if (p.generic_name?.trim()) product.genericName = p.generic_name.trim();
  if (pack.packSize) product.packSize = pack.packSize;
  if (p.quantity?.trim()) product.packSizeText = p.quantity.trim();
  if (pack.packCount) product.packCount = pack.packCount;
  if (imageUrl && /^https:\/\//.test(imageUrl)) product.image = { url: imageUrl, licenceNote: OFF_IMAGE_LICENCE_NOTE };
  return product;
}
