// Minimum pantry stock (par levels) and restock suggestions (PR1, D280-D289).
// Suggestions are COMPUTED ON READ from stock + par levels + the shopping list (no stored suggestion, no background job).
// Adding to the shopping list submits ordinary `add_item` commands with deterministic ids (idempotent) and a "Restock:"
// provenance note; the shopping engine merges them into an existing live item for the same ingredient.
import { createHash, randomUUID } from 'node:crypto';
import {
  addDays, exactQ, makeCtx, parKey, restockSuggestions, stockAvailable, today, unitText,
  type OutstandingItem, type ParLevel, type PlanRequirement, type RestockSuggestion, type RestockUnit, type UnitConverter,
} from '../../pantry/engine';
import { UNIT_OPTIONS } from '../../pantry/types';
import { SNOOZE_DAYS, type ParView, type RestockBannerData, type RestockResult, type RestockSettings, type RestockSuggestionView, type RestockView, type SetParInput } from '../../restock/types';
import { deriveAll, exactQty, type Command, type EngineContext, type Quantity } from '../../shopping/engine';
import type { IngredientLookup } from '../pantry/ingredients';
import type { PantryService } from '../pantry/service';
import { aisleForCategory } from '../shopping/plan-requirements';
import type { ShoppingRepository } from '../shopping/repository';
import type { RestockRepository } from './repository';

export interface RestockDeps {
  repo: RestockRepository;
  pantry: Pick<PantryService, 'stockSnapshot'>;
  shopping: ShoppingRepository;
  ingredients: IngredientLookup;
  converter: UnitConverter;
  /** Approved-plan requirements for the "will run low" projection. Optional; failures are ignored. */
  planRequirements?: (householdId: string) => Promise<PlanRequirement[]>;
  now: () => string;
}

const MAX_PARS = 300;
const MAX_VALUE = 100_000;
const MAX_NAME = 80;
const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();
const fail = (error: string): RestockResult => ({ ok: false, error });

/** A stable v4-shaped uuid from a seed: same seed -> same id, so retried / double-clicked adds are idempotent. */
export function stableUuid(seed: string): string {
  const h = createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const suggestionView = (s: RestockSuggestion): RestockSuggestionView => ({
  parId: s.parId, kind: s.kind, name: s.name, quantityLabel: unitText(s.quantity, s.unit), quantity: s.quantity, unit: s.unit,
  explanation: s.explanation, checkQuantity: s.checkQuantity, notes: s.notes,
});

export function createRestockService(deps: RestockDeps) {
  const { repo, ingredients } = deps;
  const shopCtx: EngineContext = { converter: deps.converter };

  /** Everything still to buy (and bought-but-not-yet-in-pantry), as engine inputs; also the log cursor for idempotent ids. */
  async function outstandingOnList(householdId: string): Promise<{ items: OutstandingItem[]; cursor: number }> {
    const snap = await deps.shopping.snapshot(householdId);
    const items: OutstandingItem[] = [];
    for (const v of deriveAll(snap.state, shopCtx)) {
      if (v.item.removed || v.noLongerNeeded) continue;
      const base = { name: v.item.displayName, ...(v.item.ingredientId ? { ingredientId: v.item.ingredientId } : {}) };
      if (v.quantified && v.unit) {
        if (v.outstanding > 0) items.push({ ...base, quantity: exactQty(v.outstanding, v.unit) });
      } else if (v.outstanding > 0) {
        items.push({ ...base, quantity: { kind: 'unparsed', originalText: v.item.displayName } });
      }
    }
    return { items, cursor: snap.cursor };
  }

  async function compute(householdId: string, opts: { withPlan: boolean; includeSnoozed?: boolean }) {
    const [settings, pars, stock, list] = await Promise.all([
      repo.getSettings(householdId), repo.listPars(householdId), deps.pantry.stockSnapshot(householdId), outstandingOnList(householdId),
    ]);
    const policy = makeCtx({ now: stock.now, staleAfterDays: stock.staleAfterDays }).policy;
    let planRequirements: PlanRequirement[] | undefined;
    if (opts.withPlan && pars.some((p) => p.enabled) && deps.planRequirements) {
      planRequirements = await deps.planRequirements(householdId).catch(() => []);
    }
    const o = { now: stock.now, policy, ...(planRequirements?.length ? { planRequirements } : {}) };
    const suggestions = restockSuggestions(stock.items, pars, [...list.items, ...stock.incoming], deps.converter, {
      ...o, ...(opts.includeSnoozed ? { includeSnoozed: true } : {}),
    });
    return { settings, pars, stock, suggestions, cursor: list.cursor, policy };
  }

  function parView(par: ParLevel, stock: { items: Parameters<typeof stockAvailable>[1]; now: string }, policy: { staleAfterDays: number }): ParView {
    const have = stockAvailable(par, stock.items, deps.converter, { now: stock.now, policy });
    const belowMin = par.enabled && have.total < par.minValue - 1e-9;
    const bits = [`Minimum ${unitText(par.minValue, par.unit)}`];
    if (par.restockToValue !== undefined && par.restockToValue > par.minValue) bits.push(`restock to ${unitText(par.restockToValue, par.unit)}`);
    if (par.pack) bits.push(`packs of ${unitText(par.pack.value, par.pack.unit)}`);
    const snoozed = !!par.snoozedUntil && par.snoozedUntil > today(stock.now);
    const status = !par.enabled ? 'Off'
      : `${unitText(have.total, par.unit)} in stock${belowMin ? ' - below minimum' : ''}${snoozed ? ` - snoozed until ${par.snoozedUntil}` : ''}`;
    return {
      id: par.id, key: parKey(par), name: par.name, ...(par.ingredientId ? { ingredientId: par.ingredientId } : {}),
      unit: par.unit, minValue: par.minValue,
      ...(par.restockToValue !== undefined ? { restockToValue: par.restockToValue } : {}),
      ...(par.pack ? { pack: par.pack } : {}),
      enabled: par.enabled, ...(par.snoozedUntil ? { snoozedUntil: par.snoozedUntil } : {}),
      label: bits.join(', '), available: have.total, status, belowMin,
    };
  }

  /** Submit one add_item per suggestion. Ids derive from (household, par, kind, quantity, list cursor): retries collapse. */
  async function addSuggestions(
    householdId: string, actor: string, chosen: readonly RestockSuggestion[], cursor: number,
  ): Promise<{ added: number; failed: number; names: string[] }> {
    let added = 0;
    let failed = 0;
    const names: string[] = [];
    for (const s of chosen) {
      const seed = `restock|${householdId}|${s.parId}|${s.kind}|${s.quantity}${s.unit}|${cursor}`;
      const ing = s.ingredientId ? ingredients.get(s.ingredientId) : undefined;
      const quantity: Quantity = exactQty(s.quantity, s.unit);
      const notes = s.kind === 'below_min'
        ? `Restock: ${unitText(s.available, s.unit)} left, minimum ${unitText(s.min, s.unit)}`
        : `Restock: will run low after this week's plan (minimum ${unitText(s.min, s.unit)})`;
      const cmd: Command = {
        type: 'add_item', commandId: stableUuid(`${seed}|cmd`), actor, at: deps.now(), itemId: stableUuid(`${seed}|item`),
        displayName: s.name.slice(0, 120), quantity, category: aisleForCategory(ing?.category), notes,
        ...(s.ingredientId ? { ingredientId: s.ingredientId } : {}),
      };
      const out = await deps.shopping.submit(householdId, cmd);
      if (out.result.status === 'applied') { added++; names.push(s.name); } else failed++;
    }
    return { added, failed, names };
  }

  return {
    async getView(householdId: string): Promise<RestockView> {
      const { settings, pars, stock, suggestions, policy } = await compute(householdId, { withPlan: true, includeSnoozed: true });
      const shown = suggestions.filter((s) => !s.snoozed);
      return {
        settings,
        pars: pars.map((p) => parView(p, stock, policy)).sort((a, b) => a.name.localeCompare(b.name)),
        suggestions: shown.filter((s) => s.kind === 'below_min').map(suggestionView),
        willRunLow: shown.filter((s) => s.kind === 'will_run_low').map(suggestionView),
        snoozedCount: suggestions.length - shown.length,
      };
    },

    /** Below-minimum suggestions only (banner on Shopping / Home). */
    async getBanner(householdId: string): Promise<RestockBannerData> {
      const { settings, suggestions } = await compute(householdId, { withPlan: false });
      const below = suggestions.filter((s) => s.kind === 'below_min');
      return {
        items: below.map((s) => ({ parId: s.parId, name: s.name, quantityLabel: unitText(s.quantity, s.unit), checkQuantity: s.checkQuantity })),
        signature: below.map((s) => `${s.parId}:${s.quantity}`).join('|'),
        autoAdd: settings.autoAdd,
      };
    },

    async setPar(householdId: string, input: SetParInput): Promise<RestockResult> {
      if (!(UNIT_OPTIONS as readonly string[]).includes(input.unit)) return fail('Choose a unit.');
      const unit = input.unit as RestockUnit;
      if (typeof input.min !== 'number' || !Number.isFinite(input.min) || input.min <= 0) return fail('The minimum must be more than zero.');
      if (input.min > MAX_VALUE) return fail('That minimum looks too large.');
      const restockTo = input.restockTo === null || input.restockTo === undefined ? undefined : input.restockTo;
      if (restockTo !== undefined) {
        if (typeof restockTo !== 'number' || !Number.isFinite(restockTo)) return fail('Restock-to must be a number.');
        if (restockTo < input.min) return fail('Restock-to cannot be below the minimum.');
        if (restockTo > MAX_VALUE) return fail('That restock-to looks too large.');
      }
      const hasPack = input.packValue !== null && input.packValue !== undefined;
      if (hasPack !== (input.packUnit !== null && input.packUnit !== undefined && input.packUnit !== '')) return fail('Give the pack size as a number and a unit, or leave both empty.');
      let pack: ParLevel['pack'];
      if (hasPack) {
        const pv = input.packValue as number;
        if (typeof pv !== 'number' || !Number.isFinite(pv) || pv <= 0 || pv > MAX_VALUE) return fail('The pack size must be more than zero.');
        if (!(UNIT_OPTIONS as readonly string[]).includes(String(input.packUnit))) return fail('Choose a unit for the pack size.');
        pack = { value: pv, unit: input.packUnit as RestockUnit };
      }
      const ing = input.ingredientId ? ingredients.get(input.ingredientId) : undefined;
      if (input.ingredientId && !ing) return fail('Unknown ingredient.');
      const name = collapse(ing?.name ?? input.name ?? '').slice(0, MAX_NAME);
      if (!name) return fail('Choose an ingredient or type a name.');
      if (pack && pack.unit !== unit && !deps.converter.convert(exactQ(pack.value, pack.unit), unit, ing?.id)) {
        return fail(`A pack in ${pack.unit} cannot be compared with a minimum in ${unit}. Use a matching unit.`);
      }

      const existing = await repo.listPars(householdId);
      const key = parKey({ ...(ing ? { ingredientId: ing.id } : {}), name });
      const target = existing.find((p) => parKey(p) === key)
        ?? (ing ? existing.find((p) => !p.ingredientId && parKey(p) === parKey({ name })) : undefined);
      if (!target && existing.length >= MAX_PARS) return fail(`You can set up to ${MAX_PARS} minimums.`);
      const par: ParLevel = {
        id: target?.id ?? randomUUID(),
        householdId, name, unit, minValue: input.min, enabled: input.enabled !== false,
        ...(ing ? { ingredientId: ing.id } : {}),
        ...(restockTo !== undefined ? { restockToValue: restockTo } : {}),
        ...(pack ? { pack } : {}),
      };
      await repo.savePar(householdId, par);
      return { ok: true, message: `Minimum for ${name} set to ${unitText(input.min, unit)}` };
    },

    async removePar(householdId: string, parId: string): Promise<RestockResult> {
      const target = (await repo.listPars(householdId)).find((p) => p.id === parId);
      if (!target) return fail('That minimum no longer exists.');
      await repo.deletePar(householdId, parId);
      return { ok: true, message: `Removed the minimum for ${target.name}` };
    },

    /** Hide one suggestion for N days (snooze / dismiss). */
    async snooze(householdId: string, parId: string, days: number = SNOOZE_DAYS): Promise<RestockResult> {
      if (!Number.isInteger(days) || days < 1 || days > 90) return fail('Snooze for between 1 and 90 days.');
      const target = (await repo.listPars(householdId)).find((p) => p.id === parId);
      if (!target) return fail('That minimum no longer exists.');
      await repo.savePar(householdId, { ...target, snoozedUntil: addDays(today(deps.now()), days) });
      return { ok: true, message: `${target.name}: hidden for ${days} day${days === 1 ? '' : 's'}` };
    },

    async updateSettings(householdId: string, settings: RestockSettings): Promise<RestockResult> {
      if (typeof settings?.autoAdd !== 'boolean') return fail('Choose on or off.');
      await repo.saveSettings(householdId, { autoAdd: settings.autoAdd });
      return { ok: true, message: settings.autoAdd ? 'Restock items will be added to your list automatically' : 'Restock items will only be suggested' };
    },

    /** Add suggestions to the shopping list: the given pars, or every below-minimum suggestion. Skips nothing silently. */
    async addToList(householdId: string, actor: string, parIds?: readonly string[]): Promise<RestockResult> {
      const { suggestions, cursor } = await compute(householdId, { withPlan: !!parIds });
      const wanted = parIds ? new Set(parIds) : null;
      const chosen = suggestions.filter((s) => (wanted ? wanted.has(s.parId) : s.kind === 'below_min'));
      if (chosen.length === 0) return { ok: true, message: 'Nothing to add: these are already covered.', added: 0 };
      const r = await addSuggestions(householdId, actor, chosen, cursor);
      if (r.added === 0) return fail('Could not add these to the shopping list. Please try again.');
      const what = r.added === 1 ? r.names[0]! : `${r.added} items`;
      return { ok: true, added: r.added, message: `Added ${what} to your shopping list${r.failed ? ` (${r.failed} could not be added)` : ''}` };
    },

    /**
     * Auto-add mode, called after every pantry write: when the household turned it on, add the below-minimum suggestions
     * (never ones flagged "check quantity", never snoozed ones). Safe to call repeatedly: what is on the list counts.
     */
    async autoAdd(householdId: string, actor: string): Promise<number> {
      const settings = await repo.getSettings(householdId);
      if (!settings.autoAdd) return 0;
      const { suggestions, cursor } = await compute(householdId, { withPlan: false });
      const chosen = suggestions.filter((s) => s.kind === 'below_min' && !s.checkQuantity);
      if (chosen.length === 0) return 0;
      return (await addSuggestions(householdId, actor, chosen, cursor)).added;
    },
  };
}

export type RestockService = ReturnType<typeof createRestockService>;
