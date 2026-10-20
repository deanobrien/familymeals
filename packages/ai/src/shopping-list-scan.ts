import { z } from 'zod';
import { QuantitySchema } from './schemas.js';

/**
 * Handwritten shopping list scan (photos of a paper list -> reviewable lines). Pure schema, prompt and
 * post-processing: the provider adapters only carry the images (DECISIONS D260-D262). Same shape as the pantry
 * scan (D80/D81): the model reads, code sanitises, nothing is written until the owner confirms.
 */

/** Photos per list. A handwritten list is one or two pages; four covers a page front/back plus a margin close-up. */
export const SHOPPING_SCAN_MAX_IMAGES = 4;
export const SHOPPING_SCAN_MAX_LINES = 120;

export const ShoppingListLineSchema = z.object({
  /** The line exactly as written, transcribed letter for letter (abbreviations, spelling and all). Empty only when illegible. */
  originalText: z.string().max(300),
  /** Plain generic item name, singular, lower case, abbreviations expanded ("spuds" -> "potatoes"). Empty only when illegible. */
  name: z.string().max(120),
  /** The amount WRITTEN on the line. Absent when none is written ("eggs"): never a guess. */
  quantity: QuantitySchema.optional(),
  /** Qualifiers and remarks that are not the item name: "semi-skimmed", "if on offer", "for Sam". */
  notes: z.string().max(200).optional(),
  /** The line is struck through / scribbled out / ticked off as already bought. */
  crossedOut: z.boolean(),
  /** The writing could not be read with reasonable confidence. */
  illegible: z.boolean(),
  /** Confidence (0..1) that the name AND quantity are right. */
  confidence: z.number().min(0).max(1),
  /** 1-based number of the image the line is on. */
  imageRef: z.number().int().min(1).max(99).default(1),
});
export type ShoppingListLine = z.infer<typeof ShoppingListLineSchema>;

export const ShoppingListScanSchema = z.object({
  lines: z.array(ShoppingListLineSchema).max(SHOPPING_SCAN_MAX_LINES),
  /** A title or heading on the list ("Tesco Saturday"), when there is one. Not an item. */
  title: z.string().max(120).optional(),
  warnings: z.array(z.string()).default([]),
});
export type ShoppingListScan = z.infer<typeof ShoppingListScanSchema>;

/** The ONLY context a list scan gets: canonical names as a hint. No household, member, pantry or purchase data (D260). */
export interface ShoppingListScanContext {
  /** Canonical ingredient names, as a naming hint only. The model may name items outside the list. */
  ingredientNames?: string[];
}

const UNITS = 'mg,g,kg,ml,l,tsp,tbsp,cup,floz,pint,item,clove,slice,can,pack,bunch,sprig,stick';

export const SHOPPING_LIST_SYSTEM = `You transcribe a HANDWRITTEN UK shopping list from photographs and turn each line into a structured item. Be faithful to the page: report only what is written, never invent items, brands, amounts or notes.

READING THE PAGE
- Handwriting varies: cursive, capitals, hurried scrawl, biro or pencil, a list on the back of an envelope or a notepad. Read every line. The list may have several columns, be split over two pages, have items squeezed in sideways in a margin or added at the bottom with an arrow. Treat the images as pages of ONE list, in the order given; a page may be rotated, read it upright.
- One written line is one item, unless a line clearly lists several items ("eggs, milk, bread" on one line is three items: give each its own line and put the same transcription in originalText). Bullets, dashes, boxes, numbers and ticks-in-boxes are decoration, not part of the name.
- A heading or title ("Weekend shop", "ASDA", "Lidl") is not an item: put it in title.

TRANSCRIPTION AND NAMING
- originalText is the line EXACTLY as written, letter for letter, including abbreviations and spelling mistakes ("2 x toms (tins)", "1kg spuds", "OJ", "choc biscs").
- name is a short plain generic item name in singular, lower case, abbreviations expanded the way a UK shopper means them: tins/tin of X -> "tinned X", toms -> "tomatoes", spuds -> "potatoes", OJ -> "orange juice", veg oil -> "vegetable oil", loo roll -> "toilet roll". Qualifiers such as "semi-skimmed" are NOT part of the name (they go in notes). No brands unless the writer only gave a brand ("Heinz beans" -> "baked beans" with the brand in notes). When a list of known ingredient names is supplied, prefer a name from it when it is clearly the same thing; otherwise use your own plain name.
- If you cannot tell what a word says, do NOT guess a plausible item: set illegible true, give your best reading of the letters in originalText (or an empty string), leave name empty if you have no idea, and lower the confidence. A wrong confident guess is worse than a flagged one.

QUANTITIES
- quantity is ONLY what is written. "2 x milk", "milk x2", "2 milk" -> exact 2 unit item. "1kg spuds" -> exact 1 unit kg. "500g flour" -> exact 500 g. "3 tins of tomatoes" -> exact 3 unit can. "2 pints milk" -> exact 2 unit pint. "a bag of carrots" -> exact 1 unit pack. "dozen eggs" -> exact 12 unit item. "some butter" or "lots of onions" -> kind approximate with approxLabel. A range "2-3 lemons" is a range with min and max. Allowed units: ${UNITS}. If the writer used a unit that is not in the list, use pack or item when that is what is counted, otherwise set kind unparsed and keep the written text in originalText.
- If NO amount is written ("eggs", "bread") OMIT quantity entirely. Never infer 1, never invent a pack size, never convert units.
- A size written with the item ("2 litre milk", "400g tin chopped tomatoes") is read as written: "2 litre milk" is exact 2 unit l.

NOTES, CROSSED OUT AND UNCLEAR LINES
- notes holds qualifiers that are not the item: "semi-skimmed", "if on offer", "the unsmoked kind", "for Sam's lunch", "brown not white". Omit when there are none.
- crossedOut is true when the line has a line through it, is scribbled out, or is clearly marked as already done (ticked off, "got it"). Still transcribe it, and flag it, so the owner can decide: never drop it silently and never un-flag it.
- imageRef is the 1-based number of the image the line is on. confidence (0..1) is your confidence that the name AND quantity are right.

OTHER
- Do not add items that are not on the page (no suggestions, no staples, no "you might also need"). Ignore anything that is not a list line (doodles, phone numbers, dates, prices, totals). Add warnings for rotated or blurred pages, cut-off lines, or anything the owner should recheck. Reply only by calling the provided tool.`;

export function scanShoppingListPrompt(imageCount: number, ctx: ShoppingListScanContext = {}): string {
  const lines: string[] = [];
  lines.push(
    imageCount > 1
      ? `There are ${imageCount} images, numbered 1..${imageCount} in the order given. They are pages or sections of ONE handwritten list: transcribe every line from every image, in reading order.`
      : 'There is 1 image of a handwritten shopping list. Transcribe every line.',
  );
  const names = (ctx.ingredientNames ?? []).map((n) => n.trim()).filter(Boolean).slice(0, 600);
  if (names.length) lines.push(`Known ingredient names (naming hint only): ${names.join(', ')}`);
  return lines.join('\n');
}

/**
 * Enforce in code what the prompt asks (D261), so a sloppy model answer cannot invent an amount or a confident
 * reading of unreadable writing: whitespace is trimmed; a line with no name is flagged illegible; an exact
 * quantity without a positive value, or an `unparsed` / empty quantity, is dropped (never defaulted); illegible
 * lines are capped at low confidence; image references are clamped to the images sent; fully empty lines go.
 */
export function normaliseShoppingListScan(scan: ShoppingListScan, imageCount: number): ShoppingListScan {
  const lines: ShoppingListLine[] = [];
  for (const l of scan.lines) {
    const originalText = l.originalText.trim().replace(/\s+/g, ' ');
    const name = l.name.trim().replace(/\s+/g, ' ');
    if (!originalText && !name && !l.illegible) continue;
    const illegible = l.illegible || !name;
    const imageRef = Number.isInteger(l.imageRef) && l.imageRef >= 1 && l.imageRef <= imageCount ? l.imageRef : 1;
    let quantity = l.quantity;
    if (quantity) {
      const badExact = quantity.kind === 'exact' && !(typeof quantity.value === 'number' && quantity.value > 0);
      if (quantity.kind === 'unparsed' || quantity.kind === 'to_taste' || badExact || !quantity.originalText.trim()) quantity = undefined;
    }
    const notes = l.notes?.trim();
    const out: ShoppingListLine = {
      originalText: originalText || name, name, crossedOut: l.crossedOut, illegible,
      confidence: illegible ? Math.min(l.confidence, 0.4) : l.confidence, imageRef,
    };
    if (quantity && !illegible) out.quantity = quantity;
    if (notes) out.notes = notes;
    lines.push(out);
  }
  const title = scan.title?.trim();
  return { lines, ...(title ? { title } : {}), warnings: scan.warnings };
}
