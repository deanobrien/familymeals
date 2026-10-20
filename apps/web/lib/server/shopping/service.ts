import type { Command, Quantity, RegenerateLine } from '../../shopping/engine';
import { UNIT_LABELS } from '../../shopping/engine';
import type { SyncResponse } from '../../shopping/types';
import type { ShoppingRepository } from './repository';
import { categoryFor, type RequirementSource } from './requirement-source';

const TYPES = ['tick', 'purchase', 'undo', 'add_item', 'edit_item', 'remove_item', 'regenerate'] as const;
const KINDS = ['exact', 'range', 'approximate', 'to_taste', 'unparsed'];
const MAX_COMMANDS = 100;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const optStr = (v: unknown, max = 500): boolean => v === undefined || (typeof v === 'string' && v.length <= max);
const optNum = (v: unknown): boolean => v === undefined || (typeof v === 'number' && Number.isFinite(v));

function validQuantity(q: unknown): q is Quantity {
  return (
    isObj(q) && typeof q.kind === 'string' && KINDS.includes(q.kind) &&
    typeof q.originalText === 'string' && q.originalText.length <= 200 &&
    optNum(q.value) && optNum(q.min) && optNum(q.max) &&
    (q.unit === undefined || (typeof q.unit === 'string' && Object.hasOwn(UNIT_LABELS, q.unit)))
  );
}

/**
 * Structural validation of a command received from a client (server actions are public endpoints).
 * Returns the command or null. syncList() replaces `actor` with the session member when one is given.
 */
export function parseCommand(raw: unknown): Command | null {
  if (!isObj(raw) || !str(raw.commandId, 64) || !str(raw.actor, 64) || !str(raw.at, 40)) return null;
  if (typeof raw.type !== 'string' || !(TYPES as readonly string[]).includes(raw.type)) return null;
  switch (raw.type) {
    case 'tick':
    case 'remove_item':
      return str(raw.itemId, 64) ? (raw as unknown as Command) : null;
    case 'undo':
      return str(raw.eventId, 64) ? (raw as unknown as Command) : null;
    case 'purchase':
      return str(raw.itemId, 64) && validQuantity(raw.quantity) && optNum(raw.actualPricePence) ? (raw as unknown as Command) : null;
    case 'add_item':
      return str(raw.itemId, 64) && str(raw.displayName, 120) && str(raw.category, 60) &&
        optStr(raw.aisle, 60) && optStr(raw.notes) && optStr(raw.ingredientId, 64) &&
        (raw.quantity === undefined || validQuantity(raw.quantity))
        ? (raw as unknown as Command) : null;
    case 'edit_item': {
      const p = raw.patch;
      if (!str(raw.itemId, 64) || !isObj(p)) return null;
      const ok =
        (p.displayName === undefined || str(p.displayName, 120)) &&
        (p.category === undefined || str(p.category, 60)) &&
        (p.aisle === undefined || p.aisle === null || typeof p.aisle === 'string') &&
        (p.notes === undefined || p.notes === null || (typeof p.notes === 'string' && p.notes.length <= 500)) &&
        (p.manualQuantity === undefined || p.manualQuantity === null || validQuantity(p.manualQuantity));
      return ok ? (raw as unknown as Command) : null;
    }
    case 'regenerate':
      return null; // server-built only (see generateFromPlan); never accepted from clients.
  }
  return null;
}

/**
 * Apply client commands (idempotent: retries are safe), then return everything the client needs to
 * catch up: log entries after its cursor. Invalid commands are dropped, not applied.
 */
export async function syncList(
  repo: ShoppingRepository, householdId: string, rawCommands: unknown[], cursor: number, sessionActor?: string,
  /** The list the client is showing (SL1, D263). When the household's active list is another one (someone switched or
   *  started a new list) the client's pending commands were meant for a different list: they are dropped and the new
   *  list is returned as a snapshot, never applied to or replayed against the wrong list. */
  expectedListId?: string | null,
): Promise<SyncResponse> {
  const results: SyncResponse['results'] = [];
  const dropped: string[] = [];
  if (expectedListId) {
    const current = await repo.activeListId(householdId);
    if (current !== expectedListId) {
      for (const raw of rawCommands.slice(0, MAX_COMMANDS)) if (isObj(raw) && str(raw.commandId, 64)) dropped.push(raw.commandId);
      const snapshot = await repo.snapshot(householdId);
      return { cursor: snapshot.cursor, entries: [], snapshot, results, dropped, meta: snapshot.meta };
    }
  }
  for (const raw of rawCommands.slice(0, MAX_COMMANDS)) {
    const cmd = parseCommand(raw);
    if (!cmd) {
      if (isObj(raw) && str(raw.commandId, 64)) dropped.push(raw.commandId);
      continue;
    }
    results.push((await repo.submit(householdId, sessionActor ? { ...cmd, actor: sessionActor } : cmd)).result);
  }
  const head = await repo.head(householdId);
  const meta = await repo.getMeta(householdId);
  const safeCursor = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0;
  if (safeCursor > head) {
    return { cursor: head, entries: [], snapshot: await repo.snapshot(householdId), results, dropped, meta };
  }
  return { cursor: head, entries: await repo.entriesSince(householdId, safeCursor), results, dropped, meta };
}

/** Build + apply the regenerate command for a plan. Returns null when the plan is unknown. */
export async function generateFromPlan(
  repo: ShoppingRepository, source: RequirementSource, householdId: string,
  planId: string, actor: string, newId: () => string, now: () => string = () => new Date().toISOString(),
): Promise<{ planName: string; lineCount: number } | null> {
  const plan = await source.forPlan(householdId, planId);
  if (!plan) return null;
  await repo.mergeMeta(householdId, { recipeTitles: plan.recipeTitles });
  const lines: RegenerateLine[] = plan.requirements.map((requirement) => ({
    itemId: newId(), requirement,
    category: (requirement.ingredientId && plan.categories?.[requirement.ingredientId]) || categoryFor(requirement),
  }));
  const cmd: Command = { type: 'regenerate', commandId: newId(), actor, at: now(), lines };
  await repo.submit(householdId, cmd);
  return { planName: plan.planName, lineCount: lines.length };
}
