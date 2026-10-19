import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { AiError, createMockProvider, type AiProvider } from '@fr/ai';
import { createIngredientCatalogue, getIngredientCatalogue } from '../refdata/catalogue';
import { buildDemoPantryService, DEMO_HOUSEHOLD_ID as H } from './deps';
import { matchScannedName, runPantryScan } from './scan';
import { toScanRows } from './scan';
import { rowFromDto, toCommitRows } from '../../pantry/scan-rows';
import type { ScanCommitRow } from '../../pantry/scan-types';

const NOW = '2026-10-19T12:00:00.000Z';
const cat = getIngredientCatalogue();
const mock = () => createMockProvider({ env: { NODE_ENV: 'test' } });
const jpeg = async () => new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: '#88aa44' } }).jpeg().toBuffer());
const id = (name: string): string => {
  const hit = cat.matcher.match(name);
  if (!hit.ingredientId) throw new Error(`no ingredient ${name}`);
  return hit.ingredientId;
};

describe('matching scanned names to the catalogue', () => {
  it('matches exact names and aliases, with the model\'s form folded in when the bare name misses', () => {
    expect(matchScannedName(cat, 'banana', 'fresh')).toMatchObject({ status: 'matched', ingredient: { name: 'banana', category: 'fruit_veg' } });
    expect(matchScannedName(cat, 'bananas', 'fresh').status).toBe('matched');
    expect(matchScannedName(cat, 'tinned chickpeas', 'canned')).toMatchObject({ status: 'matched', ingredient: { name: 'chickpeas' } });
    // bare name that only exists with the form word
    expect(matchScannedName(cat, 'chickpeas', 'canned')).toMatchObject({ status: 'matched', ingredient: { name: 'chickpeas' } });
    expect(matchScannedName(cat, 'natural yoghurt', 'chilled').status).toBe('matched');
  });
  it('never fuzzy-matches: unknown foods are unmatched (suggestions are for the owner only)', () => {
    const m = matchScannedName(cat, 'kohlrabi', 'fresh');
    expect(m.status).toBe('unmatched');
    expect(matchScannedName(cat, 'dragon fruit', 'fresh').status).toBe('unmatched');
  });
  it('returns candidates for ambiguous names so the owner chooses (never a silent pick)', () => {
    // No two real catalogue entries share a name today, so build a catalogue where an alias collides.
    const tiny = createIngredientCatalogue([
      { id: '11111111-1111-4111-8111-111111111111', name: 'sweet pepper', category: 'fruit_veg', aliases: ['pepper'] },
      { id: '22222222-2222-4222-8222-222222222222', name: 'black pepper', category: 'herbs_spices', aliases: ['pepper'] },
    ]);
    const m = matchScannedName(tiny, 'pepper', 'fresh');
    expect(m.status).toBe('ambiguous');
    if (m.status === 'ambiguous') expect(m.candidates.map((c) => c.name).sort()).toEqual(['black pepper', 'sweet pepper']);
    // the real catalogue has no "pepper" entry: unmatched, not guessed
    expect(matchScannedName(cat, 'pepper', 'fresh').status).toBe('unmatched');
  });
});

describe('runPantryScan (mock provider)', () => {
  it('returns reviewable rows and writes NOTHING to the pantry', async () => {
    const pantry = buildDemoPantryService(() => NOW);
    const before = await pantry.getView(H);
    const out = await runPantryScan({ images: [await jpeg(), await jpeg()] }, { provider: mock(), today: () => '2026-10-19' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows.map((r) => r.name)).toEqual(['banana', 'chicken breast', 'tinned chickpeas', 'natural yoghurt', 'pepper', 'kohlrabi']);
    expect(out.rows.map((r) => r.key)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    const chicken = out.rows[1]!;
    expect(chicken).toMatchObject({ useBy: '2026-10-21', packSize: { value: 650, unit: 'g' }, datesLegible: true, needsCloseUp: false });
    expect(out.rows[2]).toMatchObject({ bestBefore: '2027-11-23' });
    expect(out.rows[3]).toMatchObject({ needsCloseUp: true, datesLegible: false });
    expect(out.rows[3]!.useBy).toBeUndefined();
    expect(out.rows[5]!.match.status).toBe('unmatched');
    const after = await pantry.getView(H);
    expect(after.totalItems).toBe(before.totalItems);
  });

  it('a close-up is one photo, returns only the focused item, and keys do not collide with the main scan', async () => {
    const out = await runPantryScan({ images: [await jpeg()], focus: 'natural yoghurt' }, { provider: mock(), today: () => '2026-10-19' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ key: 'c1', name: 'natural yoghurt', useBy: '2026-10-22', datesLegible: true });
    const bad = await runPantryScan({ images: [await jpeg(), await jpeg()], focus: 'x' }, { provider: mock() });
    expect(bad).toMatchObject({ ok: false, status: 400 });
  });

  it('validates image count and maps provider failures to user messages', async () => {
    expect(await runPantryScan({ images: [] }, { provider: mock() })).toMatchObject({ ok: false, status: 400, error: { code: 'NO_IMAGES' } });
    const img = await jpeg();
    expect(await runPantryScan({ images: Array(11).fill(img) }, { provider: mock() })).toMatchObject({ ok: false, error: { code: 'TOO_MANY_IMAGES' } });
    const broken = { scanPantry: async () => { throw new AiError('PROVIDER_NOT_CONFIGURED'); } } as unknown as AiProvider;
    const out = await runPantryScan({ images: [img] }, { provider: broken });
    expect(out).toMatchObject({ ok: false, status: 412, error: { code: 'PROVIDER_NOT_CONFIGURED' } });
    const unreadable = await runPantryScan({ images: [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])] }, { provider: mock() });
    expect(unreadable).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_IMAGE_TYPE' } });
  });

  it('the AI call carries only ingredient names, today\'s date and the focus item (no household data)', async () => {
    const seen: unknown[] = [];
    const spy = { scanPantry: async (_i: unknown, ctx: unknown) => { seen.push(ctx); return { items: [], warnings: [] }; } } as unknown as AiProvider;
    await runPantryScan({ images: [await jpeg()] }, { provider: spy, today: () => '2026-10-19' });
    const ctx = seen[0] as Record<string, unknown>;
    expect(Object.keys(ctx).sort()).toEqual(['ingredientNames', 'today']);
    expect((ctx.ingredientNames as string[]).length).toBeGreaterThan(300);
    await runPantryScan({ images: [await jpeg()], focus: 'milk' }, { provider: spy, today: () => '2026-10-19' });
    expect(Object.keys(seen[1] as object).sort()).toEqual(['focusItem', 'today']);
  });
});

describe('scan rows -> pantry (service.previewScan / applyScan)', () => {
  const demo = () => buildDemoPantryService(() => NOW);
  const allItems = async (svc: ReturnType<typeof demo>) => (await svc.getView(H)).categories.flatMap((c) => c.items);

  it('preview shows engine merge semantics and writes nothing', async () => {
    const svc = demo();
    const before = await allItems(svc);
    const rows: ScanCommitRow[] = [
      { key: 'a', ingredientId: id('tinned tomatoes'), value: 1, unit: 'can' },                     // merges: 2 can, no expiry
      { key: 'b', ingredientId: id('onion'), value: 2, unit: 'item', expiry: '2026-11-02' },         // merges: same expiry
      { key: 'c', ingredientId: id('onion'), value: 4, unit: 'item', expiry: '2026-12-25' },         // different date: new line
      { key: 'd', name: 'kohlrabi', value: 1, unit: 'item' },                                         // free text: new line
    ];
    const res = await svc.previewScan(H, rows);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const by = Object.fromEntries(res.lines.map((l) => [l.key, l]));
    expect(by.a).toMatchObject({ kind: 'merge', before: '2 can', after: '3 can' });
    expect(by.b).toMatchObject({ kind: 'merge', before: '3 item', after: '5 item' });
    expect(by.c!.kind).toBe('new');
    expect(by.c!.note).toMatch(/separate line/);
    expect(by.d).toMatchObject({ kind: 'new', after: '1 item' });
    expect(await allItems(svc)).toEqual(before);
  });

  it('two rows for the same ingredient and date merge with each other (dedupe-agnostic)', async () => {
    const svc = demo();
    const res = await svc.previewScan(H, [
      { key: 'a', ingredientId: id('banana'), value: 3, unit: 'item' },
      { key: 'b', ingredientId: id('banana'), value: 2, unit: 'item' },
    ]);
    if (!res.ok) throw new Error(res.error);
    expect(res.lines[0]).toMatchObject({ kind: 'new', after: '3 item' });
    expect(res.lines[1]).toMatchObject({ kind: 'merge', before: '3 item', after: '5 item' });
    expect(await svc.applyScan(H, [
      { key: 'a', ingredientId: id('banana'), value: 3, unit: 'item' },
      { key: 'b', ingredientId: id('banana'), value: 2, unit: 'item' },
    ])).toMatchObject({ ok: true });
    expect((await allItems(svc)).filter((i) => i.name === 'banana').map((i) => i.quantityLabel)).toEqual(['5 item']);
  });

  it('confirm writes once: use by / best before arrive as the item expiry, free text is kept, count total is exact', async () => {
    const svc = demo();
    const rows = toCommitRows([
      { ...rowFromDto({ key: 'c', name: 'chicken breast', form: 'chilled', packaging: 'pack', count: 1, packSizeText: '650g', packSize: { value: 650, unit: 'g' }, useBy: '2026-10-21', datesLegible: true, needsCloseUp: false, confidence: 0.9, frameRefs: [1], match: { status: 'matched', ingredient: { id: id('chicken breast'), name: 'chicken breast', category: 'meat_poultry' } } }) },
      { ...rowFromDto({ key: 'k', name: 'tinned chickpeas', form: 'canned', packaging: 'tin', count: 2, bestBefore: '2027-11-23', datesLegible: true, needsCloseUp: false, confidence: 0.9, frameRefs: [1], match: { status: 'matched', ingredient: { id: id('chickpeas'), name: 'chickpeas', category: 'tinned_jarred' } } }) },
      { ...rowFromDto({ key: 'z', name: 'kohlrabi', form: 'fresh', packaging: 'loose', count: 1, datesLegible: false, needsCloseUp: false, confidence: 0.6, frameRefs: [1], match: { status: 'unmatched', suggestions: [] } }) },
    ]).rows;
    expect(await svc.applyScan(H, rows)).toMatchObject({ ok: true, message: 'Added 3 items to your pantry' });
    const items = await allItems(svc);
    const chicken = items.find((i) => i.name === 'chicken breast')!;
    expect(chicken).toMatchObject({ quantityLabel: '650 g', expiry: '2026-10-21' });
    expect(items.find((i) => i.name === 'chickpeas')).toMatchObject({ quantityLabel: '2 can', expiry: '2027-11-23' });
    const kohl = items.find((i) => i.name === 'kohlrabi')!;
    expect(kohl.quantityLabel).toBe('1 item');
    expect(kohl.expiry).toBeUndefined();
    expect(kohl.ingredientId).toBeUndefined();
  });

  it('is all-or-nothing: one bad row stops the whole confirm and writes nothing', async () => {
    const svc = demo();
    const before = await allItems(svc);
    const good: ScanCommitRow = { key: 'a', ingredientId: id('banana'), value: 3, unit: 'item' };
    for (const bad of [
      { key: 'b', ingredientId: id('banana'), value: 0, unit: 'item' },
      { key: 'b', ingredientId: id('banana'), value: 2, unit: 'furlong' },
      { key: 'b', ingredientId: id('banana'), value: 2, unit: 'item', expiry: '2026-02-30' },
      { key: 'b', ingredientId: 'not-a-real-id', value: 2, unit: 'item' },
      { key: 'b', name: '   ', value: 2, unit: 'item' },
      { key: 'b', ingredientId: id('banana'), value: Number.NaN, unit: 'item' },
    ] as ScanCommitRow[]) {
      const res = await svc.applyScan(H, [good, bad]);
      expect(res.ok).toBe(false);
    }
    expect(await svc.applyScan(H, [])).toMatchObject({ ok: false });
    expect(await svc.applyScan(H, Array(61).fill(good))).toMatchObject({ ok: false, error: expect.stringMatching(/up to 60/) });
    expect(await allItems(svc)).toEqual(before);
  });
});

describe('toScanRows', () => {
  it('maps every item with canonical match info and drops nothing', () => {
    const rows = toScanRows({
      items: [{ name: 'banana', form: 'fresh', packaging: 'loose', count: 6, dates: { legible: false, needsCloseUp: false }, confidence: 0.9, frameRefs: [1] }],
      warnings: [],
    }, cat);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 's1', count: 6, datesLegible: false, needsCloseUp: false, match: { status: 'matched' } });
  });
});
