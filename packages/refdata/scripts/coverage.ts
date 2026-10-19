/**
 * Coverage report: runs the real engine cost + nutrition over every e2e fixture recipe, the photo-import
 * fixture and the meal-kit style fixtures, and lists every uncosted / no-nutrition line with its reason (D90).
 *   pnpm --filter @fr/refdata coverage          -> prints the report
 *   pnpm --filter @fr/refdata coverage --json   -> machine-readable totals
 * `analyse()` is also used by test/coverage.test.ts as a regression floor.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { costRecipe, type PriceObservation } from '../../engine/src/cost/index';
import { calculateRecipeNutrition, type NutritionLine, type NutrientProfile } from '../../engine/src/nutrition/index';
import { IngredientMatcher } from '../../engine/src/normalise/index';
import { createGramsConverter, createQuantityConverter } from '../../engine/src/units/index';
import { loadCofid, loadSeed, PACKAGE_ROOT } from '../src/load';
import type { CofidFood } from '../src/cofid';

type Q = { kind: string; value?: number; min?: number; max?: number; unit?: string; originalText: string };
export interface FixtureLine { name: string; quantity: Q; optional: boolean }
export interface FixtureRecipe { id: string; title: string; servings: number; lines: FixtureLine[] }

const REPO = resolve(PACKAGE_ROOT, '../..');

export function loadFixtureRecipes(): FixtureRecipe[] {
  const out: FixtureRecipe[] = [];
  const dir = resolve(REPO, 'e2e/fixtures/recipes');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.expected.json')).sort()) {
    const j = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as { expected: { title: string; servings: number; ingredients: FixtureLine[] } };
    out.push({ id: f.replace('.expected.json', ''), title: j.expected.title, servings: j.expected.servings, lines: j.expected.ingredients });
  }
  const imp = resolve(REPO, 'packages/recipe-import/fixtures/recipe-extraction.json');
  if (existsSync(imp)) {
    const j = JSON.parse(readFileSync(imp, 'utf8')) as { title: string; servings: number; ingredients: FixtureLine[] };
    out.push({ id: 'import-fixture', title: j.title, servings: j.servings, lines: j.ingredients });
  }
  return out;
}

export function loadMealKitRecipes(): FixtureRecipe[] {
  const kit = resolve(PACKAGE_ROOT, 'test/mealkit-fixtures.json');
  return existsSync(kit) ? (JSON.parse(readFileSync(kit, 'utf8')) as FixtureRecipe[]) : [];
}

export interface LineResult { recipe: string; name: string; text: string; matched: string | null; costReason: string | null; nutritionReason: string | null }
export interface Analysis {
  recipes: { id: string; title: string; lines: number; priced: number; nutritionKnown: number; fullyPriced: boolean; energyKnown: boolean; perServingPence: number | null }[];
  lines: LineResult[];
  totals: { lines: number; priced: number; nutritionKnown: number; recipes: number; fullyPriced: number; energyKnown: number };
}

export function analyse(recipes: FixtureRecipe[] = loadFixtureRecipes()): Analysis {
  const { ingredients, prices } = loadSeed();
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const get = (id: string) => byId.get(id) as never;
  const matcher = new IngredientMatcher(ingredients as never);
  const converter = createQuantityConverter(get);
  const grams = createGramsConverter(get);
  const obs = prices as unknown as PriceObservation[];
  const cofid = loadCofid();
  const foods = new Map<string, CofidFood>();
  for (const f of cofid.foods) if (!f.duplicateCode) foods.set(f.code, f);
  const profileOf = (id: string): NutrientProfile | undefined => {
    const ing = byId.get(id);
    const food = ing?.cofid ? foods.get(ing.cofid.code) : undefined;
    if (!ing?.cofid || !food) return undefined;
    const per100g: NutrientProfile['per100g'] = {};
    for (const n of food.nutrients) {
      per100g[n.nutrient] = { status: n.status, ...(n.value !== undefined ? { value: n.value } : {}), estimate: n.estimate || ing.cofid.match === 'proxy', source: 'CoFID' };
    }
    return { per100g, source: 'CoFID' };
  };

  const lines: LineResult[] = [];
  const recipeRows: Analysis['recipes'] = [];
  for (const r of recipes) {
    const eng = r.lines.map((l, i) => {
      const m = matcher.match(l.name);
      const ingredientId = m.status === 'matched' && m.ingredientId ? m.ingredientId : undefined;
      return { id: `${r.id}-${i}`, recipeId: r.id, name: l.name, ...(ingredientId ? { ingredientId } : {}), quantity: l.quantity as never, optional: l.optional, order: i };
    });
    const cost = costRecipe({ lines: eng as never, servings: r.servings, prices: obs, converter, ingredients: get });
    const nLines: NutritionLine[] = eng.map((l) => {
      const profile = l.ingredientId ? profileOf(l.ingredientId) : undefined;
      return { id: l.id, name: l.name, ...(l.ingredientId ? { ingredientId: l.ingredientId } : {}), quantity: l.quantity, optional: l.optional, ...(profile ? { profile } : {}) };
    });
    const nut = calculateRecipeNutrition(nLines, r.servings, grams, { treatToTasteAsNegligible: true });
    const costBy = new Map(cost.lines.map((c) => [c.lineId, c]));
    const missBy = new Map(nut.missingIngredients.map((m) => [m.name, m.reason]));
    let priced = 0;
    let known = 0;
    eng.forEach((l, i) => {
      const c = costBy.get(l.id);
      const costReason = c && c.status !== 'uncosted' ? null : (c?.reason ?? 'uncosted');
      const nutReason = missBy.get(l.name) ?? null;
      if (!costReason) priced++;
      if (!nutReason) known++;
      const ing = l.ingredientId ? byId.get(l.ingredientId) : undefined;
      lines.push({ recipe: r.id, name: l.name, text: r.lines[i]!.quantity.originalText, matched: ing?.name ?? null, costReason, nutritionReason: nutReason });
    });
    recipeRows.push({
      id: r.id, title: r.title, lines: r.lines.length, priced, nutritionKnown: known,
      fullyPriced: !cost.isPartial && cost.totalPence !== null, energyKnown: nut.perServing.energy_kcal.status === 'known', perServingPence: cost.perServingPence,
    });
  }
  const sum = (f: (r: Analysis['recipes'][number]) => number) => recipeRows.reduce((a, r) => a + f(r), 0);
  return {
    recipes: recipeRows, lines,
    totals: {
      lines: sum((r) => r.lines), priced: sum((r) => r.priced), nutritionKnown: sum((r) => r.nutritionKnown),
      recipes: recipeRows.length, fullyPriced: sum((r) => (r.fullyPriced ? 1 : 0)), energyKnown: sum((r) => (r.energyKnown ? 1 : 0)),
    },
  };
}

export function renderReport(a: Analysis): string {
  const t = a.totals;
  const out: string[] = [];
  out.push(`lines=${t.lines} priced=${t.priced} nutritionKnown=${t.nutritionKnown} recipes=${t.recipes} fullyPriced=${t.fullyPriced} energyKnown=${t.energyKnown}`);
  for (const r of a.recipes) out.push(`${r.id}: priced ${r.priced}/${r.lines} nutrition ${r.nutritionKnown}/${r.lines} cost/serv=${r.perServingPence ?? '-'}`);
  out.push('--- problem lines');
  for (const l of a.lines) if (l.costReason || l.nutritionReason) out.push(`${l.recipe} | ${l.name} (${l.text}) -> ${l.matched ?? 'UNMATCHED'} | cost: ${l.costReason ?? 'ok'} | nutrition: ${l.nutritionReason ?? 'ok'}`);
  return out.join('\n');
}

if (process.argv[1] && /coverage\.ts$/.test(process.argv[1])) {
  const recipes = [...loadFixtureRecipes(), ...(process.argv.includes('--kits') ? loadMealKitRecipes() : [])];
  const a = analyse(recipes);
  console.log(process.argv.includes('--json') ? JSON.stringify(a.totals) : renderReport(a));
}
