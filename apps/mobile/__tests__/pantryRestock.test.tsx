// Minimum pantry stock on Android (PR1, D280-D289): API client + Pantry screen panels + shopping banner, against a fake server.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { ServerApiProvider } from '@/data/ServerApiContext';
import {
  addRestock, fetchRestock, fetchRestockBanner, minimumError, parseRestockBanner, parseRestockView, removeMinimum,
  saveRestockSettings, setMinimum, snoozeRestock,
} from '@/lib/pantryApi';
import type { ServerApi } from '@/lib/serverApi';
import PantryScreen from '@/screens/pantry/PantryScreen';
import { RestockBannerCard } from '@/screens/pantry/Restock';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }) }));

const tom = { id: 'i1', name: 'tinned tomatoes', ingredientId: 'ing-tom', quantityLabel: '2 can', value: 2, unit: 'can', status: 'confident', confidenceMessage: '', stale: false };
const par = { id: 'p1', key: 'ing:ing-tom', name: 'tinned tomatoes', ingredientId: 'ing-tom', unit: 'can', minValue: 6, enabled: true, label: 'Minimum 6 cans', available: 2, status: '2 cans in stock - below minimum', belowMin: true };
const low = { parId: 'p1', kind: 'below_min', name: 'tinned tomatoes', quantityLabel: '4 cans', quantity: 4, unit: 'can', explanation: 'You have 2 cans; minimum 6 cans; 0 cans already on the list -> add 4 cans', checkQuantity: false, notes: [] };
const restockBody = (over: Record<string, unknown> = {}) => ({ restock: { settings: { autoAdd: false }, pars: [par], suggestions: [low], willRunLow: [], snoozedCount: 0, ...over } });
const pantryBody = {
  view: {
    householdId: 'hh-1', settings: { purchaseMode: 'suggest', staleAfterDays: 14 }, totalItems: 1,
    categories: [{ category: 'tinned_jarred', label: 'Tinned and jarred', items: [tom] }],
    staleItems: [], expiring: [], suggestions: [], pending: [], leftovers: [],
  },
};

type Call = { method: 'GET' | 'POST'; path: string; payload: Record<string, unknown> };
function fakeApi(opts: { restock?: unknown; banner?: unknown } = {}) {
  const calls: Call[] = [];
  let restock = opts.restock ?? restockBody();
  let banner = opts.banner ?? { banner: { items: [{ parId: 'p1', name: 'tinned tomatoes', quantityLabel: '4 cans', checkQuantity: false }], signature: 'p1:4', autoAdd: false } };
  const api: ServerApi = {
    configured: true,
    get: async (path, query) => {
      const q = (query ?? {}) as Record<string, unknown>;
      calls.push({ method: 'GET', path, payload: q });
      if (q.part === 'restock') return restock as never;
      if (q.part === 'banner') return banner as never;
      if (path === '/api/pantry/ingredients') return { hits: [] } as never;
      return pantryBody as never;
    },
    post: async (path, body) => {
      calls.push({ method: 'POST', path, payload: body as Record<string, unknown> });
      const action = (body as { action: string }).action;
      if (action === 'addRestock') {
        restock = restockBody({ suggestions: [], pars: [{ ...par, belowMin: false }] });
        banner = { banner: { items: [], signature: '', autoAdd: false } };
        return { ok: true, message: 'Added tinned tomatoes to your shopping list', added: 1 } as never;
      }
      return { ok: true, message: `done ${action}` } as never;
    },
    postForm: async () => { throw new Error('unused'); },
    webUrl: () => null,
    authHeaders: async () => ({}),
  };
  return { api, calls, posts: () => calls.filter((c) => c.method === 'POST') };
}

function SetHousehold({ children }: { children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId('hh-1'), [setHouseholdId]);
  return householdId ? <>{children}</> : null;
}
const wrap = (f: ReturnType<typeof fakeApi>, node: React.ReactNode) => (
  <AppProvider dataSource={new MockDataSource()}>
    <ServerApiProvider api={f.api}>
      <SetHousehold>{node}</SetHousehold>
    </ServerApiProvider>
  </AppProvider>
);

beforeEach(() => mockPush.mockClear());

describe('restock API client', () => {
  it('parses the restock view and banner defensively', () => {
    const v = parseRestockView(restockBody({ willRunLow: [{ ...low, kind: 'will_run_low' }] }));
    expect(v.settings.autoAdd).toBe(false);
    expect(v.pars[0]).toMatchObject({ id: 'p1', minValue: 6, belowMin: true });
    expect(v.suggestions[0]).toMatchObject({ quantityLabel: '4 cans', kind: 'below_min' });
    expect(v.willRunLow[0]!.kind).toBe('will_run_low');
    expect(parseRestockView({ restock: { pars: [null, { id: 1 }, { id: 'x', name: 'salt', pack: { value: 400, unit: 'g' }, restockToValue: 8 }], suggestions: [{}] } }).pars)
      .toMatchObject([{ id: 'x', pack: { value: 400, unit: 'g' }, restockToValue: 8 }]);
    expect(() => parseRestockView({})).toThrow(/unexpected/);
    expect(parseRestockBanner({ banner: { items: [{ parId: 'p', name: 'n', quantityLabel: '1 can' }, {}], signature: 's', autoAdd: true } }))
      .toEqual({ items: [{ parId: 'p', name: 'n', quantityLabel: '1 can', checkQuantity: false }], signature: 's', autoAdd: true });
    expect(() => parseRestockBanner(null)).toThrow(/unexpected/);
  });

  it('sends the intents through /api/pantry with the household', async () => {
    const f = fakeApi();
    await fetchRestock(f.api, 'hh-1');
    await fetchRestockBanner(f.api, 'hh-1');
    expect(f.calls.map((c) => c.payload.part)).toEqual(['restock', 'banner']);
    await setMinimum(f.api, 'hh-1', { ingredientId: 'ing-tom', unit: 'can', min: 6, restockTo: null, packValue: null, packUnit: null });
    await removeMinimum(f.api, 'hh-1', 'p1');
    await snoozeRestock(f.api, 'hh-1', 'p1');
    await addRestock(f.api, 'hh-1');
    await addRestock(f.api, 'hh-1', ['p1']);
    await saveRestockSettings(f.api, 'hh-1', true);
    expect(f.posts().map((c) => [c.path, c.payload.action])).toEqual([
      ['/api/pantry', 'setMinimum'], ['/api/pantry', 'removeMinimum'], ['/api/pantry', 'snoozeRestock'],
      ['/api/pantry', 'addRestock'], ['/api/pantry', 'addRestock'], ['/api/pantry', 'restockSettings'],
    ]);
    expect(f.posts()[0]!.payload).toMatchObject({ householdId: 'hh-1', ingredientId: 'ing-tom', unit: 'can', min: 6 });
    expect(f.posts()[2]!.payload).toMatchObject({ id: 'p1', days: 7 });
    expect(f.posts()[3]!.payload).not.toHaveProperty('parIds');
    expect(f.posts()[4]!.payload).toMatchObject({ parIds: ['p1'] });
    expect(f.posts()[5]!.payload).toMatchObject({ autoAdd: true });
  });

  it('validates the minimum form values', () => {
    expect(minimumError(null, null, null)).toMatch(/number/);
    expect(minimumError(0, null, null)).toMatch(/more than zero/);
    expect(minimumError(6, 4, null)).toMatch(/below the minimum/);
    expect(minimumError(6, null, 0)).toMatch(/pack size/);
    expect(minimumError(6, 8, 400)).toBeNull();
  });
});

describe('Pantry screen: minimum stock', () => {
  it('shows Running low with the reason; Add posts addRestock for that item, then refreshes', async () => {
    const f = fakeApi();
    await render(wrap(f, <PantryScreen />));
    expect(await screen.findByTestId('running-low-panel')).toBeTruthy();
    expect(screen.getByText(/You have 2 cans; minimum 6 cans/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('low-add-p1'));
    await waitFor(() => expect(f.posts().find((c) => c.payload.action === 'addRestock')?.payload).toMatchObject({ parIds: ['p1'] }));
    await waitFor(() => expect(screen.getByText('Nothing is below its minimum.')).toBeTruthy());
  });

  it('snoozes and adds all', async () => {
    const two = { ...low, parId: 'p2', name: 'pasta', quantityLabel: '500 g', explanation: 'You have 0 g' };
    const f = fakeApi({ restock: restockBody({ suggestions: [low, two], pars: [par, { ...par, id: 'p2', name: 'pasta', ingredientId: 'ing-pasta' }] }) });
    await render(wrap(f, <PantryScreen />));
    await fireEvent.press(await screen.findByTestId('low-snooze-p2'));
    await waitFor(() => expect(f.posts().find((c) => c.payload.action === 'snoozeRestock')?.payload).toMatchObject({ id: 'p2', days: 7 }));
    await fireEvent.press(screen.getByTestId('low-add-all'));
    await waitFor(() => expect(f.posts().filter((c) => c.payload.action === 'addRestock').pop()?.payload).not.toHaveProperty('parIds'));
  });

  it('Set minimum on a row opens the stepper form and saves with the item ingredient and unit', async () => {
    const f = fakeApi({ restock: restockBody({ pars: [], suggestions: [] }) });
    await render(wrap(f, <PantryScreen />));
    await screen.findByTestId('running-low-panel');
    await fireEvent.press(screen.getByTestId('minimum-i1'));
    expect(screen.getByTestId('minimum-form')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('min-value-inc'));
    await fireEvent.press(screen.getByTestId('min-value-inc'));
    await fireEvent.changeText(screen.getByTestId('min-value'), '6');
    await fireEvent.press(screen.getByTestId('min-save'));
    await waitFor(() => expect(f.posts().find((c) => c.payload.action === 'setMinimum')?.payload).toMatchObject({
      householdId: 'hh-1', ingredientId: 'ing-tom', name: 'tinned tomatoes', unit: 'can', min: 6, restockTo: null, packValue: null,
    }));
  });

  it('refuses a bad minimum on the phone, without calling the server', async () => {
    const f = fakeApi({ restock: restockBody({ pars: [], suggestions: [] }) });
    await render(wrap(f, <PantryScreen />));
    await screen.findByTestId('running-low-panel');
    await fireEvent.press(screen.getByTestId('minimum-i1'));
    await fireEvent.changeText(screen.getByTestId('min-value'), '0');
    await fireEvent.press(screen.getByTestId('min-save'));
    expect(await screen.findByText('The minimum must be more than zero.')).toBeTruthy();
    expect(f.posts()).toEqual([]);
  });

  it('lists minimums, toggles auto-add and removes one', async () => {
    const f = fakeApi();
    await render(wrap(f, <PantryScreen />));
    expect(await screen.findByTestId('minimum-p1')).toBeTruthy();
    fireEvent(screen.getByTestId('restock-auto'), 'valueChange', true);
    await waitFor(() => expect(f.posts().find((c) => c.payload.action === 'restockSettings')?.payload).toMatchObject({ autoAdd: true }));
    await fireEvent.press(screen.getByTestId('minimum-edit-p1'));
    await fireEvent.press(screen.getByTestId('min-remove'));
    await waitFor(() => expect(f.posts().find((c) => c.payload.action === 'removeMinimum')?.payload).toMatchObject({ id: 'p1' }));
  });

  it('still shows the pantry when the minimums endpoint fails', async () => {
    const f = fakeApi({ restock: {} });
    await render(wrap(f, <PantryScreen />));
    expect(await screen.findByText('Tinned and jarred')).toBeTruthy();
    expect(screen.queryByTestId('running-low-panel')).toBeNull();
  });
});

describe('Shopping banner', () => {
  it('shows the below-minimum banner; Add all adds, calls onAdded and reports; Choose opens the pantry', async () => {
    const f = fakeApi();
    const onAdded = jest.fn();
    await render(wrap(f, <RestockBannerCard api={f.api} householdId="hh-1" onAdded={onAdded} />));
    const banner = await screen.findByTestId('restock-banner');
    expect(banner).toHaveTextContent(/1 item below your minimum/);
    expect(banner).toHaveTextContent(/Add 4 cans tinned tomatoes/);
    await fireEvent.press(screen.getByTestId('restock-choose'));
    expect(mockPush).toHaveBeenCalledWith('/pantry');
    await fireEvent.press(screen.getByTestId('restock-add-all'));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(await screen.findByText('Added tinned tomatoes to your shopping list')).toBeTruthy();
    expect(screen.queryByTestId('restock-banner')).toBeNull();
  });

  it('can be dismissed, and renders nothing when there is nothing below minimum or the call fails', async () => {
    const f = fakeApi();
    await render(wrap(f, <RestockBannerCard api={f.api} householdId="hh-1" />));
    await fireEvent.press(await screen.findByTestId('restock-dismiss'));
    expect(screen.queryByTestId('restock-banner')).toBeNull();
  });

  it('is silent with an empty or broken response', async () => {
    const empty = fakeApi({ banner: { banner: { items: [], signature: '', autoAdd: false } } });
    await render(wrap(empty, <RestockBannerCard api={empty.api} householdId="hh-1" />));
    await waitFor(() => expect(empty.calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('restock-banner')).toBeNull();
    const broken = fakeApi({ banner: {} });
    await render(wrap(broken, <RestockBannerCard api={broken.api} householdId="hh-1" />));
    await waitFor(() => expect(broken.calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('restock-banner')).toBeNull();
  });
});
