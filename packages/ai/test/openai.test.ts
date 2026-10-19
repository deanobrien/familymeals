import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AiError, MemoryUsageSink, OpenAiProvider, RecipeExtractionSchema, createProviderFromConfig, createResolvingProvider,
  toStrictSchema, type OpenAiProviderOptions,
} from '../src/index.js';
import { goodRecipe, jpeg } from './helpers.js';

const KEY = 'sk-test-SECRET-1234567890abcd';

type Reply = Response | Error | (() => Response | Error);
const ok = (content: unknown, usage = { prompt_tokens: 120, completion_tokens: 60 }, finish = 'stop') =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: finish }], usage }), { status: 200 });
const fail = (status: number, message: string, code?: string) =>
  new Response(JSON.stringify({ error: { message, ...(code ? { code } : {}) } }), { status });

function fakeFetch(queue: Reply[]) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const next = queue.shift();
    if (next === undefined) throw new Error('fake fetch queue empty');
    const r = typeof next === 'function' ? next() : next;
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const mk = (queue: Reply[], extra: Partial<OpenAiProviderOptions> = {}) => {
  const f = fakeFetch(queue);
  const sink = new MemoryUsageSink();
  const sleeps: number[] = [];
  const p = new OpenAiProvider({ apiKey: KEY, fetch: f.fn, usageSink: sink, sleep: async (ms) => { sleeps.push(ms); }, ...extra });
  return { ...f, sink, sleeps, p };
};
const tagReq = { title: 'x', ingredientNames: [] as string[] };

describe('OpenAiProvider (fake fetch)', () => {
  it('extracts a recipe with strict json_schema, vision model, base64 data URL images and bearer auth', async () => {
    const { p, calls, sink } = mk([ok(goodRecipe())], { organization: 'org-1' });
    const r = await p.extractRecipe([await jpeg()], 'Soup', { householdId: 'h1' });
    expect(r.title).toContain('Lentil');
    const c = calls[0]!;
    expect(c.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(c.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(c.headers['openai-organization']).toBe('org-1');
    expect(c.body.model).toBe('gpt-4.1');
    expect(c.body.max_completion_tokens).toBe(4096);
    expect(c.body.response_format.type).toBe('json_schema');
    expect(c.body.response_format.json_schema.strict).toBe(true);
    const user = c.body.messages[1].content;
    expect(user[0]).toMatchObject({ type: 'image_url' });
    expect(user[0].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(user.at(-1).text).toContain('Soup');
    expect(c.body.messages[0].content).toMatch(/rotated/i);
    expect(c.body.messages[0].content).not.toMatch(/provided tool/);
    expect(sink.records[0]).toMatchObject({ householdId: 'h1', operation: 'extractRecipe', status: 'ok', inputTokens: 120, outputTokens: 60, attempts: 1 });
  });

  it('never puts the API key or household id in the request body', async () => {
    const { p, calls } = mk([ok(goodRecipe())]);
    await p.extractRecipe([await jpeg()], undefined, { householdId: 'hh-secret-9' });
    const body = JSON.stringify(calls[0]!.body);
    expect(body).not.toContain(KEY);
    expect(body).not.toContain('hh-secret-9');
  });

  it('honours custom base URL (trailing slash / full path) and model override', async () => {
    const { p, calls } = mk([ok({ tags: ['a'] })], { baseUrl: 'http://localhost:11434/v1/chat/completions/', model: 'llama3.2-vision', textModel: 'tiny' });
    await p.suggestTags(tagReq);
    expect(calls[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(calls[0]!.body.model).toBe('tiny');
    // non-official host: older token parameter
    expect(calls[0]!.body.max_tokens).toBe(4096);
    expect(calls[0]!.body.max_completion_tokens).toBeUndefined();
    // text-only requests use plain string content for broad compatibility
    expect(typeof calls[0]!.body.messages[1].content).toBe('string');
  });

  it('Azure mode uses the deployment URL, api-version and api-key header (no model in body)', async () => {
    const { p, calls } = mk([ok({ tags: ['a'] })], { azure: { endpoint: 'https://res.openai.azure.com/', deployment: 'vision 1', apiVersion: '2025-01-01' } });
    await p.suggestTags(tagReq);
    const c = calls[0]!;
    expect(c.url).toBe('https://res.openai.azure.com/openai/deployments/vision%201/chat/completions?api-version=2025-01-01');
    expect(c.headers['api-key']).toBe(KEY);
    expect(c.headers.authorization).toBeUndefined();
    expect(c.body.model).toBeUndefined();
    expect(p.info).toMatchObject({ provider: 'azure', model: 'vision 1' });
  });

  it('falls back to json_object (schema described in the prompt) when json_schema is rejected, and remembers it', async () => {
    const { p, calls } = mk([
      fail(400, "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model."),
      ok({ tags: ['a'] }),
      ok({ tags: ['b'] }),
    ]);
    expect((await p.suggestTags(tagReq)).tags).toEqual(['a']);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body.response_format.type).toBe('json_schema');
    expect(calls[1]!.body.response_format).toEqual({ type: 'json_object' });
    expect(calls[1]!.body.messages[0].content).toContain('JSON Schema');
    await p.suggestTags(tagReq);
    expect(calls[2]!.body.response_format.type).toBe('json_object');
  });

  it('switches between max_completion_tokens and max_tokens when the endpoint rejects one', async () => {
    const { p, calls } = mk([fail(400, "Unrecognized request argument supplied: max_completion_tokens"), ok({ tags: [] })]);
    await p.suggestTags(tagReq);
    expect(calls[0]!.body.max_completion_tokens).toBe(4096);
    expect(calls[1]!.body.max_tokens).toBe(4096);
    expect(calls[1]!.body.max_completion_tokens).toBeUndefined();
  });

  it('tolerates markdown fences around JSON and null for optional fields', async () => {
    const { p } = mk([ok('```json\n{"tags":["soup"],"cuisine":null,"dietCategory":null,"mealTypes":["dinner"]}\n```')]);
    const r = await p.suggestTags(tagReq);
    expect(r).toEqual({ tags: ['soup'], mealTypes: ['dinner'] });
  });

  describe('error semantics', () => {
    it('401 -> PROVIDER_AUTH, not retried, message says the key was rejected', async () => {
      const { p, calls } = mk([fail(401, 'Incorrect API key provided')]);
      const e = await p.suggestTags(tagReq).catch((x) => x);
      expect(e).toBeInstanceOf(AiError);
      expect(e.code).toBe('PROVIDER_AUTH');
      expect(e.userMessage).toMatch(/rejected the API key/i);
      expect(calls).toHaveLength(1);
    });

    it('404 -> MODEL_NOT_FOUND', async () => {
      const { p } = mk([fail(404, 'The model `gpt-9` does not exist', 'model_not_found')]);
      const e = await p.suggestTags(tagReq).catch((x) => x);
      expect(e.code).toBe('MODEL_NOT_FOUND');
      expect(e.userMessage).toMatch(/model/i);
    });

    it('429 is retried with backoff then succeeds; insufficient_quota is not retried', async () => {
      const a = mk([fail(429, 'slow down'), ok({ tags: ['a'] })]);
      expect((await a.p.suggestTags(tagReq)).tags).toEqual(['a']);
      expect(a.sleeps).toEqual([500]);
      const b = mk([fail(429, 'You exceeded your current quota', 'insufficient_quota')]);
      const e = await b.p.suggestTags(tagReq).catch((x) => x);
      expect(e.code).toBe('RATE_LIMITED');
      expect(b.calls).toHaveLength(1);
    });

    it('persistent 429 gives RATE_LIMITED; 5xx gives PROVIDER_UNAVAILABLE after maxAttempts', async () => {
      const a = mk([fail(429, 'x'), fail(429, 'x'), fail(429, 'x')]);
      expect((await a.p.suggestTags(tagReq).catch((x) => x)).code).toBe('RATE_LIMITED');
      const b = mk([fail(503, 'x'), fail(500, 'x'), fail(502, 'x')]);
      const e = await b.p.suggestTags(tagReq).catch((x) => x);
      expect(e.code).toBe('PROVIDER_UNAVAILABLE');
      expect(b.calls).toHaveLength(3);
      expect(b.sink.records[0]).toMatchObject({ status: 'error', errorCode: 'PROVIDER_UNAVAILABLE', attempts: 3 });
    });

    it('network failure -> PROVIDER_UNREACHABLE (retried), timeout -> PROVIDER_UNAVAILABLE', async () => {
      const a = mk([new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed')]);
      const e = await a.p.suggestTags(tagReq).catch((x) => x);
      expect(e.code).toBe('PROVIDER_UNREACHABLE');
      expect(e.userMessage).toMatch(/could not reach/i);
      expect(a.calls).toHaveLength(3);
      const b = mk([Object.assign(new Error('aborted'), { name: 'AbortError' })], { maxAttempts: 1 });
      expect((await b.p.suggestTags(tagReq).catch((x) => x)).code).toBe('PROVIDER_UNAVAILABLE');
    });

    it('400 -> BAD_REQUEST, not retried', async () => {
      const { p, calls } = mk([fail(400, 'something else is wrong')]);
      expect((await p.suggestTags(tagReq).catch((x) => x)).code).toBe('BAD_REQUEST');
      expect(calls).toHaveLength(1);
    });

    it('redacts the key if the provider echoes it back, in AiError.message and cause', async () => {
      const { p } = mk([fail(401, `Incorrect API key provided: ${KEY}`)]);
      const e = await p.suggestTags(tagReq).catch((x) => x);
      expect(e.message).not.toContain(KEY);
      expect(String((e.cause as Error).message)).not.toContain(KEY);
      expect(JSON.stringify(e.userMessage)).not.toContain(KEY);
    });
  });

  describe('output validation', () => {
    it('retries schema-invalid output feeding the validation error back, summing usage', async () => {
      const bad = { ...goodRecipe(), ingredients: [] };
      const { p, calls, sink } = mk([ok(bad), ok(goodRecipe())]);
      const r = await p.extractRecipe([await jpeg()]);
      expect(r.ingredients.length).toBeGreaterThan(0);
      expect(calls).toHaveLength(2);
      const last = calls[1]!.body.messages.at(-1);
      expect(last.role).toBe('user');
      expect(last.content).toMatch(/Schema validation failed/);
      expect(calls[1]!.body.messages.at(-2).role).toBe('assistant');
      expect(sink.records[0]).toMatchObject({ attempts: 2, inputTokens: 240 });
    });

    it('INVALID_OUTPUT after repeated garbage, on refusal and on truncation', async () => {
      const a = mk([ok('not json'), ok('still not'), ok('nope')]);
      expect((await a.p.suggestTags(tagReq).catch((x) => x)).code).toBe('INVALID_OUTPUT');
      const refusal = new Response(JSON.stringify({ choices: [{ message: { content: null, refusal: "I can't help" }, finish_reason: 'stop' }] }), { status: 200 });
      const b = mk([refusal], { maxAttempts: 1 });
      expect((await b.p.suggestTags(tagReq).catch((x) => x)).code).toBe('INVALID_OUTPUT');
      const c = mk([ok('{"tags": [', undefined, 'length')], { maxAttempts: 1 });
      expect((await c.p.suggestTags(tagReq).catch((x) => x)).code).toBe('INVALID_OUTPUT');
    });

    it('keeps the optional printed nutrition / allergens / front image fields through the strict round trip', async () => {
      const rec = {
        ...goodRecipe(),
        printedNutrition: { basis: 'per person', values: [{ nutrient: 'Calories', amount: 822, unit: 'kcal' }], note: 'supplied ingredients only' },
        printedAllergens: ['A1: gluten'],
        sourcePublisher: 'Gousto', sourceReference: 'Recipe bag 3065', frontImageIndex: 2, frontImageRotation: 90,
      };
      const { p } = mk([ok(rec)]);
      const r = await p.extractRecipe([await jpeg(), await jpeg()]);
      expect(r.printedNutrition?.values[0]).toEqual({ nutrient: 'Calories', amount: 822, unit: 'kcal' });
      expect(r.printedAllergens).toEqual(['A1: gluten']);
      expect([r.sourcePublisher, r.sourceReference, r.frontImageIndex, r.frontImageRotation]).toEqual(['Gousto', 'Recipe bag 3065', 2, 90]);
    });
  });

  it('enforces limits and bad images before any network call', async () => {
    const a = mk([], { limits: { check: () => false } });
    expect((await a.p.suggestTags(tagReq, { householdId: 'h' }).catch((x) => x)).code).toBe('LIMIT_EXCEEDED');
    expect(a.calls).toHaveLength(0);
    const b = mk([]);
    expect((await b.p.extractRecipe([new Uint8Array([1, 2, 3])]).catch((x) => x)).code).toBe('UNSUPPORTED_IMAGE_TYPE');
    expect(b.calls).toHaveLength(0);
  });

  it('forces hard plan exclusions in code and drops hallucinated match ids (shared base behaviour)', async () => {
    const a = mk([ok({ days: 5, mealTypes: ['dinner'], servings: 4, excludeTerms: ['Mushrooms'] })]);
    const r = await a.p.parsePlanPrompt('5 dinners', { exclusions: ['peanuts', 'mushrooms'] });
    expect(r.excludeTerms).toEqual(['Mushrooms', 'peanuts']);
    const b = mk([ok({ matches: [{ line: 'onion', candidateId: 'zzz', confidence: 0.9 }] })]);
    expect((await b.p.suggestIngredientMatches(['onion'], [{ id: 'g1', name: 'garlic' }])).matches[0]!.candidateId).toBeNull();
  });

  it('ping makes one tiny call and reports the model', async () => {
    const { p, calls } = mk([ok({ ok: true })]);
    expect(await p.ping()).toEqual({ model: 'gpt-4.1' });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0]!.body.messages)).not.toContain('image_url');
  });

  it('refuses to construct without a key', () => {
    expect(() => new OpenAiProvider({ apiKey: '' })).toThrowError(/PROVIDER_NOT_CONFIGURED/);
  });
});

describe('strict schema conversion', () => {
  it('makes every property required + nullable, forbids extra props, and turns records into entry arrays', () => {
    const { schema, decode } = toStrictSchema(RecipeExtractionSchema);
    const walk = (n: any, path = ''): void => {
      if (n && typeof n === 'object') {
        if (n.type === 'object') {
          expect(n.additionalProperties, path).toBe(false);
          expect([...n.required].sort(), path).toEqual(Object.keys(n.properties).sort());
        }
        for (const k of ['minimum', 'minLength', 'minItems', 'default', 'pattern']) expect(n[k], `${path}.${k}`).toBeUndefined();
        for (const [k, v] of Object.entries(n)) walk(v, `${path}.${k}`);
      }
    };
    walk(schema);
    const props = (schema as any).properties;
    expect(props.confidence.anyOf[0].type).toBe('array');
    expect(props.printedNutrition.anyOf.some((b: any) => b.type === 'null')).toBe(true);
    // model answers with entries + nulls; decode restores the zod shape
    const decoded = decode({ ...goodRecipeNulls(), confidence: [{ key: 'title', value: 0.9 }] }) as any;
    expect(decoded.confidence).toEqual({ title: 0.9 });
    expect('description' in decoded).toBe(false);
    expect(RecipeExtractionSchema.safeParse(decoded).success).toBe(true);
  });

  it('keeps required-nullable values as null (e.g. candidateId)', () => {
    const s = z.object({ id: z.string().nullable(), note: z.string().optional() });
    const { decode } = toStrictSchema(s);
    expect(decode({ id: null, note: null })).toEqual({ id: null });
  });
});

describe('createProviderFromConfig / createResolvingProvider', () => {
  it('builds each provider kind and rejects a missing key as not configured', () => {
    expect(createProviderFromConfig({ kind: 'mock' })).toBeDefined();
    expect(createProviderFromConfig({ kind: 'openai', apiKey: 'k', model: 'gpt-4o' })).toBeInstanceOf(OpenAiProvider);
    expect(createProviderFromConfig({ kind: 'azure', apiKey: 'k', endpoint: 'https://x.openai.azure.com', deployment: 'd' })).toBeInstanceOf(OpenAiProvider);
    expect(() => createProviderFromConfig({ kind: 'openai', apiKey: '' })).toThrowError(/PROVIDER_NOT_CONFIGURED/);
  });

  it('resolves the underlying provider on every call', async () => {
    let n = 0;
    const seen: string[] = [];
    const resolving = createResolvingProvider(() => {
      n++;
      return { suggestTags: async () => { seen.push(`call${n}`); return { tags: [], mealTypes: [] }; } } as never;
    });
    await resolving.suggestTags(tagReq);
    await resolving.suggestTags(tagReq);
    expect(seen).toEqual(['call1', 'call2']);
  });
});

function goodRecipeNulls() {
  const g: any = goodRecipe();
  const nullify = (ing: any) => ({ pantryStaple: false, preparation: null, ...ing, quantity: { value: null, min: null, max: null, unit: null, approxLabel: null, ...ing.quantity } });
  return {
    ...g, ingredients: g.ingredients.map(nullify), description: null, servings: g.servings ?? null,
    printedNutrition: null, printedAllergens: null, sourcePublisher: null, sourceReference: null, frontImageIndex: null, frontImageRotation: null,
  };
}
