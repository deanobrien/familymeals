import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFoods, CofidDatasetSchema, CofidFoodSchema, parseCofidCell } from '../src/cofid.js';
import { NUTRIENT_KEYS, NUTRIENT_UNITS } from '../src/nutrients.js';
import { loadCofid, PACKAGE_ROOT } from '../src/load.js';

describe('parseCofidCell', () => {
  it('maps numbers', () => {
    expect(parseCofidCell('15.2')).toEqual({ status: 'known', value: 15.2, estimate: false });
    expect(parseCofidCell(0)).toEqual({ status: 'zero', value: 0, estimate: false });
    expect(parseCofidCell('0.0')).toEqual({ status: 'zero', value: 0, estimate: false });
  });
  it("'N' is unknown, never zero", () => {
    const p = parseCofidCell('N');
    expect(p.status).toBe('unknown');
    expect(p.value).toBeUndefined();
  });
  it("'Tr' is a known trace: contributes 0 but flagged estimate, not status zero", () => {
    expect(parseCofidCell('Tr')).toEqual({ status: 'known', value: 0, estimate: true, trace: true });
  });
  it('brackets mean estimated value', () => {
    expect(parseCofidCell('(5.2)')).toEqual({ status: 'known', value: 5.2, estimate: true });
    expect(parseCofidCell('(0)')).toEqual({ status: 'zero', value: 0, estimate: true });
  });
  it('blank/garbage is unavailable', () => {
    expect(parseCofidCell(null).status).toBe('unavailable');
    expect(parseCofidCell('').status).toBe('unavailable');
    expect(parseCofidCell('??').status).toBe('unavailable');
  });
});

// Hand-made fixture reproducing the CoFID 2021 sheet layout (row0 headers, row1 mnemonics, row2 labels).
const pHeader = ['Food Code', 'Food Name', 'Description', 'Group', 'Previous', 'Refs', 'Footnote'];
const pMn = [null, null, null, null, null, null, null, 'KCALS', 'KJ', 'PROT', 'FAT', 'CHO', 'TOTSUG', 'SATFOD', 'AOACFIB', 'ENGFIB'];
const pRows: unknown[][] = [
  [...pHeader, 'kcal', 'kJ', 'p', 'f', 'c', 's', 'sat', 'aoac', 'nsp'],
  pMn,
  [...pHeader.map(() => null), ...'x'.repeat(9).split('')],
  ['13-145', 'Ackee, canned, drained', '8 cans', 'DG', 554, 'ref', null, '151', '625', '2.9', '15.2', '0.8', '0.8', 'N', null, 'Tr'],
  ['11-001', 'Test flour', null, 'A', null, null, null, '(340)', '1440', '10.0', '1.2', '0', 'Tr', '0.2', '3.1', '2.9'],
  ['11-002', 'No salt data', null, 'A', null, null, null, '100', '420', '1', '1', '1', '1', '1', null, 'N'],
];
const iHeader = [' ', 'Food Name', 'Description', 'Group', 'Previous', 'Refs', 'Footnote'];
const iRows: unknown[][] = [
  [...iHeader, 'Sodium (mg)'],
  [...iHeader.map(() => null), 'NA'],
  [...iHeader.map(() => null), 'Sodium'],
  ['13-145', 'Ackee, canned, drained', null, null, null, null, null, '240'],
  ['11-001', 'Test flour', null, null, null, null, null, '2'],
  ['11-002', 'No salt data', null, null, null, null, null, 'N'],
];

describe('buildFoods (fixture)', () => {
  const foods = buildFoods(pRows, iRows);
  const get = (code: string, k: string) => foods.find((f) => f.code === code)!.nutrients.find((n) => n.nutrient === k)!;

  it('emits every contract nutrient key with the contract unit, once', () => {
    for (const f of foods) {
      expect(f.nutrients.map((n) => n.nutrient)).toEqual([...NUTRIENT_KEYS]);
      for (const n of f.nutrients) expect(n.unit).toBe(NUTRIENT_UNITS[n.nutrient]);
      expect(CofidFoodSchema.safeParse(f).success).toBe(true);
    }
  });
  it('N -> unknown, Tr -> trace-known, brackets -> estimate', () => {
    expect(get('13-145', 'saturates').status).toBe('unknown');
    expect(get('11-001', 'energy_kcal')).toMatchObject({ status: 'known', value: 340, estimate: true });
    expect(get('11-001', 'carbohydrate').status).toBe('zero');
    expect(get('11-001', 'sugars')).toMatchObject({ status: 'known', value: 0, trace: true });
  });
  it('derives salt from sodium (x2.5/1000) and keeps sodium in mg', () => {
    expect(get('13-145', 'sodium')).toMatchObject({ status: 'known', value: 240, unit: 'mg' });
    expect(get('13-145', 'salt')).toMatchObject({ status: 'known', value: 0.6, unit: 'g' });
  });
  it('salt is unknown when sodium is unknown (never 0)', () => {
    expect(get('11-002', 'salt').status).toBe('unknown');
    expect(get('11-002', 'salt').value).toBeUndefined();
  });
  it('fibre prefers AOAC, falls back to NSP (flagged), propagates unknown', () => {
    expect(get('11-001', 'fibre')).toMatchObject({ status: 'known', value: 3.1, estimate: false });
    expect(get('13-145', 'fibre')).toMatchObject({ status: 'known', value: 0, trace: true, estimate: true });
    expect(get('11-002', 'fibre').status).toBe('unknown');
  });
  it('throws when the sheet layout is wrong', () => {
    expect(() => buildFoods([pRows[0]!, [], [], pRows[3]!], iRows)).toThrow(/column/);
  });
});

const real = resolve(PACKAGE_ROOT, 'data/out/cofid.json');
describe.skipIf(!existsSync(real))('imported CoFID 2021 dataset', () => {
  const ds = loadCofid();
  it('validates and has the expected scale/provenance', () => {
    expect(CofidDatasetSchema.safeParse(ds).success).toBe(true);
    expect(ds.foods.length).toBeGreaterThan(2500);
    expect(ds.source.licence).toMatch(/Open Government Licence/);
  });
  it('has unique food codes except the known source duplicate, which is flagged', () => {
    const counts = new Map<string, number>();
    for (const f of ds.foods) counts.set(f.code, (counts.get(f.code) ?? 0) + 1);
    const dups = [...counts].filter(([, n]) => n > 1).map(([c]) => c);
    expect(dups).toEqual(['13-669']);
    expect(ds.foods.filter((f) => f.code === '13-669').every((f) => f.duplicateCode)).toBe(true);
  });
  it('spot check: plain flour kcal ~ 340-360 and olive oil fat ~ 100g', () => {
    const flour = ds.foods.find((f) => f.code === '11-886')!;
    const kcal = flour.nutrients.find((n) => n.nutrient === 'energy_kcal')!;
    expect(kcal.value).toBeGreaterThan(330);
    expect(kcal.value).toBeLessThan(370);
    const oil = ds.foods.find((f) => f.code === '17-038')!;
    expect(oil.nutrients.find((n) => n.nutrient === 'fat')!.value).toBeGreaterThan(95);
  });
});
