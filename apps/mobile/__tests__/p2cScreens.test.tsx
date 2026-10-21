// P2-C (D410-D419) on Android: busy toggles and leftover slots in the planner, the calendar settings screen, the freezer panel
// and "Cook x2" on mark-cooked. Jest with fakes: the real calendar prompt is a device check.
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { ServerApiProvider } from '@/data/ServerApiContext';
import type { CalendarClient } from '@/lib/calendarApi';
import type { LeftoversClient } from '@/lib/leftoversApi';
import { createMockRecipesApi } from '@/lib/mockRecipesApi';
import type { BatchView } from '@/lib/plan/types';
import type { ServerApi } from '@/lib/serverApi';
import PlanScreen from '@/screens/plan/PlanScreen';
import { CalendarSettingsBody } from '@/screens/calendar/CalendarSettingsScreen';
import FreezerPanel from '@/screens/pantry/Freezer';
import { MarkCookedForm } from '@/screens/cooking/MarkCookedForm';
import { HH, fakePlanApi, pageJson } from './helpers/planFixtures';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), setParams: jest.fn() }), useLocalSearchParams: () => ({}) }));

const calState = (Calendar as unknown as { __state: { permission: string; events: unknown[] } }).__state;

function SetHousehold({ children }: { children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId(HH), [setHouseholdId]);
  return householdId ? <>{children}</> : null;
}
async function mountPlan(api: ServerApi) {
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
const press = async (id: string) => { await fireEvent.press(screen.getByTestId(id)); };

const batch = (over: Partial<BatchView> = {}): BatchView => ({
  id: 'b1', title: 'Chilli', storedIn: 'freezer', portionsMade: 4, portionsLeft: 4, portionsPlanned: 0, portionsFree: 4, cookedOn: '2026-10-01', useBy: '2027-01-01', status: 'ok', useByLabel: 'Best by Fri 1 Jan', ...over,
});
const leftovers = (b = batch()) => ({
  batches: [b],
  suggestions: [{ batchId: b.id, title: b.title, storedIn: b.storedIn, portions: 2, date: '2026-10-22', mealType: 'dinner', label: 'Freezer meal: Chilli, 2 portions', reason: 'A busy evening: nothing to cook' }],
  titles: { [b.id]: b.title },
});
const busy = [{ date: '2026-10-22', sources: ['device'], minutesAvailable: 45, skip: false, label: 'Busy (about 45 min free)' }];

beforeEach(async () => {
  await AsyncStorage.clear();
  calState.permission = 'undetermined';
  calState.events = [];
});

describe('planner: busy evenings', () => {
  it('shows the busy chip per day, toggles the manual flag and re-reads only the extras (unsaved edits survive)', async () => {
    let manual = false;
    const { api, posts } = fakePlanApi({
      'POST /api/calendar': (p) => { manual = p.busy === true; return {}; },
      'GET /api/plan': (q) => pageJson(q.week as string, { busy: manual ? [...busy, { date: '2026-10-21', sources: ['manual'], minutesAvailable: null, skip: false, label: 'Busy' }] : busy, leftovers: { batches: [], suggestions: [], titles: {} } }),
    });
    await mountPlan(api);
    expect(screen.getByTestId('busy-chip-2026-10-22')).toHaveTextContent(/Busy \(about 45 min free\)/);
    expect(screen.queryByTestId('busy-chip-2026-10-21')).toBeNull();
    // an unsaved edit first
    await fireEvent.press(screen.getByLabelText('Add meal to Dinner on Mon'));
    await press('pick-r1');
    expect(screen.getByTestId('plan-status').props.accessibilityLabel).toMatch(/Unsaved/);
    await press('busy-2026-10-21');
    await waitFor(() => expect(screen.getByTestId('busy-chip-2026-10-21')).toBeTruthy());
    expect(posts('/api/calendar')[0]!.payload).toMatchObject({ action: 'busy_set', date: '2026-10-21', busy: true });
    expect(screen.getByTestId('plan-status').props.accessibilityLabel).toMatch(/Unsaved/); // the grid was not reloaded
    expect(screen.getByLabelText(/Edit Dinner on Mon: Fish pie/)).toBeTruthy();
  });

  it('lists busy chips in the prompt flow', async () => {
    const { api } = fakePlanApi({ 'GET /api/plan': (q) => pageJson(q.week as string, { busy, leftovers: { batches: [], suggestions: [], titles: {} } }) });
    await mountPlan(api);
    expect(screen.getByTestId('busy-chips')).toHaveTextContent(/Busy \(about 45 min free\) \(phone calendar\)/);
  });
});

describe('planner: leftover and freezer meals', () => {
  const withBatch = (entries: Record<string, unknown> = {}, extra: Record<string, unknown> = {}, isSaved = false) =>
    fakePlanApi({
      'GET /api/plan': (q) => pageJson(q.week as string, { busy, leftovers: leftovers(), isSaved, ...extra }, { entries }),
      'POST /api/leftovers': () => ({ applied: true, portionsLeft: 2 }),
    });

  it('a suggestion puts "Freezer meal: Chilli, 2 portions" into the slot, as an unsaved edit with no shopping', async () => {
    const { api } = withBatch();
    await mountPlan(api);
    expect(screen.getByTestId('leftover-suggestions')).toHaveTextContent(/Freezer meal: Chilli, 2 portions/);
    await press('suggest-b1-2026-10-22');
    expect(await screen.findByLabelText(/Edit Dinner on Thu: Freezer meal: Chilli/)).toBeTruthy();
    expect(screen.getByTestId('slot-2026-10-22-dinner')).toHaveTextContent(/2 portions · no shopping/);
    expect(screen.getByTestId('plan-status').props.accessibilityLabel).toMatch(/Unsaved/);
    expect(screen.queryByTestId('suggest-b1-2026-10-22')).toBeNull(); // the slot is taken
  });

  it('an empty slot can pick a stored meal and portions', async () => {
    const { api } = withBatch();
    await mountPlan(api);
    await fireEvent.press(screen.getByLabelText('Add a leftover or freezer meal to Dinner on Tue'));
    await press('stored-b1');
    await fireEvent.press(screen.getByLabelText('Decrease Portions')); // 2 -> 1
    await press('stored-place');
    expect(await screen.findByTestId('slot-2026-10-20-dinner')).toHaveTextContent(/Freezer meal: Chilli.*1 portion · no shopping/);
  });

  it('"Mark eaten" needs a saved plan, posts once and shows the portions left', async () => {
    const { api, posts } = withBatch({ '2026-10-22|dinner': { kind: 'leftovers', batchId: 'b1', portions: 2 } }, {}, true);
    await mountPlan(api);
    await press('eaten-2026-10-22-dinner');
    await waitFor(() => expect(posts('/api/leftovers')).toHaveLength(1));
    expect(posts('/api/leftovers')[0]!.payload).toMatchObject({ action: 'eaten', planId: 'plan-2026-10-19', date: '2026-10-22', mealType: 'dinner' });
    expect(await screen.findByTestId('plan-message')).toHaveTextContent(/Marked eaten. 2 portions of that batch left/);
  });

  it('an eaten slot offers no second "Mark eaten"', async () => {
    const { api } = withBatch({ '2026-10-22|dinner': { kind: 'leftovers', batchId: 'b1', portions: 2 } }, { eatenSlots: ['2026-10-22|dinner'] }, true);
    await mountPlan(api);
    expect(screen.queryByTestId('eaten-2026-10-22-dinner')).toBeNull();
    expect(screen.getByTestId('slot-2026-10-22-dinner')).toHaveTextContent(/Eaten/);
  });
});

function fakeCalendarClient(initial = { icsConfigured: false, deviceFlagCount: 0 }) {
  const calls: string[] = [];
  let status = { icsConfigured: initial.icsConfigured, icsHost: initial.icsConfigured ? 'calendar.example.org' : null, lastSyncedAt: null, lastStatus: null, deviceFlagCount: initial.deviceFlagCount };
  const client: CalendarClient = {
    status: async () => ({ ...status }),
    syncDevice: async (_f, _t, days) => { calls.push('sync'); status = { ...status, deviceFlagCount: days.filter((d) => d.busy).length }; return status.deviceFlagCount; },
    revokeDevice: async () => { calls.push('revoke'); status = { ...status, deviceFlagCount: 0 }; },
    saveIcs: async (url) => { calls.push(`ics:${url.includes('secret') ? 'url' : 'bad'}`); status = { ...status, icsConfigured: true, icsHost: 'calendar.example.org' }; return 3; },
    refreshIcs: async () => { calls.push('refresh'); },
    removeIcs: async () => { calls.push('remove'); status = { ...status, icsConfigured: false, icsHost: null }; },
  };
  return { client, calls };
}

describe('calendar settings', () => {
  const api = { configured: true } as unknown as ServerApi;
  const mount = async (client: CalendarClient) => {
    await render(<CalendarSettingsBody api={api} householdId={HH} client={client} />);
    await screen.findByTestId('calendar-settings');
  };

  it('explains itself, is off by default, and never reads the calendar until switched on', async () => {
    const { client, calls } = fakeCalendarClient();
    await mount(client);
    expect(screen.getByText(/Event titles, places and people are never read, stored or sent/)).toBeTruthy();
    expect(screen.getByTestId('device-calendar-switch').props.value).toBe(false);
    expect(Calendar.getEventsAsync).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('switching on asks for permission, syncs derived flags only, and switching off deletes them', async () => {
    const { client, calls } = fakeCalendarClient();
    await mount(client);
    await fireEvent(screen.getByTestId('device-calendar-switch'), 'valueChange', true);
    await waitFor(() => expect(calls).toContain('sync'));
    expect(Calendar.requestCalendarPermissionsAsync).toHaveBeenCalled();
    expect(await screen.findByTestId('device-sync')).toBeTruthy();
    await fireEvent(screen.getByTestId('device-calendar-switch'), 'valueChange', false);
    await waitFor(() => expect(calls).toContain('revoke'));
    expect(await screen.findByTestId('calendar-message')).toHaveTextContent(/turned off.*deleted/);
    expect(screen.queryByTestId('device-sync')).toBeNull();
  });

  it('a refused permission keeps it off and says so', async () => {
    calState.permission = 'denied';
    const { client, calls } = fakeCalendarClient();
    await mount(client);
    await fireEvent(screen.getByTestId('device-calendar-switch'), 'valueChange', true);
    expect(await screen.findByTestId('calendar-message')).toHaveTextContent(/not allowed/);
    expect(calls).toEqual([]);
  });

  it('links a calendar address (never shown again) and removes it', async () => {
    const { client, calls } = fakeCalendarClient();
    await mount(client);
    await fireEvent.changeText(screen.getByTestId('ics-url'), 'https://calendar.example.org/ical/secret-token/basic.ics');
    await press('ics-save');
    expect(await screen.findByTestId('ics-linked')).toHaveTextContent(/calendar.example.org/);
    expect(calls).toContain('ics:url');
    expect(screen.queryByTestId('ics-url')).toBeNull();
    expect(screen.queryByText(/secret-token/)).toBeNull();
    await press('ics-remove');
    expect(await screen.findByTestId('ics-url')).toBeTruthy();
  });
});

describe('freezer panel', () => {
  function fakeLeftovers() {
    const calls: string[] = [];
    const client: LeftoversClient = {
      list: async () => ({ batches: [], suggestions: [], titles: {} }),
      add: async (i) => { calls.push(`add:${i.title}:${i.portions}:${i.storedIn}`); },
      eat: async (id) => { calls.push(`eat:${id}`); return 3; },
      discard: async (id) => { calls.push(`discard:${id}`); return 3; },
      freeze: async (id) => { calls.push(`freeze:${id}`); },
      remove: async (id) => { calls.push(`remove:${id}`); },
    };
    return { client, calls };
  }
  const fridge = batch({ id: 'b2', title: 'Beef stew', storedIn: 'fridge', portionsMade: 3, portionsLeft: 3, useBy: '2026-10-23', useByLabel: 'Use by Fri 23 Oct', status: 'use_soon' });

  it('groups fridge and freezer, shows use-by and runs the quick actions', async () => {
    const { client, calls } = fakeLeftovers();
    const changed = jest.fn();
    await render(<FreezerPanel client={client} batches={[fridge, batch()]} onChanged={changed} />);
    expect(screen.getByTestId('fridge-list')).toHaveTextContent(/Beef stew/);
    expect(screen.getByTestId('freezer-list')).toHaveTextContent(/Freezer \(4 portions\)/);
    expect(screen.getByTestId('batch-useby-b2')).toHaveTextContent(/soon/);
    await press('ate-b1');
    await waitFor(() => expect(calls).toContain('eat:b1'));
    await press('freeze-b2');
    await waitFor(() => expect(calls).toContain('freeze:b2'));
    expect(screen.queryByTestId('freeze-b1')).toBeNull(); // already frozen
    expect(changed).toHaveBeenCalled();
  });

  it('adds a freezer meal by hand', async () => {
    const { client, calls } = fakeLeftovers();
    await render(<FreezerPanel client={client} batches={[]} onChanged={jest.fn()} />);
    expect(screen.getByTestId('no-stored')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('stored-title'), 'Lasagne');
    await fireEvent.changeText(screen.getByTestId('stored-portions'), '6');
    await press('stored-add');
    await waitFor(() => expect(calls).toEqual(['add:Lasagne:6:freezer']));
  });
});

describe('mark as cooked: Cook x2', () => {
  it('sends the batch choice and the phone date, then reports the spare portions', async () => {
    const recipes = createMockRecipesApi();
    const spy = jest.spyOn(recipes, 'markCooked');
    const saved = jest.fn();
    await render(<MarkCookedForm recipes={recipes} householdId="hh-1" recipeId="r-1" servings={4} currentRating={null} onSaved={saved} />);
    expect(screen.queryByTestId('batch-storage')).toBeNull();
    await press('batch-2');
    expect(screen.getByTestId('batch-storage')).toHaveTextContent(/4 spare portions/);
    await press('store-freezer');
    await press('save-cooked');
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(spy.mock.calls[0]![2]).toMatchObject({ servings: 4, batch: { multiplier: 2, storedIn: 'freezer' }, today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(saved.mock.calls[0]![1]).toMatchObject({ portionsMade: 4, storedIn: 'freezer' });
  });

  it('sends no batch when "just tonight" is chosen', async () => {
    const recipes = createMockRecipesApi();
    const spy = jest.spyOn(recipes, 'markCooked');
    await render(<MarkCookedForm recipes={recipes} householdId="hh-1" recipeId="r-1" servings={2} currentRating={null} onSaved={jest.fn()} />);
    await press('save-cooked');
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]![2]).not.toHaveProperty('batch');
  });
});
