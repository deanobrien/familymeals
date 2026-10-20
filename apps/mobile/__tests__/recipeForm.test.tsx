import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import RecipeFormScreen from '@/screens/RecipeFormScreen';
import { createMockRecipesApi } from '@/lib/mockRecipesApi';
import type { RecipeInputWire } from '@/lib/recipesApi';
import { mountScreen, spyOnApi } from './helpers/mount';
import { resetRouter, router } from './helpers/router';

jest.mock('expo-router', () => require('./helpers/router').routerModule());

const has = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const type = (id: string, text: string) => fireEvent.changeText(screen.getByTestId(id), text);
const sentInput = (api: { save: unknown }, call = 0) => (api.save as jest.Mock).mock.calls[call]![2] as RecipeInputWire;

beforeEach(() => resetRouter());

/** Fill the smallest valid new recipe. */
async function fillBasics(title = 'Tomato soup') {
  await type('f-title', title);
  await type('ing-name-1', 'Onion');
  await fireEvent(screen.getByTestId('ing-name-1'), 'blur');
  await type('ing-value-1', '2');
  await fireEvent.press(screen.getByTestId('ing-unit-1-item'));
  await type('step-text-1', 'Simmer.');
}

describe('RecipeFormScreen: create', () => {
  it('creates a recipe: live "Matched to" preview, amount and unit, then saves and opens it', async () => {
    const api = spyOnApi(createMockRecipesApi());
    await mountScreen(<RecipeFormScreen />, { api });
    expect(screen.getByText('New recipe')).toBeTruthy();
    await fillBasics();
    await waitFor(() => expect(screen.getByTestId('ing-link-1')).toHaveAccessibleName('Ingredient 1 match: Matched to: Onion'));
    expect(api.matchNames).toHaveBeenCalledWith('hh-1', ['Onion']);

    await fireEvent.press(screen.getByTestId('save-form'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/recipe/[id]', params: { id: expect.any(String) } }));
    const input = sentInput(api);
    expect(api.save).toHaveBeenCalledWith('hh-1', null, expect.anything(), false);
    expect(input).toMatchObject({ title: 'Tomato soup', servings: 4, mealType: 'dinner', diet: 'vegetarian', steps: ['Simmer.'] });
    expect(input.ingredients[0]).toMatchObject({ name: 'Onion', ingredientId: 'ing-onion', optional: false, quantity: { kind: 'exact', value: 2, unit: 'item', originalText: '2' } });
  });

  it('lets the cook pick a match from the catalogue search, mark "not in list", or go back to automatic', async () => {
    const api = spyOnApi(createMockRecipesApi());
    await mountScreen(<RecipeFormScreen />, { api });
    await type('f-title', 'Salad');
    await type('ing-name-1', 'Sage');
    await fireEvent(screen.getByTestId('ing-name-1'), 'blur');
    await waitFor(() => expect(screen.getByTestId('ing-link-1')).toHaveAccessibleName('Ingredient 1 match: Not matched yet'));

    await fireEvent.press(screen.getByTestId('ing-link-1'));
    await type('ing-link-search', 'cori');
    await fireEvent.press(await screen.findByTestId('ing-link-result'));
    expect(api.searchCatalogue).toHaveBeenCalledWith('hh-1', 'cori');
    expect(screen.getByTestId('ing-link-1')).toHaveAccessibleName('Ingredient 1 match: Matched to: Coriander (fresh)');
    expect(screen.queryByTestId('ing-link-panel-1')).toBeNull(); // closed after choosing

    await fireEvent.press(screen.getByTestId('ing-link-1'));
    await fireEvent.press(screen.getByTestId('ing-link-none'));
    expect(screen.getByTestId('ing-link-1')).toHaveAccessibleName('Ingredient 1 match: Not in the ingredient list');
    await type('step-text-1', 'Toss.');
    await fireEvent.press(screen.getByTestId('save-form'));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    expect(sentInput(api).ingredients[0]).toMatchObject({ name: 'Sage', ingredientId: null }); // explicit "not in list"

    await fireEvent.press(screen.getByTestId('ing-link-1'));
    await fireEvent.press(screen.getByTestId('ing-link-auto'));
    await waitFor(() => expect(screen.getByTestId('ing-link-1')).toHaveAccessibleName('Ingredient 1 match: Not matched yet'));
  });

  it('typing a new name resets the link to automatic', async () => {
    await mountScreen(<RecipeFormScreen />);
    await type('ing-name-1', 'Onion');
    await fireEvent(screen.getByTestId('ing-name-1'), 'blur');
    await waitFor(() => expect(screen.getByTestId('ing-link-1')).toHaveAccessibleName(has('Matched to: Onion')));
    await type('ing-name-1', 'Onions, red');
    expect(screen.getByTestId('ing-link-1')).toHaveAccessibleName(has('Matching...'));
  });

  it('warns about a duplicate title, keeps it after a refused save, and "Save anyway" forces it', async () => {
    const api = spyOnApi(createMockRecipesApi());
    await mountScreen(<RecipeFormScreen />, { api });
    await fillBasics('Veg Chilli');
    await fireEvent(screen.getByTestId('f-title'), 'blur');
    expect(await screen.findByTestId('duplicate-warning')).toHaveTextContent(has('This looks like a recipe you already have.'));
    expect(screen.getByTestId('duplicate-warning')).toHaveTextContent(has('Veg Chilli'));
    expect(api.checkDuplicates).toHaveBeenCalledWith('hh-1', 'Veg Chilli', ['Onion'], undefined);

    await fireEvent.press(screen.getByTestId('save-form'));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith('hh-1', null, expect.anything(), false));
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId('duplicate-warning')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('save-anyway'));
    await waitFor(() => expect(api.save).toHaveBeenLastCalledWith('hh-1', null, expect.anything(), true));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });

  it('shows the server validation messages next to the fields', async () => {
    await mountScreen(<RecipeFormScreen />);
    await fireEvent.press(screen.getByTestId('save-form'));
    expect(await screen.findByText('Title is required')).toBeTruthy();
    expect(screen.getByText('Please fix the highlighted problems and try again.')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows a save failure (offline, read-only) instead of losing the form', async () => {
    const api = createMockRecipesApi();
    api.save = jest.fn().mockRejectedValue(new Error('Could not reach the server. Check your connection and try again.'));
    await mountScreen(<RecipeFormScreen />, { api });
    await fillBasics();
    await fireEvent.press(screen.getByTestId('save-form'));
    expect(await screen.findByText('Could not reach the server. Check your connection and try again.')).toBeTruthy();
    expect(screen.getByTestId('f-title').props.value).toBe('Tomato soup');
    expect(screen.getByTestId('save-form')).not.toBeDisabled();
  });

  it('switches the quantity kind (range, to taste, approximate) and sends the right quantity', async () => {
    const api = spyOnApi(createMockRecipesApi());
    await mountScreen(<RecipeFormScreen />, { api });
    await type('f-title', 'Curry');
    await type('ing-name-1', 'Chilli flakes');
    await fireEvent.press(screen.getByTestId('ing-kind-1-range'));
    expect(screen.queryByTestId('ing-value-1')).toBeNull();
    await type('ing-min-1', '1');
    await type('ing-max-1', '2');
    await fireEvent.press(screen.getByTestId('ing-unit-1-tsp'));
    await type('step-text-1', 'Stir.');
    await fireEvent.press(screen.getByTestId('save-form'));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(sentInput(api).ingredients[0]!.quantity).toEqual({ kind: 'range', min: 1, max: 2, unit: 'tsp', originalText: '1-2 tsp' });

    await fireEvent.press(screen.getByTestId('ing-kind-1-approximate'));
    await type('ing-approx-1', 'pinch');
    await fireEvent.press(screen.getByTestId('save-form'));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(2));
    expect(sentInput(api, 1).ingredients[0]!.quantity).toMatchObject({ kind: 'approximate', approxLabel: 'pinch' });

    await fireEvent.press(screen.getByTestId('ing-kind-1-to_taste'));
    expect(screen.queryByTestId('ing-approx-1')).toBeNull();
  });

  it('adds, reorders and removes ingredients and steps; optional and preparation are sent', async () => {
    const api = spyOnApi(createMockRecipesApi());
    await mountScreen(<RecipeFormScreen />, { api });
    await type('f-title', 'Stew');
    await type('ing-name-1', 'Carrot');
    await fireEvent.press(screen.getByTestId('add-ingredient'));
    await type('ing-name-2', 'Leek');
    await type('ing-prep-2', 'sliced');
    await fireEvent.press(screen.getByTestId('ing-optional-2'));
    await fireEvent.press(screen.getByTestId('ing-up-2'));
    expect(screen.getByTestId('ing-name-1').props.value).toBe('Leek');
    await fireEvent.press(screen.getByTestId('add-ingredient'));
    await fireEvent.press(screen.getByTestId('ing-remove-3'));

    await type('step-text-1', 'First.');
    await fireEvent.press(screen.getByTestId('add-step'));
    await type('step-text-2', 'Second.');
    await fireEvent.press(screen.getByTestId('step-up-2'));
    await fireEvent.press(screen.getByTestId('add-step'));
    await fireEvent.press(screen.getByTestId('step-remove-3'));

    await fireEvent.press(screen.getByTestId('save-form'));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    const input = sentInput(api);
    expect(input.ingredients.map((i) => i.name)).toEqual(['Leek', 'Carrot']);
    expect(input.ingredients[0]).toMatchObject({ preparation: 'sliced', optional: true });
    expect(input.steps).toEqual(['Second.', 'First.']);
    expect(screen.getByTestId('ing-up-1')).toBeDisabled();
    expect(screen.getByTestId('step-down-2')).toBeDisabled();
  });

  it('the last ingredient and the last step cannot be removed', async () => {
    await mountScreen(<RecipeFormScreen />);
    expect(screen.getByTestId('ing-remove-1')).toBeDisabled();
    expect(screen.getByTestId('step-remove-1')).toBeDisabled();
  });
});

describe('RecipeFormScreen: edit, copy, delete', () => {
  it('edits a saved recipe: loads it, keeps links and the original text read-only, saves with the id and goes back', async () => {
    resetRouter({ id: 'r-1' });
    const api = spyOnApi(createMockRecipesApi());
    await mountScreen(<RecipeFormScreen />, { api });
    expect(await screen.findByText('Edit recipe')).toBeTruthy();
    expect(screen.getByTestId('f-title').props.value).toBe('Spaghetti Bolognese');
    expect(screen.getByTestId('ing-link-2')).toHaveAccessibleName('Ingredient 2 match: Matched to: Onion'); // a saved link is shown
    expect(screen.getByTestId('ing-link-1')).toHaveAccessibleName('Ingredient 1 match: Not matched yet'); // saved unlinked: not re-matched until asked

    await type('f-title', 'Spag Bol');
    await fireEvent.press(screen.getByTestId('save-form'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(api.save).toHaveBeenCalledWith('hh-1', 'r-1', expect.anything(), false);
    const input = sentInput(api);
    expect(input.title).toBe('Spag Bol');
    expect(input.ingredients.find((i) => i.name === 'Onion')).toMatchObject({ ingredientId: 'ing-onion', preparation: 'finely chopped' });
    expect(input.ingredients.find((i) => i.name === 'Salt')!.quantity).toMatchObject({ kind: 'to_taste' });
    expect(input.prepMinutes).toBe(15);
  });

  it('copies a recipe into a new one (no id on save, title marked)', async () => {
    resetRouter({ from: 'r-2' });
    const api = spyOnApi(createMockRecipesApi());
    await mountScreen(<RecipeFormScreen />, { api });
    expect(await screen.findByText('Copy recipe')).toBeTruthy();
    expect(screen.getByTestId('f-title').props.value).toBe('Veg Chilli (copy)');
    await fireEvent.press(screen.getByTestId('save-form'));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith('hh-1', null, expect.anything(), false));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });

  it('deletes (archives) only after a confirmation, then returns to the library', async () => {
    resetRouter({ id: 'r-2' });
    const api = spyOnApi(createMockRecipesApi());
    await mountScreen(<RecipeFormScreen />, { api });
    await fireEvent.press(await screen.findByTestId('delete-form'));
    await fireEvent.press(screen.getByTestId('confirm-delete-no'));
    expect(api.remove).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('delete-form'));
    await fireEvent.press(screen.getByTestId('confirm-delete-yes'));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('hh-1', 'r-2'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(tabs)/recipes'));
  });

  it('a new recipe has no delete button, and cancel goes back', async () => {
    await mountScreen(<RecipeFormScreen />);
    expect(screen.queryByTestId('delete-form')).toBeNull();
    await fireEvent.press(screen.getByTestId('cancel-form'));
    expect(router.back).toHaveBeenCalled();
  });

  it('reports a recipe that no longer exists', async () => {
    resetRouter({ id: 'zzz' });
    await mountScreen(<RecipeFormScreen />);
    expect(await screen.findByText('Recipe not found.')).toBeTruthy();
  });
});
