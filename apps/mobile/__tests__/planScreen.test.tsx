import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { ServerApiProvider } from '@/data/ServerApiContext';
import type { ServerApi } from '@/lib/serverApi';
import PlanScreen from '@/screens/plan/PlanScreen';
import { HH, IDEAS, PARSED, PROPOSAL, WEEK, err, fakePlanApi, pageJson } from './helpers/planFixtures';

/** toHaveTextContent(string) matches the whole text; these checks want "contains". */
const rx = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }) }));

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

const press = (id: string) => fireEvent.press(screen.getByTestId(id));
const pressLabel = (label: string) => fireEvent.press(screen.getByLabelText(label));
const status = () => screen.getByTestId('plan-status').props.accessibilityLabel as string;

/** Add Fish pie to Monday dinner. */
async function addFishPie() {
  await pressLabel('Add meal to Dinner on Mon');
  await press('pick-r1');
}

beforeEach(() => mockPush.mockClear());

describe('planner screen: gate, week view, consent notice', () => {
  it('explains that it needs the server when the app has no server URL (mock mode)', async () => {
    const { api } = fakePlanApi({}, false);
    await render(
      <AppProvider dataSource={new MockDataSource()}>
        <SetHousehold>
          <ServerApiProvider api={api}>
            <PlanScreen />
          </ServerApiProvider>
        </SetHousehold>
      </AppProvider>,
    );
    expect(await screen.findByLabelText(/needs the Family Recipes server/, {}, { timeout: 8000 })).toBeTruthy();
  });

  it('renders a 7-day list with empty slots, the week label, a status and an honest empty cost', async () => {
    const { api, calls } = fakePlanApi();
    await mount(api);
    expect(calls[0]).toMatchObject({ path: '/api/plan', payload: { householdId: HH } });
    expect(screen.getByTestId('week-label')).toHaveTextContent(rx('19 Oct to 25 Oct'));
    for (const d of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']) {
      expect(screen.getByTestId(`day-${d}`)).toBeTruthy();
      expect(screen.getByTestId(`slot-${d}-dinner`)).toBeTruthy();
    }
    expect(status()).toBe('Plan status: Not saved yet');
    expect(screen.getByTestId('week-cost')).toHaveTextContent(rx('No meals planned yet'));
    expect(screen.queryByTestId('consent-notice')).toBeNull();
  });

  it('shows the consent notice (count only) when exclusions are withheld', async () => {
    const { api } = fakePlanApi({ 'GET /api/plan': () => pageJson(undefined, { withheldExclusions: 2 }) });
    await mount(api);
    expect(screen.getByTestId('consent-notice')).toHaveTextContent(rx("2 allergy exclusions aren't being applied because consent hasn't been given"));
  });

  it('shows a load error with a retry', async () => {
    let fail = true;
    const { api } = fakePlanApi({ 'GET /api/plan': () => { if (fail) throw err(500, 'Server is down.'); return pageJson(undefined); } });
    await render(
      <AppProvider dataSource={new MockDataSource()}>
        <SetHousehold>
          <ServerApiProvider api={api}><PlanScreen /></ServerApiProvider>
        </SetHousehold>
      </AppProvider>,
    );
    expect(await screen.findByText('Server is down.', {}, { timeout: 8000 })).toBeTruthy();
    fail = false;
    await press('retry');
    await screen.findByTestId('week-label');
  });

  it('shows saved weeks and loads one; unsaved changes ask before leaving the week', async () => {
    const { api, calls } = fakePlanApi({
      'GET /api/plan': (q) => (q.week ? pageJson(q.week as string) : pageJson(undefined, { saved: [{ id: 'x', weekStart: '2026-10-12', status: 'approved' }] })),
    });
    await mount(api);
    expect(screen.getByTestId('saved-2026-10-12')).toHaveTextContent(rx('Approved'));
    await addFishPie(); // dirty
    await press('next-week');
    expect(screen.getByTestId('discard-confirm')).toBeTruthy();
    await press('discard-keep');
    expect(screen.queryByTestId('discard-confirm')).toBeNull();
    await press('next-week');
    await press('discard-go');
    await waitFor(() => expect(screen.getByTestId('week-label')).toHaveTextContent(rx('26 Oct to 1 Nov')));
    expect(calls.filter((c) => c.path === '/api/plan').at(-1)!.payload.week).toBe('2026-10-26');
  });
});

describe('slot editing', () => {
  it('adds a recipe from the searchable list; excluded recipes are disabled with the reason', async () => {
    const { api } = fakePlanApi();
    await mount(api);
    await pressLabel('Add meal to Dinner on Mon');
    expect(screen.getByTestId('blocked-r3')).toHaveTextContent(rx('Excluded: contains peanuts'));
    expect(screen.getByTestId('pick-r3').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('pick-r3'));
    expect(screen.queryByTestId('slot-done')).toBeNull(); // still on the picker

    await fireEvent.changeText(screen.getByTestId('recipe-search'), 'pasta');
    expect(screen.queryByTestId('pick-r1')).toBeNull();
    expect(screen.getByTestId('pick-r2')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('recipe-search'), '');
    await press('pick-r1');

    expect(screen.getByLabelText('Edit Dinner on Mon: Fish pie')).toBeTruthy();
    expect(screen.getByTestId('week-cost')).toHaveTextContent(rx('About £11.40 (estimate)'));
    expect(status()).toBe('Plan status: Unsaved changes');
  });

  it('keeps unknown costs unknown: an uncosted recipe never counts as zero', async () => {
    const { api } = fakePlanApi();
    await mount(api);
    await pressLabel('Add meal to Dinner on Mon');
    await press('pick-r4');
    expect(screen.getByTestId('week-cost')).toHaveTextContent(rx('Uncosted: no price data for 1 meal'));
    expect(screen.getByTestId('slot-2026-10-19-dinner')).toHaveTextContent(rx('Uncosted'));
  });

  it('sets servings, adds a note, marks eating out, swaps, duplicates, moves and clears', async () => {
    const { api } = fakePlanApi();
    await mount(api);
    await addFishPie();

    await pressLabel('Edit Dinner on Mon: Fish pie');
    await pressLabel('Increase Servings');
    await fireEvent.changeText(screen.getByTestId('slot-note'), 'late shift');
    await press('slot-save-note');
    await press('slot-done');
    expect(screen.getByTestId('slot-2026-10-19-dinner')).toHaveTextContent(rx('5 servings'));
    expect(screen.getByTestId('slot-2026-10-19-dinner')).toHaveTextContent(rx('late shift'));

    // swap keeps servings and note
    await pressLabel('Edit Dinner on Mon: Fish pie');
    await press('slot-swap');
    await press('pick-r2');
    expect(screen.getByTestId('slot-2026-10-19-dinner')).toHaveTextContent(rx('Tomato pasta'));
    expect(screen.getByTestId('slot-2026-10-19-dinner')).toHaveTextContent(rx('5 servings'));

    // duplicate to Tuesday
    await pressLabel('Edit Dinner on Mon: Tomato pasta');
    await press('slot-duplicate');
    await press('target-2026-10-20|dinner');
    expect(screen.getByTestId('slot-2026-10-20-dinner')).toHaveTextContent(rx('Tomato pasta'));
    expect(screen.getByTestId('slot-2026-10-19-dinner')).toHaveTextContent(rx('Tomato pasta'));

    // move Monday to Wednesday (empty target): Monday empties
    await pressLabel('Edit Dinner on Mon: Tomato pasta');
    await press('slot-move');
    await press('target-2026-10-21|dinner');
    expect(screen.getByTestId('slot-2026-10-21-dinner')).toHaveTextContent(rx('Tomato pasta'));
    expect(screen.getByLabelText('Add meal to Dinner on Mon')).toBeTruthy();

    // eating out then clear
    await pressLabel('Edit Dinner on Tue: Tomato pasta');
    await press('slot-eating-out');
    expect(screen.getByTestId('slot-2026-10-20-dinner')).toHaveTextContent(rx('Eating out'));
    expect(screen.getByTestId('slot-2026-10-20-dinner')).toHaveTextContent(rx('No shopping'));
    await pressLabel('Edit Dinner on Tue: Eating out');
    await press('slot-remove');
    expect(screen.getByLabelText('Add meal to Dinner on Tue')).toBeTruthy();
  });
});

describe('save, approve, shopping, reuse', () => {
  it('saves a draft through the server and shows the saved status', async () => {
    const { api, posts } = fakePlanApi();
    await mount(api);
    await addFishPie();
    await press('save-plan');
    await waitFor(() => expect(status()).toBe('Plan status: Saved draft'));
    const sent = posts('/api/plan/save')[0]!.payload as { householdId: string; doc: { entries: Record<string, unknown> } };
    expect(sent.householdId).toBe(HH);
    expect(sent.doc.entries['2026-10-19|dinner']).toMatchObject({ kind: 'recipe', recipeId: 'r1', servings: 4 });
    expect(screen.getByTestId('plan-message')).toHaveTextContent(rx('Plan saved'));
  });

  it('shows the server violations clearly when approval is refused, and stays a draft', async () => {
    const { api } = fakePlanApi({
      'POST /api/plan/approve': () => { throw err(422, 'This plan breaks a hard constraint or is incomplete, so it cannot be approved.', { violations: ['"Peanut satay" contains excluded ingredient(s): peanuts.', 'Fish meals: only 1 of 2'] }, 'PLAN_REFUSED'); },
    });
    await mount(api);
    await addFishPie();
    await press('approve-plan');
    const msg = await screen.findByTestId('plan-message');
    expect(msg).toHaveTextContent(rx('cannot be approved'));
    expect(msg).toHaveTextContent(rx('"Peanut satay" contains excluded ingredient(s): peanuts.'));
    expect(msg).toHaveTextContent(rx('Fish meals: only 1 of 2'));
    expect(screen.queryByTestId('generate-shopping')).toBeNull();
    expect(status()).toBe('Plan status: Unsaved changes');
  });

  it('approves, then generates the shopping list only from the explicit button and links to the Shopping tab', async () => {
    const { api, posts } = fakePlanApi({
      'POST /api/plan/generate-shopping': () => ({ count: 9, href: '/shopping?plan=p', preview: [{ name: 'cod', quantity: '600 g' }, { name: 'potatoes', quantity: '1 kg' }] }),
    });
    await mount(api);
    await addFishPie();
    expect(screen.queryByTestId('generate-shopping')).toBeNull();
    await press('approve-plan');
    await waitFor(() => expect(status()).toBe('Plan status: Approved'));
    expect(posts('/api/plan/generate-shopping')).toHaveLength(0); // approving never builds a list

    await press('generate-shopping');
    const card = await screen.findByTestId('shopping-handoff');
    expect(card).toHaveTextContent(rx('9 ingredients'));
    expect(card).toHaveTextContent(rx('cod: 600 g'));
    expect(card).toHaveTextContent(rx('and 7 more'));
    expect(posts('/api/plan/generate-shopping')[0]!.payload).toMatchObject({ householdId: HH, planId: `plan-${WEEK}` });
    await press('open-shopping');
    expect(mockPush).toHaveBeenCalledWith('/shopping');
  });

  it('shows the server message when a read-only household is refused (403)', async () => {
    const { api } = fakePlanApi({
      'POST /api/plan/save': () => { throw err(403, 'This household is read-only while it is pending deletion.', {}, 'READ_ONLY'); },
    });
    await mount(api);
    await addFishPie();
    await press('save-plan');
    expect(await screen.findByTestId('plan-message')).toHaveTextContent(rx('read-only while it is pending deletion'));
    expect(status()).toBe('Plan status: Unsaved changes');
  });

  it('reuses the previous week: copies the entries onto this week as an unsaved draft; says so when there is none', async () => {
    const prev = { id: 'old', householdId: HH, weekStart: '2026-10-12', mealTypes: ['dinner'], entries: { '2026-10-13|dinner': { kind: 'recipe', recipeId: 'r2', servings: 3 } }, status: 'approved', updatedAt: '' };
    let have = false;
    const { api, calls } = fakePlanApi({ 'GET /api/plan/week': () => ({ doc: have ? prev : null }) });
    await mount(api);
    await press('reuse-previous');
    expect(await screen.findByTestId('plan-message')).toHaveTextContent(rx('no saved plan for the previous week'));
    have = true;
    await press('reuse-previous');
    await waitFor(() => expect(screen.getByTestId('slot-2026-10-20-dinner')).toHaveTextContent(rx('Tomato pasta')));
    expect(screen.getByTestId('slot-2026-10-20-dinner')).toHaveTextContent(rx('3 servings'));
    expect(status()).toBe('Plan status: Unsaved changes');
    expect(calls.filter((c) => c.path === '/api/plan/week').at(-1)!.payload.week).toBe('2026-10-12');
  });
});

describe('prompt flow: understand -> chips -> propose -> review -> accept -> approve -> shopping', () => {
  const routes = {
    'POST /api/plan/parse': () => PARSED,
    'POST /api/plan/solve': () => PROPOSAL,
    'POST /api/plan/ideas': () => IDEAS,
    'POST /api/plan/ideas/draft': () => ({ uploadId: 'u1', draft: { title: { value: 'Salmon traybake' }, issues: [] } }),
    'POST /api/extract/save': () => ({ id: 'rec-9' }),
    'POST /api/plan/generate-shopping': () => ({ count: 14, href: '/shopping', preview: [{ name: 'salmon', quantity: '2' }] }),
  };

  it('runs the whole flow with editable chips and the review details', async () => {
    const { api, posts } = fakePlanApi(routes);
    await mount(api);

    await press('understand');
    expect(await screen.findByTestId('constraint-chips')).toBeTruthy();
    expect(posts('/api/plan/parse')[0]!.payload).toMatchObject({ householdId: HH, weekStart: WEEK, prompt: 'Plan seven dinners for four people.' });
    expect(screen.getByLabelText('peanuts (locked)')).toBeTruthy(); // household exclusion shown locked, no remove button
    expect(screen.queryByLabelText('Remove peanuts')).toBeNull();
    expect(screen.getByTestId('chip-notes')).toHaveTextContent(rx('We could not find a member called Bob.'));
    expect(screen.getByLabelText('Vegetarian: about 50%')).toBeTruthy();

    // edit the chips: drop mushrooms, add Sam's favourites, add an exclusion
    await pressLabel('Remove mushrooms');
    await pressLabel("Add Sam's favourites");
    await fireEvent.changeText(screen.getByLabelText('Avoid ingredient'), 'soy');
    await pressLabel('Add exclusion');

    await press('propose');
    await screen.findByTestId('proposal');
    expect(posts('/api/plan/solve')[0]!.payload).toMatchObject({
      householdId: HH, weekStart: WEEK,
      request: { excludeTerms: ['soy'], favouritesOf: ['Lauren', 'Sam'], servings: 4, budgetPence: 10000 },
    });

    // review: meals, cost, report, unmet, re-imposed exclusion, gaps
    expect(screen.getAllByTestId('proposal-slot')).toHaveLength(7);
    expect(screen.getByTestId('proposal-cost')).toHaveTextContent(rx('At least £42.00 (estimate); 1 meal uncosted.'));
    expect(screen.getByTestId('reimposed')).toHaveTextContent(rx('Also excluded for safety: peanuts'));
    expect(screen.getByTestId('report')).toHaveTextContent(rx('Fish meals: Not met'));
    expect(screen.getByTestId('report')).toHaveTextContent(rx('Budget: Met'));
    expect(screen.getByTestId('unmet')).toHaveTextContent(rx('Only 1 fish meal could be planned.'));
    expect(screen.getByTestId('gaps')).toHaveTextContent(rx('No viable recipe for Sunday'));

    // find ideas for the gap and save one (nothing is added to the plan)
    await press('find-ideas-0');
    expect(await screen.findByText('Salmon traybake')).toBeTruthy();
    expect(posts('/api/plan/ideas')[0]!.payload).toMatchObject({ criteria: { dietCategory: 'fish', mealType: 'dinner' }, extra: { terms: ['soy'] } });
    await pressLabel('Preview Salmon traybake');
    expect(screen.getByTestId('idea-preview')).toHaveTextContent(rx('2 fillets salmon'));
    await press('idea-save-5200');
    expect(await screen.findByTestId('idea-saved-5200')).toHaveTextContent(rx('Saved "Salmon traybake" to your recipes.'));
    expect(screen.queryByTestId('slot-2026-10-25-dinner')).toHaveTextContent(rx('+ Add meal'));

    // accept into the week: 6 recipe meals, still unsaved, linked to the proposal
    await press('accept-proposal');
    await waitFor(() => expect(status()).toBe('Plan status: Unsaved changes'));
    expect(screen.getByTestId('slot-2026-10-19-dinner')).toHaveTextContent(rx('Fish pie'));
    expect(screen.getByTestId('slot-2026-10-20-dinner')).toHaveTextContent(rx('Tomato pasta'));
    expect(screen.getByTestId('slot-2026-10-25-dinner')).toHaveTextContent(rx('+ Add meal'));

    await press('approve-plan');
    await waitFor(() => expect(status()).toBe('Plan status: Approved'));
    const approved = posts('/api/plan/approve')[0]!.payload as { doc: { proposalId: string; entries: Record<string, unknown> } };
    expect(approved.doc.proposalId).toBe('prop1');
    expect(Object.keys(approved.doc.entries)).toHaveLength(6);

    await press('generate-shopping');
    expect(await screen.findByTestId('shopping-handoff')).toHaveTextContent(rx('14 ingredients'));
  });

  it('shows why a prompt could not be understood or planned, with gaps and idea search', async () => {
    const { api } = fakePlanApi({
      ...routes,
      'POST /api/plan/parse': () => PARSED,
      'POST /api/plan/solve': () => {
        throw err(422, 'We could not build a plan from your library.', {
          unmet: [{ kind: 'solver', detail: 'No fish recipes saved.' }],
          gaps: [{ date: WEEK, mealType: 'dinner', reason: 'none' }, { date: '2026-10-20', mealType: 'dinner', reason: 'none' }],
        }, 'NO_VIABLE_CANDIDATES');
      },
    });
    await mount(api);
    await press('understand');
    await press('propose');
    const e = await screen.findByTestId('proposal-error');
    expect(e).toHaveTextContent(rx('We could not build a plan from your library.'));
    expect(e).toHaveTextContent(rx('No fish recipes saved.'));
    expect(e).toHaveTextContent(rx('2 slots would need a new recipe.'));
    expect(screen.getByText('2 dinner slots could not be filled from your library.')).toBeTruthy();
    await press('find-ideas-0');
    expect(await screen.findByText('Salmon traybake')).toBeTruthy();
  });

  it('shows a parse failure (AI unavailable) and lets the user try again', async () => {
    let fail = true;
    const { api } = fakePlanApi({
      ...routes,
      'POST /api/plan/parse': () => { if (fail) throw err(503, 'The AI service is unavailable right now.', {}, 'AI_UNAVAILABLE'); return PARSED; },
    });
    await mount(api);
    await press('understand');
    expect(await screen.findByTestId('parse-error')).toHaveTextContent(rx('The AI service is unavailable right now.'));
    fail = false;
    await press('understand');
    expect(await screen.findByTestId('constraint-chips')).toBeTruthy();
    expect(screen.queryByTestId('parse-error')).toBeNull();
  });

  it('keeps the prompt state while a slot is edited', async () => {
    const { api } = fakePlanApi(routes);
    await mount(api);
    await press('understand');
    await screen.findByTestId('constraint-chips');
    await pressLabel('Add meal to Dinner on Mon');
    await press('picker-back');
    expect(screen.getByTestId('constraint-chips')).toBeTruthy();
  });
});
