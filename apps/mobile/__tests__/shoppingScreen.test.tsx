import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { SupabaseDataSource } from '@/data/supabaseDataSource';
import { OfflineStore, type KeyValueStore } from '@/data/offlineQueue';
import type { Connectivity } from '@/lib/connectivity';
import ShoppingListScreen from '@/screens/ShoppingListScreen';
import { FakeBackend, HH, uid } from './helpers/fakeSupabase';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));

function memoryKv(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

function fakeConnectivity() {
  const subs: Array<(online: boolean) => void> = [];
  const c: Connectivity & { emit: (online: boolean) => void } = {
    subscribe(cb) {
      subs.push(cb);
      cb(true);
      return () => void subs.splice(subs.indexOf(cb), 1);
    },
    emit: (online) => subs.forEach((s) => s(online)),
  };
  return c;
}

function SetHousehold({ children }: { children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId(HH), [setHouseholdId]);
  return householdId ? <>{children}</> : null;
}

async function mount() {
  const backend = new FakeBackend();
  let n = 2000;
  const ds = new SupabaseDataSource({ client: backend.asClient(), store: new OfflineStore(memoryKv()), newId: () => uid(n++) });
  const net = fakeConnectivity();
  await render(
    <AppProvider dataSource={ds} connectivity={net}>
      <SetHousehold>
        <ShoppingListScreen />
      </SetHousehold>
    </AppProvider>,
  );
  return { backend, ds, net };
}

describe('ShoppingListScreen with the Supabase data source', () => {
  it('shows an offline banner, queues the tick, and replays it on reconnect', async () => {
    const { backend, net } = await mount();
    const milk = await screen.findByLabelText(/Milk, 2 l/);
    await act(async () => net.emit(false));
    backend.offline = true;
    expect(await screen.findByTestId('offline-banner')).toBeTruthy();

    await fireEvent.press(milk);
    expect(await screen.findByTestId(`pending-${uid(1)}`)).toBeTruthy();
    expect(screen.getByTestId('pending-banner')).toHaveTextContent('1 change waiting to sync');
    expect(backend.tables.purchase_events).toHaveLength(0);

    backend.offline = false;
    await act(async () => net.emit(true));
    await waitFor(() => expect(screen.queryByTestId('pending-banner')).toBeNull());
    expect(backend.tables.purchase_events).toHaveLength(1);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('toasts a conflict when someone else bought the item first', async () => {
    const { backend, net } = await mount();
    const milk = await screen.findByLabelText(/Milk, 2 l/);
    await act(async () => net.emit(false));
    await fireEvent.press(milk);
    backend.otherUserTick(uid(1), uid(7000));
    await act(async () => net.emit(true));
    expect(await screen.findByTestId('toast')).toHaveTextContent(/Sam already got Milk./);
    await fireEvent.press(screen.getByTestId('toast-dismiss'));
    await waitFor(() => expect(screen.queryByTestId('toast')).toBeNull());
  });

  it('undoes a ticked item', async () => {
    const { backend } = await mount();
    await fireEvent.press(await screen.findByLabelText(/Eggs, 6/));
    const undo = await screen.findByTestId(`undo-${uid(2)}`);
    await fireEvent.press(undo);
    await waitFor(() => expect(screen.queryByTestId(`undo-${uid(2)}`)).toBeNull());
    expect(backend.rpcCalls.map((c) => c.fn)).toEqual(['record_purchase', 'void_purchase']);
  });
});
