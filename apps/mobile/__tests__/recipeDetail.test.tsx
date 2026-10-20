import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import RecipeDetailScreen from '@/screens/RecipeDetailScreen';
import { createMockRecipesApi } from '@/lib/mockRecipesApi';
import type { RecipeDetailData, RecipesApi } from '@/lib/recipesApi';
import { MockDataSource } from '@/data/mockDataSource';
import { mountScreen, spyOnApi } from './helpers/mount';
import { params, resetRouter, router } from './helpers/router';

jest.mock('expo-router', () => require('./helpers/router').routerModule());

/** toHaveTextContent(string) is an exact match; most assertions here are "contains". */
const has = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

/** The demo api with the detail payload adjusted (household default servings, printed card, ...). */
function apiWith(patch: (d: RecipeDetailData) => RecipeDetailData): RecipesApi {
  const api = createMockRecipesApi();
  const real = api.get.bind(api);
  api.get = async (h, id) => {
    const d = await real(h, id);
    return d ? patch(d) : d;
  };
  return api;
}

async function signedIn(): Promise<MockDataSource> {
  const ds = new MockDataSource();
  await ds.signIn('cook@example.com', 'secret1');
  return ds;
}

beforeEach(async () => {
  resetRouter({ id: 'r-1' });
  await AsyncStorage.clear();
});

describe('RecipeDetailScreen: servings', () => {
  it('opens at the household default, not the recipe servings, with the "serves N, showing for M" note and scaled amounts', async () => {
    await mountScreen(<RecipeDetailScreen />, { api: apiWith((d) => ({ ...d, householdServings: 2 })), ds: await signedIn() });
    expect(await screen.findByTestId('servings-note')).toHaveTextContent(has('Recipe serves 4 · showing for 2 (your household)'));
    const qty = screen.getAllByTestId('ingredient-qty').map((n) => n.props.children);
    expect(qty).toEqual(['250g', '½', 'to taste']); // 500g -> 250g, 1 onion -> ½, to-taste unchanged
    expect(screen.queryByTestId('servings-reset')).toBeNull(); // already at the household number
    expect(screen.getByTestId('servings-original')).toHaveTextContent(has('Original (4)'));
    expect(screen.getByText(/Amounts scaled for 2 servings/)).toBeTruthy();
  });

  it('keeps the recipe amounts when the household default equals the recipe servings', async () => {
    await mountScreen(<RecipeDetailScreen />, { ds: await signedIn() });
    expect(await screen.findByTestId('servings-note')).toHaveTextContent(has('Recipe serves 4 · showing for 4 (your household)'));
    expect(screen.getAllByTestId('ingredient-qty').map((n) => n.props.children)).toEqual(['500g', '1', 'to taste']);
  });

  it('remembers a per-recipe override on the device, and Reset / Original work', async () => {
    const ds = await signedIn();
    await mountScreen(<RecipeDetailScreen />, { api: apiWith((d) => ({ ...d, householdServings: 2 })), ds });
    await screen.findByTestId('servings-note');
    await fireEvent.press(screen.getByTestId('servings-inc'));
    expect(screen.getByTestId('servings-value')).toHaveTextContent(has('3'));
    expect(screen.getByTestId('servings-note')).toHaveTextContent(has('Recipe serves 4 · showing for 3'));
    expect(screen.getByTestId('servings-note')).not.toHaveTextContent(has('your household'));
    await waitFor(async () => expect(await AsyncStorage.getItem('fr:servings:v1:hh-1:user-1:r-1')).toBe('3'));
    expect(screen.getByTestId('servings-reset')).toHaveTextContent(has('Reset to household (2)'));

    await fireEvent.press(screen.getByTestId('servings-original'));
    expect(screen.getByTestId('servings-value')).toHaveTextContent(has('4'));
    await waitFor(async () => expect(await AsyncStorage.getItem('fr:servings:v1:hh-1:user-1:r-1')).toBe('4'));

    await fireEvent.press(screen.getByTestId('servings-reset'));
    expect(screen.getByTestId('servings-value')).toHaveTextContent(has('2'));
    expect(screen.getByTestId('servings-note')).toHaveTextContent(/\(your household\)/);
    await waitFor(async () => expect(await AsyncStorage.getItem('fr:servings:v1:hh-1:user-1:r-1')).toBeNull());
  });

  it('applies a stored override when the screen is opened again', async () => {
    await AsyncStorage.setItem('fr:servings:v1:hh-1:user-1:r-1', '8');
    await mountScreen(<RecipeDetailScreen />, { api: apiWith((d) => ({ ...d, householdServings: 2 })), ds: await signedIn() });
    expect(await screen.findByTestId('servings-note')).toHaveTextContent(has('Recipe serves 4 · showing for 8'));
    expect(screen.getAllByTestId('ingredient-qty').map((n) => n.props.children)).toEqual(['1kg', '2', 'to taste']);
  });

  it('never scales a pinch and keeps the minimum at 1 serving', async () => {
    params.current = { id: 'r-2' };
    await mountScreen(<RecipeDetailScreen />, { api: apiWith((d) => ({ ...d, householdServings: 1 })), ds: await signedIn() });
    await screen.findByTestId('servings-note');
    expect(screen.getAllByTestId('ingredient-qty').map((n) => n.props.children)[1]).toBe('a pinch');
    expect(screen.getByTestId('servings-dec')).toBeDisabled();
  });
});

describe('RecipeDetailScreen: cost and nutrition panels', () => {
  it('labels an estimate and a partial total, scales the total with servings but not the per-serving figure', async () => {
    await mountScreen(<RecipeDetailScreen />, { api: apiWith((d) => ({ ...d, householdServings: 2 })), ds: await signedIn() });
    expect(await screen.findByTestId('cost-per-serving')).toHaveTextContent(has('At least £0.75 per serving'));
    expect(screen.getByTestId('cost-total')).toHaveTextContent(has('At least £1.50 for 2 servings')); // 300p * 2/4
    expect(screen.getByText('estimate')).toBeTruthy();
    expect(screen.getByText('partial')).toBeTruthy();
    expect(screen.getByTestId('cost-coverage')).toHaveTextContent(/2 of 3 ingredients priced \(67%\)/);
    expect(screen.getByTestId('cost-coverage')).toHaveTextContent(has('the real cost is higher'));
    expect(screen.getByTestId('cost-source')).toHaveTextContent(has('estimate: Demo price list (as of 2026-10-01)'));
    expect(screen.getByTestId('uncosted-lines')).toHaveTextContent(has('Salt: to taste'));
    await fireEvent.press(screen.getByTestId('servings-inc'));
    expect(screen.getByTestId('cost-per-serving')).toHaveTextContent(has('At least £0.75 per serving'));
    expect(screen.getByTestId('cost-total')).toHaveTextContent(has('At least £2.25 for 3 servings'));
  });

  it('says "Cost unknown" rather than 0 when nothing could be priced', async () => {
    await mountScreen(<RecipeDetailScreen />, {
      api: apiWith((d) => ({ ...d, calc: { ...d.calc, cost: { ...d.calc.cost, totalPence: null, perServingPence: null, kind: null, sources: [], lines: [] } } })),
    });
    expect(await screen.findByTestId('cost-unknown')).toHaveTextContent(has('Cost unknown'));
    expect(screen.queryByTestId('cost-per-serving')).toBeNull();
  });

  it('shows Unknown (never 0) for unknown, unavailable and missing nutrients and the CoFID attribution', async () => {
    await mountScreen(<RecipeDetailScreen />);
    expect(await screen.findByTestId('nutrition-energy_kcal')).toHaveTextContent(has('520 kcal'));
    expect(screen.getByTestId('nutrition-protein')).toHaveTextContent(has('31 g'));
    for (const key of ['fibre', 'salt', 'fat', 'sugars']) expect(screen.getByTestId(`nutrition-${key}`)).toHaveTextContent(has('Unknown'));
    expect(screen.getByTestId('nutrition-coverage')).toHaveTextContent(/Based on 75% of ingredients; values that depend on the rest show as Unknown/);
    expect(screen.getByTestId('nutrition-attribution')).toHaveTextContent(has('McCance and Widdowson (CoFID)'));
    expect(screen.getByText(/not medical advice/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('nutrition-missing-toggle'));
    expect(screen.getByTestId('nutrition-missing')).toHaveTextContent(has('Salt: to taste'));
  });

  it('switches to per-recipe values (per serving x servings shown) and a zero stays 0', async () => {
    params.current = { id: 'r-2' };
    await mountScreen(<RecipeDetailScreen />, { api: apiWith((d) => ({ ...d, householdServings: 6 })), ds: await signedIn() });
    expect(await screen.findByTestId('nutrition-energy_kcal')).toHaveTextContent(has('310 kcal'));
    expect(screen.getByTestId('nutrition-fat')).toHaveTextContent(has('0 g')); // known zero
    await fireEvent.press(screen.getByTestId('nutrition-basis-recipe'));
    expect(screen.getByTestId('nutrition-recipe-energy_kcal')).toHaveTextContent(has('1860 kcal')); // 310 x 6
    expect(screen.getByTestId('nutrition-recipe-protein')).toHaveTextContent(has('Unknown'));
  });

  it('shows the printed card nutrition beside the calculated column, labelled as source-provided and not scaled', async () => {
    await mountScreen(<RecipeDetailScreen />, {
      api: apiWith((d) => ({
        ...d,
        recipe: {
          ...d.recipe,
          printedNutrition: { basis: 'per person', values: [{ nutrient: 'Calories', amount: 640, unit: 'kcal' }, { nutrient: 'Zinc', amount: 3, unit: 'mg' }], source: 'recipe card' },
          printedAllergens: ['Milk', 'Wheat'],
        },
      })),
    });
    expect(await screen.findByTestId('printed-nutrition')).toHaveTextContent(/Recipe card figures are as printed, per person/);
    expect(screen.getByTestId('printed-nutrition')).toHaveTextContent(has('not calculated by this app, and are not scaled'));
    expect(screen.getByLabelText(/^Energy: 520 kcal, recipe card 640 kcal/)).toBeTruthy();
    expect(screen.getByText('Zinc')).toBeTruthy();
    expect(screen.getByTestId('printed-allergens')).toHaveTextContent(has('Allergens printed on the card: Milk, Wheat'));
  });
});

describe('RecipeDetailScreen: links, actions', () => {
  it('explains unlinked ingredients and re-matches them', async () => {
    const api = spyOnApi(createMockRecipesApi());
    await mountScreen(<RecipeDetailScreen />, { api });
    expect(await screen.findByTestId('unlinked-notice')).toHaveTextContent(/2 of 3 ingredients are not linked to the ingredient list, so they are left out of cost and nutrition\./);
    await fireEvent.press(screen.getByTestId('rematch-recipe'));
    expect(api.rematch).toHaveBeenCalledWith('hh-1', 'r-1');
    expect(await screen.findByTestId('notice')).toHaveTextContent(has('Linked 1 ingredient; 1 still need a choice.'));
    await waitFor(() => expect(screen.getByTestId('unlinked-notice')).toHaveTextContent(has('1 of 3 ingredients is not linked')));
    await fireEvent.press(screen.getByTestId('choose-matches'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/recipe/edit/[id]', params: { id: 'r-1' } });
  });

  it('hides the notice when every line is linked', async () => {
    await mountScreen(<RecipeDetailScreen />, { api: apiWith((d) => ({ ...d, unlinkedCount: 0 })) });
    await screen.findByTestId('servings-note');
    expect(screen.queryByTestId('unlinked-notice')).toBeNull();
  });

  it('toggles the favourite', async () => {
    const api = spyOnApi(createMockRecipesApi());
    await mountScreen(<RecipeDetailScreen />, { api });
    await fireEvent.press(await screen.findByTestId('favourite'));
    await waitFor(() => expect(screen.getByTestId('favourite')).toHaveAccessibleName('Remove from favourites'));
    expect(api.toggleFavourite).toHaveBeenCalledWith('hh-1', 'r-1');
  });

  it('asks before deleting (archive), can be cancelled, then removes and goes back', async () => {
    const api = spyOnApi(createMockRecipesApi());
    await mountScreen(<RecipeDetailScreen />, { api });
    await fireEvent.press(await screen.findByTestId('delete-recipe'));
    expect(screen.getByTestId('confirm-delete')).toHaveTextContent(/Delete "Spaghetti Bolognese"\?/);
    await fireEvent.press(screen.getByTestId('confirm-delete-no'));
    expect(screen.queryByTestId('confirm-delete')).toBeNull();
    expect(api.remove).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('delete-recipe'));
    await fireEvent.press(screen.getByTestId('confirm-delete-yes'));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('hh-1', 'r-1'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('keeps the recipe and shows the reason when delete fails', async () => {
    const api = createMockRecipesApi();
    api.remove = jest.fn().mockRejectedValue(new Error('This household is read-only.'));
    await mountScreen(<RecipeDetailScreen />, { api });
    await fireEvent.press(await screen.findByTestId('delete-recipe'));
    await fireEvent.press(screen.getByTestId('confirm-delete-yes'));
    expect(await screen.findByText('This household is read-only.')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('edits, duplicates (opens the form prefilled) and opens the in-app planner for "Add to plan"', async () => {
    await mountScreen(<RecipeDetailScreen />);
    await fireEvent.press(await screen.findByTestId('edit-recipe'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/recipe/edit/[id]', params: { id: 'r-1' } });
    await fireEvent.press(screen.getByTestId('duplicate-recipe'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/recipe/new', params: { from: 'r-1' } });
    await fireEvent.press(screen.getByTestId('add-to-plan'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/plan', params: { add: 'r-1' } });
  });

  it('shows times, source and tags', async () => {
    await mountScreen(<RecipeDetailScreen />, {
      api: apiWith((d) => ({ ...d, recipe: { ...d.recipe, sourceAttribution: 'Nan', description: 'Sunday classic', originalText: 'verbatim text' } })),
    });
    expect(await screen.findByTestId('recipe-times')).toHaveTextContent(has('Prep 15 min · Cook 40 min · Total 55 min'));
    expect(screen.getByText('Source: Nan')).toBeTruthy();
    expect(screen.getByText('Sunday classic')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('toggle-original'));
    expect(screen.getByTestId('original-text')).toHaveTextContent(has('verbatim text'));
  });

  it('shows "not found" for an unknown or archived recipe', async () => {
    params.current = { id: 'zzz' };
    await mountScreen(<RecipeDetailScreen />);
    expect(await screen.findByText('Recipe not found.')).toBeTruthy();
  });

  it('shows the error with a retry when the recipe cannot be loaded', async () => {
    const api = createMockRecipesApi();
    const real = api.get.bind(api);
    api.get = jest.fn().mockRejectedValueOnce(new Error('Could not reach the server.')).mockImplementation(real);
    await mountScreen(<RecipeDetailScreen />, { api });
    expect(await screen.findByText('Could not reach the server.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('retry'));
    expect(await screen.findByTestId('recipe-title')).toHaveTextContent(has('Spaghetti Bolognese'));
  });
});
