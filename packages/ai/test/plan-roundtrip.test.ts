import { PlanConstraintsSchema } from '@fr/domain';
import { describe, expect, it } from 'vitest';
import {
  AnthropicProvider, MemoryUsageSink, OpenAiProvider, createAzureOpenAiProvider, createMockProvider, planRequestToConstraints,
  toStrictSchema, PlanRequestSchema, type AiProvider, type HouseholdContext,
} from '../src/index.js';
import { fakeClient, toolUse } from './helpers.js';

/**
 * D130/D131: every provider turns the brief's example prompt into the ONE canonical PlanConstraints, through the
 * wire format that provider really uses (Anthropic tool input, OpenAI/Azure strict json_schema with null-filled
 * optionals, the mock fixture).
 */
const PROMPT =
  "Plan seven dinners for four people. Make roughly half vegetarian, include two fish meals, keep the shopping spend below £100, use Lauren's favourites where possible, avoid mushrooms and include quick meals on busy evenings.";
const CTX: HouseholdContext = {
  startDate: '2026-11-09', defaultServings: 4, exclusions: ['peanuts'], memberNames: ['Lauren'], availableTags: ['quick'],
};

/** What a model that follows the prompt emits (PlanRequest shape, optionals omitted). */
const MODEL_ANSWER = {
  days: 7,
  mealTypes: ['dinner'],
  servings: 4,
  budgetPence: 10000,
  dietProportions: { vegetarian: { fraction: 0.5 }, fish: { count: 2 } },
  excludeTerms: ['mushrooms'],
  favouritesOf: ['Lauren'],
  quickMeals: { weekdays: ['mon', 'tue', 'wed', 'thu'], maxTotalMinutes: 30 },
};

/** The same answer in OpenAI strict form: every property present, unused optionals null, union branches filled partly. */
const STRICT_ANSWER = {
  days: 7, mealTypes: ['dinner'], servings: 4, budgetPence: 10000,
  dietProportions: { meat: null, fish: { count: 2 }, vegetarian: { fraction: 0.5 }, vegan: { min: 1, max: null } },
  excludeDietCategories: null, includeTags: null, excludeAllergens: null,
  excludeTerms: ['mushrooms'], favouritesOf: ['Lauren'],
  quickMeals: { dates: null, weekdays: ['mon', 'tue', 'wed', 'thu'], maxTotalMinutes: 30, strict: null },
};

const ok = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });

function fakeFetch(answer: unknown) {
  const calls: Array<{ url: string; body: any }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return ok(answer);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function expectCanonical(c: unknown, opts: { vegan?: boolean } = {}) {
  // The result of parsePlanPrompt IS the canonical schema output: re-parsing it is the identity.
  const again = PlanConstraintsSchema.parse(c);
  expect(again).toEqual(c);
  expect(c).toMatchObject({
    startDate: '2026-11-09',
    days: 7,
    servings: 4,
    mealTypes: ['dinner'],
    budgetPence: 10000,
    favouritesOf: ['Lauren'],
    excludeIngredientIds: [],
    allergenGroups: {},
    allowUnverifiedIngredients: false,
  });
  const k = c as ReturnType<typeof PlanConstraintsSchema.parse>;
  expect(k.excludeTerms).toEqual(['mushrooms', 'peanuts']); // household exclusion forced in code
  expect(k.dietProportions?.vegetarian).toEqual({ fraction: 0.5 });
  expect(k.dietProportions?.fish).toEqual({ count: 2 });
  if (opts.vegan) expect(k.dietProportions?.vegan).toEqual({ min: 1 });
  expect(k.quickMeals).toEqual({ dates: [], weekdays: ['mon', 'tue', 'wed', 'thu'], maxTotalMinutes: 30, strict: false });
}

describe('parsePlanPrompt -> canonical PlanConstraints, every provider', () => {
  it('anthropic (forced tool use)', async () => {
    const client = fakeClient([toolUse('submit_plan_constraints', MODEL_ANSWER)]);
    const p: AiProvider = new AnthropicProvider({ client, usageSink: new MemoryUsageSink(), sleep: async () => {} });
    const r = await p.parsePlanPrompt(PROMPT, CTX);
    expectCanonical(r);
    const sent = client.calls[0].tools[0].input_schema;
    expect(Object.keys(sent.properties)).toContain('quickMeals');
    expect(Object.keys(sent.properties)).not.toContain('allergenGroups');
    expect(client.calls[0].messages[0].content[0].text).toContain('2026-11-09');
  });

  it('openai (strict json_schema, nulls for unused optionals)', async () => {
    const f = fakeFetch(STRICT_ANSWER);
    const p = new OpenAiProvider({ apiKey: 'sk-test', fetch: f.fn, usageSink: new MemoryUsageSink(), sleep: async () => {} });
    const r = await p.parsePlanPrompt(PROMPT, CTX);
    expectCanonical(r, { vegan: true });
    const schema = f.calls[0]!.body.response_format.json_schema.schema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort());
    expect(Object.keys(schema.properties)).not.toContain('allowUnverifiedIngredients');
  });

  it('azure openai (deployment URL, same strict schema)', async () => {
    const f = fakeFetch(STRICT_ANSWER);
    const p = createAzureOpenAiProvider(
      { AZURE_OPENAI_API_KEY: 'k', AZURE_OPENAI_ENDPOINT: 'https://res.openai.azure.com/', AZURE_OPENAI_DEPLOYMENT: 'plan1' },
      { fetch: f.fn, usageSink: new MemoryUsageSink(), sleep: async () => {} },
    );
    const r = await p.parsePlanPrompt(PROMPT, CTX);
    expectCanonical(r, { vegan: true });
    expect(f.calls[0]!.url).toContain('/openai/deployments/plan1/chat/completions');
  });

  it('openai json_object fallback still yields the canonical object', async () => {
    const f = fakeFetch(MODEL_ANSWER);
    const p = new OpenAiProvider({ apiKey: 'sk-test', fetch: f.fn, structuredOutput: 'json_object', usageSink: new MemoryUsageSink(), sleep: async () => {} });
    expectCanonical(await p.parsePlanPrompt(PROMPT, CTX));
  });

  it('mock provider fixture', async () => {
    const m = createMockProvider({ env: {} });
    const r = await m.parsePlanPrompt(PROMPT, CTX);
    expect(PlanConstraintsSchema.parse(r)).toEqual(r);
    expect(r).toMatchObject({ startDate: '2026-11-09', days: 7, servings: 4 });
    expect(r.excludeTerms).toEqual(['peanuts']);
    expect(r.quickMeals?.weekdays).toEqual(['mon', 'tue', 'wed', 'thu']);
  });
});

describe('strict schema for the plan request', () => {
  it('decodes union branches and drops null optionals so zod accepts the result', () => {
    const { decode } = toStrictSchema(PlanRequestSchema);
    const parsed = PlanRequestSchema.parse(decode(STRICT_ANSWER));
    expect(parsed.dietProportions).toEqual({ fish: { count: 2 }, vegetarian: { fraction: 0.5 }, vegan: { min: 1 } });
    expect(parsed.quickMeals?.strict).toBe(false);
  });

  it('planRequestToConstraints defaults days to 7 and de-duplicates exclusions case-insensitively', () => {
    const c = planRequestToConstraints(PlanRequestSchema.parse({ mealTypes: ['dinner'], servings: 2, excludeTerms: ['Peanuts'] }), { startDate: '2026-11-02', exclusions: ['peanuts', 'Soy'] });
    expect(c.days).toBe(7);
    expect(c.excludeTerms).toEqual(['Peanuts', 'Soy']);
  });
});
