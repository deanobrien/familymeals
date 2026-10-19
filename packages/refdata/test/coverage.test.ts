import { describe, expect, it } from 'vitest';
import { IngredientMatcher } from '../../engine/src/normalise/index';
import { convertQuantity } from '../../engine/src/units/index';
import { COUNT_UNIT_WEIGHTS } from '../src/data/count-unit-weights';
import { loadSeed } from '../src/load';
import { analyse, loadFixtureRecipes, loadMealKitRecipes } from '../scripts/coverage';

const { ingredients, prices } = loadSeed();
const byName = new Map(ingredients.map((i) => [i.name, i]));
const matcher = new IngredientMatcher(ingredients as never);

describe('count-unit weights (D90)', () => {
  it('reference real ingredients, are positive and sourced, unique per (ingredient, unit)', () => {
    const seen = new Set<string>();
    for (const [name, unit, g, src] of COUNT_UNIT_WEIGHTS) {
      expect(byName.has(name), `unknown ingredient ${name}`).toBe(true);
      expect(g).toBeGreaterThan(0);
      expect(src.length).toBeGreaterThan(5);
      expect(src.toLowerCase()).toContain('estimate');
      const k = `${name}|${unit}`;
      expect(seen.has(k), `duplicate ${k}`).toBe(false);
      seen.add(k);
    }
  });
  it('are merged onto the ingredient records, always flagged estimate', () => {
    const merged = ingredients.flatMap((i) => Object.entries(i.countUnitWeightsG ?? {}));
    expect(merged.length).toBe(COUNT_UNIT_WEIGHTS.length);
    for (const [, v] of merged) expect(v!.estimate).toBe(true);
    expect(byName.get('chickpeas')!.countUnitWeightsG!.can!.value).toBe(240);
    expect(byName.get('garlic clove')!.countUnitWeightsG!.clove!.value).toBeGreaterThan(0);
  });
  it('drive can/clove/bunch/pack conversions through the engine, flagged estimate', () => {
    const q = (value: number, unit: string) => ({ kind: 'exact' as const, value, unit: unit as never, originalText: `${value} ${unit}` });
    const tomatoes = byName.get('tinned tomatoes')!;
    expect(convertQuantity(q(2, 'can'), 'g', tomatoes as never)).toMatchObject({ ok: true, quantity: { value: 800 }, estimate: true });
    const garlic = byName.get('garlic clove')!;
    expect(convertQuantity(q(3, 'clove'), 'g', garlic as never)).toMatchObject({ ok: true, quantity: { value: 12 }, estimate: true });
    // a unit with no entry stays refused: never invent a weight
    expect(convertQuantity(q(1, 'bunch'), 'g', tomatoes as never)).toEqual({ ok: false, reason: 'incompatible_count_unit' });
    // a 400 ml tin of coconut milk is one can (volume <-> can via weight and density)
    const coconut = byName.get('coconut milk')!;
    const r = convertQuantity(q(400, 'ml'), 'can', coconut as never);
    expect(r.ok && Math.abs(r.quantity.value! - 1) < 0.01).toBe(true);
  });
});

describe('aliases for common recipe wording (D90)', () => {
  const cases: [string, string][] = [
    ['white fish fillets', 'white fish'],
    ['braising beef', 'stewing beef'],
    ['floury potatoes', 'potato'],
    ['mixed berries', 'frozen berries'],
    ['tinned chopped tomatoes', 'tinned tomatoes'],
    ['chopped tomatoes', 'tinned tomatoes'],
    ['tomato paste', 'tomato puree'],
    ['soft cheese', 'cream cheese'],
    ['grated Italian hard cheese', 'parmesan'],
    ['basil', 'fresh basil'],
    ['parsley', 'fresh parsley'],
    ['sultanas', 'raisins'],
    ['tortillas', 'wrap'],
    ['chicken stock mix', 'chicken stock powder'],
    ['little gem', 'little gem lettuce'],
    ['flaked sea salt', 'salt'],
    ['garlic cloves', 'garlic clove'],
    ['natural yoghurt', 'natural yoghurt'],
    ['basmati rice', 'basmati rice'],
    ['nigella seeds', 'nigella seeds'],
    ['mango chutney', 'mango chutney'],
  ];
  it.each(cases)('"%s" resolves to %s', (text, name) => {
    const m = matcher.match(text);
    expect(m.status).toBe('matched');
    expect(ingredients.find((i) => i.id === m.ingredientId)?.name).toBe(name);
  });
});

describe('prices (D90)', () => {
  it('cover every canonical ingredient, dated and labelled as generic estimates', () => {
    const priced = new Set(prices.map((p) => p.ingredientName));
    expect(ingredients.filter((i) => !priced.has(i.name)).map((i) => i.name)).toEqual([]);
    for (const p of prices) {
      expect(p.kind).toBe('generic_estimate');
      expect(p.observedOn).toBe('2026-10-19');
    }
  });
  it('count-unit packs and fresh herbs are priced per gram so bunch/sprig/item lines convert', () => {
    for (const n of ['fresh coriander', 'fresh parsley', 'fresh thyme', 'fresh basil', 'fresh mint', 'fresh rosemary']) {
      expect(prices.find((p) => p.ingredientName === n)!.packQuantity.unit, n).toBe('g');
    }
  });
});

describe('end-to-end coverage over fixtures (real engine cost + nutrition)', () => {
  const a = analyse([...loadFixtureRecipes(), ...loadMealKitRecipes()]);
  /** Lines that are correctly never priced or weighed: no real amount, or free text. */
  const honestlyUnresolved = (l: { costReason: string | null; nutritionReason: string | null }) =>
    ['approximate_quantity', 'to_taste', 'unmatched_ingredient'].includes(l.costReason ?? '');

  it('every uncosted line is an honestly unresolvable one (pinch, handful, to taste, free text)', () => {
    const bad = a.lines.filter((l) => l.costReason && !honestlyUnresolved(l));
    expect(bad).toEqual([]);
  });
  it('every line without nutrition is unresolvable or has no CoFID entry (explicit allow-list)', () => {
    const allowedNoProfile = new Set(['nigella seeds', 'sun-dried tomatoes']);
    const bad = a.lines.filter((l) => l.nutritionReason && !honestlyUnresolved(l) && !(l.nutritionReason === 'no_profile' && allowedNoProfile.has(l.name)));
    expect(bad.map((l) => `${l.recipe}: ${l.name} (${l.nutritionReason})`)).toEqual([]);
  });
  it('coverage floors (regression guard)', () => {
    expect(a.totals.priced / a.totals.lines).toBeGreaterThan(0.93);
    expect(a.totals.nutritionKnown / a.totals.lines).toBeGreaterThan(0.93);
    expect(a.totals.fullyPriced).toBeGreaterThanOrEqual(9);
  });
  it('meal-kit style cards price and weigh their count-unit lines (can, clove, pack, bunch)', () => {
    for (const id of ['kit-tikka-wraps', 'kit-creamy-tomato-pasta', 'kit-smoky-chicken-rice', 'kit-sweet-potato-curry']) {
      const r = a.recipes.find((x) => x.id === id)!;
      expect(r.priced, id).toBe(r.lines);
      expect(r.perServingPence).toBeGreaterThan(0);
    }
  });
});
