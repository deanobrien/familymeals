'use server';

// Server actions for stores, aisles and placements (AS1, D290-D293). Every action scopes by the signed-in household,
// validates its input, refuses writes while the household is read-only, and returns the fresh StoreBook so the client
// can replace its cache in one step.
import { getAppContext } from '../../lib/server/context';
import { StoreBookError, applyTemplate, type StoreBookRepository } from '../../lib/server/stores/repository';
import { getStoreBook } from '../../lib/server/stores/store';
import type { StoreBook } from '../../lib/shopping/engine';
import { AisleLabel, Id, PlacementTarget, StoreFields, StorePatch, TemplateId } from '../../lib/stores/schema';

export type StoreActionResult = { ok: true; book: StoreBook; id?: string } | { ok: false; error: string };

async function run(write: boolean, fn: (repo: StoreBookRepository, householdId: string) => Promise<string | void>): Promise<StoreActionResult> {
  const ctx = await getAppContext();
  if (write && ctx.readOnly) return { ok: false, error: 'This household is read-only while it is waiting to be deleted.' };
  const repo = getStoreBook();
  try {
    const id = await fn(repo, ctx.householdId);
    const book = await repo.book(ctx.householdId);
    return { ok: true, book, ...(typeof id === 'string' ? { id } : {}) };
  } catch (e) {
    // by name, not instanceof: Next can load this module twice (action layer and RSC layer), giving two classes
    if (e instanceof StoreBookError || (e instanceof Error && e.name === 'StoreBookError')) return { ok: false, error: e.message };
    console.error('[stores] action failed', e instanceof Error ? e.message : e);
    return { ok: false, error: 'That could not be saved. Please try again.' };
  }
}

const bad = (message: string): StoreActionResult => ({ ok: false, error: message });
const firstIssue = (e: { issues: Array<{ message: string }> }): string => e.issues[0]?.message ?? 'Check what you entered.';

export async function loadStoreBook(): Promise<StoreActionResult> {
  return run(false, async () => undefined);
}

export async function createStoreAction(fields: unknown, templateId?: unknown): Promise<StoreActionResult> {
  const f = StoreFields.safeParse(fields);
  if (!f.success) return bad(firstIssue(f.error));
  const t = templateId === undefined || templateId === null || templateId === '' ? null : TemplateId.safeParse(templateId);
  if (t && !t.success) return bad('Unknown starting layout.');
  return run(true, async (repo, h) => {
    const store = await repo.createStore(h, f.data);
    if (t?.success) await applyTemplate(repo, h, store.id, t.data);
    return store.id;
  });
}

export async function updateStoreAction(storeId: unknown, patch: unknown): Promise<StoreActionResult> {
  const id = Id.safeParse(storeId);
  const p = StorePatch.safeParse(patch);
  if (!id.success) return bad('Unknown store.');
  if (!p.success) return bad(firstIssue(p.error));
  const clean = Object.fromEntries(Object.entries(p.data).filter(([, v]) => v !== undefined));
  return run(true, async (repo, h) => { await repo.updateStore(h, id.data, clean); });
}

export async function deleteStoreAction(storeId: unknown): Promise<StoreActionResult> {
  const id = Id.safeParse(storeId);
  if (!id.success) return bad('Unknown store.');
  return run(true, (repo, h) => repo.deleteStore(h, id.data));
}

export async function addAisleAction(storeId: unknown, label: unknown): Promise<StoreActionResult> {
  const id = Id.safeParse(storeId);
  const l = AisleLabel.safeParse(label);
  if (!id.success) return bad('Unknown store.');
  if (!l.success) return bad(firstIssue(l.error));
  return run(true, async (repo, h) => (await repo.addAisle(h, id.data, l.data)).id);
}

export async function renameAisleAction(aisleId: unknown, label: unknown): Promise<StoreActionResult> {
  const id = Id.safeParse(aisleId);
  const l = AisleLabel.safeParse(label);
  if (!id.success) return bad('Unknown aisle.');
  if (!l.success) return bad(firstIssue(l.error));
  return run(true, (repo, h) => repo.renameAisle(h, id.data, l.data));
}

export async function reorderAislesAction(storeId: unknown, orderedAisleIds: unknown): Promise<StoreActionResult> {
  const id = Id.safeParse(storeId);
  const ids = Array.isArray(orderedAisleIds) ? orderedAisleIds.map((x) => Id.safeParse(x)) : [];
  if (!id.success || ids.length === 0 || ids.some((x) => !x.success)) return bad('That order could not be understood.');
  return run(true, (repo, h) => repo.reorderAisles(h, id.data, ids.map((x) => (x as { data: string }).data)));
}

export async function deleteAisleAction(aisleId: unknown): Promise<StoreActionResult> {
  const id = Id.safeParse(aisleId);
  if (!id.success) return bad('Unknown aisle.');
  return run(true, (repo, h) => repo.deleteAisle(h, id.data));
}

/** `aisleId = null` clears the placement. */
export async function setPlacementAction(storeId: unknown, target: unknown, aisleId: unknown): Promise<StoreActionResult> {
  const sid = Id.safeParse(storeId);
  const t = PlacementTarget.safeParse(target);
  const aid = aisleId === null ? null : Id.safeParse(aisleId);
  if (!sid.success || !t.success || (aid && !aid.success)) return bad('That placement could not be understood.');
  return run(true, (repo, h) => repo.setPlacement(h, sid.data, t.data.targetType, t.data.targetKey, aid ? (aid as { data: string }).data : null));
}

export async function applyStoreTemplateAction(storeId: unknown, templateId: unknown): Promise<StoreActionResult> {
  const sid = Id.safeParse(storeId);
  const t = TemplateId.safeParse(templateId);
  if (!sid.success || !t.success) return bad('Unknown store or layout.');
  return run(true, (repo, h) => applyTemplate(repo, h, sid.data, t.data));
}

export async function copyStoreLayoutAction(fromStoreId: unknown, toStoreId: unknown): Promise<StoreActionResult> {
  const from = Id.safeParse(fromStoreId);
  const to = Id.safeParse(toStoreId);
  if (!from.success || !to.success) return bad('Unknown store.');
  return run(true, async (repo, h) => { await repo.copyLayout(h, from.data, to.data); });
}
