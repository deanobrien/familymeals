import 'server-only';
import type { CanonicalIngredient } from '@fr/domain';
import { termMatches } from '@fr/engine/planner';
import type { ExclusionResolver } from '@fr/plan-orchestrator';
import { getIngredientCatalogue, type IngredientCatalogue } from '../refdata/catalogue';

/**
 * Household / request exclusions -> canonical ingredient ids and UK-14 allergen groups (DECISIONS D132).
 * The refdata catalogue has no allergen column, so groups are derived from ingredient names and aliases with the
 * keyword lists below. They are deliberately over-inclusive (a false exclusion is safe, a missed allergen is not)
 * and the engine's term match plus unmatched-line check stay on as the secondary net.
 */
const GROUP_KEYWORDS: Record<string, string[]> = {
  celery: ['celery', 'celeriac'],
  cereals_gluten: ['wheat', 'flour', 'bread', 'pasta', 'spaghetti', 'noodle', 'barley', 'rye', 'oat', 'couscous', 'semolina', 'bulgur', 'breadcrumb', 'pastry', 'biscuit', 'tortilla', 'pitta', 'naan', 'lasagne', 'macaroni', 'penne', 'fusilli', 'tagliatelle', 'cracker'],
  crustaceans: ['prawn', 'shrimp', 'crab', 'lobster', 'crayfish'],
  eggs: ['egg', 'mayonnaise'],
  fish: ['fish', 'salmon', 'cod', 'haddock', 'tuna', 'mackerel', 'sardine', 'anchov', 'trout', 'pollock', 'plaice', 'sea bass', 'herring', 'worcestershire'],
  lupin: ['lupin'],
  milk: ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'cheddar', 'parmesan', 'mozzarella', 'feta', 'ghee', 'custard', 'halloumi', 'paneer'],
  molluscs: ['mussel', 'oyster', 'squid', 'clam', 'scallop', 'whelk', 'octopus'],
  mustard: ['mustard'],
  peanuts: ['peanut', 'groundnut'],
  sesame: ['sesame', 'tahini'],
  soya: ['soy', 'soya', 'tofu', 'edamame', 'miso', 'tempeh'],
  sulphites: ['wine', 'sulphite', 'sulfite', 'dried apricot'],
  tree_nuts: ['almond', 'hazelnut', 'walnut', 'cashew', 'pecan', 'pistachio', 'brazil nut', 'macadamia', 'pine nut', 'marzipan', 'praline'],
};

/** What a person types -> the UK-14 group(s) it means (singular, lower case, spaces for underscores). */
const GROUP_ALIASES: Record<string, string[]> = {
  nut: ['peanuts', 'tree_nuts'], 'tree nut': ['tree_nuts'], gluten: ['cereals_gluten'], 'cereals gluten': ['cereals_gluten'], wheat: ['cereals_gluten'],
  dairy: ['milk'], lactose: ['milk'], shellfish: ['crustaceans', 'molluscs'], crustacean: ['crustaceans'], mollusc: ['molluscs'],
  egg: ['eggs'], peanut: ['peanuts'], soy: ['soya'], soya: ['soya'], sulphite: ['sulphites'], sulfite: ['sulphites'], sesame: ['sesame'],
  celery: ['celery'], fish: ['fish'], milk: ['milk'], mustard: ['mustard'], lupin: ['lupin'],
};

const singular = (t: string): string => t.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').replace(/ies$/, 'y').replace(/(?<!s)s$/, '');

export function groupsForName(name: string): string[] {
  const k = singular(name);
  const direct = Object.keys(GROUP_KEYWORDS).filter((g) => singular(g) === k);
  return [...new Set([...direct, ...(GROUP_ALIASES[k] ?? [])])];
}

const names = (i: CanonicalIngredient): string[] => [i.name, ...i.aliases];
const hits = (i: CanonicalIngredient, keywords: string[]): boolean => names(i).some((n) => keywords.some((kw) => n.toLowerCase().includes(kw)));

const cache = new WeakMap<IngredientCatalogue, { groups: Map<string, string[]>; byId: Map<string, string[]> }>();
function index(cat: IngredientCatalogue) {
  let c = cache.get(cat);
  if (!c) {
    const groups = new Map<string, string[]>();
    const byId = new Map<string, string[]>();
    for (const [g, kws] of Object.entries(GROUP_KEYWORDS)) {
      const ids = cat.all.filter((i) => hits(i, kws)).map((i) => i.id);
      groups.set(g, ids);
      for (const id of ids) byId.set(id, [...(byId.get(id) ?? []), g]);
    }
    c = { groups, byId };
    cache.set(cat, c);
  }
  return c;
}

/** Ingredient ids belonging to a UK-14 group (derived, over-inclusive). */
export function ingredientIdsForGroup(group: string, cat: IngredientCatalogue = getIngredientCatalogue()): string[] {
  return index(cat).groups.get(group) ?? [];
}

/** UK-14 groups present in a set of matched ingredient ids (a recipe's `allergens`). */
export function allergensForIngredients(ids: string[], cat: IngredientCatalogue = getIngredientCatalogue()): string[] {
  const { byId } = index(cat);
  return [...new Set(ids.flatMap((id) => byId.get(id) ?? []))].sort();
}

export function createExclusionResolver(cat: IngredientCatalogue = getIngredientCatalogue()): ExclusionResolver {
  return ({ terms, allergens }) => {
    const groupKeys = new Set<string>();
    const unknownAllergens: string[] = [];
    for (const a of allergens) {
      const g = groupsForName(a);
      if (g.length) g.forEach((x) => groupKeys.add(x));
      else unknownAllergens.push(a);
    }
    // A free-text term that names a UK-14 allergen ("peanuts", "dairy") is enforced as that group too.
    for (const t of terms) groupsForName(t).forEach((x) => groupKeys.add(x));

    const allergenGroups: Record<string, string[]> = {};
    const ids = new Set<string>();
    for (const g of groupKeys) {
      allergenGroups[g] = ingredientIdsForGroup(g, cat);
    }
    // Each term resolves to every catalogue ingredient whose name or alias matches ("mushrooms" -> all mushroom ids).
    for (const t of terms) {
      if (t.trim().length < 3) continue;
      for (const i of cat.all) if (names(i).some((n) => termMatches(n, t))) ids.add(i.id);
    }
    return {
      excludeIngredientIds: [...ids].sort(),
      allergenGroups,
      excludeAllergens: [...groupKeys, ...unknownAllergens],
    };
  };
}
