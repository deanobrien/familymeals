/**
 * TEMPORARY ingredient parser + matcher adapter.
 * TODO(@fr/engine): replace with `@fr/engine/parse` (parseIngredientLine) and `@fr/engine/normalise`
 * (matchIngredient) once the engine is merged. Keep the IngredientParser / IngredientMatcher shape.
 */
import type { IngredientMatcher, IngredientParser, ParsedIngredientLine, Quantity } from '@fr/recipe-import';

type Unit = NonNullable<Quantity['unit']>;

const UNIT_WORDS: Record<string, Unit> = {
  mg: 'mg', g: 'g', gram: 'g', grams: 'g', kg: 'kg', kilo: 'kg', kilos: 'kg',
  ml: 'ml', millilitre: 'ml', millilitres: 'ml', l: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup', floz: 'floz', pint: 'pint', pints: 'pint',
  clove: 'clove', cloves: 'clove', slice: 'slice', slices: 'slice', can: 'can', cans: 'can', tin: 'can', tins: 'can',
  pack: 'pack', packs: 'pack', packet: 'pack', packets: 'pack', bunch: 'bunch', bunches: 'bunch',
  sprig: 'sprig', sprigs: 'sprig', stick: 'stick', sticks: 'stick',
};
const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

function parseNumber(s: string): number | undefined {
  const t = s.trim();
  if (FRACTIONS[t] !== undefined) return FRACTIONS[t];
  let m = /^(\d+)\s*([½¼¾⅓⅔])$/.exec(t);
  if (m) return Number(m[1]) + FRACTIONS[m[2]!]!;
  m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = /^(\d+)\/(\d+)$/.exec(t);
  if (m) return Number(m[1]) / Number(m[2]);
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : undefined;
}

const NUM = String.raw`(\d+\s+\d+\/\d+|\d+\s*[½¼¾⅓⅔]|[½¼¾⅓⅔]|\d+\/\d+|\d+(?:\.\d+)?)`;
const RANGE_RE = new RegExp(String.raw`^${NUM}\s*(?:-|–|to)\s*${NUM}\s*([a-zA-Z]+)?\s*(.*)$`, 'i');
const EXACT_RE = new RegExp(String.raw`^${NUM}\s*([a-zA-Z]+)?\s*(.*)$`, 'i');

/** Split "onion, finely chopped" into name + preparation; strip "(optional)" and leading "of". */
function splitName(rest: string): { name: string; preparation?: string } {
  const cleaned = rest.replace(/^of\s+/i, '').trim();
  const idx = cleaned.indexOf(',');
  if (idx < 0) return { name: cleaned };
  const name = cleaned.slice(0, idx).trim();
  const preparation = cleaned.slice(idx + 1).trim();
  return preparation ? { name, preparation } : { name };
}

export const ingredientParser: IngredientParser = {
  parse(text: string): ParsedIngredientLine {
    const optional = /\(?\boptional\b\)?/i.test(text);
    const t = text.replace(/\(\s*optional\s*\)/i, '').replace(/\boptional\b/i, '').replace(/\s+/g, ' ').trim();

    let m = /^(?:a |an |some )?(pinch|handful|dash|splash|knob|drizzle)(?: of)?\s+(.+)$/i.exec(t);
    if (m) {
      const label = m[1]!.toLowerCase();
      return { quantity: { kind: 'approximate', approxLabel: label, originalText: `a ${label}` }, ...splitName(m[2]!), optional };
    }
    m = /^(.+?)\s+to taste$/i.exec(t);
    if (m) return { quantity: { kind: 'to_taste', originalText: 'to taste' }, ...splitName(m[1]!), optional };

    m = RANGE_RE.exec(t);
    if (m) {
      const min = parseNumber(m[1]!);
      const max = parseNumber(m[2]!);
      const unitWord = m[3]?.toLowerCase();
      const unit = unitWord ? UNIT_WORDS[unitWord] : undefined;
      if (min !== undefined && max !== undefined && min <= max) {
        const rest = unit || !unitWord ? m[4]! : `${m[3]!} ${m[4]!}`;
        const q: Quantity = { kind: 'range', min, max, originalText: `${m[1]}-${m[2]}${unitWord ? ' ' + unitWord : ''}` };
        q.unit = unit ?? 'item';
        return { quantity: q, ...splitName(rest), optional };
      }
    }
    m = EXACT_RE.exec(t);
    if (m) {
      const value = parseNumber(m[1]!);
      if (value !== undefined) {
        const unitWord = m[2]?.toLowerCase();
        const unit = unitWord ? UNIT_WORDS[unitWord] : undefined;
        const rest = unit || !unitWord ? m[3]! : `${m[2]!} ${m[3]!}`;
        const q: Quantity = { kind: 'exact', value, unit: unit ?? 'item', originalText: `${m[1]}${unitWord && unit ? ' ' + unitWord : ''}`.trim() };
        const parts = splitName(rest);
        if (parts.name) return { quantity: q, ...parts, optional };
      }
    }
    return { quantity: { kind: 'unparsed', originalText: text }, ...splitName(t), optional };
  },
};

// Small stand-in catalogue; @fr/engine/normalise + @fr/refdata replace this.
const CATALOGUE = [
  'red lentils', 'lentils', 'onion', 'garlic', 'vegetable stock', 'chicken stock', 'beef stock', 'salt', 'black pepper',
  'lemon juice', 'lemon', 'olive oil', 'vegetable oil', 'butter', 'milk', 'egg', 'plain flour', 'self raising flour',
  'sugar', 'caster sugar', 'tomato', 'chopped tomatoes', 'tomato puree', 'pasta', 'spaghetti', 'rice', 'potato', 'carrot',
  'celery', 'beef', 'chicken', 'cheddar', 'parmesan', 'cream', 'chickpeas', 'porridge oats', 'basil', 'parsley', 'thyme',
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const singular = (s: string) => s.replace(/(oes|ies)$/, (x) => (x === 'oes' ? 'o' : 'y')).replace(/s$/, '');

export const ingredientMatcher: IngredientMatcher = {
  match(name: string) {
    const n = norm(name);
    const id = (c: string) => `ing:${c.replace(/ /g, '-')}`;
    const exact = CATALOGUE.find((c) => norm(c) === n || singular(norm(c)) === singular(n));
    if (exact) return { ingredientId: id(exact), confidence: 0.95, alternatives: [] };
    const partial = CATALOGUE.filter((c) => n.includes(norm(c)) && norm(c).length > 2).sort((a, b) => b.length - a.length);
    if (partial.length) {
      return {
        ingredientId: id(partial[0]!), confidence: 0.65,
        alternatives: partial.slice(1, 4).map((c) => ({ ingredientId: id(c), name: c, confidence: 0.5 })),
      };
    }
    return { confidence: 0, alternatives: [] };
  },
};
