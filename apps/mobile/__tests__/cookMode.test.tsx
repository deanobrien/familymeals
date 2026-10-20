import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import CookModeScreen from '@/screens/CookModeScreen';
import { createMockRecipesApi } from '@/lib/mockRecipesApi';
import { setPendingSwaps } from '@/lib/cookHandoff';
import type { RecipeDetailData, RecipesApi } from '@/lib/recipesApi';
import { MockDataSource } from '@/data/mockDataSource';
import { mountScreen } from './helpers/mount';
import { params, resetRouter, router } from './helpers/router';

jest.mock('expo-router', () => require('./helpers/router').routerModule());

const q = (value: number, unit: 'g' | 'item', t: string) => ({ kind: 'exact' as const, value, unit, originalText: t });

/** The demo api, with a recipe whose method has real durations in it. */
function apiWithTimers(): RecipesApi {
  const api = createMockRecipesApi();
  const real = api.get.bind(api);
  api.get = async (h, id) => {
    const d = await real(h, id);
    if (!d) return d;
    const patched: RecipeDetailData = {
      ...d,
      householdServings: 4,
      recipe: {
        ...d.recipe,
        servings: 4,
        ingredients: [
          { id: 'l-onion', name: 'onion', quantity: q(1, 'item', '1 onion'), optional: false, order: 1 },
          { id: 'l-butter', name: 'butter', quantity: q(100, 'g', '100g'), optional: false, order: 2 },
          { id: 'l-beef', name: 'beef mince', quantity: q(500, 'g', '500g'), optional: false, order: 3 },
        ],
        steps: [
          { id: 's1', order: 1, text: 'Melt the butter and soften the onion for 5 minutes.' },
          { id: 's2', order: 2, text: 'Add the beef mince and simmer for 10-12 mins, then rest for 2 minutes.' },
          { id: 's3', order: 3, text: 'Serve.' },
        ],
      },
    };
    return patched;
  };
  // The suggestion and variant endpoints see the store's own lines, not the patched ones above: answer for the patched recipe.
  api.suggestSubstitutions = async (_h, _id, lineId) => ({
    ok: true,
    ingredient: { lineId, name: 'butter' },
    suggestions: [
      { substitute: 'olive oil', quantityGuidance: 'Use about 3/4 of the amount.', effect: 'Slightly less rich.', dietSafe: true },
      { substitute: 'margarine', quantityGuidance: 'Swap 1:1.', effect: 'Very close in texture.', dietSafe: true },
    ],
    withheld: 0,
    withheldUnverifiable: 0,
    exclusionsActive: false,
  });
  api.saveVariant = async () => ({ ok: true, id: 'v-1', title: 'Spaghetti Bolognese (no butter)' });
  return api;
}

async function signedIn(): Promise<MockDataSource> {
  const ds = new MockDataSource();
  await ds.signIn('cook@example.com', 'secret1');
  return ds;
}

const press = async (id: string) => {
  await fireEvent.press(screen.getByTestId(id));
};
const flat = (n: string) => JSON.stringify(n);

async function mount(api: RecipesApi = apiWithTimers(), servings?: string) {
  resetRouter({ id: 'r-1', ...(servings ? { servings } : {}) });
  const out = await mountScreen(<CookModeScreen />, { api, ds: await signedIn() });
  await screen.findByTestId('step-text');
  return out;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  setPendingSwaps([]);
});

describe('cook mode: steps, checklist and device behaviour', () => {
  it('steps through the method with previous / next and keeps the screen awake', async () => {
    await mount();
    expect(activateKeepAwakeAsync).toHaveBeenCalled();
    expect(screen.getByTestId('step-count')).toHaveTextContent(/Step 1 of 3/);
    expect(screen.getByTestId('step-text')).toHaveTextContent(/Melt the butter/);
    expect(screen.getByTestId('prev-step')).toBeDisabled();
    await press('next-step');
    expect(screen.getByTestId('step-count')).toHaveTextContent(/Step 2 of 3/);
    await press('next-step');
    expect(screen.getByTestId('next-step')).toHaveTextContent(/Finish/);
    await press('prev-step');
    expect(screen.getByTestId('step-text')).toHaveTextContent(/simmer/);
  });

  it('shows only the ingredients this step mentions, scaled to the servings, and ticks them off', async () => {
    await mount(apiWithTimers(), '8');
    expect(screen.getByText(/2 onion|2 /)).toBeTruthy();
    expect(screen.getByTestId('check-l-onion')).toBeTruthy();
    expect(screen.getByTestId('check-l-butter')).toBeTruthy();
    expect(screen.queryByTestId('check-l-beef')).toBeNull();
    expect(screen.getByLabelText(/200g butter/)).toBeTruthy(); // 100g for 4 -> 200g for 8
    await fireEvent.press(screen.getByTestId('check-l-butter'));
    expect(screen.getByTestId('check-l-butter').props.accessibilityState).toMatchObject({ checked: true });
    await press('toggle-all-ingredients');
    expect(screen.getByTestId('check-l-beef')).toBeTruthy();
  });

  it('reads the step aloud and stops', async () => {
    await mount();
    await press('read-aloud');
    expect(Speech.speak).toHaveBeenCalledWith(expect.stringContaining('Step 1. Melt the butter'), expect.objectContaining({ language: 'en-GB' }));
    await press('read-aloud');
    expect(Speech.stop).toHaveBeenCalled();
  });

  it('releases the screen lock when it closes', async () => {
    const { view } = await mount();
    await view.unmount();
    expect(deactivateKeepAwake).toHaveBeenCalled();
  });
});

describe('cook mode: timers', () => {
  beforeEach(() => jest.useFakeTimers({ now: Date.parse('2026-10-21T12:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  const startFirst = async () => {
    await act(async () => {
      await fireEvent.press(screen.getAllByTestId('start-timer')[0]!);
    });
  };

  it('detects timers in the step text, runs several at once, and pauses / resets them', async () => {
    await mount();
    expect(screen.getAllByTestId('start-timer')).toHaveLength(1);
    expect(screen.getByText('Start 5 min timer')).toBeTruthy();
    await startFirst();
    await press('next-step');
    expect(screen.getAllByTestId('start-timer').map((n) => flat(n.props.accessibilityLabel))).toEqual([flat('Start 10-12 min timer'), flat('Start 2 min timer')]);
    await act(async () => {
      await fireEvent.press(screen.getAllByTestId('start-timer')[0]!);
    });
    expect(screen.getAllByTestId('timer')).toHaveLength(2);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    const clocks = () => screen.getAllByTestId('timer-clock').map((n) => n.props.children as string);
    expect(clocks()).toEqual(['4:00', '9:00']);

    await act(async () => {
      await fireEvent.press(screen.getAllByTestId('pause-timer')[0]!);
    });
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(clocks()).toEqual(['4:00', '8:30']); // the paused one holds, the other runs on
    await act(async () => {
      await fireEvent.press(screen.getAllByTestId('reset-timer')[0]!);
    });
    expect(clocks()[0]).toBe('5:00');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalled();
  });

  it('alerts in the app, buzzes and schedules a background notification when a timer ends', async () => {
    await mount();
    await startFirst();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ title: expect.stringContaining('timer done') }), trigger: expect.objectContaining({ seconds: 300 }) }));
    await act(async () => {
      jest.advanceTimersByTime(300_500);
    });
    expect(screen.getByTestId('timer-alert')).toHaveTextContent(/time is up/);
    expect(Haptics.notificationAsync).toHaveBeenCalled();
    expect(screen.getByTestId('timer-status')).toHaveTextContent(/done/);
    await fireEvent.press(screen.getByTestId('dismiss-alert'));
    expect(screen.queryByTestId('timer-alert')).toBeNull();
  });
});

describe('cook mode: resume and finishing', () => {
  it('resumes at the saved step with the ticks and timers, and says so', async () => {
    const first = await mount();
    await press('next-step');
    await act(async () => {
      await fireEvent.press(screen.getAllByTestId('start-timer')[0]!);
    });
    await waitFor(async () => expect((await AsyncStorage.getAllKeys()).some((k) => k.startsWith('fr.cook.'))).toBe(true));
    await first.view.unmount();

    await mount();
    expect(await screen.findByTestId('resumed-note')).toBeTruthy();
    expect(screen.getByTestId('step-count')).toHaveTextContent(/Step 2 of 3/);
    expect(screen.getAllByTestId('timer')).toHaveLength(1);
  });

  it('at the end, saves a rating and a private note, then clears the saved session', async () => {
    const api = apiWithTimers();
    const spy = jest.spyOn(api, 'markCooked');
    await mount(api);
    await press('next-step');
    await press('next-step');
    await press('next-step');
    expect(await screen.findByTestId('cook-done')).toBeTruthy();
    await press('rate-4');
    await fireEvent.changeText(screen.getByTestId('cook-note'), 'less chilli next time');
    await press('save-cooked');
    expect(await screen.findByTestId('cook-saved')).toBeTruthy();
    expect(spy).toHaveBeenCalledWith('hh-1', 'r-1', { servings: 4, rating: 4, note: 'less chilli next time', notePrivate: true });
    const detail = await api.get('hh-1', 'r-1');
    expect(detail?.cooking).toMatchObject({ cookedCount: 1, myRating: 4 });
    expect(detail?.recipe.rating).toBe(4);
    expect((await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('fr.cook.'))).toEqual([]);
  });

  it('can share the note with the household and flag "don\'t suggest again"', async () => {
    const api = apiWithTimers();
    await mount(api);
    for (let i = 0; i < 3; i++) await press('next-step');
    await press('rate-2');
    await fireEvent.changeText(screen.getByTestId('cook-note'), 'Great with rice');
    await press('note-household');
    await press('never-suggest');
    await press('save-cooked');
    await screen.findByTestId('cook-saved');
    const d = await api.get('hh-1', 'r-1');
    expect(d?.cooking).toMatchObject({ dontSuggest: true, history: [{ rating: 2, note: { text: 'Great with rice', isPrivate: false } }] });
  });
});

describe('cook mode: substitutions', () => {
  it('"Out of it?" offers suggestions; applying one is a temporary swap that never edits the recipe', async () => {
    const api = apiWithTimers();
    await mount(api);
    await press('out-of-l-butter');
    expect(await screen.findByTestId('substitution-sheet')).toBeTruthy();
    await fireEvent.press(await screen.findByTestId('use-olive oil'));
    expect(screen.queryByTestId('substitution-sheet')).toBeNull();
    expect(screen.getByTestId('swap-note')).toHaveTextContent(/Using olive oil instead of butter: Use about 3\/4/);
    expect(screen.getByLabelText(/olive oil instead of butter/)).toBeTruthy();
    const d = await api.get('hh-1', 'r-1');
    expect(d?.recipe.ingredients.map((i) => i.name)).toContain('butter'); // the original is untouched
    await press('undo-swaps');
    expect(screen.queryByTestId('swap-note')).toBeNull();
  });

  it('a swap handed over from the recipe screen is applied', async () => {
    setPendingSwaps([{ lineId: 'l-butter', name: 'margarine', guidance: 'Swap 1:1.' }]);
    await mount();
    expect(screen.getByTestId('swap-note')).toHaveTextContent(/Using margarine instead of butter/);
  });

  it('saves a variant copy and offers to open it', async () => {
    const api = apiWithTimers();
    await mount(api);
    await press('out-of-l-butter');
    await fireEvent.press(await screen.findByTestId('variant-margarine'));
    expect(await screen.findByTestId('variant-saved')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('open-variant'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/recipe/[id]', params: { id: 'v-1' } });
    expect(params.current.id).toBe('r-1');
  });
});
