import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { SupabaseDataSource } from '@/data/supabaseDataSource';
import { OfflineStore, type KeyValueStore } from '@/data/offlineQueue';
import type { Connectivity } from '@/lib/connectivity';
import { parseStoreBook } from '@/lib/storeBook';
import ShoppingListScreen from '@/screens/ShoppingListScreen';
import { FakeBackend, HH, uid } from './helpers/fakeSupabase';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));

jest.setTimeout(30000); // renders the whole screen; slow when the machine is busy

const S = uid(300);
const A1 = uid(301);
const A2 = uid(302);

function memoryKv(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) };
}
const online: Connectivity = { subscribe: (cb) => (cb(true), () => undefined) };

function SetHousehold({ children }: { children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId(HH), [setHouseholdId]);
  return householdId ? <>{children}</> : null;
}

function backendWithStore() {
  const backend = new FakeBackend();
  backend.storeBook = {
    stores: [{ id: S, name: 'ALDI Gosforth', chain: 'ALDI', notes: null }],
    aisles: [
      { id: A2, storeId: S, label: 'Frozen', sortOrder: 20 },
      { id: A1, storeId: S, label: '1', sortOrder: 10 },
    ],
    placements: [
      { storeId: S, targetType: 'category', targetKey: 'Baking', aisleId: A2 },
      { storeId: S, targetType: 'category', targetKey: 'Dairy', aisleId: A1 },
    ],
  };
  return backend;
}

async function mount(backend: FakeBackend, kv = memoryKv()) {
  let n = 3000;
  const ds = new SupabaseDataSource({ client: backend.asClient(), store: new OfflineStore(kv), newId: () => uid(n++) });
  await render(
    <AppProvider dataSource={ds} connectivity={online}>
      <SetHousehold>
        <ShoppingListScreen />
      </SetHousehold>
    </AppProvider>,
  );
  return { ds, kv };
}

describe('store aisles on the shopping screen', () => {
  it('hides the store selector when the household has no stores', async () => {
    await mount(new FakeBackend());
    await screen.findByLabelText(/Milk, 2 l/);
    expect(screen.queryByTestId(`store-${S}`)).toBeNull();
    expect(screen.queryByTestId('store-none')).toBeNull();
  });

  it('orders the list by the chosen store (aisle headers, unplaced last) and goes back to category order', async () => {
    const { ds } = await mount(backendWithStore());
    await screen.findByLabelText(/Milk, 2 l/);
    await fireEvent.press(await screen.findByTestId(`store-${S}`));
    const headers = async () => (await screen.findAllByRole('header')).map((h) => h.props.children);
    await waitFor(async () => expect(await headers()).toEqual(['Aisle 1', 'Frozen']));
    // Dairy (aisle 1) first, then Baking (Frozen); nothing is unplaced here
    expect(screen.getByTestId(`place-${uid(1)}`)).toBeTruthy();
    expect(await ds.getSelectedStoreId(HH)).toBe(S);
    await fireEvent.press(screen.getByTestId('store-none'));
    await waitFor(() => expect(screen.queryAllByRole('header')).toHaveLength(0));
  });

  it('quick placement: an unplaced item is put in an aisle, saved for the store, and moves there', async () => {
    const backend = backendWithStore();
    backend.storeBook.placements = [{ storeId: S, targetType: 'category', targetKey: 'Dairy', aisleId: A1 }]; // Baking items unplaced
    await mount(backend);
    await screen.findByLabelText(/Flour, 1 kg/);
    await fireEvent.press(await screen.findByTestId(`store-${S}`));
    await waitFor(async () => expect((await screen.findAllByRole('header')).map((h) => h.props.children)).toEqual(['Aisle 1', 'Not placed yet']));
    await fireEvent.press(screen.getByTestId(`place-${uid(3)}`)); // Flour
    await fireEvent.press(await screen.findByTestId(`aisle-${A2}`)); // Frozen
    await waitFor(() => expect(backend.storeBook.placements).toContainEqual({ storeId: S, targetType: 'item', targetKey: 'flour', aisleId: A2 }));
    await waitFor(async () => expect((await screen.findAllByRole('header')).map((h) => h.props.children)).toEqual(['Aisle 1', 'Frozen', 'Not placed yet']));
  });
});

describe('store book data source', () => {
  it('falls back to the cached book when offline and remembers the selected store', async () => {
    const backend = backendWithStore();
    const kv = memoryKv();
    const ds = new SupabaseDataSource({ client: backend.asClient(), store: new OfflineStore(kv) });
    const online1 = await ds.getStoreBook(HH);
    expect(online1.stores).toHaveLength(1);
    backend.offline = true;
    const offline = await new SupabaseDataSource({ client: backend.asClient(), store: new OfflineStore(kv) }).getStoreBook(HH);
    expect(offline).toEqual(online1);
    await ds.setSelectedStoreId(HH, S);
    expect(await new SupabaseDataSource({ client: backend.asClient(), store: new OfflineStore(kv) }).getSelectedStoreId(HH)).toBe(S);
    // nothing cached and offline: an empty book, never a throw
    const fresh = await new SupabaseDataSource({ client: backend.asClient(), store: new OfflineStore(memoryKv()) }).getStoreBook(HH);
    expect(fresh).toEqual({ stores: [], aisles: [], placements: [] });
  });

  it('parses a store book payload defensively', () => {
    expect(parseStoreBook(null)).toEqual({ stores: [], aisles: [], placements: [] });
    const b = parseStoreBook({ stores: [{ id: 's', name: 'S' }, {}], aisles: [{ id: 'a', storeId: 's', label: '1', sortOrder: 10 }], placements: [{ storeId: 's', aisleId: 'a', targetType: 'nope', targetKey: 'x' }] });
    expect(b.stores).toHaveLength(1);
    expect(b.aisles).toHaveLength(1);
    expect(b.placements).toHaveLength(0);
  });
});
