import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { ServerApiProvider } from '@/data/ServerApiContext';
import { parsePage } from '@/lib/planApi';
import { cookedVariety, weekVariety } from '@/lib/plan/ops';
import type { PlanDoc, RecipeLite } from '@/lib/plan/types';
import type { ServerApi } from '@/lib/serverApi';
import PlanScreen from '@/screens/plan/PlanScreen';
import { HH, PARSED, WEEK, fakePlanApi, pageJson, recipeJson } from './helpers/planFixtures';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn(), setParams: jest.fn() }), useLocalSearchParams: () => ({}) }));

const rx = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const profile = (over: Record<string, unknown> = {}) => ({ fv: 2, pulses: 0, plants: ['carrot', 'onion'], proteinSources: ['salmon'], proteins: ['fish'], unweighed: 0, ...over });

function SetHousehold({ children }: { children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId(HH), [setHouseholdId]);
  return householdId ? <>{children}</> : null;
}
async function mount(api: ServerApi) {
  await render(
    <AppProvider dataSource={new MockDataSource()}>
      <SetHousehold>
        <ServerApiProvider api={api}>
          <PlanScreen />
        </ServerApiProvider>
      </SetHousehold>
    </AppProvider>,
  );
  await screen.findByTestId('week-label', {}, { timeout: 8000 });
}

const recipes = [
  recipeJson('r1', 'Fish pie', { dietCategory: 'fish', variety: profile({ fv: 3 }) }),
  recipeJson('r2', 'Tomato pasta', { dietCategory: 'vegetarian', variety: profile({ fv: 5, proteins: ['plant'], proteinSources: ['lentil'], plants: ['tomato', 'lentil'] }) }),
  recipeJson('r4', 'Mystery stew'), // the server sent no variety for this one
];
const entry = (recipeId: string) => ({ kind: 'recipe', recipeId, servings: 4 });
const planned = { [`${WEEK}|dinner`]: entry('r1'), ['2026-10-20|dinner']: entry('r2'), ['2026-10-21|dinner']: entry('r4') };

describe('parsePage: variety and dislikes (defensive)', () => {
  it('keeps a valid variety profile and drops malformed ones to null (never invented numbers)', () => {
    const p = parsePage(pageJson(WEEK, { recipes: [recipeJson('a', 'A', { variety: profile() }), recipeJson('b', 'B', { variety: { fv: 'lots' } }), recipeJson('c', 'C', { variety: { fv: -1, pulses: 0 } }), recipeJson('d', 'D')] }));
    expect(p.recipes.map((r) => r.variety)).toEqual([
      { fv: 2, pulses: 0, plants: ['carrot', 'onion'], proteinSources: ['salmon'], proteins: ['fish'], unweighed: 0 }, null, null, null,
    ]);
  });
  it('parses member dislikes and cooked meals when present, and leaves them absent otherwise', () => {
    const p = parsePage(pageJson(WEEK, { memberDislikes: [{ memberName: 'Sam', terms: ['mushrooms'] }, { memberName: 'Bo', terms: [] }, { terms: ['x'] }, 'junk'], cooked: [{ date: WEEK, recipeId: 'r1' }, { date: 5 }] }));
    expect(p.memberDislikes).toEqual([{ memberName: 'Sam', terms: ['mushrooms'] }]);
    expect(p.cooked).toEqual([{ date: WEEK, recipeId: 'r1' }]);
    const bare = parsePage(pageJson(WEEK));
    expect(bare.memberDislikes).toBeUndefined();
    expect(bare.cooked).toBeUndefined();
  });
});

describe('weekVariety / cookedVariety (the same engine summary as the web planner)', () => {
  const lite = (id: string, v: ReturnType<typeof profile> | null): RecipeLite => ({ id, title: id, tags: [], mealTypes: ['dinner'], baseServings: 4, costPerServingPence: null, excludedBy: [], variety: v as never });
  const doc = { id: 'p', householdId: HH, weekStart: WEEK, mealTypes: ['dinner'], entries: { ...planned, '2026-10-22|dinner': { kind: 'eating_out' } }, status: 'draft', updatedAt: '' } as PlanDoc;
  it('counts recipe meals only, with the day totals and lower-bound meals', () => {
    const v = weekVariety(doc, new Map([['r1', lite('r1', profile({ fv: 3 }))], ['r2', lite('r2', profile({ fv: 5 }))], ['r4', lite('r4', null)]]))!;
    expect(v.meals).toBe(3);
    expect(v.summary.days.map((d) => d.portions)).toEqual([3, 5, 0]);
    expect(v.summary.daysWithFive).toBe(1);
    expect(v.summary.mealsWithoutData).toBe(1);
  });
  it('null when there is nothing to summarise', () => {
    expect(weekVariety({ ...doc, entries: {} }, new Map())).toBeNull();
    expect(cookedVariety([], new Map())).toBeNull();
  });
});

describe('planner screen: variety panel and dislike chips', () => {
  it('shows the estimate, protein kinds, plants and the disclaimer for the planned week', async () => {
    const { api } = fakePlanApi({ 'GET /api/plan': () => pageJson(WEEK, { recipes }, { entries: planned }) });
    await mount(api);
    expect(await screen.findByTestId('week-variety')).toBeTruthy();
    expect(screen.getByTestId('variety-score')).toHaveTextContent(/Variety score \d+ out of 100/);
    expect(screen.getByTestId('variety-avg')).toHaveTextContent(rx('fruit and veg portions per person per planned day; 1 of 3 days reach 5.'));
    expect(screen.getByTestId('variety-protein')).toHaveTextContent(rx('Fish: 1 meal'));
    expect(screen.getByTestId('variety-plants')).toHaveTextContent(rx('carrot'));
    expect(screen.getByText(rx('1 meal has no ingredient data, so figures are lower bounds.'))).toBeTruthy();
    expect(screen.getByTestId('week-variety-disclaimer')).toHaveTextContent(rx('not dietary or medical advice'));
    // no cooking log yet: no Planned/Cooked toggle
    expect(screen.queryByTestId('variety-cooked')).toBeNull();
  });

  it('shows nothing for a week with no recipe meals', async () => {
    const { api } = fakePlanApi();
    await mount(api);
    expect(screen.queryByTestId('week-variety')).toBeNull();
  });

  it('adds a Planned / Cooked toggle only when the server sends cooked meals (P1-A feature detect)', async () => {
    const { api } = fakePlanApi({ 'GET /api/plan': () => pageJson(WEEK, { recipes, cooked: [{ date: WEEK, recipeId: 'r2' }] }, { entries: planned }) });
    await mount(api);
    await fireEvent.press(await screen.findByTestId('variety-cooked'));
    expect(screen.getByTestId('variety-avg')).toHaveTextContent(rx('per cooked day; 1 of 1 day reach 5.'));
    await fireEvent.press(screen.getByTestId('variety-planned'));
    expect(screen.getByTestId('variety-avg')).toHaveTextContent(rx('per planned day'));
  });

  it('shows each member\'s soft dislikes as read-only chips in the request chips, apart from the locked allergy exclusions', async () => {
    const { api } = fakePlanApi({
      'GET /api/plan': () => pageJson(WEEK, { memberDislikes: [{ memberName: 'Sam', terms: ['mushrooms', 'olives'] }] }),
      'POST /api/plan/parse': () => PARSED,
    });
    await mount(api);
    await fireEvent.press(screen.getByTestId('understand'));
    expect(await screen.findByTestId('dislike-chips')).toBeTruthy();
    expect(screen.getByLabelText('Sam: mushrooms')).toBeTruthy();
    expect(screen.getByLabelText('Sam: olives')).toBeTruthy();
    expect(screen.getByLabelText('peanuts (locked)')).toBeTruthy(); // allergies stay a separate, locked set
    expect(screen.queryByLabelText('Sam: mushrooms (locked)')).toBeNull();
  });
});
