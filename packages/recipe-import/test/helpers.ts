import type { IngredientMatcher, IngredientParser, ParsedIngredientLine } from '../src/index.js';
import type { Quantity, Unit } from '../src/extraction.js';

const UNITS: Record<string, Unit> = { g: 'g', kg: 'kg', ml: 'ml', l: 'l', litre: 'l', litres: 'l', tsp: 'tsp', tbsp: 'tbsp', clove: 'clove', cloves: 'clove' };

/** Tiny deterministic stand-in for @fr/engine parse. */
export const testParser: IngredientParser = {
  parse(text: string): ParsedIngredientLine {
    const optional = /\(optional\)/i.test(text);
    const t = text.replace(/\(optional\)/i, '').trim();
    let m = /^(a )?(pinch|handful|dash) of (.+)$/i.exec(t);
    if (m) return { quantity: { kind: 'approximate', approxLabel: m[2]!.toLowerCase(), originalText: `a ${m[2]}` }, name: m[3]!, optional };
    m = /^(.+?) to taste$/i.exec(t);
    if (m) return { quantity: { kind: 'to_taste', originalText: 'to taste' }, name: m[1]!, optional };
    m = /^(\d+(?:\.\d+)?)\s*(g|kg|ml|l|litres?|tsp|tbsp|cloves?)?\s+(.+?)(?:,\s*(.+))?$/i.exec(t);
    if (m) {
      const unit = m[2] ? UNITS[m[2].toLowerCase()] : 'item';
      const q: Quantity = { kind: 'exact', value: Number(m[1]), originalText: `${m[1]}${m[2] ?? ''}` };
      if (unit) q.unit = unit;
      const r: ParsedIngredientLine = { quantity: q, name: m[3]!, optional };
      if (m[4]) r.preparation = m[4];
      return r;
    }
    return { quantity: { kind: 'unparsed', originalText: text }, name: t, optional };
  },
};

const CATALOGUE: Record<string, string> = {
  'red lentils': 'id-lentils', onion: 'id-onion', garlic: 'id-garlic', 'vegetable stock': 'id-stock', salt: 'id-salt', 'lemon juice': 'id-lemon',
};
export const testMatcher: IngredientMatcher = {
  match(name: string) {
    const id = CATALOGUE[name.toLowerCase()];
    return id
      ? { ingredientId: id, confidence: 0.95, alternatives: [] }
      : { confidence: 0, alternatives: [{ ingredientId: 'id-x', name: 'something', confidence: 0.3 }] };
  },
};
