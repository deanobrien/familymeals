/**
 * Voice add (P2-A, D395): a spoken sentence -> shopping items. Pure.
 *
 * "add milk, two tins of tomatoes and eggs" -> milk, 2 x tins of tomatoes, eggs. Speech-to-text happens on the device
 * (Web Speech API / Android recogniser); this module only reads the TEXT, with the same line parser the recipe and
 * handwritten-list paths use (quantities, units, number words), so a spoken "half a kilo of carrots" and a typed one agree.
 * Nothing is added from here: the caller shows the result as review chips first.
 */
import { parseIngredientLine } from '../parse/index';

/** The units the shopping list accepts (same as the handwritten-list review; `item` = a count with no unit). */
export const SPOKEN_UNITS = ['item', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'pint', 'can', 'pack', 'bunch', 'clove', 'slice', 'sprig', 'stick'] as const;
const UNIT_SET = new Set<string>(SPOKEN_UNITS);

export const MAX_SPOKEN_ITEMS = 30;

export interface SpokenItem {
  /** Stable within one parse: "v1", "v2", ... */
  key: string;
  /** The words this item was read from (shown on the chip so a mis-hearing is easy to spot). */
  text: string;
  /** Name as spoken, first letter capitalised ("Tins of tomatoes" never; "Tomatoes"). */
  name: string;
  value?: number;
  unit?: string;
  notes?: string;
}

/** Phrases that are one item although they contain "and". */
const KEEP_TOGETHER = [
  'fish and chips', 'salt and pepper', 'salt and vinegar', 'mac and cheese', 'macaroni and cheese', 'bread and butter',
  'sausage and mash', 'half and half', 'ham and cheese', 'cheese and onion', 'sweet and sour', 'surf and turf', 'pie and mash',
  'bangers and mash', 'rice and peas', 'beans and sausages', 'tea and coffee',
];

const LEAD_INS = [
  /^(?:ok(?:ay)?|hey|right|so|um+|uh+|er+)[,\s]+/,
  /^(?:can|could|will|would) you (?:please )?(?:add|put|get|buy)\s+/,
  /^(?:please\s+)?(?:add|put|get|buy|pick up|grab|order)\s+/,
  /^(?:i|we) (?:need|want|have to get|must get|am out of|are out of|ran out of|'ve run out of|have run out of)\s+/,
  /^(?:we(?:'re| are)|i(?:'m| am)) (?:out of|low on|running low on)\s+/,
  /^(?:also|and then|then|and)\s+/,
];
const TRAIL_OUTS = [/\s+(?:to|on|onto|in|into)\s+(?:the|my|our)\s+(?:shopping\s+)?list$/, /\s+to (?:the )?list$/, /[,\s]+please$/, /[.!?]+$/];

const STOP_WORDS = new Set(['please', 'thanks', 'thank you', 'ok', 'okay', 'um', 'uh', 'that is all', "that's all", "that's it", 'that is it']);

const FILLER_PREFIX = /^(?:some|a few|the|any|more|another)\s+/;

const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** The sentence cut into one text per item. */
export function splitSpokenList(transcript: string): string[] {
  let t = String(transcript ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
  for (let i = 0; i < 3; i++) {
    const before = t;
    for (const re of LEAD_INS) t = t.replace(re, '');
    for (const re of TRAIL_OUTS) t = t.replace(re, '');
    t = t.trim();
    if (t === before) break;
  }
  // protect "fish and chips"-style phrases from the "and" split
  const parts = KEEP_TOGETHER.map((p, i) => ({ p, token: `\u0001${i}\u0001` }));
  for (const { p, token } of parts) t = t.split(p).join(token.replace(/ /g, '\u0002'));
  const pieces = t
    .split(/\s*(?:[,;\n]|\band then\b|\band also\b|\bplus\b|&|\band\b|\bthen\b|\balso\b)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return pieces.map((s) => {
    let out = s;
    for (const { p, token } of parts) out = out.split(token.replace(/ /g, '\u0002')).join(p);
    return out.replace(FILLER_PREFIX, '').replace(/^(?:and|then)\s+/, '').trim();
  }).filter((s) => s && !STOP_WORDS.has(s));
}

const fmt = (n: number): string => String(Math.round(n * 1000) / 1000);

function itemFromText(text: string, key: string): SpokenItem | null {
  const line = parseIngredientLine(text);
  let name = line.name.replace(/\s+/g, ' ').trim().replace(FILLER_PREFIX, '');
  if (!name || /^\d+$/.test(name)) return null;
  const notes: string[] = [];
  const q = line.quantity;
  let value: number | undefined;
  let unit: string | undefined;
  if (q.kind === 'exact' && q.value !== undefined) {
    if (UNIT_SET.has(q.unit ?? 'item')) {
      value = q.value;
      unit = q.unit ?? 'item';
    } else {
      notes.push(`${fmt(q.value)} ${q.unit ?? ''}`); // "a cup of rice": not a list unit; keep the words, add one
      value = 1;
      unit = 'item';
    }
    if (line.pack && line.pack.size.kind === 'exact' && line.pack.size.value !== undefined) notes.push(`${fmt(line.pack.size.value)} ${line.pack.size.unit ?? ''} each`.replace(/\s+/g, ' '));
  } else if (q.kind === 'range' && q.max !== undefined && q.min !== undefined) {
    if (UNIT_SET.has(q.unit ?? 'item')) {
      value = q.max;
      unit = q.unit ?? 'item';
      notes.push(`said ${fmt(q.min)} to ${fmt(q.max)}`);
    }
  } else if (q.kind === 'approximate' && q.approxLabel) {
    notes.push(q.approxLabel);
  }
  if (value !== undefined && (!(value > 0) || value > 100_000)) {
    value = undefined;
    unit = undefined;
  }
  name = name.replace(/^of\s+/, '');
  const clean = notes.filter(Boolean).join(', ');
  return { key, text, name: cap(name), ...(value !== undefined ? { value, unit: unit ?? 'item' } : {}), ...(clean ? { notes: clean } : {}) };
}

/** The sentence -> items (at most MAX_SPOKEN_ITEMS). Empty when nothing could be read. */
export function parseSpokenList(transcript: string): SpokenItem[] {
  const out: SpokenItem[] = [];
  for (const piece of splitSpokenList(transcript)) {
    if (out.length >= MAX_SPOKEN_ITEMS) break;
    const item = itemFromText(piece, `v${out.length + 1}`);
    if (item) out.push(item);
  }
  return out;
}
