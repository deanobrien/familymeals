import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { ServerApiProvider } from '@/data/ServerApiContext';
import { parseMakeNowView } from '@/lib/makeNowApi';
import { ServerApiError, type ServerApi } from '@/lib/serverApi';
import { MakeNowHome, MakeNowSection } from '@/screens/MakeNow';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }) }));

const item = (id: string, over: Record<string, unknown> = {}) => ({
  recipeId: id, title: `Recipe ${id}`, href: `/recipes/${id}`, coveragePct: 80, urgencyPct: 50, makeable: false, usesExpiring: true,
  covered: ['milk', 'rice'], missing: [{ name: 'sugar', quantityLabel: '50 g' }], headline: '80% covered, 1 to buy, uses stock expiring soon', ...over,
});
const view = (over: Record<string, unknown> = {}) => ({
  view: { items: [item('r1'), item('r2', { makeable: true, coveragePct: 100, missing: [], urgencyPct: 0, usesExpiring: false }), item('r3'), item('r4')], hiddenByAllergy: 0, exclusionsActive: false, withheldExclusions: 0, totalRecipes: 9, pantryEmpty: false, ...over },
});

function fakeApi(opts: { body?: unknown; getFails?: boolean; postFails?: ServerApiError; addResult?: Record<string, unknown>; configured?: boolean } = {}) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const gets: Array<{ path: string; query: Record<string, unknown> }> = [];
  const api: ServerApi = {
    configured: opts.configured ?? true,
    get: async (path, query) => {
      gets.push({ path, query: (query ?? {}) as Record<string, unknown> });
      if (opts.getFails) throw new Error('down');
      return (opts.body ?? view()) as never;
    },
    post: async (path, body) => {
      posts.push({ path, body: body as Record<string, unknown> });
      if (opts.postFails) throw opts.postFails;
      return (opts.addResult ?? { ok: true, added: 1, alreadyOnList: 0, message: 'Added 1 item to your shopping list' }) as never;
    },
    postForm: async () => { throw new Error('unused'); },
    webUrl: () => null,
    authHeaders: async () => ({}),
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

beforeEach(() => mockPush.mockClear());

describe('parseMakeNowView', () => {
  it('keeps valid suggestions, clamps numbers and drops malformed rows', () => {
    const v = parseMakeNowView({ view: { items: [item('a', { coveragePct: 140 }), { title: 'no id' }, 7], hiddenByAllergy: -3, withheldExclusions: 2.9, pantryEmpty: true } });
    expect(v.items).toHaveLength(1);
    expect(v.items[0]).toMatchObject({ recipeId: 'a', coveragePct: 100, missing: [{ name: 'sugar', quantityLabel: '50 g' }] });
    expect(v).toMatchObject({ hiddenByAllergy: 0, withheldExclusions: 2, pantryEmpty: true, exclusionsActive: false });
  });
  it('throws on an unexpected body so the section is left out', () => {
    expect(() => parseMakeNowView({})).toThrow(/unexpected/);
    expect(() => parseMakeNowView(null)).toThrow();
  });
});

describe('MakeNowSection (Pantry)', () => {
  it('shows ranked recipes with coverage, expiring stock and what is still needed', async () => {
    const f = fakeApi();
    await mount(<MakeNowSection api={f.api} householdId="hh-1" limit={6} />, f.api);
    expect(await screen.findByText('Recipe r1')).toBeTruthy();
    expect(f.gets[0]).toEqual({ path: '/api/pantry/make-now', query: { householdId: 'hh-1', limit: 6 } });
    expect(screen.getByText('What can I make now?')).toBeTruthy();
    expect(screen.getByTestId('make-now-missing-r1')).toHaveTextContent('Still needed: sugar (50 g)');
    expect(screen.getByTestId('make-now-r2')).toHaveTextContent(/Ready to cook/);
    expect(screen.queryByTestId('make-now-missing-r2')).toBeNull();
    expect(screen.queryByTestId('make-now-add-r2')).toBeNull(); // nothing to add for a recipe you can already make
  });

  it('adds the missing items to the shopping list through the server and shows its message', async () => {
    const f = fakeApi();
    const added = jest.fn();
    await mount(<MakeNowSection api={f.api} householdId="hh-1" onAdded={added} />, f.api);
    await fireEvent.press(await screen.findByTestId('make-now-add-r1'));
    await waitFor(() => expect(f.posts).toHaveLength(1));
    expect(f.posts[0]).toEqual({ path: '/api/pantry/make-now', body: { action: 'add_missing', householdId: 'hh-1', recipeId: 'r1' } });
    expect(await screen.findByTestId('make-now-message')).toHaveTextContent('Added 1 item to your shopping list');
    expect(added).toHaveBeenCalledWith('Added 1 item to your shopping list');
  });

  it('a refusal shows the server text; nothing is claimed as added', async () => {
    const f = fakeApi({ postFails: new ServerApiError('This household is read-only while it is pending deletion.', 403, false, 'READ_ONLY') });
    await mount(<MakeNowSection api={f.api} householdId="hh-1" />, f.api);
    await fireEvent.press(await screen.findByTestId('make-now-add-r1'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/read-only/);
    expect(screen.queryByTestId('make-now-message')).toBeNull();
  });

  it('says how many recipes were left out for allergies and counts consent-withheld exclusions', async () => {
    const f = fakeApi({ body: view({ hiddenByAllergy: 2, exclusionsActive: true, withheldExclusions: 1 }) });
    await mount(<MakeNowSection api={f.api} householdId="hh-1" />, f.api);
    expect(await screen.findByTestId('make-now-hidden')).toHaveTextContent("2 recipes left out because of your household's allergy list.");
    expect(screen.getByTestId('make-now-consent')).toHaveTextContent("1 allergy exclusion isn't being applied because consent hasn't been given");
  });

  it('explains an empty pantry, and an empty result with hidden recipes', async () => {
    const empty = fakeApi({ body: view({ items: [], pantryEmpty: true }) });
    await mount(<MakeNowSection api={empty.api} householdId="hh-1" />, empty.api);
    expect(await screen.findByTestId('make-now-empty')).toHaveTextContent(/Add some stock to your pantry/);
  });

  it('leaves the section out when the server cannot answer', async () => {
    const f = fakeApi({ getFails: true });
    await mount(<MakeNowSection api={f.api} householdId="hh-1" />, f.api);
    await waitFor(() => expect(f.gets).toHaveLength(1));
    expect(screen.queryByTestId('make-now')).toBeNull();
  });
});

describe('MakeNowHome (Recipes tab card)', () => {
  it('shows the top three, no add buttons, and links to the Pantry for the rest', async () => {
    const f = fakeApi();
    await mount(<MakeNowHome />, f.api);
    expect(await screen.findByText('Recipe r1')).toBeTruthy();
    expect(f.gets[0]!.query).toEqual({ householdId: 'hh-1', limit: 3 });
    expect(screen.getByText('Recipe r3')).toBeTruthy();
    expect(screen.queryByText('Recipe r4')).toBeNull();
    expect(screen.queryByTestId('make-now-add-r1')).toBeNull();
    await fireEvent.press(screen.getByTestId('make-now-see-all'));
    expect(mockPush).toHaveBeenCalledWith('/pantry');
    await fireEvent.press(screen.getByText('Recipe r1'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/recipe/[id]', params: { id: 'r1' } });
  });

  it('renders nothing without a server, or with no suggestions', async () => {
    const off = fakeApi({ configured: false });
    await mount(<MakeNowHome />, off.api);
    expect(screen.queryByTestId('make-now')).toBeNull();
    expect(off.gets).toHaveLength(0);
  });

  it('renders nothing when nothing is close to the pantry', async () => {
    const f = fakeApi({ body: view({ items: [] }) });
    await mount(<MakeNowHome />, f.api);
    await waitFor(() => expect(f.gets).toHaveLength(1));
    expect(screen.queryByTestId('make-now')).toBeNull();
  });
});
