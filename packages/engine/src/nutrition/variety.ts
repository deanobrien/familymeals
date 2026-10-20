// "5 a day" and variety for a planned week (P1-B, D376). Pure and deterministic. DESCRIPTIVE ONLY, never advice:
// every number is an ESTIMATE from the planned recipes' ingredient weights, assuming one serving of each planned meal per
// person. No medical or health claims; the UI says so. The 80 g portion is the common portion-size convention (dried fruit 30 g);
// pulses count as at most one portion a day; potatoes (other than sweet potatoes), juice, garlic, ginger, chilli and herbs
// do not count towards portions (herbs still count as plants for the diversity count).
import type { IsoDate } from '../contract';

export const PORTION_G = 80;
export const DRIED_FRUIT_PORTION_G = 30;
export const VARIETY_DISCLAIMER =
  'A rough estimate from your planned recipes, one serving of each meal per person, using 80 g portions. It is not dietary or medical advice.';

export type ProteinKind = 'fish' | 'meat' | 'plant';

export interface VarietyLine {
  ingredientId?: string | undefined;
  name: string;
  /** Catalogue category of the matched ingredient (e.g. fruit_veg, meat_poultry). */
  category?: string | undefined;
  /** Weight of the whole line in grams; null/undefined when it could not be worked out. */
  grams?: number | null | undefined;
  optional?: boolean | undefined;
}

/** What one recipe contributes per serving. Small and serialisable: it travels with the recipe to web and Android. */
export interface RecipeVarietyProfile {
  /** Fruit and vegetable portions per serving (pulses excluded). */
  fv: number;
  /** Pulse portions per serving (a day counts at most one). */
  pulses: number;
  /** Distinct plant names (lower case, simplified) in the recipe. */
  plants: string[];
  /** Distinct protein ingredients (meat, fish, pulses, tofu...), lower case. */
  proteinSources: string[];
  /** Kinds of protein present. */
  proteins: ProteinKind[];
  /** Fruit / veg / pulse lines whose weight is unknown (portions are then a lower bound). */
  unweighed: number;
}

type Portion = 'veg' | 'dried' | 'pulse' | null;
export interface VarietyClass { portion: Portion; protein: ProteinKind | null; plant: string | null }

const PULSE = /\b(?:lentils?|chickpeas?|(?:kidney|black|cannellini|butter|borlotti|haricot|broad) beans?|baked beans?|black[- ]eyed)\b/i;
const DRIED_FRUIT = /\b(?:raisins?|sultanas?|currants?|prunes?|dates?|dried (?:apricots?|figs?|mango|cranberr\w+|fruit)|sun-dried tomatoes?)\b/i;
const NO_PORTION_FV = /\b(?:juice|garlic|ginger|chill?i(?:es)?|lemongrass|curry leaves|coriander|parsley|basil|mint|thyme|rosemary|sage|dill|chives)\b/i;
const WHITE_POTATO = /\bpotato(?:es)?\b/i;
const VEG_IN_JAR = /\b(?:tomatoes|passata|sweetcorn|peas|pineapple|peaches|mushrooms|spinach|mixed vegetables|berries)\b/i;
const FISH_NAME = /\b(?:tuna|sardines?|salmon|mackerel|anchov\w+|fish|cod|haddock|prawns?)\b/i;
const PLANT_PROTEIN = /\b(?:tofu|quorn|tempeh|vegetarian sausages?|seitan)\b/i;
const NOT_A_PLANT = /\b(?:salt|stock|cube|gravy|yeast extract|baking|ketchup|mayonnaise|sauce|puree|paste|custard|milk|cream|ice cream|oven chips|pizza|fish fingers)\b/i;
const PLANT_CATEGORIES = new Set(['fruit_veg', 'herbs_spices', 'nuts_seeds', 'pasta_rice_grains', 'cereals']);

/** Simplify a name so "red onion" and "onion", "frozen peas" and "peas" are one plant. Deliberately modest. */
export function plantKey(name: string): string {
  let n = name.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) n = n.replace(/^(?:fresh|frozen|tinned|dried|ground|smoked|red|green|yellow|white|black|baby|new|little gem|sun-dried|jacket|mixed|whole|plain)\s+/, '');
  n = n.replace(/\s+(?:clove|cloves|powder|seeds|pods|leaves|flakes|stick|puree)$/, '').replace(/(?<=o)es$/, '').replace(/ies$/, 'y').replace(/(?<![su])s$/, '');
  return n;
}

export function classifyForVariety(name: string, category: string | undefined): VarietyClass {
  const cat = category ?? '';
  const text = name.toLowerCase();
  let portion: Portion = null;
  let protein: ProteinKind | null = null;
  let plant: string | null = null;

  if (cat === 'meat_poultry') protein = 'meat';
  else if (cat === 'fish_seafood' || FISH_NAME.test(text) && (cat === 'tinned_jarred' || cat === 'frozen')) protein = 'fish';
  else if (cat === 'meat_alternatives' || PLANT_PROTEIN.test(text)) protein = 'plant';

  if (PULSE.test(text) && cat !== 'meat_poultry') { portion = 'pulse'; protein = 'plant'; plant = plantKey(text); }
  else if (DRIED_FRUIT.test(text)) { portion = 'dried'; plant = plantKey(text); }
  else if (cat === 'fruit_veg') {
    const whitePotato = WHITE_POTATO.test(text) && !/\bsweet\b/i.test(text);
    if (!(whitePotato || NO_PORTION_FV.test(text))) portion = 'veg';
    plant = plantKey(text);
  } else if ((cat === 'tinned_jarred' || cat === 'frozen') && VEG_IN_JAR.test(text) && !/\b(?:puree|soup|pizza|chips)\b/i.test(text)) {
    portion = 'veg';
    plant = plantKey(text);
  } else if (PLANT_CATEGORIES.has(cat) && !NOT_A_PLANT.test(text)) plant = plantKey(text);
  else if (protein === 'plant' && PLANT_PROTEIN.test(text)) plant = plantKey(text);

  if (plant && NOT_A_PLANT.test(text) && portion === null && cat !== 'fruit_veg') plant = null;
  return { portion, protein, plant: plant || null };
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** One recipe's per-serving contribution. Optional lines are left out; lines with no matched ingredient are not classified. */
export function recipeVarietyProfile(lines: readonly VarietyLine[], servings: number): RecipeVarietyProfile {
  const per = servings > 0 && Number.isFinite(servings) ? servings : 1;
  let fv = 0;
  let pulses = 0;
  let unweighed = 0;
  const plants = new Set<string>();
  const sources = new Set<string>();
  const kinds = new Set<ProteinKind>();
  for (const l of lines) {
    if (l.optional || !l.ingredientId) continue;
    const c = classifyForVariety(l.name, l.category);
    if (c.plant) plants.add(c.plant);
    if (c.protein) { kinds.add(c.protein); sources.add(plantKey(l.name)); }
    if (c.portion) {
      if (l.grams == null || !(l.grams > 0)) { unweighed++; continue; }
      const g = l.grams / per;
      if (c.portion === 'veg') fv += g / PORTION_G;
      else if (c.portion === 'dried') fv += g / DRIED_FRUIT_PORTION_G;
      else pulses += g / PORTION_G;
    }
  }
  return {
    fv: r2(fv), pulses: r2(pulses), plants: [...plants].sort(), proteinSources: [...sources].sort(),
    proteins: (['fish', 'meat', 'plant'] as const).filter((k) => kinds.has(k)), unweighed,
  };
}

export interface PlannedVarietyMeal {
  /** Any stable id (planned slot key). */
  id: string;
  date: IsoDate;
  title?: string | undefined;
  variety?: RecipeVarietyProfile | null | undefined;
}

export interface VarietyDay { date: IsoDate; portions: number; meals: number }

export interface VarietySummary {
  disclaimer: string;
  mealCount: number;
  /** Meals with no variety data (recipe not matched / not calculated): the numbers are lower bounds. */
  mealsWithoutData: number;
  /** Meals whose fruit/veg weights were partly unknown. */
  mealsPartlyWeighed: number;
  dayCount: number;
  days: VarietyDay[];
  /** Estimated fruit and veg portions per person per planned day, averaged. */
  avgPortionsPerDay: number;
  daysWithFive: number;
  /** Meals containing each kind of protein (a meal may have several). */
  proteinMeals: Record<ProteinKind, number>;
  proteinSources: string[];
  plants: string[];
  /** 0..100, a rough blend of the three measures above. Transparent and described in the UI; not a health score. */
  score: number;
  /** Whole-number tenths of the blend, for tests and display: fruit & veg, plants, protein sources (each 0..1). */
  parts: { fruitVeg: number; plants: number; protein: number };
}

export interface VarietyOptions {
  /** Days to average over; default the number of distinct dates that have a meal. */
  dayCount?: number;
}

/** Summarise planned (or cooked) meals. Pulses count at most one portion per day. */
export function summariseVariety(meals: readonly PlannedVarietyMeal[], opts: VarietyOptions = {}): VarietySummary {
  const byDay = new Map<string, { fv: number; pulses: number; meals: number }>();
  const plants = new Set<string>();
  const sources = new Set<string>();
  const proteinMeals: Record<ProteinKind, number> = { fish: 0, meat: 0, plant: 0 };
  let without = 0;
  let partly = 0;
  for (const m of meals) {
    const d = byDay.get(m.date) ?? { fv: 0, pulses: 0, meals: 0 };
    d.meals++;
    if (!m.variety) { without++; byDay.set(m.date, d); continue; }
    d.fv += m.variety.fv;
    d.pulses += m.variety.pulses;
    if (m.variety.unweighed > 0) partly++;
    for (const p of m.variety.plants) plants.add(p);
    for (const s of m.variety.proteinSources) sources.add(s);
    for (const k of m.variety.proteins) proteinMeals[k]++;
    byDay.set(m.date, d);
  }
  const days: VarietyDay[] = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, portions: r2(d.fv + Math.min(1, d.pulses)), meals: d.meals }));
  const dayCount = opts.dayCount ?? days.length;
  const total = days.reduce((s, d) => s + d.portions, 0);
  const avg = dayCount > 0 ? total / dayCount : 0;
  const plantTarget = Math.max(1, Math.min(30, 4 * Math.max(1, dayCount)));
  const proteinTarget = Math.max(1, Math.min(6, Math.max(1, dayCount)));
  const parts = {
    fruitVeg: r2(Math.min(1, avg / 5)),
    plants: r2(Math.min(1, plants.size / plantTarget)),
    protein: r2(Math.min(1, sources.size / proteinTarget)),
  };
  return {
    disclaimer: VARIETY_DISCLAIMER,
    mealCount: meals.length, mealsWithoutData: without, mealsPartlyWeighed: partly,
    dayCount, days, avgPortionsPerDay: r2(avg), daysWithFive: days.filter((d) => d.portions >= 5).length,
    proteinMeals, proteinSources: [...sources].sort(), plants: [...plants].sort(),
    score: meals.length === 0 ? 0 : Math.round(100 * (0.4 * parts.fruitVeg + 0.35 * parts.plants + 0.25 * parts.protein)),
    parts,
  };
}
