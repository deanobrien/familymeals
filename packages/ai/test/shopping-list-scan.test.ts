import { describe, expect, it } from 'vitest';
import listFx from '../fixtures/shopping-list-scan.json' with { type: 'json' };
import {
  AnthropicProvider, MemoryUsageSink, OpenAiProvider, SHOPPING_LIST_SYSTEM, SHOPPING_SCAN_MAX_IMAGES,
  ShoppingListLineSchema, ShoppingListScanSchema, createMockProvider, createResolvingProvider,
  normaliseShoppingListScan, scanShoppingListPrompt, toStrictSchema, type ShoppingListScan,
} from '../src/index.js';
import { fakeClient, jpeg, toolUse } from './helpers.js';

const line = (over: Record<string, unknown> = {}) => ShoppingListLineSchema.parse({
  originalText: 'milk', name: 'milk', crossedOut: false, illegible: false, confidence: 0.9, imageRef: 1, ...over,
});
const run = (l: ReturnType<typeof line>, n = 2) => normaliseShoppingListScan({ lines: [l], warnings: [] }, n).lines[0];

describe('shopping list scan prompt', () => {
  const p = SHOPPING_LIST_SYSTEM;
  it('covers UK handwriting: abbreviations, columns, margins, crossed-out lines and ticks', () => {
    expect(p).toMatch(/HANDWRITTEN UK shopping list/);
    expect(p).toMatch(/spuds/);
    expect(p).toMatch(/toms/);
    expect(p).toMatch(/OJ/);
    expect(p).toMatch(/several columns/);
    expect(p).toMatch(/margin/);
    expect(p).toMatch(/crossedOut is true when the line has a line through it/);
    expect(p).toMatch(/ticked off/);
  });
  it('forbids inventing items or amounts and keeps the transcription verbatim', () => {
    expect(p).toMatch(/never invent items/);
    expect(p).toMatch(/OMIT quantity entirely/);
    expect(p).toMatch(/Never infer 1/);
    expect(p).toMatch(/EXACTLY as written/);
    expect(p).toMatch(/do NOT guess a plausible item/);
    expect(p).toMatch(/Do not add items that are not on the page/);
  });
  it('context carries only ingredient names and the page count', () => {
    const t = scanShoppingListPrompt(2, { ingredientNames: ['milk', 'potatoes'] });
    expect(t).toContain('2 images');
    expect(t).toContain('milk, potatoes');
    expect(scanShoppingListPrompt(1)).toContain('1 image');
    // A careless caller passing household data never leaks it into the prompt.
    const leaky = scanShoppingListPrompt(1, { ingredientNames: ['x'], householdId: 'hh-1', members: ['Ann'], pantry: ['rice'] } as never);
    expect(leaky).not.toMatch(/hh-1|Ann|rice/);
  });
});

describe('shopping list scan schema', () => {
  it('accepts the mock fixture', () => {
    expect(ShoppingListScanSchema.safeParse(listFx).success).toBe(true);
  });
  it('allows a line with no quantity and rejects an exact quantity without a value', () => {
    expect(ShoppingListLineSchema.safeParse({ originalText: 'eggs', name: 'eggs', crossedOut: false, illegible: false, confidence: 0.9 }).success).toBe(true);
    const q = (quantity: unknown) => ShoppingListLineSchema.safeParse({ originalText: 'x', name: 'x', quantity, crossedOut: false, illegible: false, confidence: 1 }).success;
    expect(q({ kind: 'exact', unit: 'kg', originalText: '1kg' })).toBe(false);
    expect(q({ kind: 'exact', value: 1, unit: 'kg', originalText: '1kg' })).toBe(true);
    expect(q({ kind: 'exact', value: 1, unit: 'bag', originalText: '1 bag' })).toBe(false);
  });
  it('rejects too many lines, confidence outside 0..1 and an image ref below 1', () => {
    expect(ShoppingListLineSchema.safeParse({ ...line(), confidence: 1.5 }).success).toBe(false);
    expect(ShoppingListLineSchema.safeParse({ ...line(), imageRef: 0 }).success).toBe(false);
    expect(ShoppingListScanSchema.safeParse({ lines: Array(121).fill(line()), warnings: [] }).success).toBe(false);
  });
  it('converts to the OpenAI strict subset (optionals nullable) and decodes back', () => {
    const { schema, decode } = toStrictSchema(ShoppingListScanSchema);
    const item = (schema as any).properties.lines.items;
    expect(item.required).toEqual(expect.arrayContaining(['originalText', 'name', 'quantity', 'notes', 'crossedOut', 'illegible', 'confidence', 'imageRef']));
    const decoded = decode({
      title: null, warnings: [],
      lines: [{ originalText: 'eggs', name: 'eggs', quantity: null, notes: null, crossedOut: false, illegible: false, confidence: 0.9, imageRef: 1 }],
    });
    const parsed = ShoppingListScanSchema.safeParse(decoded);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.lines[0]!.quantity).toBeUndefined();
  });
});

describe('normaliseShoppingListScan', () => {
  it('never invents an amount: unparsed, to_taste, valueless and blank-text quantities are dropped', () => {
    const unparsed = { kind: 'unparsed' as const, originalText: 'some' };
    expect(run(line({ quantity: unparsed }))!.quantity).toBeUndefined();
    expect(run(line({ quantity: { kind: 'to_taste', originalText: 'lots' } }))!.quantity).toBeUndefined();
    expect(run(line({ quantity: { kind: 'exact', value: 0, unit: 'item', originalText: '0' } }))!.quantity).toBeUndefined();
    expect(run(line({ quantity: { kind: 'exact', value: 2, unit: 'item', originalText: '  ' } }))!.quantity).toBeUndefined();
    const good = { kind: 'exact' as const, value: 2, unit: 'item' as const, originalText: '2 x' };
    expect(run(line({ quantity: good }))!.quantity).toEqual(good);
    const approx = { kind: 'approximate' as const, approxLabel: 'a bag', originalText: 'a bag' };
    expect(run(line({ quantity: approx }))!.quantity).toEqual(approx);
  });
  it('a line with no name is flagged illegible with low confidence and no quantity', () => {
    const r = run(line({ originalText: 'ch??', name: '  ', confidence: 0.9, quantity: { kind: 'exact', value: 2, unit: 'item', originalText: '2' } }))!;
    expect(r.illegible).toBe(true);
    expect(r.confidence).toBeLessThanOrEqual(0.4);
    expect(r.quantity).toBeUndefined();
    expect(r.originalText).toBe('ch??');
    // A model that flags illegible but is confident is capped too.
    expect(run(line({ illegible: true, confidence: 0.95 }))!.confidence).toBe(0.4);
  });
  it('keeps crossed-out lines (flagged, never dropped or un-flagged)', () => {
    const r = run(line({ crossedOut: true }))!;
    expect(r.crossedOut).toBe(true);
  });
  it('trims, collapses whitespace, drops fully empty lines and clamps image refs', () => {
    const out = normaliseShoppingListScan({
      lines: [line({ originalText: '  2   x  milk ', name: ' semi   milk ', notes: '  skimmed ', imageRef: 9 }), line({ originalText: '  ', name: '  ' })],
      title: '  Sat shop ', warnings: ['w'],
    }, 2);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toMatchObject({ originalText: '2 x milk', name: 'semi milk', notes: 'skimmed', imageRef: 1 });
    expect(out.title).toBe('Sat shop');
    expect(out.warnings).toEqual(['w']);
  });
  it('does not merge repeated lines itself (the merge preview does)', () => {
    const out = normaliseShoppingListScan({ lines: [line(), line()], warnings: [] }, 1);
    expect(out.lines).toHaveLength(2);
  });
});

describe('MockAiProvider.scanShoppingList', () => {
  const m = () => createMockProvider({ env: { NODE_ENV: 'test' } });
  it('is deterministic and schema-valid, with a realistic handwritten list', async () => {
    const img = await jpeg();
    const a = await m().scanShoppingList([img]);
    expect(a).toEqual(await m().scanShoppingList([img]));
    expect(ShoppingListScanSchema.safeParse(a).success).toBe(true);
    expect(a.lines.find((l) => l.originalText === '1kg spuds')).toMatchObject({ name: 'potatoes', quantity: { kind: 'exact', value: 1, unit: 'kg' } });
    expect(a.lines.find((l) => l.originalText === 'eggs')!.quantity).toBeUndefined();
    expect(a.lines.find((l) => l.originalText === 'butter')!.crossedOut).toBe(true);
    const bad = a.lines.find((l) => l.illegible)!;
    expect(bad.name).toBe('');
    expect(bad.confidence).toBeLessThanOrEqual(0.4);
    expect(a.lines.find((l) => l.name === 'cheddar')!.notes).toBe('if on offer');
  });
  it('accepts up to 4 photos and rejects 5; refuses bad image bytes', async () => {
    const img = await jpeg();
    await expect(m().scanShoppingList(Array(SHOPPING_SCAN_MAX_IMAGES).fill(img))).resolves.toBeTruthy();
    expect((await m().scanShoppingList(Array(SHOPPING_SCAN_MAX_IMAGES + 1).fill(img)).catch((e) => e)).code).toBe('TOO_MANY_IMAGES');
    expect((await m().scanShoppingList([new Uint8Array([1, 2, 3])]).catch((e) => e)).code).toBe('UNSUPPORTED_IMAGE_TYPE');
    expect((await m().scanShoppingList([]).catch((e) => e)).code).toBe('BAD_REQUEST');
  });
  it('is forwarded by the resolving provider', async () => {
    const p = createResolvingProvider(() => m());
    expect((await p.scanShoppingList([await jpeg()])).lines.length).toBeGreaterThan(5);
  });
});

describe('real adapters carry scanShoppingList', () => {
  const good = (): ShoppingListScan => ShoppingListScanSchema.parse({
    lines: [
      line({ originalText: '2 x milk', quantity: { kind: 'exact', value: 2, unit: 'item', originalText: '2 x' }, imageRef: 7 }),
      line({ originalText: 'eggs', name: 'eggs', quantity: { kind: 'unparsed', originalText: 'eggs' }, crossedOut: true }),
    ],
    warnings: [],
  });

  it('Anthropic: sends every page, the list tool, and sanitises the answer', async () => {
    const c = fakeClient([toolUse('submit_shopping_list', good())]);
    const sink = new MemoryUsageSink();
    const p = new AnthropicProvider({ client: c as never, usageSink: sink });
    const img = await jpeg();
    const out = await p.scanShoppingList([img, img, img], { ingredientNames: ['milk'] }, { householdId: 'hh-secret' });
    const call = c.calls[0];
    expect(call.tools[0].name).toBe('submit_shopping_list');
    expect(call.system ?? JSON.stringify(call)).toMatch(/HANDWRITTEN UK shopping list/);
    expect(call.messages[0].content.filter((b: any) => b.type === 'image')).toHaveLength(3);
    expect(call.messages[0].content.at(-1).text).toContain('3 images');
    // Image ref 7 is beyond the 3 sent -> 1; the unparsed quantity "eggs" is dropped; crossed-out stays flagged.
    expect(out.lines[0]!.imageRef).toBe(1);
    expect(out.lines[1]!.quantity).toBeUndefined();
    expect(out.lines[1]!.crossedOut).toBe(true);
    expect(sink.records[0]).toMatchObject({ operation: 'scanShoppingList', status: 'ok', householdId: 'hh-secret' });
    expect(JSON.stringify(call)).not.toMatch(/hh-secret/);
  });

  it('OpenAI/Azure: strict json_schema request with the images and the list system prompt (fake fetch)', async () => {
    const calls: any[] = [];
    const strict = (s: ShoppingListScan) => ({
      title: null, warnings: s.warnings,
      lines: s.lines.map((l) => ({ ...l, notes: l.notes ?? null, quantity: l.quantity ? { value: null, min: null, max: null, unit: null, approxLabel: null, ...l.quantity } : null })),
    });
    const fn = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(strict(good())) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new OpenAiProvider({ apiKey: 'sk-test-1234567890abcd', fetch: fn });
    const img = await jpeg();
    const out = await p.scanShoppingList([img, img], {});
    expect(out.lines).toHaveLength(2);
    expect(out.lines[0]!.quantity).toMatchObject({ kind: 'exact', value: 2, unit: 'item' });
    const body = calls[0].body;
    expect(body.response_format.type).toBe('json_schema');
    expect(body.messages[0].content).toMatch(/HANDWRITTEN UK shopping list/);
    expect(body.messages[1].content.filter((b: any) => b.type === 'image_url')).toHaveLength(2);
  });

  it('rejects an invalid model answer after bounded retries (never returns unvalidated lines)', async () => {
    const bad = { lines: [{ originalText: 'x', name: 'x', crossedOut: 'no' }], warnings: [] };
    const c = fakeClient([toolUse('submit_shopping_list', bad), toolUse('submit_shopping_list', bad), toolUse('submit_shopping_list', bad)]);
    const p = new AnthropicProvider({ client: c as never, sleep: async () => {} } as never);
    const err = await p.scanShoppingList([await jpeg()]).catch((e) => e);
    expect(err.code).toBe('INVALID_OUTPUT');
  });
});
