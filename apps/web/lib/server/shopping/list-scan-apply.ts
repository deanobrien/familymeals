import { createHash } from 'node:crypto';
import type { Command, EngineContext, Quantity, ShoppingItem, ShoppingState, Unit } from '../../shopping/engine';
import { UNIT_LABELS, applyCommand, deriveItem, emptyState, itemKey } from '../../shopping/engine';
import { formatAmount } from '../../shopping/format';
import { AISLES } from '../../shopping/types';
import type {
  ListCommitRow, ListDestination, ListScanPreview, ListScanPreviewLine,
} from '../../shopping/list-scan-types';
import type { IngredientCatalogue } from '../refdata/catalogue';
import { DEFAULT_LIST_NAME, cleanListName, type ShoppingRepository } from './repository';

/**
 * Applying a reviewed handwritten list to the shopping list (DECISIONS D264-D267).
 *
 * One pure planner turns the reviewed rows into engine commands and simulates them over the destination list's state,
 * so the PREVIEW (read-only) and the CONFIRM (writes) can never disagree (same pattern as the pantry scan, D84).
 * Every command id is derived from the batch id + household + row key, so a double submit, a retry after a lost
 * response or a second tab replays the same ids and the repository's idempotency drops them: nothing is added twice.
 */

export const MAX_COMMIT_ROWS = 150;
const UNIT_KEYS = new Set(Object.keys(UNIT_LABELS));
const AISLE_SET = new Set<string>(AISLES);
const BATCH_RE = /^[\w-]{8,64}$/;

/** Deterministic UUID-shaped id from (kind, household, batch, key). */
export function derivedId(kind: string, householdId: string, batchId: string, key: string): string {
  const h = createHash('sha1').update(`${kind}\u0000${householdId}\u0000${batchId}\u0000${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const isBatchId = (v: unknown): v is string => typeof v === 'string' && BATCH_RE.test(v);

const clip = (v: unknown, max: number): string => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/**
 * Structural validation of reviewed rows from the browser (server actions are public endpoints). Unknown ingredient
 * ids degrade to free text, units outside the engine's list are refused, amounts must be positive and finite.
 */
export function sanitiseCommitRows(raw: unknown, cat: IngredientCatalogue): { rows: ListCommitRow[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'There is nothing to add.' };
  if (raw.length === 0) return { error: 'Choose at least one item to add.' };
  if (raw.length > MAX_COMMIT_ROWS) return { error: `You can add up to ${MAX_COMMIT_ROWS} items at a time.` };
  const rows: ListCommitRow[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') return { error: 'One of the items could not be read. Please go back and try again.' };
    const o = r as Record<string, unknown>;
    const key = clip(o.key, 40);
    if (!key || seen.has(key)) return { error: 'One of the items could not be read. Please go back and try again.' };
    seen.add(key);
    const ing = typeof o.ingredientId === 'string' ? cat.get(o.ingredientId) : undefined;
    const name = ing ? ing.name : clip(o.name, 120);
    if (!name) return { error: 'Every item needs a name.' };
    const row: ListCommitRow = { key, name };
    if (ing) row.ingredientId = ing.id;
    if (o.value !== undefined && o.value !== null && o.value !== '') {
      const value = Number(o.value);
      const unit = typeof o.unit === 'string' && UNIT_KEYS.has(o.unit) ? o.unit : undefined;
      if (!Number.isFinite(value) || value <= 0 || value > 100_000 || !unit) return { error: `Check the amount for ${name}.` };
      row.value = value;
      row.unit = unit;
    }
    const notes = clip(o.notes, 200);
    if (notes) row.notes = notes;
    row.aisle = typeof o.aisle === 'string' && AISLE_SET.has(o.aisle) ? o.aisle : 'Other';
    rows.push(row);
  }
  return { rows };
}

export const defaultNewListName = (now: Date): string =>
  `Shopping list - ${now.getUTCDate()} ${now.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;

export function parseDestination(raw: unknown, now: Date): ListDestination | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.kind === 'current') return { kind: 'current' };
  if (o.kind === 'new') return { kind: 'new', name: cleanListName(o.name) ?? defaultNewListName(now) };
  return null;
}

function quantityOf(row: ListCommitRow): Quantity | undefined {
  if (row.value === undefined || !row.unit) return undefined;
  const label = UNIT_LABELS[row.unit as Unit];
  return { kind: 'exact', value: row.value, unit: row.unit as Unit, originalText: `${row.value} ${label}`.trim() };
}

const isLive = (it: ShoppingItem): boolean => !it.removed;

function liveItems(state: ShoppingState): ShoppingItem[] {
  return state.itemOrder.map((id) => state.items[id]!).filter(isLive);
}

function amountOf(state: ShoppingState, item: ShoppingItem, ctx: EngineContext): string {
  const v = deriveItem(state, item, ctx);
  return v.quantified ? formatAmount(v.required, v.unit) : 'no amount';
}

export interface PlanInput {
  householdId: string;
  batchId: string;
  actor: string;
  at: string;
  ctx: EngineContext;
  cat: IngredientCatalogue;
}

export interface PlanLine {
  line: ListScanPreviewLine;
  command?: Command;
}

export interface ListScanPlan {
  lines: PlanLine[];
  commands: Command[];
  added: number;
  merged: number;
  skipped: number;
}

/**
 * Rows -> commands, simulated sequentially over `state` (so two "milk" lines combine, and a second no-quantity line
 * is "already on your list"). A row is linked to an existing item when it is the same ingredient (key), or when it
 * matches an ingredient that an existing hand-typed item (no ingredient id) names: it is then added under that
 * item's own name so the engine's merge key lines up and the quantities combine.
 */
export function planListScan(state0: ShoppingState, rows: ListCommitRow[], o: PlanInput): ListScanPlan {
  let state = state0;
  const lines: PlanLine[] = [];
  const commands: Command[] = [];
  let added = 0, merged = 0, skipped = 0;

  for (const row of rows) {
    const ing = row.ingredientId ? o.cat.get(row.ingredientId) : undefined;
    let ingredientId = ing?.id;
    let displayName = ing ? ing.name : row.name;
    const aisle = row.aisle ?? 'Other';
    const quantity = quantityOf(row);

    const live = liveItems(state);
    let target = live.find((it) => it.key === itemKey(ingredientId, displayName));
    if (!target && ing) {
      const typed = live.find((it) => {
        if (it.ingredientId) return false;
        const m = o.cat.matcher.match(it.displayName);
        return m.status === 'matched' && m.ingredientId === ing.id;
      });
      if (typed) { target = typed; ingredientId = undefined; displayName = typed.displayName; }
    }

    const base = { actor: o.actor, at: o.at };
    const commandId = derivedId('cmd', o.householdId, o.batchId, row.key);
    const itemId = derivedId('item', o.householdId, o.batchId, row.key);
    const mk = (): Command => {
      if (target && quantity && !deriveItem(state, target, o.ctx).quantified) {
        // The item is on the list with no amount ("eggs"): give it the written amount instead of a second line.
        return {
          ...base, commandId, type: 'edit_item', itemId: target.id,
          patch: { manualQuantity: quantity, ...(row.notes && !target.notes ? { notes: row.notes } : {}) },
        };
      }
      return {
        ...base, commandId, type: 'add_item', itemId, displayName, category: aisle,
        ...(ingredientId ? { ingredientId } : {}),
        ...(quantity ? { quantity } : {}),
        ...(row.notes ? { notes: row.notes } : {}),
      };
    };

    if (target && !quantity) {
      skipped++;
      lines.push({ line: { key: row.key, name: displayName, kind: 'exists', after: amountOf(state, target, o.ctx), aisle, note: 'Already on your list, so it is left as it is.' } });
      continue;
    }

    const cmd = mk();
    const before = state;
    const out = applyCommand(state, cmd, o.ctx);
    if (out.result.status === 'rejected') {
      skipped++;
      lines.push({ line: { key: row.key, name: displayName, kind: 'skip', after: '', aisle, note: 'This one could not be added.' } });
      continue;
    }
    state = out.state;
    commands.push(cmd);
    const resultId = out.result.itemId ?? itemId;
    const prev = before.items[resultId];
    const now = state.items[resultId];
    if (prev && now) {
      merged++;
      lines.push({ line: { key: row.key, name: now.displayName, kind: 'merge', before: amountOf(before, prev, o.ctx), after: amountOf(state, now, o.ctx), aisle: now.aisle ?? now.category }, command: cmd });
    } else {
      added++;
      const fresh = state.items[resultId];
      const separate = !!target && cmd.type === 'add_item';
      lines.push({
        line: {
          key: row.key, name: displayName, kind: 'new', after: fresh ? amountOf(state, fresh, o.ctx) : 'no amount', aisle,
          ...(separate ? { note: 'The units cannot be combined with the one already on your list, so this is a separate line.' } : {}),
        },
        command: cmd,
      });
    }
  }
  return { lines, commands, added, merged, skipped };
}

export function toPreview(plan: ListScanPlan, destination: ListDestination): ListScanPreview {
  return {
    destination: { kind: destination.kind, name: destination.kind === 'new' ? destination.name : 'your current list' },
    lines: plan.lines.map((l) => l.line),
    added: plan.added, merged: plan.merged, skipped: plan.skipped,
  };
}

export interface ApplyEnv {
  repo: ShoppingRepository;
  householdId: string;
  actor: string;
  ctx: EngineContext;
  cat: IngredientCatalogue;
  now?: () => Date;
}

/** Read-only: what confirming would do to the destination list. */
export async function previewListScan(env: ApplyEnv, rows: ListCommitRow[], destination: ListDestination, batchId: string): Promise<ListScanPreview> {
  const now = (env.now ?? (() => new Date()))();
  const state = destination.kind === 'new' ? emptyState() : (await env.repo.snapshot(env.householdId)).state;
  const plan = planListScan(state, rows, { householdId: env.householdId, batchId, actor: env.actor, at: now.toISOString(), ctx: env.ctx, cat: env.cat });
  return toPreview(plan, destination);
}

export interface ConfirmResult {
  listId: string | null;
  listName: string;
  created: boolean;
  added: number;
  merged: number;
  skipped: number;
  message: string;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The ONLY point where a list scan writes. `new`: create the list (idempotent on a batch-derived id; the previous
 * active list is archived whole), then add into it. `current`: add into the active list. Replays are harmless.
 */
export async function confirmListScan(env: ApplyEnv, rows: ListCommitRow[], destination: ListDestination, batchId: string): Promise<ConfirmResult> {
  const now = (env.now ?? (() => new Date()))();
  let listId: string | null = null;
  let listName = DEFAULT_LIST_NAME;
  let created = false;
  if (destination.kind === 'new') {
    const list = await env.repo.createList(env.householdId, { id: derivedId('list', env.householdId, batchId, 'new'), name: destination.name });
    listId = list.id;
    listName = list.name;
    created = true;
  }
  const snap = await env.repo.snapshot(env.householdId);
  if (destination.kind === 'current') {
    listId = snap.meta.listId ?? null;
    listName = snap.meta.listName ?? DEFAULT_LIST_NAME;
  }
  const plan = planListScan(snap.state, rows, { householdId: env.householdId, batchId, actor: env.actor, at: now.toISOString(), ctx: env.ctx, cat: env.cat });

  let added = 0, merged = 0, skipped = plan.skipped;
  for (const cmd of plan.commands) {
    const r = await env.repo.submit(env.householdId, cmd);
    if (r.result.status !== 'applied') { skipped++; continue; }
    // add_item reports the merged-into item's id; an edit_item always targets an existing item.
    if (cmd.type === 'edit_item' || (cmd.type === 'add_item' && r.result.itemId !== cmd.itemId)) merged++;
    else added++;
  }
  const parts = [
    added > 0 ? `added ${plural(added, 'new item', 'new items')}` : '',
    merged > 0 ? `combined ${merged} with ${merged === 1 ? 'an item' : 'items'} already on the list` : '',
    skipped > 0 ? `left ${plural(skipped, 'item', 'items')} as ${skipped === 1 ? 'it was' : 'they were'}` : '',
  ].filter(Boolean);
  const body = parts.length ? parts.join(', ') : 'nothing to add';
  const message = created
    ? `Created "${listName}": ${body}.`
    : `${body.charAt(0).toUpperCase()}${body.slice(1)}.`;
  return { listId, listName, created, added, merged, skipped, message };
}
