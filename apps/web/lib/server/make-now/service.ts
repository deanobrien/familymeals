// "What can I make now?" (P1-B, D375): library recipes ranked by what the pantry covers (engine rankRecipesByPantry), with
// expiring stock weighted up, the household's allergy exclusions applied FIRST (with consent, fail-safe: a recipe line we
// cannot check is withheld while any exclusion is active), and an idempotent "add missing to the shopping list".
import { createHash } from 'node:crypto';
import { checkRecipe, type ExclusionRules } from '@fr/recipe-sources';
import { fmtQ, isExact, type RecipeSummary } from '../../pantry/engine';
import { deriveAll, type Command, type EngineContext } from '../../shopping/engine';
import type { MakeNowAddResult, MakeNowItem, MakeNowView } from '../../make-now/types';
import { buildRules } from '../discover/service';
import type { IngredientLookup } from '../pantry/ingredients';
import type { PantryService } from '../pantry/service';
import { aisleForCategory } from '../shopping/plan-requirements';
import type { ShoppingRepository } from '../shopping/repository';
import type { Household } from '@fr/plan-orchestrator';

export interface MakeNowDeps {
  pantry: Pick<PantryService, 'rankedRecipes'>;
  shopping: ShoppingRepository;
  ingredients: IngredientLookup;
  converter: EngineContext['converter'];
  /** The household profile of THIS request (hard exclusions, consent already applied) and the withheld count. */
  loadHousehold: (householdId: string) => Promise<{ household: Pick<Household, 'hardExclusions'>; withheldExclusions: number }>;
  now: () => string;
}

export interface MakeNowOptions {
  limit?: number;
  /** Recipes covering less than this share of their ingredients are not suggested. Default 0.4. */
  minCoverage?: number;
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 30;
/** Expiring stock counts for more than in the plain pantry ranking: coverage 55%, urgency 45%. */
const COVERAGE_WEIGHT = 0.55;

const stableUuid = (seed: string): string => {
  const h = createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const lineName = (l: RecipeSummary['lines'][number]): string => l.displayName ?? l.ingredientId ?? l.quantity.originalText;

function quantityLabel(l: RecipeSummary['lines'][number]): string {
  const q = l.quantity;
  if (q.kind === 'to_taste' || q.kind === 'unparsed') return '';
  try { return fmtQ(q); } catch { return ''; }
}

export function createMakeNowService(deps: MakeNowDeps) {
  /** Exclusion verdict for one recipe: the line's own ingredient id is trusted over re-matching its name. */
  function allowed(r: RecipeSummary, rules: ExclusionRules, active: boolean): boolean {
    const idByName = new Map<string, string>();
    for (const l of r.lines) if (l.ingredientId) idByName.set(lineName(l), l.ingredientId);
    const scoped: ExclusionRules = { ...rules, resolveIngredientId: (n) => idByName.get(n) ?? rules.resolveIngredientId(n) };
    const verdict = checkRecipe(
      { title: r.title, ingredients: r.lines.map((l) => ({ name: lineName(l), measure: '' })), instructions: '' },
      scoped, 'vegan', active,
    );
    return verdict.ok;
  }

  async function candidates(householdId: string) {
    const [{ recipes, ranked }, { household, withheldExclusions }] = await Promise.all([
      deps.pantry.rankedRecipes(householdId, { coverageWeight: COVERAGE_WEIGHT }),
      deps.loadHousehold(householdId),
    ]);
    const { rules, active } = buildRules(household);
    return { recipes, ranked, rules, active, withheldExclusions };
  }

  async function outstandingOnList(householdId: string): Promise<{ ids: Set<string>; names: Set<string>; cursor: number }> {
    const snap = await deps.shopping.snapshot(householdId);
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const v of deriveAll(snap.state, { converter: deps.converter })) {
      if (v.item.removed || v.noLongerNeeded || v.outstanding <= 0) continue;
      if (v.item.ingredientId) ids.add(v.item.ingredientId);
      names.add(v.item.displayName.trim().toLowerCase());
    }
    return { ids, names, cursor: snap.cursor };
  }

  return {
    async getView(householdId: string, opts: MakeNowOptions = {}): Promise<MakeNowView> {
      const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(opts.limit ?? DEFAULT_LIMIT)));
      const minCoverage = opts.minCoverage ?? 0.4;
      const { recipes, ranked, rules, active, withheldExclusions } = await candidates(householdId);
      const byId = new Map(recipes.map((r) => [r.id, r]));
      let hidden = 0;
      const items: MakeNowItem[] = [];
      for (const r of ranked) {
        if (r.coverage < minCoverage) continue;
        const recipe = byId.get(r.recipeId);
        if (!recipe) continue;
        if (!allowed(recipe, rules, active)) { hidden++; continue; }
        const missingNames = new Set(r.missing);
        const missing = recipe.lines.filter((l) => !l.optional && missingNames.has(lineName(l))).map((l) => ({ name: lineName(l), quantityLabel: quantityLabel(l) }));
        const covPct = Math.round(r.coverage * 100);
        const usesExpiring = r.urgency > 0;
        items.push({
          recipeId: r.recipeId, title: r.title, href: `/recipes/${r.recipeId}`, coveragePct: covPct, urgencyPct: Math.round(r.urgency * 100),
          makeable: missing.length === 0 && covPct >= 100, usesExpiring, covered: r.covered, missing,
          headline: missing.length === 0 ? 'You have everything' : `${covPct}% covered, ${missing.length} to buy` + (usesExpiring ? ', uses stock expiring soon' : ''),
        });
      }
      // Fully makeable first; then the engine's order (coverage blended with expiring stock).
      const order = new Map(items.map((it, i) => [it.recipeId, i]));
      items.sort((a, b) => Number(b.makeable) - Number(a.makeable) || order.get(a.recipeId)! - order.get(b.recipeId)!);
      return {
        items: items.slice(0, limit), hiddenByAllergy: hidden, exclusionsActive: active, withheldExclusions,
        totalRecipes: recipes.length, pantryEmpty: ranked.every((r) => r.coverage === 0),
      };
    },

    /**
     * Add the ingredients the pantry lacks for one recipe to the shopping list. Idempotent: lines already outstanding on the
     * list (same ingredient, or same name) are skipped, command ids are deterministic per list position, and the shopping
     * engine merges repeats, so a double tap or a retry never doubles anything.
     */
    async addMissing(householdId: string, actor: string, recipeId: string): Promise<MakeNowAddResult> {
      const { recipes, ranked } = await candidates(householdId);
      const recipe = recipes.find((r) => r.id === recipeId);
      const entry = ranked.find((r) => r.recipeId === recipeId);
      if (!recipe || !entry) return { ok: false, error: 'That recipe could not be found.' };
      const missingNames = new Set(entry.missing);
      const lines = recipe.lines.filter((l) => !l.optional && missingNames.has(lineName(l)));
      if (lines.length === 0) return { ok: true, added: 0, alreadyOnList: 0, message: 'You already have everything for this recipe.' };
      const list = await outstandingOnList(householdId);
      let added = 0;
      let already = 0;
      let failed = 0;
      for (const [i, l] of lines.entries()) {
        const name = lineName(l);
        if ((l.ingredientId && list.ids.has(l.ingredientId)) || list.names.has(name.trim().toLowerCase())) { already++; continue; }
        const seed = `makenow|${householdId}|${recipeId}|${i}|${list.cursor}`;
        const ing = l.ingredientId ? deps.ingredients.get(l.ingredientId) : undefined;
        const cmd: Command = {
          type: 'add_item', commandId: stableUuid(`${seed}|cmd`), actor, at: deps.now(), itemId: stableUuid(`${seed}|item`),
          displayName: (ing?.name ?? name).slice(0, 120), quantity: isExact(l.quantity) || l.quantity.kind === 'range' || l.quantity.kind === 'approximate' ? l.quantity : { kind: 'unparsed', originalText: name },
          category: aisleForCategory(ing?.category), notes: `For ${recipe.title}`.slice(0, 200),
          ...(l.ingredientId ? { ingredientId: l.ingredientId } : {}),
        } as Command;
        const out = await deps.shopping.submit(householdId, cmd);
        if (out.result.status === 'applied') added++; else failed++;
      }
      if (added === 0 && failed > 0) return { ok: false, error: 'Could not add these to the shopping list. Please try again.' };
      const bits = [added ? `Added ${added} item${added === 1 ? '' : 's'} to your shopping list` : 'Everything missing is already on your shopping list'];
      if (added && already) bits.push(`${already} already on it`);
      if (failed) bits.push(`${failed} could not be added`);
      return { ok: true, added, alreadyOnList: already, message: bits.join(', ') };
    },
  };
}

export type MakeNowService = ReturnType<typeof createMakeNowService>;
