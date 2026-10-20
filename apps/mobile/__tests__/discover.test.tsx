import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import DiscoverScreen, { consentNoticeText } from '@/screens/DiscoverScreen';
import { createMockRecipesApi } from '@/lib/mockRecipesApi';
import type { ImportClient } from '@/lib/importApi';
import { mountScreen, spyOnApi } from './helpers/mount';
import { resetRouter, router } from './helpers/router';

jest.mock('expo-router', () => require('./helpers/router').routerModule());

const has = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

function importClient() {
  const c: ImportClient & { save: jest.Mock } = { configured: true, extract: jest.fn(), save: jest.fn(async () => ({ id: 'rec-7' })), webUrl: () => null };
  return c;
}

beforeEach(() => resetRouter());

describe('consentNoticeText', () => {
  it('gives a count only, with correct singular/plural, and nothing for 0', () => {
    expect(consentNoticeText(0)).toBeNull();
    expect(consentNoticeText(1)).toBe("1 allergy exclusion isn't being applied because consent hasn't been given");
    expect(consentNoticeText(3)).toBe("3 allergy exclusions aren't being applied because consent hasn't been given");
  });
});

describe('DiscoverScreen', () => {
  it('searches on the server with the typed words and filters, and shows attribution and an unverified diet label', async () => {
    const api = spyOnApi(createMockRecipesApi());
    await mountScreen(<DiscoverScreen importClient={importClient()} />, { api });
    expect(await screen.findByTestId('discover-source')).toHaveTextContent(has('Source: TheMealDB (demo data)'));
    await fireEvent.changeText(screen.getByTestId('discover-q'), 'corba');
    await fireEvent.press(screen.getByTestId('discover-area-Turkish'));
    await fireEvent.press(screen.getByTestId('discover-search'));
    expect(await screen.findByTestId('discover-card-52977')).toBeTruthy();
    expect(api.discoverSearch).toHaveBeenCalledWith('hh-1', { q: 'corba', area: 'Turkish', ingredient: '' });
    expect(screen.queryByTestId('discover-card-52772')).toBeNull();
    expect(screen.getByText('Vegan (unverified)')).toBeTruthy();
    expect(screen.getByTestId('card-attribution-52977')).toHaveTextContent(has('Source: TheMealDB'));
  });

  it('previews the ingredients, method, diet note and source before anything is saved', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await mountScreen(<DiscoverScreen importClient={importClient()} />);
    await fireEvent.press(await screen.findByTestId('discover-search'));
    await fireEvent.press(await screen.findByTestId('preview-52772'));
    const preview = screen.getByTestId('discover-preview');
    expect(preview).toHaveTextContent(has('Contains chicken (not verified).'));
    expect(preview).toHaveTextContent(has('3/4 cup Soy sauce'));
    expect(preview).toHaveTextContent(has('1. Mix the sauce.'));
    await fireEvent.press(screen.getByText(/Source: TheMealDB \(https/));
    expect(open).toHaveBeenCalledWith('https://www.themealdb.com/meal/52772');
    await fireEvent.press(screen.getByTestId('preview-52772'));
    expect(screen.queryByTestId('discover-preview')).toBeNull();
    open.mockRestore();
  });

  it('reports no results, hidden recipes (exclusions) and search errors', async () => {
    const api = createMockRecipesApi();
    api.discoverSearch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, cards: [], withheld: 2, withheldUnverifiable: 1, exclusionsActive: true, sourceLabel: 'TheMealDB' })
      .mockResolvedValueOnce({ ok: false, message: 'The recipe source is not reachable right now.' })
      .mockRejectedValueOnce(new Error('Could not reach the server.'));
    await mountScreen(<DiscoverScreen importClient={importClient()} />, { api });
    await fireEvent.press(await screen.findByTestId('discover-search'));
    expect(await screen.findByTestId('discover-empty')).toHaveTextContent('No recipes to show.');
    expect(screen.getByTestId('discover-withheld')).toHaveTextContent(has('2 recipes hidden because they contain something your household excludes'));
    expect(screen.getByTestId('discover-withheld')).toHaveTextContent(has('(1 only because they could not be checked)'));
    await fireEvent.press(screen.getByTestId('discover-search'));
    expect(await screen.findByText('The recipe source is not reachable right now.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('discover-search'));
    expect(await screen.findByText('Could not reach the server.')).toBeTruthy();
  });

  it('shows the consent notice (a count only) with a button to the in-app Settings', async () => {
    const api = createMockRecipesApi();
    api.discoverFilters = async () => ({ categories: [], areas: [], sourceLabel: 'TheMealDB', withheld: 2 });
    await mountScreen(<DiscoverScreen importClient={importClient()} />, { api });
    expect(await screen.findByTestId('consent-notice')).toHaveTextContent(has("2 allergy exclusions aren't being applied because consent hasn't been given"));
    await fireEvent.press(screen.getByTestId('consent-review'));
    expect(router.push).toHaveBeenCalledWith('/(tabs)/settings');
  });

  it('"Surprise me" searches a random category and saves nothing by itself', async () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    const api = spyOnApi(createMockRecipesApi());
    const c = importClient();
    await mountScreen(<DiscoverScreen importClient={c} />, { api });
    await fireEvent.press(await screen.findByTestId('discover-surprise'));
    await waitFor(() => expect(api.discoverSearch).toHaveBeenCalledWith('hh-1', { category: 'Chicken' }));
    expect(await screen.findByTestId('discover-card-52772')).toBeTruthy();
    expect(c.save).not.toHaveBeenCalled();
    expect(api.discoverDraft).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('saves through the same review screen as a photo import, and nothing is stored until Save', async () => {
    const api = spyOnApi(createMockRecipesApi());
    const c = importClient();
    await mountScreen(<DiscoverScreen importClient={c} />, { api });
    await fireEvent.press(await screen.findByTestId('discover-search'));
    await fireEvent.press(await screen.findByTestId('save-52977'));
    expect(await screen.findByText('Review recipe')).toBeTruthy();
    expect(api.discoverDraft).toHaveBeenCalledWith('hh-1', '52977');
    expect(screen.getByText(/The dietary label is worked out from the ingredients and is not verified/)).toBeTruthy();
    expect(screen.getByTestId('review-source')).toHaveTextContent(has('TheMealDB - https://www.themealdb.com/meal/52977'));
    expect(c.save).not.toHaveBeenCalled();

    // The unparsed measure blocks saving until the cook sets an amount, exactly like a photo import.
    expect(screen.getByTestId('save-recipe')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('ing-kind-1-exact'));
    await fireEvent.changeText(screen.getByTestId('ing-value-1'), '1');
    await fireEvent.press(screen.getByTestId('ing-unit-1-cup'));
    await waitFor(() => expect(screen.getByTestId('save-recipe')).not.toBeDisabled());
    await fireEvent.press(screen.getByTestId('save-recipe'));
    expect(await screen.findByTestId('saved-title')).toHaveTextContent('Corba');
    expect(c.save).toHaveBeenCalledWith(expect.objectContaining({ uploadId: 'mock-52977' }));

    await fireEvent.press(screen.getByTestId('capture-another'));
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/recipes');
  });

  it('goes back from the review to the results', async () => {
    await mountScreen(<DiscoverScreen importClient={importClient()} />);
    await fireEvent.press(await screen.findByTestId('discover-search'));
    await fireEvent.press(await screen.findByTestId('save-52772'));
    await fireEvent.press(await screen.findByTestId('back-to-photos'));
    expect(await screen.findByTestId('discover-card-52772')).toBeTruthy();
  });

  it('shows why a recipe cannot be added (household exclusions) and stays on the results', async () => {
    const api = createMockRecipesApi();
    api.discoverDraft = async () => ({ ok: false, message: 'This recipe contains something your household excludes (or an ingredient we cannot check against your exclusions), so it cannot be added.' });
    await mountScreen(<DiscoverScreen importClient={importClient()} />, { api });
    await fireEvent.press(await screen.findByTestId('discover-search'));
    await fireEvent.press(await screen.findByTestId('save-52772'));
    expect(await screen.findByText(has('this recipe contains something your household excludes'.replace('this', 'This')))).toBeTruthy();
    expect(screen.getByTestId('discover-card-52772')).toBeTruthy();
  });
});
