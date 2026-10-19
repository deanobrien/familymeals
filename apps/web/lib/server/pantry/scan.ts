import { SCAN_MAX_IMAGES, type AiProvider, type PantryScan, type ScannedItem } from '@fr/ai';
import { describeActiveProvider, getAiProvider } from '../ai/provider';
import { toError, type PipelineError } from '../import/pipeline';
import { getIngredientCatalogue, type IngredientCatalogue } from '../refdata/catalogue';
import type { IngredientRef, ScanApiOk, ScanForm, ScanMatch, ScanRowDto } from '../../pantry/scan-types';

export interface ScanDeps {
  provider?: AiProvider;
  catalogue?: IngredientCatalogue;
  /** YYYY-MM-DD; injected by tests. */
  today?: () => string;
}

export interface ScanInput {
  images: Uint8Array[];
  /** A close-up of this one item (re-scan to read its dates). */
  focus?: string;
}

export type ScanOutcome = ({ ok: true } & ScanApiOk) | { ok: false; status: number; error: PipelineError };

const FORM_WORD: Partial<Record<ScanForm, string>> = { frozen: 'frozen', canned: 'tinned', dried: 'dried' };
const todayUtc = (): string => new Date().toISOString().slice(0, 10);

function ref(cat: IngredientCatalogue, id: string): IngredientRef | undefined {
  const i = cat.get(id);
  return i ? { id: i.id, name: i.name, category: i.category } : undefined;
}

/**
 * Match a scanned product name to the canonical catalogue with the engine's conservative matcher (exact name /
 * alias only, never fuzzy). If the bare name fails but the model said the item is frozen / tinned / dried, one more
 * try is made with that form word in front ("chickpeas" + canned -> "tinned chickpeas"). Ambiguous names return
 * their candidates for the owner to choose; misses return near-miss suggestions only (never auto-applied).
 */
export function matchScannedName(cat: IngredientCatalogue, name: string, form: ScanForm): ScanMatch {
  const tries = [name];
  const fw = FORM_WORD[form];
  if (fw && !new RegExp(`\\b(${fw}|frozen|tinned|canned|dried)\\b`, 'i').test(name)) tries.push(`${fw} ${name}`);
  let ambiguous: IngredientRef[] = [];
  let suggestions: IngredientRef[] = [];
  for (const t of tries) {
    const r = cat.matcher.match(t);
    if (r.status === 'matched' && r.ingredientId) {
      const hit = ref(cat, r.ingredientId);
      if (hit) return { status: 'matched', ingredient: hit };
    }
    if (r.status === 'ambiguous' && !ambiguous.length) ambiguous = r.candidates.map((id) => ref(cat, id)).filter((x): x is IngredientRef => !!x);
    if (!suggestions.length) suggestions = r.suggestions.map((id) => ref(cat, id)).filter((x): x is IngredientRef => !!x);
  }
  if (ambiguous.length) return { status: 'ambiguous', candidates: ambiguous.slice(0, 8) };
  return { status: 'unmatched', suggestions: suggestions.slice(0, 5) };
}

export function toScanRows(scan: PantryScan, cat: IngredientCatalogue, keyPrefix = 's'): ScanRowDto[] {
  return scan.items.map((it: ScannedItem, i) => ({
    key: `${keyPrefix}${i + 1}`,
    name: it.name,
    form: it.form,
    packaging: it.packaging,
    count: it.count,
    ...(it.packSizeText ? { packSizeText: it.packSizeText } : {}),
    ...(it.packSize ? { packSize: { value: it.packSize.value, unit: it.packSize.unit } } : {}),
    ...(it.dates.useBy ? { useBy: it.dates.useBy } : {}),
    ...(it.dates.bestBefore ? { bestBefore: it.dates.bestBefore } : {}),
    datesLegible: it.dates.legible,
    needsCloseUp: it.dates.needsCloseUp,
    confidence: it.confidence,
    frameRefs: it.frameRefs,
    ...(it.notes ? { notes: it.notes } : {}),
    match: matchScannedName(cat, it.name, it.form),
  }));
}

/**
 * Photos / video frames in, reviewable rows out. Reads only: NOTHING is written to the pantry here (D84).
 * The AI context is the canonical ingredient names plus today's date; no household data (D80).
 */
export async function runPantryScan(input: ScanInput, deps: ScanDeps = {}): Promise<ScanOutcome> {
  const { images } = input;
  const focus = input.focus?.trim().slice(0, 80) || undefined;
  if (images.length === 0) {
    return { ok: false, status: 400, error: { code: 'NO_IMAGES', message: 'Add at least one photo or a short video.', retryable: false } };
  }
  if (images.length > SCAN_MAX_IMAGES) {
    return { ok: false, status: 400, error: { code: 'TOO_MANY_IMAGES', message: `You can scan up to ${SCAN_MAX_IMAGES} photos or frames at a time.`, retryable: false } };
  }
  if (focus && images.length !== 1) {
    return { ok: false, status: 400, error: { code: 'BAD_REQUEST', message: 'A close-up is a single photo.', retryable: false } };
  }
  const cat = deps.catalogue ?? getIngredientCatalogue();
  const today = (deps.today ?? todayUtc)();
  try {
    const provider = deps.provider ?? getAiProvider();
    const info = deps.provider ? undefined : describeActiveProvider();
    const scan = await provider.scanPantry(images, {
      today,
      ...(focus ? { focusItem: focus } : { ingredientNames: cat.all.map((i) => i.name) }),
    });
    return {
      ok: true,
      rows: toScanRows(scan, cat, focus ? 'c' : 's'),
      warnings: scan.warnings,
      ...(info ? { provider: { label: info.label, isMock: info.isMock, configured: info.configured } } : {}),
    };
  } catch (e) {
    return { ok: false, ...toError(e) };
  }
}
