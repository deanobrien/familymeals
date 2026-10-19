import { z } from 'zod';
import { UnitSchema } from './schemas.js';

/**
 * Pantry scan (photo / video frames -> items in the kitchen). Pure schema, prompt and post-processing:
 * the provider adapters only carry the images (DECISIONS D80, D81).
 */

/** Photos or video frames per scan. The server accepts at most this many; the browser picks 6-10 video frames. */
export const SCAN_MAX_IMAGES = 10;
export const SCAN_MAX_ITEMS = 40;

export const isRealScanDate = (s: string): boolean => {
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d || y < 2000 || y > 2100) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealScanDate, 'not a real calendar date').describe('YYYY-MM-DD');

export const ScanFormSchema = z.enum(['fresh', 'chilled', 'frozen', 'canned', 'dried', 'ambient', 'other']);
export const ScanPackagingSchema = z.enum(['loose', 'pack', 'tin', 'jar', 'bag', 'bottle']);
export type ScanForm = z.infer<typeof ScanFormSchema>;
export type ScanPackaging = z.infer<typeof ScanPackagingSchema>;

export const ScanDatesSchema = z.object({
  /** UK "use by" (safety date, usually chilled meat/fish/dairy). Only when printed and readable. */
  useBy: IsoDay.optional(),
  /** "Best before" / "BBE" (quality date). A different thing from use by. */
  bestBefore: IsoDay.optional(),
  /** True when a date was actually read; false when none is visible or it could not be read. */
  legible: z.boolean(),
  /** A date label is visible on the item but too small / blurred / angled to read: ask for a close-up. */
  needsCloseUp: z.boolean(),
});
export type ScanDates = z.infer<typeof ScanDatesSchema>;

export const PackSizeSchema = z.object({ value: z.number().positive(), unit: UnitSchema });

export const ScannedItemSchema = z.object({
  /** Plain product name, singular generic wording (e.g. "carrot", "tinned chickpeas", "chicken breast"). */
  name: z.string().min(1).max(120),
  form: ScanFormSchema,
  packaging: ScanPackagingSchema,
  /** Loose items: how many individual items. Packaged goods: how many packs / tins / jars / bags / bottles. */
  count: z.number().int().min(1).max(500),
  /** The pack size exactly as printed ("400g", "1 litre", "6 x 125g"); only when legible. */
  packSizeText: z.string().max(60).optional(),
  /** The pack size parsed per pack (not multiplied by count); only when packSizeText is legible. */
  packSize: PackSizeSchema.optional(),
  dates: ScanDatesSchema,
  confidence: z.number().min(0).max(1),
  /** 1-based numbers of the images this item is visible in. */
  frameRefs: z.array(z.number().int().min(1)).min(1).max(SCAN_MAX_IMAGES),
  notes: z.string().max(200).optional(),
});
export type ScannedItem = z.infer<typeof ScannedItemSchema>;

export const PantryScanSchema = z.object({
  items: z.array(ScannedItemSchema).max(SCAN_MAX_ITEMS),
  warnings: z.array(z.string()).default([]),
});
export type PantryScan = z.infer<typeof PantryScanSchema>;

/** The ONLY context a scan gets: no household, member or purchase data (D80). */
export interface PantryScanContext {
  /** Canonical ingredient names, as a naming hint only. The model may name items outside the list. */
  ingredientNames?: string[];
  /** Today (YYYY-MM-DD) so printed dates without a year ("21 OCT") resolve sensibly. */
  today?: string;
  /** A close-up photo of this one item: read its dates / pack size and report only that item. */
  focusItem?: string;
}

export const SCAN_SYSTEM = `You list the food and drink items visible in photographs (or video frames) of a UK kitchen, fridge, cupboard or shopping. Be faithful to the images: report only what you can actually see, never invent items, sizes or dates.

COUNTING
- The images may be several frames of the SAME scene from different angles. Treat them as one scene: an item visible in more than one frame is ONE item, not several. Never add counts across frames. If frames disagree on a count, report the highest count you can clearly verify in a single frame and lower the confidence.
- Count individual loose items (5 carrots, 3 lemons) with packaging "loose". For packaged goods count packs: 2 tins of chickpeas is count 2, packaging "tin". A multipack counts as the number of multipacks unless the individual packs are clearly separate.
- If you cannot tell how many, give your best count, lower the confidence and say so in notes. Do not list the same product twice.

NAMING
- Use a short generic product name in singular, lower case ("carrot", "chicken breast", "tinned chickpeas", "natural yoghurt"), not a brand. Set form: fresh, chilled, frozen, canned, dried, ambient (shelf-stable packaged goods) or other. When a list of known ingredient names is supplied, prefer a name from it when it is clearly the same product; otherwise use your own plain name.

DATES (UK)
- "Use by" is a safety date. "Best before" (or "BBE") is a quality date. They are DIFFERENT: put each in its own field and never copy one into the other.
- Only report a date that is printed AND readable, converted to YYYY-MM-DD. If the day and month are printed without a year, use the nearest future occurrence relative to today.
- NEVER invent, estimate or infer a date. If you cannot read it, omit both dates, set dates.legible to false, and if a date label IS visible but unreadable (too small, blurred, glare, angle, curved) set dates.needsCloseUp to true so the user can take a close-up. If there is simply no date label in view, legible false and needsCloseUp false.
- Dates read from distant frames are often wrong: when unsure, prefer needsCloseUp over guessing.

PACK SIZE
- If the pack size is printed and readable ("400g", "1L", "6 x 125g"), copy it exactly into packSizeText and give the per-pack amount in packSize (value + unit). For "6 x 125g" packSize is 125 g only if the six are separate packs you counted; otherwise give the total 750 g and count 1. Omit both if not legible.

OTHER
- frameRefs lists the 1-based image numbers where the item is visible. confidence (0..1) is your confidence that the name AND count are right.
- Ignore non-food items, people and pets. Add warnings for blurred frames, duplicates you merged, or anything the user should recheck. Reply only by calling the provided tool.`;

export function scanPantryPrompt(imageCount: number, ctx: PantryScanContext = {}): string {
  const lines: string[] = [];
  if (ctx.focusItem?.trim()) {
    lines.push(
      `This is a CLOSE-UP photo of one item: "${ctx.focusItem.trim().slice(0, 80)}". Report ONLY that item (count 1 unless several identical packs are in view). Read its use by / best before date and pack size carefully; follow the date rules exactly and never guess.`,
    );
  } else {
    lines.push(
      imageCount > 1
        ? `There are ${imageCount} images, numbered 1..${imageCount} in the order given. They may show the same scene from different angles: de-duplicate across them and never double count.`
        : 'There is 1 image. List every food or drink item you can see.',
    );
  }
  if (ctx.today) lines.push(`Today is ${ctx.today}.`);
  const names = (ctx.ingredientNames ?? []).map((n) => n.trim()).filter(Boolean).slice(0, 600);
  if (names.length) lines.push(`Known ingredient names (naming hint only): ${names.join(', ')}`);
  return lines.join('\n');
}

/**
 * Enforce in code what the prompt asks (D81), so a sloppy model answer cannot put an unreadable or
 * invented date into the pantry: dates are dropped whenever the item is flagged unreadable / needs a
 * close-up; `needsCloseUp` is never kept together with a date; frame references are clamped to the
 * images actually sent; whitespace is trimmed; items with an empty name are dropped.
 */
export function normaliseScan(scan: PantryScan, imageCount: number): PantryScan {
  const items: ScannedItem[] = [];
  for (const it of scan.items) {
    const name = it.name.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const frameRefs = [...new Set(it.frameRefs.filter((n) => Number.isInteger(n) && n >= 1 && n <= imageCount))].sort((a, b) => a - b);
    let useBy = it.dates.useBy && isRealScanDate(it.dates.useBy) ? it.dates.useBy : undefined;
    let bestBefore = it.dates.bestBefore && isRealScanDate(it.dates.bestBefore) ? it.dates.bestBefore : undefined;
    if (it.dates.needsCloseUp || !it.dates.legible) { useBy = undefined; bestBefore = undefined; }
    const hasDate = useBy !== undefined || bestBefore !== undefined;
    const dates: ScannedItem['dates'] = {
      legible: hasDate,
      needsCloseUp: hasDate ? false : it.dates.needsCloseUp,
      ...(useBy ? { useBy } : {}),
      ...(bestBefore ? { bestBefore } : {}),
    };
    const sizeText = it.packSizeText?.trim();
    const out: ScannedItem = {
      name, form: it.form, packaging: it.packaging, count: it.count, dates,
      confidence: it.confidence, frameRefs: frameRefs.length ? frameRefs : [1],
    };
    if (sizeText) {
      out.packSizeText = sizeText;
      if (it.packSize) out.packSize = it.packSize;
    }
    const notes = it.notes?.trim();
    if (notes) out.notes = notes;
    items.push(out);
  }
  return { items, warnings: scan.warnings };
}
