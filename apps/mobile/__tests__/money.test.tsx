import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { ServerApiProvider } from '@/data/ServerApiContext';
import { gbp, parseListCompare, parsePriceHistory, parseSpendingView, poundsToPence, statusText } from '@/lib/moneyApi';
import { ServerApiError, type ServerApi } from '@/lib/serverApi';
import { csvFileName, shareSpendCsv, type CsvDeps } from '@/lib/spendingCsv';
import { CompareListCard } from '@/screens/money/CompareListCard';
import PriceHistoryScreen from '@/screens/money/PriceHistoryScreen';
import SpendingScreen from '@/screens/money/SpendingScreen';
import { MORE_ENTRIES } from '@/screens/MoreScreen';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));

const week = (over: Record<string, unknown> = {}) => ({
  weekStart: '2026-10-19', label: '19 Oct to 25 Oct', inProgress: true, budgetPence: 8000, plannedPence: 6500, plannedPartial: true, actualPence: 4000,
  receiptsPence: 3450, manualPence: 550, entries: 2, actualStatus: 'so_far_within', varianceToBudgetPence: -4000, ...over,
});
const spendingBody = (over: Record<string, unknown> = {}) => ({
  view: {
    today: '2026-10-21', from: '2026-10-05', to: '2026-10-25', weeklyBudgetPence: 8000,
    weeks: [week({ weekStart: '2026-10-12', label: '12 Oct to 18 Oct', inProgress: false, actualPence: 9000, actualStatus: 'over', varianceToBudgetPence: 1000, plannedPence: null }), week()],
    months: [{ month: '2026-10', label: 'Oct 2026', weeks: 2, budgetPence: 16000, plannedPence: 6500, plannedPartial: true, actualPence: 13000, actualStatus: 'so_far_within', varianceToBudgetPence: -3000 }],
    categories: [{ category: 'Dairy & eggs', pence: 1000, sharePct: 25 }, { category: 'Uncategorised', pence: 3000, sharePct: 75 }],
    shops: [{ shop: 'ALDI', pence: 3000, trips: 1 }],
    recent: [
      { id: 'r1', source: 'receipt', date: '2026-10-20', shop: 'ALDI', totalPence: 3000, note: null, category: null },
      { id: 'm1', source: 'manual', date: '2026-10-21', shop: 'Market stall', totalPence: 550, note: 'berries', category: 'Fruit & veg' },
    ],
    totals: { actualPence: 13000, receiptsPence: 12450, manualPence: 550, plannedPence: 6500, plannedPartial: true, plannedWeeks: 1 },
    thisWeek: week(),
    unlinked: [
      { retailer: 'TESCO EXTRA', key: 'tesco extra', receipts: 2, suggestion: { id: 's-tesco', name: 'Tesco', chain: null } },
      { retailer: 'Co-op', key: 'co op', receipts: 1, suggestion: null },
    ],
    stores: [{ id: 's-tesco', name: 'Tesco', chain: null }, { id: 's-aldi', name: 'ALDI', chain: null }],
    categoryChoices: ['Fruit & veg', 'Bakery'], usedScanDate: 1, notes: ['Planned figures are estimates from your recipe costs.'], ...over,
  },
});

function fakeApi(opts: { get?: (path: string) => unknown; postFails?: ServerApiError; configured?: boolean } = {}) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const gets: Array<{ path: string; query: Record<string, unknown> }> = [];
  const api: ServerApi = {
    configured: opts.configured ?? true,
    get: async (path, query) => { gets.push({ path, query: (query ?? {}) as Record<string, unknown> }); return (opts.get ? opts.get(path) : spendingBody()) as never; },
    post: async (path, body) => { posts.push({ path, body: body as Record<string, unknown> }); if (opts.postFails) throw opts.postFails; return { ok: true } as never; },
    postForm: async () => { throw new Error('unused'); },
    webUrl: (p) => `https://api.test${p}`,
    authHeaders: async () => ({ Authorization: 'Bearer tok' }),
  };
  return { api, posts, gets };
}

function SetHousehold({ children }: { children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId('hh-1'), [setHouseholdId]);
  return householdId ? <>{children}</> : null;
}
async function mount(ui: React.ReactElement, api: ServerApi) {
  await render(
    <AppProvider dataSource={new MockDataSource()}>
      <ServerApiProvider api={api}>
        <SetHousehold>{ui}</SetHousehold>
      </ServerApiProvider>
    </AppProvider>,
  );
}

describe('money API parsers and helpers', () => {
  it('parses a spending view and drops malformed rows', () => {
    const v = parseSpendingView(spendingBody({ recent: [{ id: 'x', source: 'manual', date: 'd', totalPence: 5 }, { nope: 1 }, 7], unlinked: [{ nope: 1 }] }));
    expect(v.recent).toHaveLength(1);
    expect(v.unlinked).toEqual([]);
    expect(v.weeks[1]).toMatchObject({ actualStatus: 'so_far_within', plannedPartial: true });
    expect(v.thisWeek?.weekStart).toBe('2026-10-19');
    expect(() => parseSpendingView({})).toThrow(/unexpected/);
  });
  it('parses a list comparison and a price history; unknown shapes throw', () => {
    const c = parseListCompare({ view: { totalItems: 3, shops: [{ label: 'ALDI', pricedItems: 2, coveragePct: 67, totalPence: 400, missing: ['x'] }], badges: { i1: { ingredientId: 'g', text: 'Cheapest at LIDL', cheapestShop: 'LIDL' }, bad: 1 }, likeForLike: null, note: 'n' } });
    expect(Object.keys(c.badges)).toEqual(['i1']);
    expect(c.shops[0]).toMatchObject({ label: 'ALDI', coveragePct: 67, missing: ['x'] });
    expect(() => parseListCompare(null)).toThrow();
    const h = parsePriceHistory({ view: { ingredientId: 'g', name: 'Rice', comparison: { shops: [{ label: 'ALDI', pricePence: 150, cheapest: true }] }, history: [], stores: [] } });
    expect(h.comparison.shops[0]).toMatchObject({ label: 'ALDI', cheapest: true });
    expect(() => parsePriceHistory({ view: {} })).toThrow();
  });
  it('formats money and reads amounts', () => {
    expect(gbp(1250)).toBe('£12.50');
    expect(gbp(-5)).toBe('-£0.05');
    expect(poundsToPence('12.5')).toBe(1250);
    expect(poundsToPence('£3')).toBe(300);
    expect(poundsToPence('0')).toBeNull();
    expect(poundsToPence('1.234')).toBeNull();
    expect(poundsToPence('abc')).toBeNull();
    expect(statusText('over', 1050)).toBe('£10.50 over budget');
    expect(statusText('so_far_within', -3000)).toBe('£30.00 left so far');
  });
  it('lists Spending under More', () => {
    expect(MORE_ENTRIES.find((e) => e.key === 'spending')?.href).toBe('/spending');
  });
});

describe('SpendingScreen', () => {
  it('shows budget, planned (estimate) and spent separately, with status in words', async () => {
    const { api, gets } = fakeApi();
    await mount(<SpendingScreen />, api);
    expect(await screen.findByTestId('budget-value')).toHaveTextContent('£80.00');
    expect(screen.getByTestId('planned-value')).toHaveTextContent('At least £65.00');
    expect(screen.getByTestId('actual-value')).toHaveTextContent('£40.00');
    expect(screen.getByTestId('budget-status')).toHaveTextContent(/£40.00 left so far/);
    expect(screen.getAllByText(/estimate/i).length).toBeGreaterThan(0);
    expect(gets[0]).toMatchObject({ path: '/api/money/spending', query: { householdId: 'hh-1', weeks: 12 } });
    expect(screen.getAllByTestId('spend-bar-row')).toHaveLength(2);
    expect(screen.getByLabelText(/12 Oct to 18 Oct: spent £90.00, budget £80.00/)).toBeTruthy();
    expect(screen.getByTestId('category-breakdown')).toBeTruthy();
  });

  it('switches range and unit', async () => {
    const { api, gets } = fakeApi();
    await mount(<SpendingScreen />, api);
    await screen.findByTestId('budget-value');
    await fireEvent.press(screen.getByTestId('range-26'));
    await waitFor(() => expect(gets.at(-1)?.query.weeks).toBe(26));
    await fireEvent.press(screen.getByTestId('unit-month'));
    expect(screen.getAllByTestId('spend-bar-row')).toHaveLength(1);
    expect(screen.getByLabelText(/Oct 2026 so far|Oct 2026: spent £130.00/)).toBeTruthy();
  });

  it('adds a manual entry (validating the amount first) and deletes one', async () => {
    const { api, posts } = fakeApi();
    await mount(<SpendingScreen />, api);
    await screen.findByTestId('add-spend-form');
    await fireEvent.changeText(screen.getByTestId('spend-amount'), 'abc');
    await fireEvent.press(screen.getByTestId('add-spend'));
    expect(await screen.findByText('Enter an amount like 12.50.')).toBeTruthy();
    expect(posts).toHaveLength(0);
    await fireEvent.changeText(screen.getByTestId('spend-amount'), '12.50');
    await fireEvent.changeText(screen.getByTestId('spend-shop'), 'Greggs');
    await fireEvent.press(screen.getByTestId('add-spend'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ path: '/api/money/spending', body: { action: 'add', householdId: 'hh-1', amountPence: 1250, retailer: 'Greggs', date: '2026-10-21' } });
    await fireEvent.press(screen.getByTestId('delete-m1'));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]!.body).toMatchObject({ action: 'delete', id: 'm1' });
    expect(screen.queryByTestId('delete-r1')).toBeNull(); // receipts are not deleted from here
  });

  it('links a receipt shop to a store only when the user confirms', async () => {
    const { api, posts } = fakeApi();
    await mount(<SpendingScreen />, api);
    await screen.findByTestId('unlinked-retailers');
    expect(posts).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('link-tesco extra'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({ action: 'link', retailer: 'TESCO EXTRA', storeId: 's-tesco' });
    await fireEvent.press(screen.getByTestId('link-co op-s-aldi'));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]!.body).toMatchObject({ retailer: 'Co-op', storeId: 's-aldi' });
  });

  it('shows the server\'s refusal and a retry on a load failure', async () => {
    const { api, posts } = fakeApi({ postFails: new ServerApiError('Choose a valid date.', 400, false, 'BAD_REQUEST') });
    await mount(<SpendingScreen />, api);
    await screen.findByTestId('add-spend-form');
    await fireEvent.changeText(screen.getByTestId('spend-amount'), '5');
    await fireEvent.press(screen.getByTestId('add-spend'));
    expect(await screen.findByText('Choose a valid date.')).toBeTruthy();
    expect(posts).toHaveLength(1);
  });

  it('says what it needs when there is no server', async () => {
    const { api } = fakeApi({ configured: false });
    await mount(<SpendingScreen />, api);
    expect(await screen.findByText(/needs the Family Recipes server/i)).toBeTruthy();
  });

  it('shares the CSV through the share sheet and cleans up the file', async () => {
    const { api } = fakeApi();
    await mount(<SpendingScreen />, api);
    await screen.findByTestId('share-csv');
    const calls: string[] = [];
    const deps: CsvDeps = {
      isShareAvailable: async () => true,
      download: async (url, name, headers) => { calls.push(`download ${url} ${name.startsWith('family-recipes-spend-')} ${headers.Authorization}`); return { uri: 'file:///c/x.csv', delete: () => calls.push('delete') }; },
      share: async (uri) => { calls.push(`share ${uri}`); },
    };
    await shareSpendCsv(api, 'hh-1', 26, deps, new Date('2026-10-21T10:00:00Z'));
    expect(calls).toEqual(['download https://api.test/api/money/spending/csv?weeks=26&householdId=hh-1 true Bearer tok', 'share file:///c/x.csv', 'delete']);
    expect(csvFileName(new Date('2026-10-21T10:00:00Z'))).toBe('family-recipes-spend-20261021.csv');
    await expect(shareSpendCsv(api, 'hh-1', 26, { ...deps, isShareAvailable: async () => false })).rejects.toThrow(/not available/);
    await expect(shareSpendCsv(api, 'hh-1', 26, { ...deps, download: async () => { throw new Error('x'); } })).rejects.toThrow(/did not finish/);
  });
});

describe('PriceHistoryScreen and the list comparison card', () => {
  const history = {
    view: {
      ingredientId: 'ing-1', name: 'Basmati rice',
      comparison: {
        basis: 'kg', note: null, badge: 'Cheapest at LIDL: £2.30 per kg (6 days ago)', tied: false, savingPct: 23,
        shops: [
          { label: 'LIDL', linked: false, pricePence: 230, packLabel: '1 kg', unitText: '£2.30 per kg', observedOn: '2026-10-15', ageText: '6 days ago', count: 1, stale: false, comparable: true, cheapest: true, kind: 'receipt' },
          { label: 'ALDI', linked: true, pricePence: 150, packLabel: '500 g', unitText: '£3.00 per kg', observedOn: '2026-10-19', ageText: '2 days ago', count: 2, stale: false, comparable: true, cheapest: false, kind: 'user_confirmed' },
        ],
      },
      history: [{ label: 'ALDI', pricePence: 150, packLabel: '500 g', unitText: '£3.00 per kg', observedOn: '2026-10-19', ageText: '2 days ago', kind: 'user_confirmed' }],
      stores: [{ id: 's-aldi', name: 'ALDI', chain: null }],
    },
  };

  it('shows the cheapest shop with ages and unit prices, and adds a price you saw', async () => {
    const { api, posts, gets } = fakeApi({ get: () => history });
    await mount(<PriceHistoryScreen ingredientId="ing-1" />, api);
    expect(await screen.findByTestId('price-badge')).toHaveTextContent(/Cheapest at LIDL: £2\.30 per kg \(6 days ago\)/);
    expect(gets[0]).toMatchObject({ path: '/api/money/prices', query: { householdId: 'hh-1', ingredientId: 'ing-1' } });
    expect(screen.getAllByTestId('shop-price')).toHaveLength(2);
    await fireEvent.changeText(screen.getByTestId('price-amount'), 'x');
    await fireEvent.press(screen.getByTestId('save-price'));
    expect(await screen.findByText('Enter the price like 1.25.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('price-store-s-aldi'));
    await fireEvent.changeText(screen.getByTestId('price-amount'), '1.40');
    await fireEvent.changeText(screen.getByTestId('price-size'), '500');
    await fireEvent.press(screen.getByTestId('save-price'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ path: '/api/money/prices', body: { action: 'add', householdId: 'hh-1', ingredientId: 'ing-1', storeId: 's-aldi', pricePence: 140, packValue: 500, packUnit: 'g' } });
  });

  it('the list card shows coverage for every shop and never a bare total', async () => {
    const view = parseListCompare({
      view: {
        totalItems: 12, note: 'Totals cover only the items each shop has a price for.',
        shops: [{ label: 'ALDI', linked: true, totalPence: 1800, pricedItems: 8, coveragePct: 67, missing: [], oldestText: '3 weeks ago', allRecent: true }, { label: 'LIDL', linked: false, totalPence: 500, pricedItems: 3, coveragePct: 25, missing: [], oldestText: '3 months ago', allRecent: false }],
        likeForLike: { itemNames: ['rice'], totals: [{ label: 'ALDI', totalPence: 300 }, { label: 'LIDL', totalPence: 400 }], cheapest: 'ALDI' }, badges: {},
      },
    });
    await render(<CompareListCard view={view} />);
    expect(screen.queryByTestId('compare-row')).toBeNull(); // collapsed
    await fireEvent.press(screen.getByTestId('compare-toggle'));
    const rows = screen.getAllByTestId('compare-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/Covers 8 of 12 items \(67%\): £18\.00/);
    expect(rows[1]).toHaveTextContent(/Covers 3 of 12 items \(25%\): £5\.00/);
    expect(screen.getByText(/Some prices are old/)).toBeTruthy();
    expect(screen.getByTestId('compare-like')).toHaveTextContent(/Cheapest here: ALDI/);
  });

  it('says nothing is comparable yet when there are no shop prices', async () => {
    await render(<CompareListCard view={parseListCompare({ view: { totalItems: 2, shops: [], badges: {}, likeForLike: null, note: 'No shop prices for the items on this list yet.' } })} />);
    await fireEvent.press(screen.getByTestId('compare-toggle'));
    expect(screen.getByTestId('compare-empty')).toHaveTextContent(/No shop prices/);
  });
});
