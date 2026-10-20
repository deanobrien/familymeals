import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen } from '@testing-library/react-native';
import RecipeDetailScreen from '@/screens/RecipeDetailScreen';
import { createMockRecipesApi } from '@/lib/mockRecipesApi';
import { takePendingSwaps } from '@/lib/cookHandoff';
import { MockDataSource } from '@/data/mockDataSource';
import { mountScreen } from './helpers/mount';
import { resetRouter, router } from './helpers/router';

jest.mock('expo-router', () => require('./helpers/router').routerModule());

async function mount() {
  const ds = new MockDataSource();
  await ds.signIn('cook@example.com', 'secret1');
  const api = createMockRecipesApi();
  await mountScreen(<RecipeDetailScreen />, { api, ds });
  await screen.findByTestId('cooking-section');
  return api;
}
const press = async (id: string) => {
  await fireEvent.press(screen.getByTestId(id));
};

beforeEach(async () => {
  resetRouter({ id: 'r-1' });
  await AsyncStorage.clear();
  takePendingSwaps();
});

describe('recipe screen: cooking', () => {
  it('opens cook mode at the servings being shown', async () => {
    await mount();
    await press('cook-mode');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/recipe/cook/[id]', params: { id: 'r-1', servings: '4' } });
  });

  it('marks as cooked with a rating and a note; the summary, history and household rating update', async () => {
    await mount();
    expect(screen.getByTestId('cooked-summary')).toHaveTextContent(/Not cooked yet/);
    await press('mark-cooked');
    await press('rate-5');
    await fireEvent.changeText(screen.getByTestId('cook-note'), 'less chilli next time');
    await press('save-cooked');
    expect(await screen.findByTestId('cooked-flash')).toBeTruthy();
    expect(screen.getByTestId('cooked-summary')).toHaveTextContent(/Cooked once, today · Household rating 5\/5 · You rated it 5\/5/);
    expect(screen.getByTestId('cook-history')).toHaveTextContent(/less chilli next time.*\(private\)/);
  });

  it("toggles don't suggest again", async () => {
    await mount();
    await press('dont-suggest');
    expect(await screen.findByText('Planner skips this (undo)')).toBeTruthy();
    await press('dont-suggest');
    expect(await screen.findByText("Don't suggest again")).toBeTruthy();
  });

  it('"Out of it?" on an ingredient offers swaps and can hand one to cook mode', async () => {
    await mount();
    await press('out-of-i-2'); // Onion
    expect(await screen.findByTestId('substitution-sheet')).toBeTruthy();
    await fireEvent.press(await screen.findByTestId('cook-with-leek'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/recipe/cook/[id]', params: { id: 'r-1', servings: '4' } });
    expect(takePendingSwaps()).toEqual([{ lineId: 'i-2', name: 'leek', guidance: 'About the same weight.' }]);
  });

  it('says plainly when there is no substitute', async () => {
    await mount();
    await press('out-of-i-1'); // Minced beef: nothing in the demo list
    expect(await screen.findByTestId('no-substitutes')).toBeTruthy();
  });
});
