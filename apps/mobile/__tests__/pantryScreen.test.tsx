import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { ServerApiProvider } from '@/data/ServerApiContext';
import { ServerApiError, type ServerApi } from '@/lib/serverApi';
import PantryScreen from '@/screens/pantry/PantryScreen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }) }));

const badge = (tone: string, label: string) => ({ tone, label });
const milk = { id: 'i1', name: 'milk', ingredientId: 'ing-milk', quantityLabel: '500 ml', value: 500, unit: 'ml', expiry: '2026-10-21', expiryBadge: badge('danger', 'Expires today'), status: 'confident', confidenceMessage: '', stale: false };
const lemon = { id: 'i2', name: 'lemon', quantityLabel: '2 item', value: 2, unit: 'item', status: 'stale', confidenceMessage: 'Last checked 20 days ago', stale: true };
const rice = { id: 'i3', name: 'rice', quantityLabel: '1 kg', value: 1, unit: 'kg', expiryBadge: badge('neutral', 'Use by Fri 30 Oct'), expiry: '2026-10-30', status: 'confident', confidenceMessage: '', stale: false };

function makeView(over: Record<string, unknown> = {}) {
  return {
    view: {
      householdId: 'hh-1',
      settings: { purchaseMode: 'suggest', staleAfterDays: 14 },
      totalItems: 3,
      categories: [
        { category: 'dairy_eggs', label: 'Dairy and eggs', items: [milk] },
        { category: 'fruit_veg', label: 'Fruit and veg', items: [lemon] },
        { category: 'pasta_rice_grains', label: 'Pasta, rice and grains', items: [rice] },
      ],
      staleItems: [lemon],
      expiring: [{ id: 'i1', name: 'milk', quantityLabel: '500 ml', expiry: '2026-10-21', daysLeft: 0, expired: false, badge: badge('danger', 'Expires today') }],
      suggestions: [{ recipeId: 'r1', title: 'Rice pudding', href: '/recipes/r1', coveragePct: 80, urgencyPct: 50, covered: ['milk', 'rice'], missing: ['sugar'], headline: '80% covered - uses stock that is expiring soon' }],
      pending: [{ eventId: 'e1', name: 'chicken breast', quantityLabel: '600 g', reason: 'Bought yesterday', requiresConfirmation: true }],
      leftovers: [{ key: 'fx', title: 'Beef stew', portionsRemaining: 4, useBy: '2026-10-23', suggestions: ['2 portions on Thu 22 Oct dinner'], advice: ['Reheat until piping hot'], summary: '4 portions left, use by Fri 23 Oct' }],
      ...over,
    },
  };
}

type Call = { method: 'GET' | 'POST'; path: string; payload: Record<string, unknown> };
function fakeApi(opts: { body?: unknown; fail?: ServerApiError } = {}) {
  const calls: Call[] = [];
  let failNext: ServerApiError | undefined = opts.fail;
  const api: ServerApi = {
    configured: true,
    get: async (path, query) => {
      calls.push({ method: 'GET', path, payload: (query ?? {}) as Record<string, unknown> });
      if (path === '/api/pantry/ingredients') return { hits: [{ id: 'ing-quinoa', name: 'quinoa', category: 'pasta_rice_grains' }] } as never;
      return (opts.body ?? makeView()) as never;
    },
    post: async (path, body) => {
      calls.push({ method: 'POST', path, payload: body as Record<string, unknown> });
      if (failNext) { const e = failNext; failNext = undefined; throw e; }
      const action = (body as { action: string }).action;
      if (action === 'leftovers') return { ok: true, plan: { key: 'adhoc', title: 'Chilli', portionsRemaining: 4, useBy: '2026-10-23', suggestions: ['1 portion on Wed 21 Oct lunch'], advice: [], summary: '4 portions left, use by Fri 23 Oct' } } as never;
      return { ok: true, message: `done ${action}` } as never;
    },
    postForm: async () => { throw new Error('unused'); },
    webUrl: () => null,
    authHeaders: async () => ({}),
  };
  return { api, calls, posts: () => calls.filter((c) => c.method === 'POST'), gets: () => calls.filter((c) => c.method === 'GET' && c.path === '/api/pantry' && !c.payload.part) };
}

function SetHousehold({ children }: { children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId('hh-1'), [setHouseholdId]);
  return householdId ? <>{children}</> : null;
}

async function mount(f = fakeApi()) {
  await render(
    <AppProvider dataSource={new MockDataSource()}>
      <ServerApiProvider api={f.api}>
        <SetHousehold>
          <PantryScreen />
        </SetHousehold>
      </ServerApiProvider>
    </AppProvider>,
  );
  await screen.findByText('Pantry');
  return f;
}

beforeEach(() => mockPush.mockClear());

describe('PantryScreen display', () => {
  it('shows categories, expiry badges as text, stale prompt, expiring, suggestions, pending, leftovers and settings', async () => {
    await mount();
    expect(screen.getByText('Dairy and eggs')).toBeTruthy();
    expect(screen.getByText('Fruit and veg')).toBeTruthy();
    expect(screen.getByTestId('badge-i1')).toHaveTextContent(/Expires today/);
    expect(screen.getByTestId('badge-i3')).toHaveTextContent('Use by Fri 30 Oct');
    expect(screen.getByTestId('stale-panel')).toBeTruthy();
    expect(screen.getByLabelText('Still have lemon')).toBeTruthy();
    expect(screen.getByTestId('expiring-panel')).toBeTruthy();
    expect(screen.getByTestId('expiring-badge-i1')).toHaveTextContent(/Expires today/);
    expect(screen.getByText('80% covered')).toBeTruthy();
    expect(screen.getByText('Have: milk, rice')).toBeTruthy();
    expect(screen.getByText('Missing: sugar')).toBeTruthy();
    expect(screen.getByText(/chicken breast, 600 g/)).toBeTruthy();
    expect(screen.getByText('4 portions left, use by Fri 23 Oct')).toBeTruthy();
    expect(screen.getByTestId('mode-suggest').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('stale-days').props.value).toBe('14');
  });

  it('collapses and expands a category', async () => {
    await mount();
    expect(screen.getByTestId('item-i1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('category-dairy_eggs'));
    expect(screen.queryByTestId('item-i1')).toBeNull();
    await fireEvent.press(screen.getByTestId('category-dairy_eggs'));
    expect(screen.getByTestId('item-i1')).toBeTruthy();
  });

  it('opens a suggested recipe', async () => {
    await mount();
    await fireEvent.press(screen.getByTestId('open-r1'));
    expect(mockPush).toHaveBeenCalledWith('/recipe/r1');
  });

  it('empty pantry shows the empty state and the Scan groceries button goes to /pantry/scan', async () => {
    await mount(fakeApi({ body: makeView({ totalItems: 0, categories: [], staleItems: [], expiring: [], suggestions: [], pending: [], leftovers: [] }) }));
    expect(screen.getByText('Your pantry is empty.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Scan groceries'));
    expect(mockPush).toHaveBeenCalledWith('/pantry/scan');
  });

  it('shows a load error with retry', async () => {
    const f = fakeApi();
    f.api.get = jest.fn().mockRejectedValueOnce(new ServerApiError('Could not reach the server.', 0, true, 'NETWORK')).mockResolvedValue(makeView());
    await render(
      <AppProvider dataSource={new MockDataSource()}>
        <ServerApiProvider api={f.api}>
          <SetHousehold>
            <PantryScreen />
          </SetHousehold>
        </ServerApiProvider>
      </AppProvider>,
    );
    expect(await screen.findByText('Could not reach the server.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('retry'));
    expect(await screen.findByText('Pantry')).toBeTruthy();
  });
});

describe('PantryScreen actions', () => {
  it('confirms a stale item and refreshes', async () => {
    const f = await mount();
    await fireEvent.press(screen.getByTestId('stale-confirm-i2'));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.posts()[0]).toMatchObject({ path: '/api/pantry', payload: { action: 'confirm', id: 'i2', householdId: 'hh-1' } });
    await waitFor(() => expect(f.gets()).toHaveLength(2));
    expect(await screen.findByText('done confirm')).toBeTruthy();
  });

  it('adds an item by free text with unit and expiry', async () => {
    const f = await mount();
    await fireEvent.press(screen.getByTestId('add-toggle'));
    await fireEvent.changeText(screen.getByTestId('item-name'), 'Oat milk');
    await fireEvent.changeText(screen.getByTestId('item-value'), '1,5');
    await fireEvent.press(screen.getByTestId('unit-l'));
    await fireEvent.changeText(screen.getByTestId('item-expiry'), '2026-12-01');
    await fireEvent.press(screen.getByTestId('item-save'));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.posts()[0]!.payload).toEqual({ action: 'add', householdId: 'hh-1', name: 'Oat milk', value: 1.5, unit: 'l', expiry: '2026-12-01' });
    await waitFor(() => expect(screen.queryByTestId('add-form')).toBeNull());
  });

  it('adds a canonical ingredient picked from the type-ahead', async () => {
    const f = await mount();
    await fireEvent.press(screen.getByTestId('add-toggle'));
    await fireEvent.changeText(screen.getByTestId('add-ingredient-input'), 'quin');
    await fireEvent.press(await screen.findByTestId('add-ingredient-hit'));
    await fireEvent.changeText(screen.getByTestId('item-value'), '250');
    await fireEvent.press(screen.getByTestId('unit-g'));
    await fireEvent.press(screen.getByTestId('item-save'));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.posts()[0]!.payload).toEqual({ action: 'add', householdId: 'hh-1', ingredientId: 'ing-quinoa', value: 250, unit: 'g' });
  });

  it('validates add input locally without calling the server', async () => {
    const f = await mount();
    await fireEvent.press(screen.getByTestId('add-toggle'));
    await fireEvent.press(screen.getByTestId('item-save'));
    expect(await screen.findByText('Choose an ingredient or type a name.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('item-name'), 'Rice');
    await fireEvent.press(screen.getByTestId('item-save'));
    expect(await screen.findByText('Enter a quantity as a number.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('item-value'), '2');
    await fireEvent.changeText(screen.getByTestId('item-expiry'), '1/2/2027');
    await fireEvent.press(screen.getByTestId('item-save'));
    expect(await screen.findByText(/YYYY-MM-DD/)).toBeTruthy();
    expect(f.posts()).toHaveLength(0);
  });

  it('edits quantity and clears the expiry', async () => {
    const f = await mount();
    await fireEvent.press(screen.getByTestId('edit-i1'));
    expect(screen.getByTestId('item-value').props.value).toBe('500');
    expect(screen.getByTestId('item-expiry').props.value).toBe('2026-10-21');
    await fireEvent.changeText(screen.getByTestId('item-value'), '250');
    await fireEvent.press(screen.getByTestId('item-clear-expiry'));
    await fireEvent.press(screen.getByTestId('item-save'));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.posts()[0]!.payload).toEqual({ action: 'correct', householdId: 'hh-1', id: 'i1', value: 250, unit: 'ml', expiry: null });
  });

  it('removes only after confirmation', async () => {
    const f = await mount();
    await fireEvent.press(screen.getByTestId('remove-i3'));
    expect(screen.getByText('Remove rice from the pantry?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('remove-no-i3'));
    expect(f.posts()).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('remove-i3'));
    await fireEvent.press(screen.getByTestId('remove-yes-i3'));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.posts()[0]!.payload).toEqual({ action: 'remove', householdId: 'hh-1', id: 'i3' });
  });

  it('changes the post-purchase mode and stale days', async () => {
    const f = await mount();
    await fireEvent.press(screen.getByTestId('mode-auto'));
    await fireEvent.changeText(screen.getByTestId('stale-days'), '30');
    await fireEvent.press(screen.getByTestId('settings-save'));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.posts()[0]!.payload).toEqual({ action: 'settings', householdId: 'hh-1', purchaseMode: 'auto', staleAfterDays: 30 });
  });

  it('rejects an invalid stale-days value locally', async () => {
    const f = await mount();
    await fireEvent.changeText(screen.getByTestId('stale-days'), '0');
    await fireEvent.press(screen.getByTestId('settings-save'));
    expect(await screen.findByText(/between 1 and 730/)).toBeTruthy();
    expect(f.posts()).toHaveLength(0);
  });

  it('accepts a pending purchase with an expiry, and dismisses', async () => {
    const f = await mount();
    await fireEvent.changeText(screen.getByTestId('pending-expiry-e1'), '2026-10-25');
    await fireEvent.press(screen.getByTestId('accept-e1'));
    await waitFor(() => expect(f.posts()).toHaveLength(1));
    expect(f.posts()[0]!.payload).toEqual({ action: 'acceptAdjustment', householdId: 'hh-1', eventId: 'e1', expiry: '2026-10-25' });
    await fireEvent.press(screen.getByTestId('dismiss-e1'));
    await waitFor(() => expect(f.posts()).toHaveLength(2));
    expect(f.posts()[1]!.payload).toEqual({ action: 'dismissAdjustment', householdId: 'hh-1', eventId: 'e1' });
  });

  it('plans leftovers from the form and shows the plan', async () => {
    const f = await mount();
    await fireEvent.press(screen.getByTestId('leftovers-toggle'));
    await fireEvent.changeText(screen.getByTestId('lo-title'), 'Chilli');
    await fireEvent.changeText(screen.getByTestId('lo-cooked'), '6');
    await fireEvent.changeText(screen.getByTestId('lo-eaten'), '2');
    await fireEvent.changeText(screen.getByTestId('lo-keep'), '3');
    await fireEvent(screen.getByTestId('lo-freezable'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('lo-submit'));
    expect(await screen.findByTestId('leftover-adhoc')).toBeTruthy();
    expect(f.posts()[0]!.payload).toEqual({ action: 'leftovers', householdId: 'hh-1', title: 'Chilli', portionsCooked: 6, portionsEaten: 2, keepDays: 3, freezable: true });
    expect(screen.getByText('- 1 portion on Wed 21 Oct lunch')).toBeTruthy();
  });

  it('refuses eating more than cooked without calling the server', async () => {
    const f = await mount();
    await fireEvent.press(screen.getByTestId('leftovers-toggle'));
    await fireEvent.changeText(screen.getByTestId('lo-title'), 'Soup');
    await fireEvent.changeText(screen.getByTestId('lo-cooked'), '2');
    await fireEvent.changeText(screen.getByTestId('lo-eaten'), '3');
    await fireEvent.press(screen.getByTestId('lo-submit'));
    expect(await screen.findByText('You cannot have eaten more than you cooked.')).toBeTruthy();
    expect(f.posts()).toHaveLength(0);
  });
});

describe('PantryScreen errors', () => {
  it('shows the read-only message from the server and still refreshes', async () => {
    const f = await mount(fakeApi({ fail: new ServerApiError('This household is read-only while it is pending deletion.', 403, false, 'READ_ONLY') }));
    await fireEvent.press(screen.getByTestId('stale-confirm-i2'));
    expect(await screen.findByText('This household is read-only while it is pending deletion.')).toBeTruthy();
    await waitFor(() => expect(f.gets()).toHaveLength(2));
  });

  it('shows the server refusal text for a rejected add', async () => {
    await mount(fakeApi({ fail: new ServerApiError('Unknown ingredient.', 422, false, 'REFUSED') }));
    await fireEvent.press(screen.getByTestId('add-toggle'));
    await fireEvent.changeText(screen.getByTestId('item-name'), 'x');
    await fireEvent.changeText(screen.getByTestId('item-value'), '1');
    await fireEvent.press(screen.getByTestId('item-save'));
    expect(await screen.findByText('Unknown ingredient.')).toBeTruthy();
  });
});
