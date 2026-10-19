import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MockAiProvider, RecipeExtractionSchema, SYSTEM, normaliseRotation, prepareImage, recipePrompt, rotateJpeg } from '../src/index.js';
import { jpeg } from './helpers.js';

describe('recipe extraction prompt', () => {
  const p = SYSTEM.recipe;
  it('covers multi-page cards in any order, rotation, bracket quantities, nutrition, staples and source', () => {
    expect(p).toMatch(/FRONT/);
    expect(p).toMatch(/in either order/i);
    expect(p).toMatch(/rotated 90 or 180 degrees/i);
    expect(p).toMatch(/frontImageRotation/);
    expect(p).toMatch(/\[Double for 4 people\]/);
    expect(p).toMatch(/200ml \[400ml\]/);
    expect(p).toMatch(/BASE/);
    expect(p).toMatch(/You need: olive oil, salt/);
    expect(p).toMatch(/pantryStaple true/);
    expect(p).toMatch(/printedNutrition/);
    expect(p).toMatch(/never calculate/i);
    expect(p).toMatch(/printedAllergens/);
    expect(p).toMatch(/sourcePublisher/);
    expect(p).toMatch(/originalText/);
  });
  it('tells the model how many images there are', () => {
    expect(recipePrompt(undefined, 2)).toMatch(/2 image\(s\)/);
    expect(recipePrompt('Chilli', 1)).toContain('Chilli');
  });
});

describe('extraction schema', () => {
  it('printed nutrition / allergens / source / front image are optional, pantryStaple is optional', () => {
    const base = {
      title: 't',
      ingredients: [{ originalText: 'salt', name: 'salt', quantity: { kind: 'to_taste', originalText: 'salt' }, confidence: 0.9 }],
      steps: ['s'],
    };
    const r = RecipeExtractionSchema.parse(base);
    expect(r.printedNutrition).toBeUndefined();
    expect(r.ingredients[0]!.pantryStaple).toBeUndefined();
    const withN = RecipeExtractionSchema.parse({ ...base, printedNutrition: { basis: 'per person', values: [{ nutrient: 'Fat', amount: 11, unit: 'g' }] }, printedAllergens: ['A1: gluten'] });
    expect(withN.printedNutrition?.basis).toBe('per person');
    expect(RecipeExtractionSchema.safeParse({ ...base, printedNutrition: { basis: 'per person', values: [] } }).success).toBe(false);
  });
});

describe('mock meal-kit fixture', () => {
  it('returns the two-sided card (bracket quantities, printed nutrition, staples) for a meal-kit hint', async () => {
    const r = await new MockAiProvider().extractRecipe([await jpeg()], 'meal kit card');
    expect(r.title).toMatch(/Wraps/);
    expect(r.servings).toBe(2);
    expect(r.printedNutrition?.basis).toBe('per person');
    expect(r.ingredients.filter((i) => i.pantryStaple).map((i) => i.name)).toEqual(['olive oil', 'salt']);
    expect(r.ingredients.find((i) => i.name === 'chicken stock')?.quantity).toMatchObject({ value: 200, unit: 'ml' });
  });
});

describe('image rotation', () => {
  it('prepareImage applies EXIF orientation (a landscape photo tagged "rotate 90" comes out portrait)', async () => {
    const raw = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#88aa44' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await prepareImage(new Uint8Array(raw));
    expect(out.width).toBe(200);
    expect(out.height).toBe(400);
  });
  it('rotateJpeg turns clockwise and snaps odd angles', async () => {
    const img = await jpeg(400, 200);
    const r = await rotateJpeg(img, 90);
    const m = await sharp(r).metadata();
    expect([m.width, m.height]).toEqual([200, 400]);
    const r180 = await sharp(await rotateJpeg(img, 180)).metadata();
    expect([r180.width, r180.height]).toEqual([400, 200]);
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(95)).toBe(90);
    expect(normaliseRotation(undefined)).toBe(0);
    expect(normaliseRotation(450)).toBe(90);
  });
});
