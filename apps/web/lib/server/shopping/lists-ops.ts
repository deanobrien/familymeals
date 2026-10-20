// The shopping-lists operations (D263) with the household passed in, shared by the web server actions
// (app/shopping/actions.ts, cookie-bound) and the Android JSON API (app/api/shopping/lists, bearer-capable, D346).
import { randomUUID } from 'node:crypto';
import { cleanListName, type ShoppingRepository } from './repository';

export type ListOpResult = { ok: true } | { ok: false; error: string };

export async function createListOp(repo: ShoppingRepository, hh: string, name: unknown): Promise<ListOpResult> {
  const clean = cleanListName(name);
  if (!clean) return { ok: false, error: 'Give the list a name.' };
  await repo.createList(hh, { id: randomUUID(), name: clean });
  return { ok: true };
}

export async function switchListOp(repo: ShoppingRepository, hh: string, listId: unknown): Promise<ListOpResult> {
  return (await repo.activateList(hh, String(listId))) ? { ok: true } : { ok: false, error: 'That list could not be found.' };
}

export async function renameListOp(repo: ShoppingRepository, hh: string, listId: unknown, name: unknown): Promise<ListOpResult> {
  if (!cleanListName(name)) return { ok: false, error: 'Give the list a name.' };
  return (await repo.renameList(hh, String(listId), String(name))) ? { ok: true } : { ok: false, error: 'That list could not be found.' };
}

export async function archiveListOp(repo: ShoppingRepository, hh: string): Promise<ListOpResult> {
  return (await repo.archiveActiveList(hh)) ? { ok: true } : { ok: false, error: 'There is no current list to archive.' };
}
