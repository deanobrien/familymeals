import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { ServerApiProvider } from '@/data/ServerApiContext';
import { NO_GOALS, createGoalsClient, parseGoals, type GoalsClient, type MyGoals } from '@/lib/goalsApi';
import { parsePage } from '@/lib/planApi';
import { cookedGoals, weekGoals } from '@/lib/plan/ops';
import type { PlanDoc, RecipeLite } from '@/lib/plan/types';
import type { ServerApi } from '@/lib/serverApi';
import { HealthGoalsBody } from '@/screens/goals/HealthGoalsScreen';
import PlanScreen from '@/screens/plan/PlanScreen';
import { HH, WEEK, fakePlanApi, pageJson, recipeJson } from './helpers/planFixtures';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn(), setParams: jest.fn() }), useLocalSearchParams: () => ({}) }));

const rx = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const active = (over: Partial<MyGoals> = {}): MyGoals => ({ ...NO_GOALS, consentActive: true, adultConfirmed: true, goals: ['more_fruit_veg'], ...over });
const api = (): ServerApi => fakePlanApi().api;

function fakeClient(initial: MyGoals) {
  let state = initial;
  const calls: { fn: string; arg?: unknown }[] = [];
  const client: GoalsClient = {
    load: async () => state,
    save: async (input) => {
      calls.push({ fn: 'save', arg: input });
      if (!state.consentActive && !input.consent) throw new Error('Your consent is needed before nutrition goals can be saved.');
      state = { consentActive: true, goals: input.goals, portionShare: input.portionShare, nudgePlan: input.nudgePlan, adultConfirmed: true, wordingVersion: 'g1' };
      return state;
    },
    withdraw: async () => {
      calls.push({ fn: 'withdraw' });
      state = { ...NO_GOALS };
      return state;
    },
  };
  return { client, calls };
}

describe('parseGoals (defensive)', () => {
  it('anything without an active consent is "nothing stored" (never invented goals)', () => {
    expect(parseGoals(null)).toEqual(NO_GOALS);
    expect(parseGoals({ consentActive: false, goals: ['more_fibre'] })).toEqual(NO_GOALS);
    expect(parseGoals('junk')).toEqual(NO_GOALS);
  });
  it('keeps only known goals in a fixed order and a valid portion', () => {
    expect(parseGoals({ consentActive: true, goals: ['less_salt', 'lose_weight', 'more_fibre'], portionShare: 9, nudgePlan: true, adultConfirmed: true, wordingVersion: 'g1' })).toEqual({
      consentActive: true, goals: ['more_fibre', 'less_salt'], portionShare: 1, nudgePlan: true, adultConfirmed: true, wordingVersion: 'g1',
    });
  });
  it('the client reads { goals } and posts the explicit actions with the household id', async () => {
    const { api: a, calls } = fakePlanApi({
      'GET /api/goals': () => ({ goals: { consentActive: true, goals: ['more_fibre'], portionShare: 0.5, nudgePlan: false, adultConfirmed: true } }),
      'POST /api/goals': (p) => ({ goals: p.action === 'withdraw' ? { consentActive: false } : { consentActive: true, goals: p.goals, portionShare: 1 } }),
    });
    const c = createGoalsClient(a, HH);
    expect(await c.load()).toMatchObject({ consentActive: true, goals: ['more_fibre'], portionShare: 0.5 });
    expect(await c.withdraw()).toEqual(NO_GOALS);
    await c.save({ goals: ['less_salt'], portionShare: 1, nudgePlan: false, consent: true, adultConfirmed: true });
    expect(calls.filter((x) => x.method === 'POST').map((x) => [x.payload.action, x.payload.householdId])).toEqual([['withdraw', HH], ['save', HH]]);
  });
});

describe('Settings > Health goals screen', () => {
  const mount = async (client: GoalsClient) => {
    await render(<HealthGoalsBody api={api()} householdId={HH} client={client} />);
    await screen.findByTestId('goals-save');
  };

  it('starts with consent text only: no goals shown, Save disabled, nothing sent', async () => {
    const { client, calls } = fakeClient({ ...NO_GOALS });
    await mount(client);
    expect(screen.getByTestId('goals-consent')).toBeTruthy();
    expect(screen.queryByTestId('goals-list')).toBeNull();
    expect(screen.getByTestId('goals-disclaimer')).toHaveTextContent(rx('not medical or dietary advice'));
    expect(screen.getByText(rx('Only you can see your goals'))).toBeTruthy();
    expect(screen.getByText(rx('never sent to our AI provider'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('goals-save'));
    expect(calls).toEqual([]);
  });

  it('after consent and the adult tick the goals appear with NHS references and links; saving sends consent, adult and the goals', async () => {
    const { client, calls } = fakeClient({ ...NO_GOALS });
    await mount(client);
    await fireEvent.press(screen.getByTestId('goals-consent-box'));
    await fireEvent.press(screen.getByTestId('goals-adult-box'));
    expect(await screen.findByTestId('goals-list')).toBeTruthy();
    expect(screen.getByText(rx('Adults: aim for 30 g of fibre a day (NHS).'))).toBeTruthy();
    expect(screen.getByText(rx('page reviewed 2026-03-02'))).toBeTruthy();
    expect(screen.getByText(rx('no more than 6 g of salt a day'))).toBeTruthy();
    expect(screen.queryByText(/calorie goal|weight loss|lose weight/i)).toBeNull();
    await fireEvent.press(screen.getByTestId('goal-more_fibre'));
    await fireEvent.press(screen.getByTestId('goal-less_salt'));
    await fireEvent.press(screen.getByLabelText('Small (half a serving)'));
    await fireEvent.press(screen.getByTestId('goals-save'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ fn: 'save', arg: { goals: ['more_fibre', 'less_salt'], portionShare: 0.5, nudgePlan: false, consent: true, adultConfirmed: true } });
    expect(await screen.findByTestId('goals-consent-on')).toBeTruthy();
    expect(screen.getByTestId('goals-notice')).toHaveTextContent('Goals saved');
  });

  it('with consent on file the screen shows saved goals and a withdraw that deletes them after a confirmation', async () => {
    const { client, calls } = fakeClient(active({ goals: ['more_fibre'], nudgePlan: true }));
    await mount(client);
    expect(screen.queryByTestId('goals-consent-box')).toBeNull();
    expect(screen.getByTestId('goal-more_fibre').props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId('goal-nudge').props.accessibilityState.checked).toBe(true);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.find((b) => b.style === 'destructive')?.onPress?.(); });
    await fireEvent.press(screen.getByTestId('goals-withdraw'));
    await waitFor(() => expect(calls).toEqual([{ fn: 'withdraw' }]));
    expect(await screen.findByTestId('goals-consent')).toBeTruthy(); // back to the consent screen: nothing held
    expect(screen.queryByTestId('goals-list')).toBeNull();
    expect(screen.getByTestId('goals-notice')).toHaveTextContent('Consent withdrawn and your goals deleted');
    alert.mockRestore();
  });

  it('withdrawing is cancellable', async () => {
    const { client, calls } = fakeClient(active());
    await mount(client);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.find((b) => b.style === 'cancel')?.onPress?.(); });
    await fireEvent.press(screen.getByTestId('goals-withdraw'));
    expect(calls).toEqual([]);
    alert.mockRestore();
  });
});

// ---- the planner week panel ----
const fruit = (fv: number, unweighed = 0) => ({ fv, pulses: 0, plants: [], proteinSources: [], proteins: [], unweighed });
const noOily = { oilyFishPortions: 0, oilyUnweighed: 0, redProcessedMeatG: 0, redUnweighed: 0 };
const recipes = [
  recipeJson('r1', 'Fish pie', { dietCategory: 'fish', variety: fruit(1), goals: { ...noOily, oilyFishPortions: 1 } }),
  recipeJson('r2', 'Veg pasta', { dietCategory: 'vegetarian', variety: fruit(4), goals: noOily }),
  recipeJson('r4', 'Mystery stew'), // no variety / goal data from the server
  recipeJson('r5', 'Big salad', { dietCategory: 'vegetarian', variety: fruit(6), goals: noOily }),
];
const entry = (recipeId: string) => ({ kind: 'recipe' as const, recipeId, servings: 4 });
const planned = { [`${WEEK}|dinner`]: entry('r1'), ['2026-10-20|dinner']: entry('r2') };

function SetHousehold({ children }: { children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId(HH), [setHouseholdId]);
  return householdId ? <>{children}</> : null;
}
async function mountPlan(a: ServerApi) {
  await render(
    <AppProvider dataSource={new MockDataSource()}>
      <SetHousehold>
        <ServerApiProvider api={a}>
          <PlanScreen />
        </ServerApiProvider>
      </SetHousehold>
    </AppProvider>,
  );
  await screen.findByTestId('week-label', {}, { timeout: 8000 });
}
const lite = (r: ReturnType<typeof recipeJson>): RecipeLite => parsePage(pageJson(WEEK, { recipes: [r] })).recipes[0]!;

describe('parsePage: recipe goal profile (defensive)', () => {
  it('keeps a valid profile and drops malformed ones to null', () => {
    const p = parsePage(pageJson(WEEK, { recipes: [recipeJson('a', 'A', { goals: noOily }), recipeJson('b', 'B', { goals: { oilyFishPortions: 'lots' } }), recipeJson('c', 'C', { goals: { oilyFishPortions: -1, redProcessedMeatG: 0 } }), recipeJson('d', 'D')] }));
    expect(p.recipes.map((r) => r.goals)).toEqual([noOily, null, null, null]);
  });
});

describe('weekGoals / cookedGoals (the same engine summary as the web planner)', () => {
  const doc = { id: 'p', householdId: HH, weekStart: WEEK, mealTypes: ['dinner'], entries: { ...planned, '2026-10-21|dinner': entry('r4'), '2026-10-22|dinner': { kind: 'eating_out' } }, status: 'draft', updatedAt: '' } as PlanDoc;
  const map = new Map(recipes.map((r) => [r.id as string, lite(r)]));
  it('nothing without goals or consent', () => {
    expect(weekGoals(null, doc, map)).toBeNull();
    expect(weekGoals({ goals: [], portionShare: 1 }, doc, map)).toBeNull();
    expect(cookedGoals({ goals: ['more_fruit_veg'], portionShare: 1 }, [], map)).toBeNull();
  });
  it('counts recipe meals, scales by portion and reports "at least" when a meal has no data', () => {
    const full = weekGoals({ goals: ['more_fruit_veg'], portionShare: 1 }, { ...doc, entries: planned }, map)!;
    expect(full.summary.progress[0]).toMatchObject({ atLeast: false, amount: 2.5 });
    const half = weekGoals({ goals: ['more_fruit_veg'], portionShare: 0.5 }, { ...doc, entries: planned }, map)!;
    expect(half.summary.progress[0]!.amount).toBe(1.25);
    const partial = weekGoals({ goals: ['more_fruit_veg'], portionShare: 1 }, doc, map)!;
    expect(partial.meals).toBe(3);
    expect(partial.summary.progress[0]).toMatchObject({ atLeast: true, mealsMissingData: 1 });
  });
});

describe('planner screen: My goals this week', () => {
  const goalsRoute = (g: unknown) => ({ 'GET /api/goals': () => ({ goals: g }) });

  it('is hidden without consent and when no goals are chosen (nothing shown, nothing computed)', async () => {
    const { api: a } = fakePlanApi({ 'GET /api/plan': () => pageJson(WEEK, { recipes }, { entries: planned }), ...goalsRoute({ consentActive: false }) });
    await mountPlan(a);
    await screen.findByTestId('week-variety');
    expect(screen.queryByTestId('week-goals')).toBeNull();
    const b = fakePlanApi({ 'GET /api/plan': () => pageJson(WEEK, { recipes }, { entries: planned }), ...goalsRoute({ consentActive: true, goals: [] }) });
    await mountPlan(b.api);
    expect(screen.queryByTestId('week-goals')).toBeNull();
  });

  it('shows my progress with the reference, source and disclaimer, and an "at least" figure when a meal lacks data', async () => {
    const { api: a } = fakePlanApi({
      'GET /api/plan': () => pageJson(WEEK, { recipes }, { entries: { ...planned, ['2026-10-21|dinner']: entry('r4') } }),
      ...goalsRoute({ consentActive: true, goals: ['more_fruit_veg', 'more_oily_fish'], portionShare: 1, adultConfirmed: true }),
    });
    await mountPlan(a);
    expect(await screen.findByTestId('week-goals')).toBeTruthy();
    expect(screen.getByTestId('goal-headline-more_fruit_veg')).toHaveTextContent(rx('at least'));
    expect(screen.getByTestId('goal-progress-more_fruit_veg').props.accessibilityLabel).toMatch(/Not enough data to say/);
    expect(screen.getByTestId('goal-progress-more_oily_fish')).toBeTruthy();
    expect(screen.getAllByText(rx('NHS')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('week-goals-disclaimer')).toHaveTextContent(rx('not medical or dietary advice'));
  });

  it('gives a gentle swap hint from a saved recipe only when the data is complete', async () => {
    const { api: a } = fakePlanApi({
      'GET /api/plan': () => pageJson(WEEK, { recipes }, { entries: { [`${WEEK}|dinner`]: entry('r1') } }),
      ...goalsRoute({ consentActive: true, goals: ['more_fruit_veg'], portionShare: 1, adultConfirmed: true }),
    });
    await mountPlan(a);
    const hints = await screen.findByTestId('goal-hints');
    expect(hints).toHaveTextContent(rx('on the low side for fruit and veg'));
    expect(hints).toHaveTextContent(rx('you could try Big salad instead of Fish pie'));
    expect(hints).not.toHaveTextContent(/should|must|deficien|unhealthy/i);
  });

  it('a Planned / Cooked toggle appears only when the server sends cooked meals', async () => {
    const { api: a } = fakePlanApi({
      'GET /api/plan': () => pageJson(WEEK, { recipes, cooked: [{ date: WEEK, recipeId: 'r5' }] }, { entries: planned }),
      ...goalsRoute({ consentActive: true, goals: ['more_fruit_veg'], portionShare: 1, adultConfirmed: true }),
    });
    await mountPlan(a);
    await fireEvent.press(await screen.findByTestId('goals-cooked'));
    expect(screen.getByTestId('goal-headline-more_fruit_veg')).toHaveTextContent(rx('about 6'));
    await fireEvent.press(screen.getByTestId('goals-planned'));
    expect(screen.getByTestId('goal-headline-more_fruit_veg')).toHaveTextContent(rx('about 2.5'));
  });
});
