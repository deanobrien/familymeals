import { describe, expect, it } from 'vitest';
import { AiError, AnthropicProvider, MemoryUsageSink } from '../src/index.js';
import { fakeClient, goodRecipe, httpErr, jpeg, toolUse } from './helpers.js';

const mk = (queue: unknown[], extra: Record<string, unknown> = {}) => {
  const client = fakeClient(queue);
  const sink = new MemoryUsageSink();
  const sleeps: number[] = [];
  const p = new AnthropicProvider({ client, usageSink: sink, sleep: async (ms) => { sleeps.push(ms); }, ...extra });
  return { client, sink, sleeps, p };
};
const tagReq = { title: 'x', ingredientNames: [] as string[] };

describe('AnthropicProvider', () => {
  it('extracts a recipe via forced tool use, with vision model and image block', async () => {
    const { p, client, sink } = mk([toolUse('submit_recipe', goodRecipe())]);
    const r = await p.extractRecipe([await jpeg()], undefined, { householdId: 'h1' });
    expect(r.title).toContain('Lentil');
    const call = client.calls[0];
    expect(call.model).toBe('claude-sonnet-5-5');
    expect(call.tool_choice).toEqual({ type: 'tool', name: 'submit_recipe' });
    expect(call.messages[0].content[0].type).toBe('image');
    expect(call.tools[0].input_schema.type).toBe('object');
    expect(sink.records[0]).toMatchObject({ householdId: 'h1', operation: 'extractRecipe', status: 'ok', inputTokens: 100, outputTokens: 50, attempts: 1 });
  });

  it('uses the text model for text operations and respects configured model ids', async () => {
    const { p, client } = mk([toolUse('submit_tags', { tags: ['soup'] })], { textModel: 'my-text' });
    await p.suggestTags({ title: 'Soup', ingredientNames: ['lentils'] });
    expect(client.calls[0].model).toBe('my-text');
  });

  it('defaults text model to haiku', async () => {
    const { p, client } = mk([toolUse('submit_tags', { tags: [] })]);
    await p.suggestTags(tagReq);
    expect(client.calls[0].model).toBe('claude-haiku-4-5');
  });

  it('retries transient errors with backoff then succeeds', async () => {
    const { p, client, sleeps, sink } = mk([httpErr(529), httpErr(429), toolUse('submit_tags', { tags: ['a'] })]);
    const r = await p.suggestTags(tagReq);
    expect(r.tags).toEqual(['a']);
    expect(client.calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
    expect(sink.records[0]?.attempts).toBe(3);
  });

  it('gives up after maxAttempts on transient errors with a typed user-visible error', async () => {
    const { p, client, sink } = mk([httpErr(500), httpErr(500), httpErr(500)]);
    const err = await p.suggestTags(tagReq).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe('PROVIDER_UNAVAILABLE');
    expect(err.userMessage).toMatch(/temporarily unavailable/);
    expect(client.calls).toHaveLength(3);
    expect(sink.records[0]).toMatchObject({ status: 'error', errorCode: 'PROVIDER_UNAVAILABLE', attempts: 3 });
  });

  it('does not retry auth or bad-request errors', async () => {
    const a = mk([httpErr(401)]);
    expect((await a.p.suggestTags(tagReq).catch((e) => e)).code).toBe('PROVIDER_AUTH');
    expect(a.client.calls).toHaveLength(1);
    const b = mk([httpErr(400)]);
    expect((await b.p.suggestTags(tagReq).catch((e) => e)).code).toBe('BAD_REQUEST');
    expect(b.client.calls).toHaveLength(1);
  });

  it('retries schema-invalid output, feeding the validation error back', async () => {
    const bad = { ...goodRecipe(), ingredients: [] };
    const { p, client, sink } = mk([toolUse('submit_recipe', bad), toolUse('submit_recipe', goodRecipe())]);
    const r = await p.extractRecipe([await jpeg()]);
    expect(r.ingredients.length).toBeGreaterThan(0);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1].messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', is_error: true });
    expect(sink.records[0]?.attempts).toBe(2);
    expect(sink.records[0]?.inputTokens).toBe(200);
  });

  it('fails with INVALID_OUTPUT when output stays invalid', async () => {
    const bad = () => toolUse('submit_tags', { tags: 'nope' });
    const { p, client } = mk([bad(), bad(), bad()]);
    const err = await p.suggestTags(tagReq).catch((e) => e);
    expect(err.code).toBe('INVALID_OUTPUT');
    expect(client.calls).toHaveLength(3);
  });

  it('treats a response with no tool call as invalid output', async () => {
    const { p } = mk([{ content: [{ type: 'text', text: 'hi' }], usage: {} }], { maxAttempts: 1 });
    expect((await p.suggestTags(tagReq).catch((e) => e)).code).toBe('INVALID_OUTPUT');
  });

  it('enforces per-household limits before calling the provider', async () => {
    const { p, client } = mk([], { limits: { check: () => false } });
    const err = await p.suggestTags(tagReq, { householdId: 'h' }).catch((e) => e);
    expect(err.code).toBe('LIMIT_EXCEEDED');
    expect(client.calls).toHaveLength(0);
  });

  it('rejects bad images before any provider call', async () => {
    const { p, client } = mk([]);
    const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
    expect((await p.extractRecipe([heic]).catch((e) => e)).code).toBe('UNSUPPORTED_IMAGE_TYPE');
    expect(client.calls).toHaveLength(0);
  });

  describe('prompt minimisation and hard constraints', () => {
    it('plan prompt contains only allow-listed context, never extra household data', async () => {
      const { p, client } = mk([toolUse('submit_plan_constraints', { days: 5, mealTypes: ['dinner'] })]);
      const ctx: any = { defaultServings: 4, exclusions: ['peanuts'], memberNames: ['Sam'], secretAddress: '1 Privet Drive', members: [{ name: 'Zed', allergy: 'shellfish' }] };
      await p.parsePlanPrompt('5 dinners', ctx);
      const text = JSON.stringify(client.calls[0].messages);
      expect(text).toContain('peanuts');
      expect(text).not.toContain('Privet');
      expect(text).not.toContain('Zed');
      expect(text).not.toContain('shellfish');
    });

    it('household id is never put in the prompt', async () => {
      const { p, client } = mk([toolUse('submit_tags', { tags: [] })]);
      await p.suggestTags(tagReq, { householdId: 'hh-secret-123' });
      expect(JSON.stringify(client.calls[0])).not.toContain('hh-secret-123');
    });

    it('forces hard exclusions into the result even if the model omitted them', async () => {
      const { p } = mk([toolUse('submit_plan_constraints', { days: 5, mealTypes: ['dinner'], excludeIngredients: ['Mushrooms'] })]);
      const r = await p.parsePlanPrompt('5 dinners', { exclusions: ['peanuts', 'mushrooms'] });
      expect(r.excludeIngredients).toEqual(['Mushrooms', 'peanuts']);
    });

    it('drops hallucinated candidate ids in ingredient matches', async () => {
      const { p } = mk([toolUse('submit_matches', { matches: [{ line: 'onion', candidateId: 'zzz', confidence: 0.9 }, { line: 'garlic', candidateId: 'g1', confidence: 0.9 }] })]);
      const r = await p.suggestIngredientMatches(['onion', 'garlic'], [{ id: 'g1', name: 'garlic' }]);
      expect(r.matches.map((m) => m.candidateId)).toEqual([null, 'g1']);
    });
  });
});
