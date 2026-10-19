// Seeds the in-memory repository from e2e/fixtures/recipes/*.expected.json (read from disk at runtime, server only).
// Fixtures carry title/servings/ingredients/steps/diet; the remaining fields (cuisine, times, tags, cost, nutrition)
// are placeholder enrichment keyed by fixture number so the library has realistic variety.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  DietCategory,
  IngredientLine,
  MealType,
  NutrientValue,
  Quantity,
  RecipeView,
} from './types';

interface FixtureIngredient {
  name: string;
  quantity: Quantity;
  preparation?: string;
  optional: boolean;
}
interface Fixture {
  scenario?: string;
  diet: DietCategory;
  expected: { title: string; servings: number; ingredients: FixtureIngredient[]; steps: string[] };
}

interface Enrichment {
  description: string;
  cuisine: string;
  mealType: MealType;
  tags: string[];
  prep: number | null;
  cook: number | null;
  totalPence: number | null;
  rating: number | null;
  favourite?: boolean;
  nutrition?: 'full' | 'partial' | 'none';
}

const ENRICH: Record<string, Enrichment> = {
  '01': { description: 'A simple midweek tomato sauce with garlic and basil.', cuisine: 'Italian', mealType: 'dinner', tags: ['pasta', 'family', 'quick'], prep: 10, cook: 25, totalPence: 380, rating: 4, favourite: true, nutrition: 'full' },
  '02': { description: 'A zesty loaf cake with a sugary lemon crust.', cuisine: 'British', mealType: 'snack', tags: ['baking', 'cake'], prep: 20, cook: 55, totalPence: 520, rating: 5, nutrition: 'partial' },
  '03': { description: 'A slow-cooked beef stew for cold evenings.', cuisine: 'British', mealType: 'dinner', tags: ['slow-cook', 'winter', 'comfort'], prep: 25, cook: 150, totalPence: 1380, rating: 4, nutrition: 'partial' },
  '04': { description: "Gran's handwritten flapjacks and soup card, with fractions and loose amounts.", cuisine: 'British', mealType: 'lunch', tags: ['soup', 'baking', 'family'], prep: 15, cook: 30, totalPence: null, rating: null, nutrition: 'none' },
  '05': { description: 'A fast vegetable curry from a faded recipe card.', cuisine: 'Indian', mealType: 'dinner', tags: ['curry', 'quick', 'budget'], prep: 10, cook: 20, totalPence: 360, rating: 3, nutrition: 'none' },
  '06': { description: 'Creamy fish pie with a mashed potato topping.', cuisine: 'British', mealType: 'dinner', tags: ['fish', 'family', 'comfort'], prep: 30, cook: 45, totalPence: 1680, rating: 5, favourite: true, nutrition: 'full' },
  '07': { description: 'Make-ahead oats with berries and honey.', cuisine: 'British', mealType: 'breakfast', tags: ['breakfast', 'make-ahead', 'quick'], prep: 5, cook: 0, totalPence: 150, rating: 4, nutrition: 'partial' },
  '08': { description: 'A smoky, spiced chickpea stew for the whole week.', cuisine: 'Spanish', mealType: 'dinner', tags: ['vegan', 'stew', 'budget'], prep: 10, cook: 30, totalPence: 560, rating: null, nutrition: 'partial' },
};

const SOURCE = 'Family recipe collection (fixture)';

const k = (nutrient: NutrientValue['nutrient'], unit: NutrientValue['unit'], value: number): NutrientValue => ({
  nutrient, unit, value, status: 'known', estimate: true, source: 'Placeholder estimate',
});
const u = (nutrient: NutrientValue['nutrient'], unit: NutrientValue['unit']): NutrientValue => ({
  nutrient, unit, status: 'unknown', estimate: true,
});

function nutritionFor(kind: Enrichment['nutrition'], idx: number): NutrientValue[] {
  if (kind === 'none' || !kind) return [];
  const kcal = 300 + idx * 40;
  const rows: NutrientValue[] = [
    k('energy_kcal', 'kcal', kcal),
    k('protein', 'g', 10 + idx),
    k('carbohydrate', 'g', 40 + idx),
    k('fat', 'g', 8 + idx),
    k('fibre', 'g', 4),
  ];
  if (kind === 'full') rows.push(k('sugars', 'g', 6), k('saturates', 'g', 2), k('salt', 'g', 0.6));
  else rows.push(u('sugars', 'g'), u('saturates', 'g'), u('salt', 'g'));
  return rows;
}

function seedId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** Deterministic UUID-shaped id for a child row (ingredient '1' / step '2'). */
function childId(parent: string, kind: string, idx: number, n: number): string {
  return `${parent.slice(0, 24)}${kind}${String(idx).padStart(3, '0')}${String(n).padStart(8, '0')}`;
}

function originalTextOf(f: Fixture): string {
  const lines = f.expected.ingredients.map((i) => i.quantity.originalText + ' ' + i.name + (i.preparation ? `, ${i.preparation}` : ''));
  return [...lines, '', ...f.expected.steps].join('\n');
}

export function toRecipeView(f: Fixture, key: string, idx: number): RecipeView {
  const e = ENRICH[key] ?? { description: '', cuisine: '', mealType: 'dinner' as MealType, tags: [], prep: null, cook: null, totalPence: null, rating: null };
  const id = seedId(idx + 1);
  const created = new Date(Date.UTC(2026, 8, 1 + idx, 9, 0, 0)).toISOString();
  const ingredients: IngredientLine[] = f.expected.ingredients.map((i, n) => ({
    id: childId(id, '1', idx, n),
    name: i.name,
    quantity: i.quantity,
    preparation: i.preparation,
    optional: i.optional,
    order: n,
  }));
  return {
    id,
    title: f.expected.title,
    description: e.description,
    imageUrl: null,
    sourceAttribution: SOURCE,
    sourceUrl: '',
    originalText: originalTextOf(f),
    prepMinutes: e.prep,
    cookMinutes: e.cook,
    servings: f.expected.servings,
    cuisine: e.cuisine,
    mealType: e.mealType,
    diet: f.diet,
    tags: e.tags,
    ingredients,
    steps: f.expected.steps.map((text, n) => ({ id: childId(id, '2', idx, n), order: n, text })),
    favourite: !!e.favourite,
    rating: e.rating,
    cost: { totalPence: e.totalPence, kind: 'generic_estimate', source: 'Placeholder estimate (cost engine not merged)' },
    nutritionPerServing: nutritionFor(e.nutrition, idx),
    createdAt: created,
    updatedAt: created,
  };
}

export function findFixtureDir(): string | null {
  const candidates = [
    process.env.FR_FIXTURES_DIR,
    path.resolve(process.cwd(), '../../e2e/fixtures/recipes'),
    path.resolve(process.cwd(), 'e2e/fixtures/recipes'),
  ].filter((c): c is string => !!c);
  return candidates.find((c) => existsSync(c)) ?? null;
}

export function loadSeedRecipes(dir: string | null = findFixtureDir()): RecipeView[] {
  if (!dir) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.expected.json'))
    .sort()
    .map((file, idx) => {
      const fixture = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as Fixture;
      return toRecipeView(fixture, file.slice(0, 2), idx);
    });
}
