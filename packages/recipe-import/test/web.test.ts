import { describe, expect, it } from 'vitest';
import {
  RecipeExtractionSchema, buildDraft, decodeEntities, extractStructuredRecipe, pageMeta, parseDurationMinutes, parseHtml,
  parseYield, structuredToExtraction, visibleText,
} from '../src/index.js';
import { testMatcher, testParser } from './helpers.js';
import {
  BLOG_JSON_LD, GRAPH_JSON_LD, MICRODATA_PAGE, NOT_A_RECIPE, PLAIN_PAGE, SLOPPY_JSON_LD,
} from './web-fixtures.js';

const extract = (html: string, url = 'https://www.example-kitchen.test/recipes/x/') => extractStructuredRecipe(parseHtml(html), url);

describe('parseDurationMinutes / parseYield / entities', () => {
  it('reads ISO 8601 durations and plain text', () => {
    expect(parseDurationMinutes('PT1H30M')).toBe(90);
    expect(parseDurationMinutes('PT45M')).toBe(45);
    expect(parseDurationMinutes('P0DT1H')).toBe(60);
    expect(parseDurationMinutes('P1DT2H')).toBe(26 * 60);
    expect(parseDurationMinutes('1 hr 5 mins')).toBe(65);
    expect(parseDurationMinutes('soon')).toBeUndefined();
    expect(parseDurationMinutes('P')).toBeUndefined();
    expect(parseDurationMinutes('P400D')).toBeUndefined();
  });
  it('reads yields', () => {
    expect(parseYield('4 servings')).toBe(4);
    expect(parseYield(['4', '4 servings'])).toBe(4);
    expect(parseYield('Serves 4-6')).toBe(4);
    expect(parseYield(12)).toBe(12);
    expect(parseYield('one pie')).toBeUndefined();
    expect(parseYield(0)).toBeUndefined();
    expect(parseYield('1000 sweets')).toBeUndefined();
  });
  it('decodes entities and leaves unknown ones alone', () => {
    expect(decodeEntities('Fish &amp; chips &#8211; &#x41; &nbsp;x &bogus;')).toBe('Fish & chips – A  x &bogus;');
  });
});

describe('JSON-LD extraction', () => {
  it('reads a typical blog recipe', () => {
    const r = extract(BLOG_JSON_LD)!;
    expect(r.via).toBe('json-ld');
    expect(r.name).toBe('Weeknight Lentil Dahl & Rice');
    expect(r.ingredients).toHaveLength(7);
    expect(r.ingredients[1]).toBe('1 onion, finely chopped');
    expect(r.steps).toHaveLength(3);
    expect(r.servings).toBe(4);
    expect(r.prepMinutes).toBe(10);
    expect(r.cookMinutes).toBe(25);
    expect(r.totalMinutes).toBe(35);
    expect(r.author).toBe('Sam Example');
    expect(r.imageUrl).toBe('https://www.example-kitchen.test/img/dahl-1x1.jpg');
    expect(r.category).toBe('Dinner');
    expect(r.cuisine).toBe('Indian');
    expect(r.keywords).toEqual(expect.arrayContaining(['dahl', 'lentils', 'budget', 'one pot', 'dinner']));
  });

  it('reads @graph, @id author references, publisher and HowToSection steps', () => {
    const r = extract(GRAPH_JSON_LD, 'https://cookbook.test/roast-chicken/')!;
    expect(r.name).toBe('Sunday Roast Chicken');
    expect(r.author).toBe('Priya Tester');
    expect(r.publisher).toBe('Test Cookbook');
    expect(r.servings).toBe(4);
    expect(r.cookMinutes).toBe(90);
    expect(r.steps).toEqual([
      'Heat the oven to 200C. Rub the butter over the chicken.',
      'Put the lemon in the cavity.',
      'Roast for 1 hour 20 minutes with the potatoes around it.',
      'Rest for 15 minutes before carving.',
    ]);
    expect(r.imageUrl).toBe('https://cookbook.test/wp-content/roast.jpg');
  });

  it('repairs sloppy JSON and splits a single instruction string', () => {
    const r = extract(SLOPPY_JSON_LD, 'https://shop.test/pasta')!;
    expect(r.name).toBe('Quick Tomato Pasta');
    expect(r.ingredients).toHaveLength(5);
    expect(r.steps).toEqual([
      '1. Boil the pasta in salted water.',
      '2. Fry the garlic in oil, add the tomatoes and simmer 10 minutes.',
      '3. Toss with the pasta and basil.',
    ]);
    expect(r.servings).toBe(2);
    expect(r.cookMinutes).toBeUndefined();
    expect(r.totalMinutes).toBe(20);
    // protocol-relative image resolves against the page, keeping https
    expect(r.imageUrl).toBe('https://img.example.test/pasta.jpg');
  });

  it('ignores non-recipe JSON-LD and recipe stubs with no method', () => {
    expect(extract(NOT_A_RECIPE)).toBeUndefined();
  });

  it('never returns a javascript: or data: image', () => {
    const html = BLOG_JSON_LD.replace(/"image":\[[^\]]*\]/, '"image":"javascript:alert(1)"');
    expect(extract(html)!.imageUrl).toBeUndefined();
  });
});

describe('microdata extraction', () => {
  it('reads itemprops, ignores nested person itemprops, resolves the image', () => {
    const r = extract(MICRODATA_PAGE, 'https://pancakes.test/p/1')!;
    expect(r.via).toBe('microdata');
    expect(r.name).toBe('Banana Oat Pancakes');
    expect(r.ingredients).toEqual(['2 ripe bananas', '100g porridge oats', '2 eggs', '1 tsp baking powder']);
    expect(r.steps).toEqual(['Blitz everything to a thick batter.', 'Cook spoonfuls in a lightly oiled pan, 2 minutes each side.']);
    expect(r.servings).toBe(8);
    expect(r.prepMinutes).toBe(5);
    expect(r.cookMinutes).toBe(10);
    expect(r.author).toBe('Jo Sample');
    expect(r.imageUrl).toBe('https://pancakes.test/photos/pancakes.jpg');
  });
});

describe('no structured data', () => {
  it('returns undefined and gives readable text without scripts, nav or footer', () => {
    const root = parseHtml(PLAIN_PAGE);
    expect(extractStructuredRecipe(root, 'https://gran.test/')).toBeUndefined();
    const text = visibleText(root);
    expect(text).toContain("Gran's Rice Pudding");
    expect(text).toContain('100g pudding rice');
    expect(text).toContain('Bake at 150C for 2 hours');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('Home');
    expect(text).not.toContain('Copyright');
    expect(text).not.toContain('color:red');
  });
  it('caps text length and survives hostile nesting', () => {
    const deep = '<div>'.repeat(5000) + 'x' + '</div>'.repeat(5000);
    expect(() => visibleText(parseHtml(deep))).not.toThrow();
    expect(visibleText(parseHtml('<main>' + '<p>word </p>'.repeat(5000) + '</main>'), 500).length).toBeLessThanOrEqual(500);
  });
});

describe('pageMeta', () => {
  it('reads og tags, canonical and title', () => {
    const m = pageMeta(parseHtml(BLOG_JSON_LD), 'https://www.example-kitchen.test/recipes/x/');
    expect(m.siteName).toBe('Example Kitchen');
    expect(m.canonicalUrl).toBe('https://www.example-kitchen.test/recipes/lentil-dahl/');
    expect(m.imageUrl).toBe('https://www.example-kitchen.test/img/dahl-og.jpg');
    expect(m.title).toBe('Weeknight Lentil Dahl & Rice | Example Kitchen');
  });
});

describe('structuredToExtraction -> draft', () => {
  it('builds the same reviewable draft as a photo import, with attribution', () => {
    const sr = extract(BLOG_JSON_LD)!;
    const ex = structuredToExtraction(sr, testParser, { publisher: 'Example Kitchen', sourceUrl: 'https://www.example-kitchen.test/recipes/lentil-dahl/' });
    expect(RecipeExtractionSchema.safeParse(ex).success).toBe(true);
    expect(ex.sourcePublisher).toBe('Example Kitchen');
    expect(ex.sourceReference).toContain('lentil-dahl');
    const salt = ex.ingredients.find((i) => i.name.toLowerCase() === 'salt')!;
    expect(salt.quantity.kind).toBe('to_taste');
    expect(salt.pantryStaple).toBe(true);
    const draft = buildDraft(ex, { parser: testParser, matcher: testMatcher }, { source: 'Example Kitchen' });
    expect(draft.title.value).toContain('Lentil Dahl');
    expect(draft.servings.value).toBe(4);
    expect(draft.sourceReference).toContain('example-kitchen.test');
    expect(draft.ingredients.some((i) => i.originalText === '250g red lentils')).toBe(true);
    // the original text of every line is kept verbatim
    expect(ex.ingredients.map((i) => i.originalText)).toEqual(sr.ingredients);
  });

  it('uses total time as cook time only when prep and cook are both absent', () => {
    const sr = extract(SLOPPY_JSON_LD)!;
    const ex = structuredToExtraction(sr, testParser, { publisher: 'x', sourceUrl: 'https://x.test/' });
    expect(ex.cookMinutes).toBe(20);
    const withPrep = structuredToExtraction({ ...sr, prepMinutes: 5 }, testParser, { publisher: 'x', sourceUrl: 'https://x.test/' });
    expect(withPrep.cookMinutes).toBeUndefined();
  });

  it('warns when servings are missing', () => {
    const sr = { ...extract(BLOG_JSON_LD)! };
    delete sr.servings;
    const ex = structuredToExtraction(sr, testParser, { publisher: 'x', sourceUrl: 'https://x.test/' });
    expect(ex.warnings.join(' ')).toMatch(/serves/i);
  });
});
