import { describe, expect, it } from 'vitest';
import scanFx from '../fixtures/pantry-scan.json' with { type: 'json' };
import {
  AnthropicProvider, MemoryUsageSink, OpenAiProvider, PantryScanSchema, SCAN_MAX_IMAGES, SCAN_SYSTEM, ScannedItemSchema,
  createMockProvider, createResolvingProvider, normaliseScan, scanPantryPrompt, toStrictSchema, type PantryScan,
} from '../src/index.js';
import { fakeClient, jpeg, toolUse } from './helpers.js';

/** The fixture holds relative dates ("+2d"); give them real values for schema-level tests. */
function resolveFx() {
  const c = structuredClone(scanFx) as any;
  for (const it of c.items) {
    if (it.dates.useBy) it.dates.useBy = '2026-10-21';
    if (it.dates.bestBefore) it.dates.bestBefore = '2027-11-23';
  }
  return c;
}
const item = (over: Record<string, unknown> = {}) => ScannedItemSchema.parse({
  name: 'carrot', form: 'fresh', packaging: 'loose', count: 5, dates: { legible: false, needsCloseUp: false }, confidence: 0.9, frameRefs: [1], ...over,
});

describe('pantry scan prompt', () => {
  const p = SCAN_SYSTEM;
  it('de-duplicates across frames and counts loose items vs packs', () => {
    expect(p).toMatch(/SAME scene/);
    expect(p).toMatch(/never add counts across frames/i);
    expect(p).toMatch(/loose/);
    expect(p).toMatch(/2 tins of chickpeas is count 2/);
  });
  it('keeps UK use by and best before distinct and forbids inventing dates', () => {
    expect(p).toMatch(/"Use by" is a safety date/);
    expect(p).toMatch(/Best before/);
    expect(p).toMatch(/DIFFERENT/);
    expect(p).toMatch(/NEVER invent/);
    expect(p).toMatch(/needsCloseUp to true/);
  });
  it('context carries only ingredient names, today and the focus item', () => {
    const t = scanPantryPrompt(8, { ingredientNames: ['carrot', 'milk'], today: '2026-10-19' });
    expect(t).toContain('8 images');
    expect(t).toContain('carrot, milk');
    expect(t).toContain('Today is 2026-10-19');
    // Unknown keys (a careless caller passing household data) never reach the prompt.
    const leaky = scanPantryPrompt(1, { ingredientNames: ['x'], householdId: 'hh-1', members: ['Ann'] } as never);
    expect(leaky).not.toMatch(/hh-1|Ann/);
    expect(scanPantryPrompt(1, { focusItem: 'natural yoghurt' })).toMatch(/CLOSE-UP photo of one item: "natural yoghurt"/);
  });
});

describe('pantry scan schema', () => {
  it('accepts the fixture shape with real dates', () => {
    expect(PantryScanSchema.safeParse(resolveFx()).success).toBe(true);
  });
  it('rejects impossible dates, zero counts, empty frame refs and unknown packaging', () => {
    const d = (dates: Record<string, unknown>) => ({ ...item(), dates: { legible: true, needsCloseUp: false, ...dates } });
    expect(ScannedItemSchema.safeParse(d({ useBy: '2026-02-30' })).success).toBe(false);
    expect(ScannedItemSchema.safeParse(d({ useBy: '21/10/2026' })).success).toBe(false);
    expect(ScannedItemSchema.safeParse(d({ useBy: '2026-10-21' })).success).toBe(true);
    expect(ScannedItemSchema.safeParse({ ...item(), count: 0 }).success).toBe(false);
    expect(ScannedItemSchema.safeParse({ ...item(), count: 2.5 }).success).toBe(false);
    expect(ScannedItemSchema.safeParse({ ...item(), frameRefs: [] }).success).toBe(false);
    expect(ScannedItemSchema.safeParse({ ...item(), packaging: 'crate' }).success).toBe(false);
  });
  it('converts to the OpenAI strict subset (every property required, optionals nullable)', () => {
    const { schema, decode } = toStrictSchema(PantryScanSchema);
    const itemSchema = (schema as any).properties.items.items;
    expect(itemSchema.required).toEqual(expect.arrayContaining(['name', 'dates', 'frameRefs', 'packSize', 'packSizeText']));
    expect(itemSchema.properties.packSize.anyOf).toBeTruthy();
    const decoded = decode({ items: [{ ...item(), packSizeText: null, packSize: null, notes: null, dates: { useBy: null, bestBefore: null, legible: false, needsCloseUp: false } }], warnings: [] });
    expect(PantryScanSchema.safeParse(decoded).success).toBe(true);
  });
});

describe('normaliseScan', () => {
  const run = (it: ReturnType<typeof item>, n = 3) => normaliseScan({ items: [it], warnings: [] }, n).items[0]!;

  it('drops dates when the label was flagged unreadable or needs a close-up', () => {
    const a = run(item({ dates: { useBy: '2026-10-21', legible: false, needsCloseUp: false } }));
    expect(a.dates).toEqual({ legible: false, needsCloseUp: false });
    const b = run(item({ dates: { bestBefore: '2027-01-01', legible: true, needsCloseUp: true } }));
    expect(b.dates).toEqual({ legible: false, needsCloseUp: true });
  });
  it('keeps use by and best before separate and clears needsCloseUp once a date exists', () => {
    const r = run(item({ dates: { useBy: '2026-10-21', bestBefore: '2026-10-25', legible: true, needsCloseUp: false } }));
    expect(r.dates).toEqual({ useBy: '2026-10-21', bestBefore: '2026-10-25', legible: true, needsCloseUp: false });
    const only = run(item({ dates: { bestBefore: '2027-03-01', legible: true, needsCloseUp: false } }));
    expect(only.dates.useBy).toBeUndefined();
    expect(only.dates.bestBefore).toBe('2027-03-01');
  });
  it('legible without any date becomes not legible', () => {
    expect(run(item({ dates: { legible: true, needsCloseUp: false } })).dates).toEqual({ legible: false, needsCloseUp: false });
  });
  it('clamps frame references to the images sent and de-duplicates them', () => {
    expect(run(item({ frameRefs: [3, 1, 1, 9] }), 3).frameRefs).toEqual([1, 3]);
    expect(run(item({ frameRefs: [9] }), 3).frameRefs).toEqual([1]);
  });
  it('trims names, drops empty ones, and ignores a pack size without printed text', () => {
    const out = normaliseScan({ items: [item({ name: '  tinned   chickpeas ' }), item({ name: '   ' }), item({ packSize: { value: 400, unit: 'g' } })], warnings: ['w'] }, 2);
    expect(out.items.map((i) => i.name)).toEqual(['tinned chickpeas', 'carrot']);
    expect(out.items[1]!.packSize).toBeUndefined();
    expect(out.warnings).toEqual(['w']);
    const sized = run(item({ packSizeText: ' 400g ', packSize: { value: 400, unit: 'g' } }));
    expect(sized.packSizeText).toBe('400g');
    expect(sized.packSize).toEqual({ value: 400, unit: 'g' });
  });
  it('does not merge or sum items itself (de-duplication is the model\'s job; mapping must cope with repeats)', () => {
    const out = normaliseScan({ items: [item({ count: 3 }), item({ count: 2, frameRefs: [2] })], warnings: [] }, 2);
    expect(out.items.map((i) => i.count)).toEqual([3, 2]);
  });
});

describe('MockAiProvider.scanPantry', () => {
  const m = () => createMockProvider({ env: { NODE_ENV: 'test' } });
  it('is deterministic, schema-valid, resolves relative dates against today and clamps frames to the images sent', async () => {
    const img = await jpeg();
    const a = await m().scanPantry([img], { today: '2026-10-19' });
    expect(a).toEqual(await m().scanPantry([img], { today: '2026-10-19' }));
    expect(PantryScanSchema.safeParse(a).success).toBe(true);
    const chicken = a.items.find((i) => i.name === 'chicken breast')!;
    expect(chicken.dates.useBy).toBe('2026-10-21');
    expect(chicken.packSize).toEqual({ value: 650, unit: 'g' });
    expect(a.items.find((i) => i.name === 'tinned chickpeas')!.dates.bestBefore).toBe('2027-11-23');
    const yoghurt = a.items.find((i) => i.name === 'natural yoghurt')!;
    expect(yoghurt.dates).toEqual({ legible: false, needsCloseUp: true });
    expect(a.items.every((i) => i.frameRefs.every((n) => n === 1))).toBe(true);
    const two = await m().scanPantry([img, img], { today: '2026-10-19' });
    expect(two.items.find((i) => i.name === 'banana')!.frameRefs).toEqual([1, 2]);
  });
  it('accepts up to 10 frames and rejects 11; refuses bad image bytes', async () => {
    const img = await jpeg();
    await expect(m().scanPantry(Array(SCAN_MAX_IMAGES).fill(img))).resolves.toBeTruthy();
    expect((await m().scanPantry(Array(SCAN_MAX_IMAGES + 1).fill(img)).catch((e) => e)).code).toBe('TOO_MANY_IMAGES');
    expect((await m().scanPantry([new Uint8Array([1, 2, 3])]).catch((e) => e)).code).toBe('UNSUPPORTED_IMAGE_TYPE');
  });
  it('a close-up returns only the focused item with a readable date', async () => {
    const r = await m().scanPantry([await jpeg()], { focusItem: 'natural yoghurt', today: '2026-10-19' });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ name: 'natural yoghurt', dates: { useBy: '2026-10-22', legible: true, needsCloseUp: false } });
  });
  it('is forwarded by the resolving provider', async () => {
    const p = createResolvingProvider(() => m());
    expect((await p.scanPantry([await jpeg()])).items.length).toBeGreaterThan(0);
  });
});

describe('real adapters carry scanPantry', () => {
  const good = (): PantryScan => PantryScanSchema.parse({
    items: [{ ...item(), dates: { useBy: '2026-10-21', legible: false, needsCloseUp: false }, frameRefs: [1, 7] }], warnings: [],
  });

  it('Anthropic: sends every frame (more than the recipe limit of 6), the scan tool, and sanitises the answer', async () => {
    const c = fakeClient([toolUse('submit_pantry_scan', good())]);
    const sink = new MemoryUsageSink();
    const p = new AnthropicProvider({ client: c as never, usageSink: sink });
    const img = await jpeg();
    const out = await p.scanPantry(Array(8).fill(img), { ingredientNames: ['carrot'], today: '2026-10-19' }, { householdId: 'h' });
    const call = c.calls[0];
    expect(call.tools[0].name).toBe('submit_pantry_scan');
    expect(call.messages[0].content.filter((b: any) => b.type === 'image')).toHaveLength(8);
    expect(call.messages[0].content.at(-1).text).toContain('8 images');
    // legible:false -> the date is dropped even though the model supplied one; frame 7 is within 8 so it stays.
    expect(out.items[0]!.dates).toEqual({ legible: false, needsCloseUp: false });
    expect(out.items[0]!.frameRefs).toEqual([1, 7]);
    expect(sink.records[0]).toMatchObject({ operation: 'scanPantry', status: 'ok', householdId: 'h' });
    expect(JSON.stringify(call)).not.toMatch(/"h"/);
  });

  it('OpenAI: strict json_schema request with the images and the scan system prompt', async () => {
    const calls: any[] = [];
    const fn = (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(good()) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new OpenAiProvider({ apiKey: 'sk-test-1234567890abcd', fetch: fn });
    const img = await jpeg();
    const out = await p.scanPantry([img, img, img], {});
    expect(out.items).toHaveLength(1);
    const body = calls[0];
    expect(body.response_format.type).toBe('json_schema');
    expect(body.messages[0].content).toMatch(/SAME scene/);
    expect(body.messages[1].content.filter((b: any) => b.type === 'image_url')).toHaveLength(3);
  });
});
