import { SHOPPING_SCAN_MAX_IMAGES, type AiProvider, type ShoppingListLine, type ShoppingListScan } from '@fr/ai';
import { describeActiveProvider, getAiProvider } from '../ai/provider';
import { toError, type PipelineError } from '../import/pipeline';
import { matchScannedName } from '../pantry/scan';
import { getIngredientCatalogue, type IngredientCatalogue } from '../refdata/catalogue';
import type { ListScanApiOk, ListScanQuantityDto, ListScanRowDto } from '../../shopping/list-scan-types';
import { aisleForCategory } from '../../shopping/aisles';

export interface ListScanDeps {
  provider?: AiProvider;
  catalogue?: IngredientCatalogue;
}

export interface ListScanInput {
  images: Uint8Array[];
}

export type ListScanOutcome = ({ ok: true } & ListScanApiOk) | { ok: false; status: number; error: PipelineError };

const HOUSEHOLD = /\b(washing[- ]up|toilet roll|loo roll|kitchen roll|bin bags?|bleach|detergent|dishwasher|laundry|washing powder|fabric (?:softener|conditioner)|sponges?|foil|cling ?film|tissues?|shampoo|conditioner|toothpaste|soap|nappies|wipes|batteries|light ?bulbs?|cleaner|air freshener)\b/i;

/** Aisle for an unmatched item: a small household keyword list, else "Other". Never claims food the catalogue does not know. */
export function guessAisle(name: string): string {
  return HOUSEHOLD.test(name) ? 'Household' : 'Other';
}

function quantityDto(l: ShoppingListLine): ListScanQuantityDto | undefined {
  const q = l.quantity;
  if (!q || (q.kind !== 'exact' && q.kind !== 'range' && q.kind !== 'approximate')) return undefined;
  return {
    kind: q.kind,
    ...(q.value !== undefined ? { value: q.value } : {}),
    ...(q.min !== undefined ? { min: q.min } : {}),
    ...(q.max !== undefined ? { max: q.max } : {}),
    ...(q.unit ? { unit: q.unit } : {}),
    ...(q.approxLabel ? { approxLabel: q.approxLabel } : {}),
  };
}

/** Scanned lines -> reviewable rows: each name goes through the engine's conservative matcher (exact name / alias only). */
export function toListScanRows(scan: ShoppingListScan, cat: IngredientCatalogue, keyPrefix = 'l'): ListScanRowDto[] {
  return scan.lines.map((l, i): ListScanRowDto => {
    const match = l.name ? matchScannedName(cat, l.name, 'other') : { status: 'unmatched' as const, suggestions: [] };
    const aisle = match.status === 'matched' ? aisleForCategory(match.ingredient.category) : guessAisle(l.name);
    const quantity = quantityDto(l);
    return {
      key: `${keyPrefix}${i + 1}`,
      originalText: l.originalText,
      name: l.name,
      ...(quantity ? { quantity } : {}),
      ...(l.notes ? { notes: l.notes } : {}),
      crossedOut: l.crossedOut,
      illegible: l.illegible,
      confidence: l.confidence,
      imageRef: l.imageRef,
      match,
      aisle,
    };
  });
}

/**
 * Photos of a handwritten list in, reviewable rows out. Reads only: NOTHING is written to any list here (D264).
 * The AI context is the canonical ingredient names; no household, pantry or purchase data (D260).
 */
export async function runShoppingListScan(input: ListScanInput, deps: ListScanDeps = {}): Promise<ListScanOutcome> {
  const { images } = input;
  if (images.length === 0) {
    return { ok: false, status: 400, error: { code: 'NO_IMAGES', message: 'Add at least one photo of your list.', retryable: false } };
  }
  if (images.length > SHOPPING_SCAN_MAX_IMAGES) {
    return { ok: false, status: 400, error: { code: 'TOO_MANY_IMAGES', message: `You can scan up to ${SHOPPING_SCAN_MAX_IMAGES} photos of a list at a time.`, retryable: false } };
  }
  const cat = deps.catalogue ?? getIngredientCatalogue();
  try {
    const provider = deps.provider ?? (await getAiProvider());
    const info = deps.provider ? undefined : await describeActiveProvider();
    const scan = await provider.scanShoppingList(images, { ingredientNames: cat.all.map((i) => i.name) });
    return {
      ok: true,
      rows: toListScanRows(scan, cat),
      ...(scan.title ? { title: scan.title } : {}),
      warnings: scan.warnings,
      ...(info ? { provider: { label: info.label, isMock: info.isMock, configured: info.configured } } : {}),
    };
  } catch (e) {
    return { ok: false, ...toError(e) };
  }
}
