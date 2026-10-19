/**
 * Ingredient line parser: free text -> Quantity + name + preparation + optional flag.
 *
 * Deterministic, pure, no I/O. Never invents an amount: anything it cannot read becomes
 * `kind: 'unparsed'` with the original text preserved. Imperial mass (oz/lb) and odd metric
 * volumes (cl/dl, quart, gallon) are converted into contract units at parse time; the original
 * wording is always kept in `quantity.originalText`.
 */
import type { Quantity, Unit } from '../contract';
import { roundStored } from '../units/index';

export interface PackSize {
  /** Number of packs/cans (e.g. 2 in "2 x 400g cans"). */
  count: number;
  /** Size of one pack (e.g. 400 g). */
  size: Quantity;
}

export interface ParsedIngredientLine {
  quantity: Quantity;
  /** Ingredient name as written (lower-cased, cleaned) — not yet normalised to a canonical ingredient. */
  name: string;
  preparation?: string;
  optional: boolean;
  /** Present for "2 x 400g can" style lines. */
  pack?: PackSize;
  /** Parenthetical remarks, secondary equivalents ("(7oz)"), "or to taste" etc. */
  notes: string[];
}

interface UnitSpec {
  unit: Unit;
  /** Multiply the written number by this to get the value in `unit`. */
  factor: number;
}

/** Written unit token -> contract unit (+factor for units outside the contract). */
const UNIT_WORDS: ReadonlyArray<[string[], UnitSpec]> = [
  [['milligrams', 'milligram', 'milligrammes', 'milligramme', 'mg'], { unit: 'mg', factor: 1 }],
  [['kilograms', 'kilogram', 'kilogrammes', 'kilogramme', 'kilos', 'kilo', 'kgs', 'kg'], { unit: 'kg', factor: 1 }],
  [['grams', 'gram', 'grammes', 'gramme', 'gms', 'gm', 'gr', 'g'], { unit: 'g', factor: 1 }],
  [['millilitres', 'millilitre', 'milliliters', 'milliliter', 'mls', 'ml'], { unit: 'ml', factor: 1 }],
  [['centilitres', 'centilitre', 'centiliters', 'centiliter', 'cl'], { unit: 'ml', factor: 10 }],
  [['decilitres', 'decilitre', 'deciliters', 'deciliter', 'dl'], { unit: 'ml', factor: 100 }],
  [['litres', 'litre', 'liters', 'liter', 'ltrs', 'ltr', 'lt', 'l'], { unit: 'l', factor: 1 }],
  [['teaspoonfuls', 'teaspoonful', 'teaspoons', 'teaspoon', 'tspns', 'tspn', 'tsps', 'tsp'], { unit: 'tsp', factor: 1 }],
  [['tablespoonfuls', 'tablespoonful', 'tablespoons', 'tablespoon', 'tbspns', 'tbspn', 'tblsp', 'tbsps', 'tbsp', 'tbls', 'tbl', 'tbs'], { unit: 'tbsp', factor: 1 }],
  [['cups', 'cup'], { unit: 'cup', factor: 1 }],
  [['fluid ounces', 'fluid ounce', 'fl. oz', 'fl.oz', 'fl oz', 'floz'], { unit: 'floz', factor: 1 }],
  [['pints', 'pint', 'pts', 'pt'], { unit: 'pint', factor: 1 }],
  [['quarts', 'quart', 'qts', 'qt'], { unit: 'pint', factor: 2 }],
  [['gallons', 'gallon', 'gal'], { unit: 'pint', factor: 8 }],
  [['ounces', 'ounce', 'oz'], { unit: 'g', factor: 28.349523125 }],
  [['pounds', 'pound', 'lbs', 'lb'], { unit: 'g', factor: 453.59237 }],
  [['cloves', 'clove'], { unit: 'clove', factor: 1 }],
  [['slices', 'slice'], { unit: 'slice', factor: 1 }],
  [['cans', 'can', 'tins', 'tin'], { unit: 'can', factor: 1 }],
  [['packets', 'packet', 'packs', 'pack', 'pkts', 'pkt', 'packages', 'package', 'pkg', 'bags', 'bag', 'jars', 'jar', 'bottles', 'bottle', 'cartons', 'carton', 'tubs', 'tub', 'pots', 'pot', 'blocks', 'block'], { unit: 'pack', factor: 1 }],
  [['bunches', 'bunch'], { unit: 'bunch', factor: 1 }],
  [['sprigs', 'sprig'], { unit: 'sprig', factor: 1 }],
  [['sticks', 'stick', 'stalks', 'stalk'], { unit: 'stick', factor: 1 }],
  [['items', 'item', 'pieces', 'piece', 'heads', 'head', 'bulbs', 'bulb', 'whole'], { unit: 'item', factor: 1 }],
];

const CONTAINER_WORDS = new Set([
  'can', 'cans', 'tin', 'tins', 'pack', 'packs', 'packet', 'packets', 'jar', 'jars', 'bag', 'bags',
  'bottle', 'bottles', 'carton', 'cartons', 'tub', 'tubs', 'pot', 'pots', 'block', 'blocks',
]);

const UNIT_LOOKUP = new Map<string, UnitSpec>();
for (const [words, spec] of UNIT_WORDS) for (const w of words) UNIT_LOOKUP.set(w, spec);
const UNIT_ALTERNATION = [...UNIT_LOOKUP.keys()]
  .sort((a, b) => b.length - a.length)
  .map((w) => w.replace(/[.]/g, '\\.').replace(/ /g, '\\s*'))
  .join('|');
/** Unit at cursor; must not run into a following letter ("g" must not match "garlic"). */
const UNIT_RE = new RegExp(`\\s*(${UNIT_ALTERNATION})\\.?(?![a-z])`, 'y');
const LENGTH_RE = /\s*(cm|mm|centimetres?|centimeters?|inch(?:es)?|in\.|")(?![a-z])/y;

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, dozen: 12,
};

const APPROX_WORDS: Record<string, string> = {
  pinch: 'pinch', pinches: 'pinch', handful: 'handful', handfuls: 'handful', dash: 'dash', dashes: 'dash',
  splash: 'splash', splashes: 'splash', drizzle: 'drizzle', drizzles: 'drizzle', sprinkle: 'sprinkle',
  sprinkling: 'sprinkle', knob: 'knob', knobs: 'knob', glug: 'glug', glugs: 'glug', few: 'few', couple: 'couple',
  little: 'little', some: 'some', squeeze: 'squeeze', squeezes: 'squeeze', smidgen: 'smidgen', dollop: 'dollop',
  dollops: 'dollop',
};
const APPROX_RE = new RegExp(
  `\\s*(?:(?:small|large|big|good|generous|healthy|tiny)\\s+)?(${Object.keys(APPROX_WORDS).sort((a, b) => b.length - a.length).join('|')})(?![a-z])(?:\\s+of(?![a-z]))?`,
  'y',
);

const HEDGE_PREFIX_RE = /^(?:about|approx\.?|approximately|around|roughly|circa|c\.|~|up to)\s*/;
const SIZE_ADJ_RE = /\s*(heaped|heaping|rounded|generous|scant|level|small|medium|large|big)\s+/y;

const FRACTION_CHARS: Record<string, string> = {
  '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5',
  '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
};

/** Normalise unicode fractions, dashes and whitespace; lower-case. */
export function normaliseLineText(text: string): string {
  let s = text.toLowerCase();
  s = s.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (ch) => ` ${FRACTION_CHARS[ch]} `);
  s = s.replace(/\u2044/g, '/');
  s = s.replace(/[\u2010-\u2015\u2212]/g, '-');
  s = s.replace(/(\d)\s*\/\s*(\d)/g, '$1/$2');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[-•*·]\s+/, '');
  return s;
}

class Cursor {
  constructor(public s: string, public i = 0) {}
  match(re: RegExp): RegExpExecArray | null {
    re.lastIndex = this.i;
    const m = re.exec(this.s);
    if (m) this.i = re.lastIndex;
    return m;
  }
  rest(): string {
    return this.s.slice(this.i);
  }
}

const NUMBER_RE = /\s*(?:(\d+(?:\.\d+)?)\s+(\d+)\/(\d+)|(\d+)\/(\d+)|(\d*\.\d+|\d+)(?![\d/]))/y;
const WORD_NUMBER_RE = /\s*(half\s+an?|half|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen)(?![a-z])/y;
const DOZEN_RE = /\s*dozen(?![a-z])/y;

/** Read one number (digits, fraction, mixed number or word) at the cursor. */
function readNumber(c: Cursor, allowWords: boolean): number | undefined {
  const m = c.match(NUMBER_RE);
  if (m) {
    let n: number;
    if (m[1] !== undefined) n = Number(m[1]) + Number(m[2]) / Number(m[3]);
    else if (m[4] !== undefined) n = Number(m[4]) / Number(m[5]);
    else n = Number(m[6]);
    if (c.match(DOZEN_RE)) n *= 12;
    return n;
  }
  if (!allowWords) return undefined;
  const w = c.match(WORD_NUMBER_RE);
  if (!w) return undefined;
  const word = w[1]!.replace(/\s+/g, ' ');
  let n = word.startsWith('half') ? 0.5 : WORD_NUMBERS[word]!;
  if (word !== 'dozen' && c.match(DOZEN_RE)) n *= 12;
  return n;
}

function readUnit(c: Cursor): (UnitSpec & { word: string }) | undefined {
  const m = c.match(UNIT_RE);
  if (!m) return undefined;
  const word = m[1]!.replace(/\s+/g, ' ');
  const spec = UNIT_LOOKUP.get(word) ?? UNIT_LOOKUP.get(word.replace(/\s/g, ''))!;
  return { ...spec, word };
}

function isMassOrVolume(u: Unit): boolean {
  return u !== 'item' && !['clove', 'slice', 'can', 'pack', 'bunch', 'sprig', 'stick'].includes(u);
}

const RANGE_SEP_RE = /\s*(?:-|to(?![a-z])|or(?![a-z]))\s*/y;
const MULTIPLY_RE = /\s*[x×*]\s*/y;
const CONTAINER_RE = /\s*([a-z]+)/y;
const PIECE_RE = /\s*(?:-\s*)?pieces?(?![a-z])/y;
const OF_RE = /\s*of(?![a-z])\s*/y;

interface NumericParse {
  min: number;
  max: number;
  unit?: Unit;
  pack?: PackSize;
  hedge?: string;
  approxLabel?: string;
  /** True when an explicit number was written (vs "a pinch"). */
  explicit: boolean;
}

function finite(n: number | undefined): n is number {
  return n !== undefined && Number.isFinite(n);
}

/** Try to read a pack size: "<n><mass/vol unit> [container]". Returns undefined (cursor restored) if absent. */
function readPackSize(c: Cursor, requireContainer: boolean): { size: { value: number; unit: Unit }; container?: Unit } | undefined {
  const start = c.i;
  const n = readNumber(c, false);
  const u = n !== undefined ? readUnit(c) : undefined;
  if (!finite(n) || !u || !isMassOrVolume(u.unit)) {
    c.i = start;
    return undefined;
  }
  const containerStart = c.i;
  const cm = c.match(CONTAINER_RE);
  let container: Unit | undefined;
  if (cm && CONTAINER_WORDS.has(cm[1]!)) {
    container = cm[1]!.startsWith('can') || cm[1]!.startsWith('tin') ? 'can' : 'pack';
  } else {
    c.i = containerStart;
    if (requireContainer) {
      c.i = start;
      return undefined;
    }
  }
  return { size: { value: roundStored(n * u.factor), unit: u.unit }, container };
}

function readNumeric(c: Cursor): NumericParse | undefined {
  const start = c.i;
  const first = readNumber(c, true);
  if (first === undefined) {
    // "a pinch" is caught here only via APPROX handling by the caller; "400g can" handled below.
    c.i = start;
    return undefined;
  }
  const explicitStart = /^\s*\d/.test(c.s.slice(start)) || !/^\s*(a|an)(?![a-z])/.test(c.s.slice(start));

  // Approximate word directly after the count: "a pinch of", "2 pinches", "a small handful".
  const approx = c.match(APPROX_RE);
  if (approx) {
    const res: NumericParse = { min: first, max: first, approxLabel: APPROX_WORDS[approx[1]!], explicit: explicitStart };
    const u = readUnit(c); // "a few sprigs of thyme"
    if (u) res.unit = u.unit;
    return res;
  }

  // "2 x 400g cans" / "2 x 400g".
  const beforeX = c.i;
  if (c.match(MULTIPLY_RE)) {
    const pack = readPackSize(c, false);
    if (pack) {
      return packResult(first, pack);
    }
    c.i = beforeX;
  }
  // "a 400g can" / "2 400g tins".
  const pack = readPackSize(c, true);
  if (pack) return packResult(first, pack);

  // Range: "2-3", "1 to 2", "1kg-1.2kg".
  let unit = readUnitWithAdjectives(c);
  const afterUnit = c.i;
  let max = first;
  if (c.match(RANGE_SEP_RE)) {
    const second = readNumber(c, false);
    if (second !== undefined) {
      const save = c.i;
      const unit2 = readUnitWithAdjectives(c);
      if (unit2 && unit && unit2.unit !== unit.unit) {
        // Mismatched units on each side: too unusual to trust.
        c.i = save;
        return undefined;
      }
      if (!unit && unit2) unit = unit2;
      max = second;
    } else {
      c.i = afterUnit;
    }
  }

  // Length units ("2cm piece of ginger") are never converted: keep as an approximate size.
  if (!unit) {
    const len = c.match(LENGTH_RE);
    if (len) {
      const label = len[1] === '"' || len[1]!.startsWith('in') ? 'inch' : len[1]!.startsWith('c') ? 'cm' : 'mm';
      c.match(PIECE_RE);
      return { min: first, max, approxLabel: label, explicit: true };
    }
  }

  const factor = unit?.factor ?? 1;
  const res: NumericParse = { min: first * factor, max: max * factor, unit: unit?.unit, explicit: true };
  if (unit?.hedge) res.approxLabel = unit.hedge;

  // "400g can of tomatoes": a mass/volume followed by a container word is one pack of that size.
  if (unit && isMassOrVolume(unit.unit) && first === max) {
    const save = c.i;
    const cm = c.match(CONTAINER_RE);
    if (cm && CONTAINER_WORDS.has(cm[1]!)) {
      const container: Unit = cm[1]!.startsWith('can') || cm[1]!.startsWith('tin') ? 'can' : 'pack';
      return packResult(1, { size: { value: roundStored(first * factor), unit: unit.unit }, container });
    }
    c.i = save;
  }
  return res;
}

function packResult(count: number, pack: { size: { value: number; unit: Unit }; container?: Unit }): NumericParse {
  const sizeQ: Quantity = { kind: 'exact', value: pack.size.value, unit: pack.size.unit, originalText: '' };
  if (pack.container) {
    return { min: count, max: count, unit: pack.container, pack: { count, size: sizeQ }, explicit: true };
  }
  const total = roundStored(count * pack.size.value);
  return { min: total, max: total, unit: pack.size.unit, pack: { count, size: sizeQ }, explicit: true };
}

/** Unit possibly preceded by an adjective; "heaped"/"rounded"/"generous" make the amount approximate. */
function readUnitWithAdjectives(c: Cursor): (UnitSpec & { hedge?: string }) | undefined {
  const start = c.i;
  const adj = c.match(SIZE_ADJ_RE);
  const u = readUnit(c);
  if (u) {
    const word = adj?.[1];
    const hedge = word && ['heaped', 'heaping', 'rounded', 'generous', 'scant'].includes(word)
      ? (word === 'heaping' ? 'heaped' : word)
      : undefined;
    return hedge ? { unit: u.unit, factor: u.factor, hedge } : { unit: u.unit, factor: u.factor };
  }
  c.i = start;
  return undefined;
}

const LEADING_PREP_RE = /^((?:very\s+)?(?:finely|roughly|thinly|coarsely|freshly|lightly|thickly|well)\s+(?:chopped|sliced|diced|grated|minced|crushed|ground|shredded|torn|beaten|cubed|julienned))\s+/;
const OPTIONAL_RES: RegExp[] = [
  /^optional\s*[:-]?\s*/,
  /\(\s*optional\s*\)/g,
  /\(\s*if (?:desired|liked|using|you like)\s*\)/g,
  /,?\s*\b(?:optional|if desired|if liked|if using|if you like)\b\s*,?/g,
];
/** "3 garlic cloves", "2 celery sticks": count unit written after the name. */
const TRAILING_COUNT_UNIT_RE = /\s+(cloves?|sprigs?|slices?|sticks?|stalks?)$/;

/**
 * Parse one ingredient line.
 *
 * @example parseIngredientLine('1 ½ tbsp olive oil') // exact 1.5 tbsp, name 'olive oil'
 * @example parseIngredientLine('2 x 400g cans chopped tomatoes') // exact 2 can, pack 400 g
 * @example parseIngredientLine('a pinch of salt') // approximate, approxLabel 'pinch'
 */
export function parseIngredientLine(text: string): ParsedIngredientLine {
  const originalText = text;
  const notes: string[] = [];
  let s = normaliseLineText(text);

  // 1. optional markers
  let optional = false;
  for (const re of OPTIONAL_RES) {
    const next = s.replace(re, ' ');
    if (next !== s) optional = true;
    s = next;
  }
  s = s.replace(/\s+/g, ' ').trim();

  // 2. "2 (400g) cans" -> "2 x 400g cans"
  s = s.replace(/^(\S+)\s*\(\s*([^()]+?)\s*\)\s*(?=(?:cans?|tins?|packs?|packets?|jars?|bags?|bottles?|cartons?|tubs?|pots?|blocks?)(?![a-z]))/, '$1 x $2 ');

  // 3. remaining parentheticals become notes
  s = s.replace(/\(([^()]*)\)/g, (_m, inner: string) => {
    const t = inner.trim();
    if (t) notes.push(t);
    return ' ';
  }).replace(/\s+/g, ' ').trim();

  // 4. "to taste"
  let toTaste = false;
  const tasteRe = /,?\s*\b(?:or\s+|and\s+)?(?:adjust\s+)?to taste\b\s*,?/;
  if (tasteRe.test(s)) {
    toTaste = true;
    s = s.replace(tasteRe, ' ').replace(/\s+/g, ' ').trim();
  }

  // 5. hedges ("about 200g")
  let hedge: string | undefined;
  const hm = HEDGE_PREFIX_RE.exec(s);
  if (hm) {
    hedge = 'about';
    s = s.slice(hm[0].length);
  }

  // 6. quantity at the start of the line
  const c = new Cursor(s);
  let numeric = readNumeric(c);
  let approxOnlyLabel: string | undefined;
  if (!numeric) {
    c.i = 0;
    const am = c.match(APPROX_RE);
    if (am) approxOnlyLabel = APPROX_WORDS[am[1]!];
    else c.i = 0;
  }
  if (numeric || approxOnlyLabel) c.match(OF_RE);
  let rest = c.rest().trim();

  // Trailing quantity ("salt, a pinch" / "flour 200g") is deliberately NOT guessed beyond a trailing approx word.
  if (!numeric && !approxOnlyLabel) {
    const trail = /,\s*(?:a\s+)?(pinch|handful|dash|splash|drizzle|knob|sprinkle)\s*$/.exec(rest);
    if (trail) {
      approxOnlyLabel = APPROX_WORDS[trail[1]!];
      rest = rest.slice(0, trail.index);
    }
  }

  // 7. name / preparation
  rest = rest.replace(/^[,;:\-\s]+/, '');
  let name = rest;
  let preparation: string | undefined;
  const comma = rest.indexOf(',');
  if (comma >= 0) {
    name = rest.slice(0, comma);
    preparation = rest.slice(comma + 1);
  }
  const lead = LEADING_PREP_RE.exec(name);
  if (lead) {
    preparation = preparation ? `${lead[1]}, ${preparation}` : lead[1];
    name = name.slice(lead[0].length);
  }
  name = cleanText(name);
  if (numeric && numeric.unit === undefined && !numeric.approxLabel && !numeric.pack) {
    const tm = TRAILING_COUNT_UNIT_RE.exec(name);
    if (tm) {
      numeric.unit = readUnit(new Cursor(tm[1]!))!.unit;
      name = name.slice(0, tm.index);
    }
  }
  preparation = preparation !== undefined ? cleanText(preparation) || undefined : undefined;

  // 8. assemble quantity
  let quantity: Quantity;
  if (numeric && (!finite(numeric.min) || !finite(numeric.max) || numeric.min < 0 || numeric.max < 0)) {
    numeric = undefined;
  }
  if (numeric && name !== '') {
    const label = numeric.approxLabel ?? hedge;
    let { min, max } = numeric;
    if (min > max) [min, max] = [max, min];
    min = roundStored(min);
    max = roundStored(max);
    if (label) {
      quantity = { kind: 'approximate', approxLabel: label, originalText };
      if (numeric.explicit || label === 'about') {
        if (min === max) quantity.value = min;
        else { quantity.min = min; quantity.max = max; }
      }
      if (numeric.unit) quantity.unit = numeric.unit;
    } else if (min === max) {
      quantity = { kind: 'exact', value: min, originalText };
      if (numeric.unit) quantity.unit = numeric.unit;
    } else {
      quantity = { kind: 'range', min, max, originalText };
      if (numeric.unit) quantity.unit = numeric.unit;
    }
    if (toTaste) notes.push('to taste');
  } else if (approxOnlyLabel && name !== '') {
    quantity = { kind: 'approximate', approxLabel: approxOnlyLabel, originalText };
    if (toTaste) notes.push('to taste');
  } else if (toTaste && name !== '') {
    quantity = { kind: 'to_taste', originalText };
  } else {
    // Keep the cleaned text as the best-effort name, but never an amount.
    quantity = { kind: 'unparsed', originalText };
  }

  const result: ParsedIngredientLine = { quantity, name, optional, notes };
  if (preparation) result.preparation = preparation;
  if (numeric?.pack && quantity.kind === 'exact') {
    result.pack = { count: numeric.pack.count, size: { ...numeric.pack.size, originalText } };
  }
  return result;
}

function cleanText(t: string): string {
  return t.replace(/\s+/g, ' ').replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '').trim();
}
