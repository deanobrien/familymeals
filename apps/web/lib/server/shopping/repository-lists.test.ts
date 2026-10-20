import { describe, expect, it } from 'vitest';
import { ShoppingController, type PendingStore, type Transport } from '../../shopping/controller';
import { deriveAll, defaultEngineContext } from '../../shopping/engine';
import { InMemoryShoppingRepository, cleanListName } from './repository';
import { syncList } from './service';

const HH = 'hh';
let n = 0;
const id = () => `l-${++n}`;
const at = '2026-10-20T10:00:00.000Z';
const add = (repo: InMemoryShoppingRepository, name: string) =>
  repo.submit(HH, { type: 'add_item', commandId: id(), actor: 'a', at, itemId: id(), displayName: name, category: 'Other' });

describe('InMemoryShoppingRepository: several lists, one active (D263)', () => {
  it('starts with one default active list that has an id and a name', async () => {
    const repo = new InMemoryShoppingRepository();
    const lists = await repo.listLists(HH);
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ name: 'Shopping list', status: 'active' });
    expect((await repo.snapshot(HH)).meta).toMatchObject({ listId: lists[0]!.id, listName: 'Shopping list' });
  });

  it('create archives the old list whole, is idempotent on the id, and each list keeps its own log and cursor', async () => {
    const repo = new InMemoryShoppingRepository();
    await add(repo, 'Milk');
    const first = (await repo.activeListId(HH))!;
    const made = await repo.createList(HH, { id: 'new-1', name: ' Weekend  shop ' });
    expect(made).toMatchObject({ name: 'Weekend shop', status: 'active' });
    expect((await repo.createList(HH, { id: 'new-1', name: 'ignored' })).name).toBe('Weekend shop');
    expect(await repo.head(HH)).toBe(0);
    expect((await repo.snapshot(HH)).state.itemOrder).toHaveLength(0);
    await add(repo, 'Eggs');
    expect(await repo.head(HH)).toBe(1);
    expect(await repo.activateList(HH, first)).toBe(true);
    const snap = await repo.snapshot(HH);
    expect(deriveAll(snap.state, defaultEngineContext).map((v) => v.item.displayName)).toEqual(['Milk']);
    expect((await repo.listLists(HH)).map((l) => [l.name, l.status])).toEqual([['Shopping list', 'active'], ['Weekend shop', 'archived']]);
    expect(await repo.activateList(HH, 'nope')).toBe(false);
  });

  it('rename, archive-active (next write starts a fresh default list), and a nameless list is refused', async () => {
    const repo = new InMemoryShoppingRepository();
    await add(repo, 'Milk');
    const first = (await repo.activeListId(HH))!;
    expect(await repo.renameList(HH, first, '  Big   shop ')).toBe(true);
    expect(await repo.renameList(HH, first, '   ')).toBe(false);
    expect((await repo.snapshot(HH)).meta.listName).toBe('Big shop');
    expect(await repo.archiveActiveList(HH)).toBe(true);
    expect(await repo.activeListId(HH)).toBeNull();
    expect((await repo.snapshot(HH)).state.itemOrder).toHaveLength(0);
    expect(await repo.archiveActiveList(HH)).toBe(false);
    await add(repo, 'Tea');
    expect((await repo.listLists(HH)).map((l) => [l.name, l.status])).toEqual([['Shopping list', 'active'], ['Big shop', 'archived']]);
    await expect(repo.createList(HH, { id: 'x', name: '  ' })).rejects.toThrow();
    expect(cleanListName('  a   b ')).toBe('a b');
    expect(cleanListName('')).toBeNull();
  });

  it('households stay separate', async () => {
    const repo = new InMemoryShoppingRepository();
    await repo.createList(HH, { id: 'a', name: 'Mine' });
    expect((await repo.listLists('other')).map((l) => l.name)).toEqual(['Shopping list']);
  });
});

describe('syncList list guard and the controller (D263)', () => {
  it('a client on a list that is no longer active gets the new list and its pending commands dropped', async () => {
    const repo = new InMemoryShoppingRepository();
    await add(repo, 'Milk');
    const stale = (await repo.activeListId(HH))!;
    await repo.createList(HH, { id: 'fresh', name: 'Fresh' });
    const res = await syncList(repo, HH, [{ type: 'add_item', commandId: 'p1', actor: 'a', at, itemId: 'i1', displayName: 'Stale', category: 'Other' }], 1, 'a', stale);
    expect(res.snapshot?.meta.listName).toBe('Fresh');
    expect(res.dropped).toEqual(['p1']);
    expect((await repo.snapshot(HH)).state.itemOrder).toHaveLength(0);
    // no list id from the client = no guard (older clients / mobile)
    const open = await syncList(repo, HH, [], 0, 'a');
    expect(open.snapshot).toBeUndefined();
  });

  it('the controller sends its list id, and adopts the new list from the snapshot', async () => {
    const repo = new InMemoryShoppingRepository();
    await add(repo, 'Milk');
    const seen: Array<string | undefined> = [];
    const transport: Transport = {
      sync: async (cmds, cursor, listId) => { seen.push(listId); return syncList(repo, HH, cmds, cursor, 'a', listId); },
      snapshot: async () => repo.snapshot(HH),
    };
    let saved: never[] = [];
    const store: PendingStore = { load: () => saved, save: () => { saved = []; } };
    const c = new ShoppingController(await repo.snapshot(HH), { transport, store, actor: () => 'a', newId: id });
    const first = c.getState().meta.listId;
    expect(first).toBeTruthy();
    await c.sync();
    expect(seen).toEqual([first]);
    await repo.createList(HH, { id: 'fresh', name: 'Fresh' });
    await add(repo, 'Eggs');
    await c.sync();
    expect(c.getState().meta).toMatchObject({ listId: 'fresh', listName: 'Fresh' });
    expect(deriveAll(c.getState().view, defaultEngineContext).map((v) => v.item.displayName)).toEqual(['Eggs']);
    await c.sync();
    expect(seen.at(-1)).toBe('fresh');
  });
});
