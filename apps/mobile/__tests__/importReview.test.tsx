import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { RecipeDraft } from '@fr/recipe-import';
import ImportReviewScreen from '@/screens/ImportReviewScreen';
import { summariseDraft, type ExtractionOutcome, type ImportClient } from '@/lib/importApi';
import { cleanDraft, makeDraft } from './helpers/draft';
import { mountScreen } from './helpers/mount';
import { resetRouter, router } from './helpers/router';

jest.mock('expo-router', () => require('./helpers/router').routerModule());

const has = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const type = (id: string, text: string) => fireEvent.changeText(screen.getByTestId(id), text);

function client() {
  const c: ImportClient & { save: jest.Mock } = {
    configured: true,
    extract: jest.fn(),
    save: jest.fn(async () => ({ id: 'rec-9' })),
    webUrl: () => null,
  };
  return c;
}

async function show(draft: RecipeDraft, over: Partial<ExtractionOutcome> = {}, props: Partial<React.ComponentProps<typeof ImportReviewScreen>> = {}) {
  const c = client();
  const outcome: ExtractionOutcome = { uploadId: 'up-1', draft, summary: summariseDraft(draft), existing: [], ...over };
  const onBack = jest.fn();
  const onDone = jest.fn();
  await mountScreen(<ImportReviewScreen outcome={outcome} client={c} onBack={onBack} onDone={onDone} {...props} />);
  return { c, onBack, onDone };
}

const savedDraft = (c: { save: jest.Mock }, n = 0) => (c.save.mock.calls[n]![0] as { draft: RecipeDraft }).draft;

beforeEach(() => resetRouter());

describe('ImportReviewScreen: what needs checking', () => {
  it('shows a status badge per field and the blocking issue, and keeps Save disabled', async () => {
    await show(makeDraft());
    expect(screen.getByLabelText('Title: OK')).toBeTruthy();
    expect(screen.getByLabelText('Servings: OK')).toBeTruthy();
    expect(screen.getByLabelText('Ingredient 1 quantity: Low confidence')).toBeTruthy();
    expect(screen.getByLabelText('Ingredient 2 quantity: Unparsed')).toBeTruthy();
    expect(screen.getByLabelText('Ingredient 2 match: Needs clarification')).toBeTruthy();
    expect(screen.getByLabelText('Ingredient 1 match: OK')).toBeTruthy();
    expect(screen.getByTestId('blocking-issues')).toHaveTextContent(has('"some milk" has no usable quantity'));
    expect(screen.getByTestId('save-recipe')).toBeDisabled();
    expect(screen.getByText(/from photo: .*some milk/)).toBeTruthy();
  });

  it('shows photo notes, the reading provider, the source and a duplicate warning (similar title and ingredients)', async () => {
    const d = makeDraft({ warnings: ['Page 2 was blurry'], source: 'Nan - recipe card' });
    await show(d, { provider: { label: 'Sample reader', isMock: true }, existing: [{ id: 'old', title: 'Pancakes', ingredientNames: ['flour', 'milk'] }, { id: 'x', title: 'Soup', ingredientNames: ['leek'] }] });
    expect(screen.getByTestId('extraction-warnings')).toHaveTextContent(has('Note from the photo: Page 2 was blurry'));
    expect(screen.getByTestId('review-provider')).toHaveTextContent(has('Read by: Sample reader (sample data, not your photo)'));
    expect(screen.getByTestId('review-source')).toHaveTextContent(has('Source: Nan - recipe card'));
    expect(screen.getByTestId('duplicate-warning')).toHaveTextContent(has('Pancakes'));
    expect(screen.getByTestId('duplicate-warning')).not.toHaveTextContent(has('Soup'));
  });

  it('says when the title was only proposed by the AI and offers the photo title as an alternative', async () => {
    const d = makeDraft({ titleProposed: true });
    d.title = { value: 'Pancakes', status: 'low_confidence', alternative: 'Panckes', warnings: [] };
    await show(d);
    expect(screen.getByText(/Suggested by AI/)).toBeTruthy();
    expect(screen.getByLabelText('Title: Low confidence')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('use-title-alt'));
    expect(screen.getByTestId('review-title-input').props.value).toBe('Panckes');
    expect(screen.getByLabelText('Title: OK')).toBeTruthy(); // a corrected value is OK
    expect(screen.queryByText(/Suggested by AI/)).toBeNull();
  });

  it('shows the recipe-card nutrition and allergens as printed', async () => {
    const d = makeDraft({
      printedNutrition: { basis: 'per person', values: [{ nutrient: 'Calories', amount: 640, unit: 'kcal' }], source: 'recipe card', calculated: false } as never,
      printedAllergens: ['Milk', 'Wheat'],
    });
    await show(d);
    expect(screen.getByTestId('printed-nutrition')).toHaveTextContent(has('Nutrition per person'));
    expect(screen.getByTestId('printed-nutrition')).toHaveTextContent(has('640 kcal'));
    expect(screen.getByTestId('printed-allergens')).toHaveTextContent(has('Milk, Wheat'));
  });
});

describe('ImportReviewScreen: corrections', () => {
  it('corrects the blocking line (kind, amount, unit) and then saves the edited draft', async () => {
    const { c } = await show(makeDraft());
    await fireEvent.press(screen.getByTestId('ing-kind-2-exact'));
    await type('ing-value-2', '250');
    await fireEvent.press(screen.getByTestId('ing-unit-2-ml'));
    await waitFor(() => expect(screen.getByTestId('save-recipe')).not.toBeDisabled());
    expect(screen.queryByTestId('blocking-issues')).toBeNull();
    expect(screen.getByLabelText('Ingredient 2 quantity: OK')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('save-recipe'));
    expect(await screen.findByTestId('saved-title')).toHaveTextContent('Pancakes');
    expect(c.save).toHaveBeenCalledWith(expect.objectContaining({ uploadId: 'up-1' }));
    const d = savedDraft(c);
    expect(d.ingredients[1]!.quantity).toMatchObject({ value: { kind: 'exact', value: 250, unit: 'ml' }, status: 'ok', edited: true });
    expect(d.issues.filter((i) => i.blocking)).toEqual([]);
  });

  it('edits title, name, preparation, optional and servings', async () => {
    const { c } = await show(cleanDraft());
    await type('review-title-input', 'Thick pancakes');
    await type('ing-name-1', 'plain flour');
    await type('ing-prep-1', 'sifted');
    await fireEvent.press(screen.getByTestId('ing-optional-1'));
    await type('review-servings', '6');
    await type('review-prep', '10');
    await type('review-cook', '20');
    await fireEvent.press(screen.getByTestId('save-recipe'));
    await screen.findByTestId('saved-title');
    const d = savedDraft(c);
    expect(d.title).toMatchObject({ value: 'Thick pancakes', status: 'ok', edited: true });
    expect(d.ingredients[0]).toMatchObject({ preparation: 'sifted', optional: true, name: { value: 'plain flour', edited: true } });
    expect(d.servings.value).toBe(6);
    expect(d.prepMinutes).toBe(10);
    expect(d.cookMinutes).toBe(20);
  });

  it('keeps a trailing space while typing, and ignores an empty ingredient name', async () => {
    await show(cleanDraft());
    await type('review-title-input', 'Thick ');
    expect(screen.getByTestId('review-title-input').props.value).toBe('Thick ');
    await type('ing-name-1', '   ');
    expect(screen.queryByText(/ingredient name cannot be empty/)).toBeNull(); // not committed at all
  });

  it('offers the model\'s alternative name and quantity readings, never applying them silently', async () => {
    const d = cleanDraft();
    d.ingredients[0]!.name = { value: 'flour', status: 'low_confidence', alternative: 'four', warnings: [] };
    d.ingredients[0]!.quantity = {
      value: { kind: 'exact', value: 200, unit: 'g', originalText: '200g' } as never,
      status: 'low_confidence',
      alternative: { kind: 'exact', value: 250, unit: 'g', originalText: '250g' } as never,
      warnings: ['Reading differs between pages'],
    };
    const { c } = await show(d);
    expect(screen.getByText(/Alternative reading: \W*four/)).toBeTruthy();
    expect(screen.getByText(/Alternative reading: 250 g/)).toBeTruthy();
    expect(screen.getByText('Reading differs between pages')).toBeTruthy();
    expect(screen.getByTestId('ing-name-1').props.value).toBe('flour'); // not applied by itself
    await fireEvent.press(screen.getByTestId('use-name-alt-1'));
    await fireEvent.press(screen.getByTestId('use-qty-alt-1'));
    expect(screen.getByTestId('ing-name-1').props.value).toBe('four');
    expect(screen.getByTestId('ing-value-1').props.value).toBe('250');
    await fireEvent.press(screen.getByTestId('save-recipe'));
    await screen.findByTestId('saved-title');
    expect(savedDraft(c).ingredients[0]!.quantity.value).toMatchObject({ value: 250, unit: 'g' });
  });

  it('switches to a range and to an approximate amount', async () => {
    const { c } = await show(cleanDraft());
    await fireEvent.press(screen.getByTestId('ing-kind-1-range'));
    await type('ing-min-1', '150');
    await type('ing-max-1', '250');
    await fireEvent.press(screen.getByTestId('ing-kind-2-approximate'));
    await type('ing-approx-2', 'splash');
    await fireEvent.press(screen.getByTestId('save-recipe'));
    await screen.findByTestId('saved-title');
    const d = savedDraft(c);
    expect(d.ingredients[0]!.quantity.value).toMatchObject({ kind: 'range', min: 150, max: 250 });
    expect(d.ingredients[1]!.quantity.value).toMatchObject({ kind: 'approximate', approxLabel: 'splash' });
  });

  it('removes and adds ingredient lines; a new line has no quantity yet, so it blocks saving until it has one', async () => {
    await show(cleanDraft());
    await fireEvent.press(screen.getByTestId('ing-remove-2'));
    expect(screen.queryByText(/from photo: .*some milk/)).toBeNull();
    await fireEvent.press(screen.getByTestId('add-ingredient'));
    expect(await screen.findByTestId('ingredient-row-2')).toBeTruthy();
    expect(screen.getByTestId('save-recipe')).toBeDisabled();
    expect(screen.getByTestId('blocking-issues')).toHaveTextContent(has('has no usable quantity'));
    await fireEvent.press(screen.getByTestId('ing-kind-2-to_taste'));
    await waitFor(() => expect(screen.getByTestId('save-recipe')).not.toBeDisabled());
  });

  it('edits, removes and adds method steps; empty steps are dropped on save; no steps blocks saving', async () => {
    const { c } = await show(cleanDraft());
    await type('step-text-1', 'Whisk well.');
    await fireEvent.press(screen.getByTestId('step-remove-2'));
    await fireEvent.press(screen.getByTestId('add-step')); // blank step
    await fireEvent.press(screen.getByTestId('save-recipe'));
    await screen.findByTestId('saved-title');
    expect(savedDraft(c).steps.map((s) => s.text)).toEqual(['Whisk well.']);
  });

  it('blocks saving with no steps', async () => {
    await show(cleanDraft());
    await fireEvent.press(screen.getByTestId('step-remove-1'));
    await fireEvent.press(screen.getByTestId('step-remove-1'));
    expect(screen.getByTestId('blocking-issues')).toHaveTextContent(has('Recipe has no steps.'));
    expect(screen.getByTestId('save-recipe')).toBeDisabled();
  });
});

describe('ImportReviewScreen: cover photo', () => {
  const pages = [1, 2, 3].map((n) => ({ uri: `file:///p${n}.jpg`, width: 10, height: 10 }));

  it('lets the cook choose the cover page; the AI rotation only applies to the page the AI picked', async () => {
    const d = cleanDraft({ coverPage: 2, coverRotation: 90, sourceImageRefs: ['a', 'b', 'c'] });
    const { c } = await show(d, {}, { pages });
    expect(screen.getByLabelText('Cover photo preview (page 2)').props.style).toMatchObject({ transform: [{ rotate: '90deg' }] });
    expect(screen.getByTestId('cover-page-2')).toHaveAccessibleName('Cover photo: Page 2 (picked by the AI)');
    await fireEvent.press(screen.getByTestId('cover-page-3'));
    const img = screen.getByLabelText('Cover photo preview (page 3)');
    expect(img.props.source).toEqual({ uri: 'file:///p3.jpg' });
    expect(img.props.style.transform).toEqual([]);
    await fireEvent.press(screen.getByTestId('save-recipe'));
    await screen.findByTestId('saved-title');
    expect(savedDraft(c).coverPage).toBe(3);
  });

  it('a single photo is simply the cover; no photos, no cover section', async () => {
    await show(cleanDraft(), {}, { pages: pages.slice(0, 1) });
    expect(screen.getByText(/This photo will be the recipe/)).toBeTruthy();
    expect(screen.queryByTestId('cover-page-1')).toBeNull();
  });

  it('has no cover picker for a discovered recipe (no photos)', async () => {
    await show(cleanDraft());
    expect(screen.queryByTestId('cover-picker')).toBeNull();
  });
});

describe('ImportReviewScreen: saving', () => {
  it('shows the server error, stays on the review and can retry', async () => {
    const { c } = await show(cleanDraft());
    c.save.mockRejectedValueOnce(new Error('The server did not accept your sign-in for recipe import.'));
    await fireEvent.press(screen.getByTestId('save-recipe'));
    expect(await screen.findByText('The server did not accept your sign-in for recipe import.')).toBeTruthy();
    expect(screen.getByTestId('review-title-input').props.value).toBe('Pancakes'); // edits survive
    await fireEvent.press(screen.getByTestId('save-recipe'));
    expect(await screen.findByTestId('saved-title')).toBeTruthy();
    expect(c.save).toHaveBeenCalledTimes(2);
  });

  it('offers to open the saved recipe, and to start again; back leaves the review', async () => {
    const { onBack, onDone } = await show(cleanDraft(), {}, { doneLabel: 'Back to my recipes', backLabel: 'Back to results', intro: 'Check the recipe below.' });
    expect(screen.getByText('Check the recipe below.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('back-to-photos'));
    expect(onBack).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('save-recipe'));
    await fireEvent.press(await screen.findByTestId('open-recipe'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/recipe/[id]', params: { id: 'rec-9' } });
    await fireEvent.press(screen.getByText('Back to my recipes'));
    expect(onDone).toHaveBeenCalled();
  });
});
