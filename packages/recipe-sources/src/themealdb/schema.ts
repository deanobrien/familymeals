import { z } from 'zod';
import type { SourceRecipe } from '../types.js';

/** TheMealDB v1 JSON: every field is a nullable string; ingredients are strIngredient1..20 / strMeasure1..20. */
const str = z.string().nullable().optional();

export const RawMealSchema = z
  .object({
    idMeal: z.string().min(1),
    strMeal: z.string().min(1),
    strCategory: str,
    strArea: str,
    strInstructions: str,
    strMealThumb: str,
    strTags: str,
    strYoutube: str,
    strSource: str,
    strCreativeCommonsConfirmed: str,
  })
  .catchall(z.unknown());
export type RawMeal = z.infer<typeof RawMealSchema>;

/** `{ meals: [...] | null }` for search/lookup/random. */
export const MealsResponseSchema = z.object({ meals: z.array(RawMealSchema).nullable() });

/** `filter.php` returns summaries only. */
export const FilterResponseSchema = z.object({
  meals: z
    .array(z.object({ idMeal: z.string().min(1), strMeal: z.string().min(1), strMealThumb: str }))
    .nullable(),
});

export const ListResponseSchema = z.object({
  meals: z.array(z.record(z.string(), z.string().nullable())).nullable(),
});

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const MAX_INGREDIENTS = 20;

export function mealUrl(id: string): string {
  return `https://www.themealdb.com/meal/${encodeURIComponent(id)}`;
}

/** Only https URLs to the publisher's own image host are kept (they are rendered in <img> under a strict CSP). */
function safeImage(v: unknown): string | undefined {
  const s = clean(v);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && (u.hostname === 'www.themealdb.com' || u.hostname.endsWith('.themealdb.com')) ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Raw meal -> SourceRecipe. Returns null when the meal has no usable ingredients or instructions. */
export function normaliseMeal(raw: RawMeal): SourceRecipe | null {
  const ingredients: SourceRecipe['ingredients'] = [];
  for (let i = 1; i <= MAX_INGREDIENTS; i++) {
    const name = clean(raw[`strIngredient${i}`]);
    if (!name) continue;
    ingredients.push({ name, measure: clean(raw[`strMeasure${i}`]) });
  }
  const instructions = clean(raw.strInstructions);
  if (ingredients.length === 0 || !instructions) return null;
  const category = clean(raw.strCategory);
  const area = clean(raw.strArea);
  const tags = clean(raw.strTags).split(',').map((t) => t.trim()).filter(Boolean);
  const image = safeImage(raw.strMealThumb);
  const youtube = clean(raw.strYoutube);
  const cc = clean(raw.strCreativeCommonsConfirmed);
  return {
    provider: 'themealdb',
    id: raw.idMeal,
    title: raw.strMeal.trim(),
    ...(category ? { category } : {}),
    ...(area && area.toLowerCase() !== 'unknown' ? { area } : {}),
    tags,
    instructions,
    ...(image ? { imageUrl: image } : {}),
    ...(/^https:\/\//i.test(youtube) ? { youtubeUrl: youtube } : {}),
    ...(cc ? { creativeCommons: cc } : {}),
    attribution: { publisher: 'TheMealDB', url: mealUrl(raw.idMeal), id: raw.idMeal },
    ingredients,
  };
}
