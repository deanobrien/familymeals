import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import RecipeListScreen from '@/screens/RecipeListScreen';
import { createMockRecipesApi } from '@/lib/mockRecipesApi';
import { mountScreen, spyOnApi } from './helpers/mount';
import { resetRouter, router } from './helpers/router';

jest.mock('expo-router', () => require('./helpers/router').routerModule());

beforeEach(() => resetRouter());

describe('RecipeListScreen', () => {
  it('lists the household recipes with time, serves and a partial-cost label', async () => {
    await mountScreen(<RecipeListScreen />);
    expect(await screen.findByLabelText(/^Spaghetti Bolognese/)).toBeTruthy();
    expect(screen.getByLabelText(/^Veg Chilli/)).toBeTruthy();
    // 2 of 3 lines priced (salt is to taste) -> "from", never presented as the full cost.
    expect(screen.getByLabelText(/^Spaghetti Bolognese, Serves 4 · 55 min · from £0.75 each/)).toBeTruthy();
    expect(screen.getByTestId('result-count')).toHaveTextContent('2 recipes');
    // Another household's recipe is not shown.
    expect(screen.queryByText('Cheese on Toast')).toBeNull();
  });

  it('searches (debounced) and sends the text to the server', async () => {
    const api = spyOnApi(createMockRecipesApi());
    await mountScreen(<RecipeListScreen />, { api });
    await screen.findByLabelText(/^Veg Chilli/);
    await fireEvent.changeText(screen.getByTestId('recipe-search'), 'chilli');
    await waitFor(() => expect(screen.queryByLabelText(/^Spaghetti Bolognese/)).toBeNull());
    expect(screen.getByLabelText(/^Veg Chilli/)).toBeTruthy();
    expect(api.list).toHaveBeenLastCalledWith('hh-1', expect.objectContaining({ q: 'chilli', page: 1 }));
    expect(screen.getByTestId('result-count')).toHaveTextContent('1 recipe');
  });

  it('applies a collection, shows an empty-result message, and clears it', async () => {
    await mountScreen(<RecipeListScreen />);
    await screen.findByLabelText(/^Veg Chilli/);
    await fireEvent.press(screen.getByTestId('collection-favourites'));
    expect(await screen.findByText('No recipes match.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('collection-all'));
    expect(await screen.findByLabelText(/^Veg Chilli/)).toBeTruthy();
  });

  it('toggles a favourite (optimistic) and the Favourites collection then shows it', async () => {
    const api = spyOnApi(createMockRecipesApi());
    await mountScreen(<RecipeListScreen />, { api });
    await fireEvent.press(await screen.findByTestId('fav-r-2'));
    expect(api.toggleFavourite).toHaveBeenCalledWith('hh-1', 'r-2');
    await waitFor(() => expect(screen.getByTestId('fav-r-2')).toHaveAccessibleName('Remove Veg Chilli from favourites'));
    await fireEvent.press(screen.getByTestId('collection-favourites'));
    await waitFor(() => expect(screen.queryByLabelText(/^Spaghetti Bolognese/)).toBeNull());
    expect(screen.getByLabelText(/^Veg Chilli/)).toBeTruthy();
  });

  it('reverts the heart and shows the error when the favourite call fails', async () => {
    const api = createMockRecipesApi();
    api.toggleFavourite = jest.fn().mockRejectedValue(new Error('This household is read-only.'));
    await mountScreen(<RecipeListScreen />, { api });
    await fireEvent.press(await screen.findByTestId('fav-r-1'));
    expect(await screen.findByText('This household is read-only.')).toBeTruthy();
    expect(screen.getByTestId('fav-r-1')).toHaveAccessibleName('Add Spaghetti Bolognese to favourites');
  });

  it('filters by diet, meal, prep time, tags and price from the filters panel, then clears them', async () => {
    const api = spyOnApi(createMockRecipesApi());
    await mountScreen(<RecipeListScreen />, { api });
    await screen.findByLabelText(/^Veg Chilli/);
    expect(screen.queryByTestId('filters-panel')).toBeNull();
    await fireEvent.press(screen.getByTestId('toggle-filters'));
    await fireEvent.press(screen.getByTestId('diet-vegan'));
    await waitFor(() => expect(screen.queryByLabelText(/^Spaghetti Bolognese/)).toBeNull());
    expect(api.list).toHaveBeenLastCalledWith('hh-1', expect.objectContaining({ diet: 'vegan' }));
    expect(screen.getByTestId('toggle-filters')).toHaveAccessibleName(/\(1\)/);

    await fireEvent.press(screen.getByTestId('clear-filters'));
    expect(await screen.findByLabelText(/^Spaghetti Bolognese/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('tag-batch'));
    await waitFor(() => expect(screen.queryByLabelText(/^Spaghetti Bolognese/)).toBeNull());
    expect(api.list).toHaveBeenLastCalledWith('hh-1', expect.objectContaining({ tags: ['batch'] }));

    // The remaining filters are wired to the same query.
    await fireEvent.press(screen.getByTestId('clear-filters'));
    await fireEvent.press(screen.getByTestId('meal-dinner'));
    await fireEvent.press(screen.getByTestId('prep-15'));
    await fireEvent.press(screen.getByTestId('price-low'));
    await fireEvent.press(screen.getByTestId('cuisine-Italian'));
    await fireEvent.press(screen.getByTestId('sort-cost'));
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith('hh-1', expect.objectContaining({ mealType: 'dinner', maxPrepMinutes: 15, priceBand: 'low', cuisine: 'Italian', sort: 'cost' })));
  });

  it('opens a recipe, the new-recipe form and discover', async () => {
    await mountScreen(<RecipeListScreen />);
    await fireEvent.press(await screen.findByTestId('recipe-r-1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/recipe/[id]', params: { id: 'r-1' } });
    await fireEvent.press(screen.getByTestId('new-recipe'));
    expect(router.push).toHaveBeenCalledWith('/recipe/new');
    await fireEvent.press(screen.getByTestId('open-discover'));
    expect(router.push).toHaveBeenCalledWith('/discover');
  });

  it('shows an empty library hint, and a retry when loading fails', async () => {
    await mountScreen(<RecipeListScreen />, { household: 'hh-none' });
    expect(await screen.findByText('No recipes yet.')).toBeTruthy();
  });

  it('retries after a load failure', async () => {
    const api = createMockRecipesApi();
    const real = api.list.bind(api);
    api.list = jest.fn().mockRejectedValueOnce(new Error('Could not reach the server.')).mockImplementation(real);
    await mountScreen(<RecipeListScreen />, { api });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.');
    await act(async () => {
      fireEvent.press(screen.getByTestId('retry'));
    });
    expect(await screen.findByLabelText(/^Veg Chilli/)).toBeTruthy();
  });
});
