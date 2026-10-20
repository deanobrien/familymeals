import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { ServerApiProvider } from '@/data/ServerApiContext';
import { ServerApiError, type ServerApi } from '@/lib/serverApi';
import ShoppingListScreen from '@/screens/ShoppingListScreen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }) }));

type L = { id: string; name: string; active: boolean };
const row = (l: L) => ({ id: l.id, name: l.name, status: l.active ? 'active' : 'archived', active: l.active, archived: !l.active, updatedAt: '2026-10-19T10:00:00Z' });

function fakeApi(opts: { configured?: boolean; failWith?: ServerApiError } = {}) {
  let lists: L[] = [{ id: 'l1', name: 'Weekly shop', active: true }, { id: 'l0', name: 'Birthday', active: false }];
  const posts: Array<Record<string, unknown>> = [];
  let fail = opts.failWith;
  const out = () => ({ lists: lists.map(row) });
  const api: ServerApi = {
    configured: opts.configured ?? true,
    get: async () => out() as never,
    post: async (_p, body) => {
      const b = body as Record<string, unknown>;
      posts.push(b);
      if (fail) { const e = fail; fail = undefined; throw e; }
      if (b.action === 'create') lists = [{ id: 'l9', name: String(b.name), active: true }, ...lists.map((l) => ({ ...l, active: false }))];
      if (b.action === 'switch') lists = lists.map((l) => ({ ...l, active: l.id === b.listId }));
      if (b.action === 'rename') lists = lists.map((l) => (l.id === b.listId ? { ...l, name: String(b.name) } : l));
      if (b.action === 'archive') lists = lists.map((l) => ({ ...l, active: false }));
      return { ok: true, ...out() } as never;
    },
    postForm: async () => { throw new Error('unused'); },
    webUrl: () => null,
    authHeaders: async () => ({}),
  };
  return { api, posts };
}

function SetHousehold({ children }: { children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId('hh-1'), [setHouseholdId]);
  return householdId ? <>{children}</> : null;
}

async function mount(f = fakeApi()) {
  const ds = new MockDataSource();
  const getList = jest.spyOn(ds, 'getShoppingList');
  await render(
    <AppProvider dataSource={ds}>
      <ServerApiProvider api={f.api}>
        <SetHousehold>
          <ShoppingListScreen />
        </SetHousehold>
      </ServerApiProvider>
    </AppProvider>,
  );
  return { ...f, getList };
}

beforeEach(() => mockPush.mockClear());

describe('shopping lists sheet', () => {
  it('is hidden when the server is not configured (mock mode)', async () => {
    const f = await mount(fakeApi({ configured: false }));
    await waitFor(() => expect(f.getList).toHaveBeenCalled());
    await screen.findByTestId('item-' + (await f.getList.mock.results[0]!.value).items[0].id);
    expect(screen.queryByTestId('lists-open')).toBeNull();
    expect(screen.queryByTestId('list-scan-open')).toBeNull();
  });

  it('shows the current list name and opens a sheet with the earlier lists', async () => {
    await mount();
    expect(await screen.findByLabelText('Shopping lists, current list Weekly shop')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('lists-open'));
    expect(await screen.findByTestId('lists-sheet')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('lists-rename-input').props.value).toBe('Weekly shop'));
    expect(screen.getByLabelText('Switch to Birthday')).toBeTruthy();
  });

  it('create posts the name, re-reads the list and updates the header', async () => {
    const f = await mount();
    await fireEvent.press(await screen.findByTestId('lists-open'));
    await screen.findByTestId('lists-new-input');
    const before = f.getList.mock.calls.length;
    await fireEvent.changeText(screen.getByTestId('lists-new-input'), 'Weekend shop');
    await fireEvent.press(screen.getByTestId('lists-create'));
    await waitFor(() => expect(f.posts).toEqual([{ householdId: 'hh-1', action: 'create', name: 'Weekend shop' }]));
    await waitFor(() => expect(f.getList.mock.calls.length).toBeGreaterThan(before));
    expect(await screen.findByLabelText('Shopping lists, current list Weekend shop')).toBeTruthy();
  });

  it('switch, rename and archive call the right action', async () => {
    const f = await mount();
    await fireEvent.press(await screen.findByTestId('lists-open'));
    await fireEvent.press(await screen.findByTestId('lists-switch-l0'));
    await waitFor(() => expect(f.posts[0]).toEqual({ householdId: 'hh-1', action: 'switch', listId: 'l0' }));
    expect(await screen.findByLabelText('Shopping lists, current list Birthday')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('lists-open'));
    await waitFor(() => expect(screen.getByTestId('lists-rename-input').props.value).toBe('Birthday'));
    await fireEvent.changeText(screen.getByTestId('lists-rename-input'), 'Party');
    await fireEvent.press(screen.getByTestId('lists-rename'));
    await waitFor(() => expect(f.posts[1]).toEqual({ householdId: 'hh-1', action: 'rename', listId: 'l0', name: 'Party' }));
    expect(await screen.findByLabelText('Shopping lists, current list Party')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('lists-archive'));
    await fireEvent.press(await screen.findByTestId('lists-archive-confirm'));
    await waitFor(() => expect(f.posts[2]).toEqual({ householdId: 'hh-1', action: 'archive' }));
    await waitFor(() => expect(screen.getByLabelText('Shopping lists')).toBeTruthy());
  });

  it('shows the server message (read-only household) and keeps the sheet open', async () => {
    const f = await mount(fakeApi({ failWith: new ServerApiError('This household is read-only while it is pending deletion.', 403, false, 'READ_ONLY') }));
    await fireEvent.press(await screen.findByTestId('lists-open'));
    await fireEvent.changeText(await screen.findByTestId('lists-new-input'), 'X');
    await fireEvent.press(screen.getByTestId('lists-create'));
    expect(await screen.findByText('This household is read-only while it is pending deletion.')).toBeTruthy();
    expect(screen.getByTestId('lists-sheet')).toBeTruthy();
    expect(f.posts).toHaveLength(1);
  });

  it('the scan button opens the handwritten list scan', async () => {
    await mount();
    await fireEvent.press(await screen.findByTestId('list-scan-open'));
    expect(mockPush).toHaveBeenCalledWith('/shopping-scan');
  });
});
