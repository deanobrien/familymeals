import { describe, expect, it } from 'vitest';
import { classifyForVariety, plantKey, recipeVarietyProfile, summariseVariety, type PlannedVarietyMeal, type VarietyLine } from '../../src/nutrition';

const L = (name: string, category: string, grams: number | null, extra: Partial<VarietyLine> = {}): VarietyLine => ({ ingredientId: `id-${name}`, name, category, grams, ...extra });

describe('plantKey', () => {
  it('folds colour / state prefixes and plurals', () => {
    expect(plantKey('red onion')).toBe('onion');
    expect(plantKey('frozen peas')).toBe('pea');
    expect(plantKey('Fresh Coriander')).toBe('coriander');
    expect(plantKey('garlic clove')).toBe('garlic');
    expect(plantKey('tomatoes')).toBe('tomato');
    expect(plantKey('sweet potato')).toBe('sweet potato');
    expect(plantKey('green lentils')).toBe('lentil');
  });
});

describe('classifyForVariety', () => {
  it('counts vegetables and fruit, not white potato, juice, garlic, ginger, chilli or herbs', () => {
    expect(classifyForVariety('carrot', 'fruit_veg').portion).toBe('veg');
    expect(classifyForVariety('apple', 'fruit_veg').portion).toBe('veg');
    expect(classifyForVariety('sweet potato', 'fruit_veg').portion).toBe('veg');
    for (const n of ['potato', 'new potato', 'jacket potato', 'lemon juice', 'garlic clove', 'ginger', 'chilli', 'fresh coriander', 'chives']) {
      const c = classifyForVariety(n, 'fruit_veg');
      expect(c.portion, n).toBeNull();
      expect(c.plant, n).not.toBeNull(); // still a plant for diversity
    }
  });
  it('counts tinned and frozen vegetables, dried fruit and pulses', () => {
    expect(classifyForVariety('tinned tomatoes', 'tinned_jarred').portion).toBe('veg');
    expect(classifyForVariety('frozen peas', 'frozen').portion).toBe('veg');
    expect(classifyForVariety('tomato puree', 'tinned_jarred').portion).toBeNull();
    expect(classifyForVariety('tinned tomato soup', 'tinned_jarred').portion).toBeNull();
    expect(classifyForVariety('raisins', 'baking').portion).toBe('dried');
    expect(classifyForVariety('chickpeas', 'tinned_jarred')).toMatchObject({ portion: 'pulse', protein: 'plant' });
    expect(classifyForVariety('baked beans', 'tinned_jarred').portion).toBe('pulse');
    expect(classifyForVariety('green beans', 'fruit_veg').portion).toBe('veg'); // a vegetable, not a pulse
  });
  it('classifies protein kinds', () => {
    expect(classifyForVariety('chicken breast', 'meat_poultry').protein).toBe('meat');
    expect(classifyForVariety('salmon fillet', 'fish_seafood').protein).toBe('fish');
    expect(classifyForVariety('tuna chunks', 'tinned_jarred').protein).toBe('fish');
    expect(classifyForVariety('tofu', 'meat_alternatives').protein).toBe('plant');
    expect(classifyForVariety('milk', 'dairy_eggs').protein).toBeNull();
  });
  it('does not count salt, stock or sauces as plants', () => {
    expect(classifyForVariety('salt', 'herbs_spices').plant).toBeNull();
    expect(classifyForVariety('vegetable stock', 'sauces_condiments').plant).toBeNull();
    expect(classifyForVariety('ground cumin', 'herbs_spices').plant).toBe('cumin');
    expect(classifyForVariety('pasta', 'pasta_rice_grains').plant).toBe('pasta');
  });
});

describe('recipeVarietyProfile', () => {
  it('applies the 80 g convention per serving and caps nothing yet', () => {
    const p = recipeVarietyProfile([
      L('carrot', 'fruit_veg', 320), L('onion', 'fruit_veg', 160), L('chickpeas', 'tinned_jarred', 240), L('chicken breast', 'meat_poultry', 400),
      L('potato', 'fruit_veg', 500), L('salt', 'herbs_spices', 5),
    ], 4);
    expect(p.fv).toBe(1.5); // (320 + 160) / 4 / 80
    expect(p.pulses).toBe(0.75);
    expect(p.proteins).toEqual(['meat', 'plant']);
    expect(p.plants).toEqual(expect.arrayContaining(['carrot', 'onion', 'chickpea', 'potato']));
    expect(p.plants).not.toContain('salt');
    expect(p.proteinSources).toEqual(['chicken breast', 'chickpea']);
    expect(p.unweighed).toBe(0);
  });
  it('dried fruit counts 30 g, unmatched and optional lines are skipped, unknown weights flagged', () => {
    const p = recipeVarietyProfile([
      L('raisins', 'baking', 60), L('banana', 'fruit_veg', null), { name: 'mystery', grams: 100 }, L('spinach', 'fruit_veg', 400, { optional: true }),
    ], 2);
    expect(p.fv).toBe(1); // 60 / 2 / 30
    expect(p.unweighed).toBe(1);
    expect(p.plants).toEqual(['banana', 'raisin']);
  });
  it('handles zero servings without dividing by zero', () => {
    expect(recipeVarietyProfile([L('carrot', 'fruit_veg', 80)], 0).fv).toBe(1);
  });
});

const prof = (over: Partial<ReturnType<typeof recipeVarietyProfile>> = {}) => ({ fv: 0, pulses: 0, plants: [], proteinSources: [], proteins: [], unweighed: 0, ...over });
const meal = (id: string, date: string, variety: PlannedVarietyMeal['variety']): PlannedVarietyMeal => ({ id, date, variety });

describe('summariseVariety', () => {
  it('sums a day, caps pulses at one portion, averages, and counts days with five', () => {
    const s = summariseVariety([
      meal('a', '2026-10-19', prof({ fv: 3, pulses: 1.5, plants: ['carrot', 'chickpea'], proteins: ['plant'], proteinSources: ['chickpea'] })),
      meal('b', '2026-10-19', prof({ fv: 1.5 })),
      meal('c', '2026-10-20', prof({ fv: 2, proteins: ['fish'], proteinSources: ['salmon'], plants: ['pea'] })),
    ]);
    expect(s.days).toEqual([
      { date: '2026-10-19', portions: 5.5, meals: 2 }, // 3 + 1.5 + min(1, 1.5)
      { date: '2026-10-20', portions: 2, meals: 1 },
    ]);
    expect(s.dayCount).toBe(2);
    expect(s.avgPortionsPerDay).toBe(3.75);
    expect(s.daysWithFive).toBe(1);
    expect(s.proteinMeals).toEqual({ fish: 1, meat: 0, plant: 1 });
    expect(s.plants).toEqual(['carrot', 'chickpea', 'pea']);
    expect(s.proteinSources).toEqual(['chickpea', 'salmon']);
  });

  it('counts meals with no data as lower bounds and never invents numbers for them', () => {
    const s = summariseVariety([meal('a', '2026-10-19', null), meal('b', '2026-10-19', undefined), meal('c', '2026-10-20', prof({ fv: 4, unweighed: 1 }))]);
    expect(s.mealCount).toBe(3);
    expect(s.mealsWithoutData).toBe(2);
    expect(s.mealsPartlyWeighed).toBe(1);
    expect(s.days.map((d) => d.portions)).toEqual([0, 4]);
  });

  it('an empty week scores zero', () => {
    const s = summariseVariety([]);
    expect(s).toMatchObject({ mealCount: 0, score: 0, avgPortionsPerDay: 0, daysWithFive: 0, dayCount: 0 });
  });

  it('a rich week scores near the top; a plain one scores low; diet-neutral protein measure', () => {
    const rich = Array.from({ length: 7 }, (_, i) => meal(`m${i}`, `2026-10-${19 + i}`, prof({
      fv: 5, plants: [`p${i}a`, `p${i}b`, `p${i}c`, `p${i}d`], proteins: ['plant'], proteinSources: [`src${i}`],
    })));
    expect(summariseVariety(rich).score).toBe(100);
    const plain = Array.from({ length: 7 }, (_, i) => meal(`m${i}`, `2026-10-${19 + i}`, prof({ fv: 0.5, plants: ['pasta'], proteins: ['meat'], proteinSources: ['mince'] })));
    const s = summariseVariety(plain);
    expect(s.score).toBeLessThan(25);
    // a fully vegan week and a fully meat week with the same number of distinct protein sources score the same on that part
    const veg = summariseVariety([meal('a', '2026-10-19', prof({ proteinSources: ['tofu', 'lentil'], proteins: ['plant'] }))]);
    const meat = summariseVariety([meal('a', '2026-10-19', prof({ proteinSources: ['beef', 'pork'], proteins: ['meat'] }))]);
    expect(veg.parts.protein).toBe(meat.parts.protein);
  });

  it('honours a fixed day count', () => {
    const s = summariseVariety([meal('a', '2026-10-19', prof({ fv: 7 }))], { dayCount: 7 });
    expect(s.avgPortionsPerDay).toBe(1);
  });

  it('carries the disclaimer, which makes no health claim', () => {
    const s = summariseVariety([]);
    expect(s.disclaimer).toMatch(/estimate/i);
    expect(s.disclaimer).toMatch(/not dietary or medical advice/i);
  });
});
