import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { IngredientMatcher, editDistance, matchIngredient, normaliseName, singularise } from '../../src/normalise';
import type { CanonicalIngredient } from '../../src/contract';
import {
  BEEF_MINCE, BEEF_STEAK, CATALOGUE, CHICKEN_BREAST, CHICKEN_THIGH, CHOPPED_TOMATOES, CORIANDER_FRESH, CORIANDER_GROUND,
  FLOUR_NO_DENSITY, GARLIC, MILK, ONION, OREGANO_DRIED, RED_ONION, SALT, TOMATO,
} from './fixtures';

describe('singularise', () => {
  it.each([
    ['onions', 'onion'], ['tomatoes', 'tomato'], ['potatoes', 'potato'], ['berries', 'berry'], ['cherries', 'cherry'],
    ['leaves', 'leaf'], ['chillies', 'chilli'], ['peaches', 'peach'], ['radishes', 'radish'], ['boxes', 'box'],
    ['eggs', 'egg'], ['asparagus', 'asparagus'], ['couscous', 'couscous'], ['hummus', 'hummus'], ['molasses', 'molasses'],
    ['glass', 'glass'], ['bass', 'bass'], ['peas', 'pea'], ['days', 'day'], ['egg', 'egg'], ['gas', 'gas'], ['anchovies', 'anchovy'],
    ['brussels', 'brussels'], ['cress', 'cress'], ['quiz', 'quiz'], ['swiss', 'swiss'], ['lentils', 'lentil'],
  ])('%s -> %s', (w, s) => expect(singularise(w)).toBe(s));
});

describe('normaliseName', () => {
  it('lower-cases, strips accents/punctuation/noise and singularises', () => {
    expect(normaliseName('  Large  ONIONS ').key).toBe('onion');
    expect(normaliseName('Jalapeño Peppers').key).toBe('jalapeno pepper');
    expect(normaliseName("Baker's flour").key).toBe('baker flour');
    expect(normaliseName('free-range eggs').key).toBe('egg');
    expect(normaliseName('Free Range Eggs').key).toBe('egg');
    expect(normaliseName('good-quality olive oil').key).toBe('olive oil');
    expect(normaliseName('salt & pepper').key).toBe('salt and pepper');
    expect(normaliseName('semi-skimmed milk').key).toBe('semi skimmed milk');
  });
  it('keeps and detects form words, canonicalising synonyms', () => {
    expect(normaliseName('Ground Coriander')).toEqual({ key: 'ground coriander', core: 'coriander', form: 'ground' });
    expect(normaliseName('fresh coriander')).toEqual({ key: 'fresh coriander', core: 'coriander', form: 'fresh' });
    expect(normaliseName('tinned tomatoes')).toEqual({ key: 'canned tomato', core: 'tomato', form: 'canned' });
    expect(normaliseName('dry oregano')).toEqual({ key: 'dried oregano', core: 'oregano', form: 'dried' });
    expect(normaliseName('frozen peas').form).toBe('frozen');
    expect(normaliseName('coriander').form).toBeUndefined();
  });
  it('first form word wins when several are present', () => {
    expect(normaliseName('fresh dried thing').form).toBe('fresh');
  });
  it('handles empty / symbol-only input', () => {
    expect(normaliseName('').key).toBe('');
    expect(normaliseName('!!!').key).toBe('');
  });
  it('is idempotent on its own key', () => {
    fc.assert(fc.property(fc.string({ maxLength: 40 }), (s) => {
      const k = normaliseName(s).key;
      expect(normaliseName(k).key).toBe(k);
    }), { numRuns: 1000 });
  });
});

describe('IngredientMatcher — exact matches', () => {
  const m = new IngredientMatcher(CATALOGUE);
  it.each([
    ['onion', ONION, 'exact_name'],
    ['Onions', ONION, 'exact_name'],
    ['2 large onions'.replace('2 ', ''), ONION, 'exact_name'],
    ['brown onion', ONION, 'exact_alias'],
    ['red onions', RED_ONION, 'exact_name'],
    ['milk', MILK, 'exact_name'],
    ['semi-skimmed milk', MILK, 'exact_alias'],
    ['flour', FLOUR_NO_DENSITY, 'exact_alias'],
    ['Plain Flour', FLOUR_NO_DENSITY, 'exact_name'],
    ['sea salt', SALT, 'exact_alias'],
    ['chicken breasts', CHICKEN_BREAST, 'exact_name'],
    ['boneless chicken thighs', CHICKEN_THIGH, 'exact_alias'],
    ['minced beef', BEEF_MINCE, 'exact_alias'],
    ['garlic cloves', GARLIC, 'exact_alias'],
    ['tinned chopped tomatoes', CHOPPED_TOMATOES, 'exact_alias'],
    ['canned chopped tomatoes', CHOPPED_TOMATOES, 'exact_alias'],
  ])('%s', (raw, ing, method) => {
    const r = m.match(raw);
    expect(r.status).toBe('matched');
    expect(r.ingredientId).toBe(ing.id);
    expect(r.ingredient).toBe(ing);
    expect(r.confidence).toBe(1);
    expect(r.method).toBe(method);
  });
});

describe('IngredientMatcher — fresh vs dried/ground stay separate', () => {
  const m = new IngredientMatcher(CATALOGUE);
  it('fresh coriander and ground coriander resolve to different ingredients', () => {
    expect(m.match('fresh coriander').ingredientId).toBe(CORIANDER_FRESH.id);
    expect(m.match('coriander leaves').ingredientId).toBe(CORIANDER_FRESH.id);
    expect(m.match('cilantro').ingredientId).toBe(CORIANDER_FRESH.id);
    expect(m.match('ground coriander').ingredientId).toBe(CORIANDER_GROUND.id);
    expect(m.match('coriander powder').ingredientId).toBe(CORIANDER_GROUND.id);
  });
  it('a form not present in the catalogue is no_match, never the other form', () => {
    const r = m.match('dried coriander');
    expect(r.status).toBe('no_match');
    expect(r.ingredientId).toBeUndefined();
    expect(r.suggestions).toEqual([CORIANDER_FRESH.id, CORIANDER_GROUND.id].sort());
  });
  it('without fresh herb in catalogue, ground coriander is never offered for "fresh coriander"', () => {
    const only = new IngredientMatcher([CORIANDER_GROUND]);
    expect(only.match('fresh coriander').status).toBe('no_match');
    expect(only.match('coriander').status).toBe('no_match');
  });
  it('core + same form: "dried oregano" -> oregano{form: dried}', () => {
    const r = m.match('dried oregano');
    expect(r).toMatchObject({ status: 'matched', ingredientId: OREGANO_DRIED.id, confidence: 0.9, method: 'core_with_form' });
    expect(m.match('fresh oregano').status).toBe('no_match');
  });
  it('core + form ambiguity is reported, not guessed', () => {
    const a: CanonicalIngredient = { id: 'a', name: 'basil', category: 'h', aliases: [], form: 'dried' };
    const b: CanonicalIngredient = { id: 'b', name: 'sweet basil', category: 'h', aliases: ['basil'], form: 'dried' };
    const r = new IngredientMatcher([a, b]).match('dried basil');
    expect(r.status).toBe('ambiguous');
    expect(r.candidates).toEqual(['a', 'b']);
  });
});

describe('IngredientMatcher — conservative (no guessing)', () => {
  const m = new IngredientMatcher(CATALOGUE);
  it('different cuts of meat never cross-match', () => {
    expect(m.match('chicken breast').ingredientId).toBe(CHICKEN_BREAST.id);
    expect(m.match('chicken thigh').ingredientId).toBe(CHICKEN_THIGH.id);
    expect(m.match('chicken').status).toBe('no_match');
    expect(m.match('chicken drumsticks').status).toBe('no_match');
    expect(m.match('beef').status).toBe('no_match');
    expect(m.match('sirloin steak').ingredientId).toBe(BEEF_STEAK.id);
  });
  it('materially different products stay separate', () => {
    expect(m.match('red onion').ingredientId).toBe(RED_ONION.id);
    expect(m.match('spring onion').status).toBe('no_match');
    expect(m.match('tomato').ingredientId).toBe(TOMATO.id);
    expect(m.match('chopped tomatoes').ingredientId).toBe(CHOPPED_TOMATOES.id);
    expect(m.match('tomato puree').status).toBe('no_match');
    expect(m.match('self-raising flour').status).toBe('no_match');
    expect(m.match('garlic powder').status).toBe('no_match');
  });
  it('typos are suggestions only', () => {
    const r = m.match('onoin');
    expect(r.status).toBe('no_match');
    expect(r.confidence).toBe(0);
    expect(r.suggestions).toContain(ONION.id);
    expect(m.match('corriander').suggestions).toContain(CORIANDER_FRESH.id);
  });
  it('empty names do not match', () => {
    expect(m.match('').status).toBe('no_match');
    expect(m.match('   ').status).toBe('no_match');
  });
  it('a key shared by two ingredients is ambiguous unless form disambiguates', () => {
    const x: CanonicalIngredient = { id: 'x', name: 'stock', category: 's', aliases: ['broth'] };
    const y: CanonicalIngredient = { id: 'y', name: 'chicken stock', category: 's', aliases: ['broth'] };
    const r = new IngredientMatcher([x, y]).match('broth');
    expect(r).toMatchObject({ status: 'ambiguous', confidence: 0, candidates: ['x', 'y'] });
    const p: CanonicalIngredient = { id: 'p', name: 'peas', category: 'v', aliases: ['frozen peas'], form: 'frozen' };
    const q: CanonicalIngredient = { id: 'q', name: 'garden peas', category: 'v', aliases: ['frozen peas'], form: 'fresh' };
    expect(new IngredientMatcher([p, q]).match('frozen peas')).toMatchObject({ status: 'matched', ingredientId: 'p' });
  });
  it('duplicate aliases within one ingredient are harmless', () => {
    const dup: CanonicalIngredient = { id: 'd', name: 'egg', category: 'e', aliases: ['eggs', 'Egg', ''] };
    expect(new IngredientMatcher([dup]).match('EGGS')).toMatchObject({ status: 'matched', method: 'exact_name' });
  });
  it('matchIngredient one-shot helper equals the class', () => {
    expect(matchIngredient('ground coriander', CATALOGUE)).toEqual(new IngredientMatcher(CATALOGUE).match('ground coriander'));
  });
  it('result does not depend on catalogue order', () => {
    fc.assert(fc.property(fc.shuffledSubarray(CATALOGUE, { minLength: CATALOGUE.length }), (cat) => {
      const a = new IngredientMatcher(cat);
      for (const name of ['onion', 'coriander', 'dried coriander', 'chicken', 'onoin', 'ground coriander']) {
        expect(a.match(name)).toEqual(new IngredientMatcher(CATALOGUE).match(name));
      }
    }), { numRuns: 50 });
  });
});

describe('editDistance', () => {
  it.each([['', '', 0], ['a', '', 1], ['', 'ab', 2], ['kitten', 'sitting', 3], ['onion', 'onoin', 1], ['ab', 'ba', 1], ['abc', 'ca', 3], ['same', 'same', 0]])(
    '%s/%s',
    (a, b, d) => expect(editDistance(a, b)).toBe(d),
  );
});
