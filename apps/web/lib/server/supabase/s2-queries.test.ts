// S2 query-shape tests (D120-D127) with the recording supabase-js double: exact RPC names/arguments, retry paths that
// the single-connection PGlite contract test cannot provoke (stale head, needs_engine_outstanding), and row mapping.
import { describe, expect, it } from 'vitest';
import { defaultEngineContext } from '../../shopping/engine';
import { SettingsWriteRefused } from '../ai/secret';
import { SupabaseSettingsBackend } from './ai-settings-backend';
import { profileFromJson } from './household-sources';
import { SupabasePriceStore, observationToRpc, receiptLineOf } from './price-store';
import { receiptToRpc } from './receipt-repository';
import { SupabaseShoppingRepository, engineReason, logRowToEntry, stateFromSnapshot, tickRetryId } from './shopping-repository';
import { createFakeSupabase, type RecordedCall } from './test-support/fake-client';

const HH = 'aa000000-0000-4000-8000-0000000000aa';
const LIST = 'ab000000-0000-4000-8000-0000000000ab';
const ITEM = 'd1000000-0000-4000-8000-000000000001';
const ALICE = 'a0000000-0000-4000-8000-000000000001';
const at = '2026-10-19T10:00:00.000Z';

const itemRow = (over: Record<string, unknown> = {}) => ({
  id: ITEM, shopping_list_id: LIST, household_id: HH, display_name: 'Flour', ingredient_ref: null, ingredient_id: null,
  quantity_kind: 'exact', quantity_value: '500', unit: 'g', original_text: '500 g', category: 'Baking', status: 'active',
  item_key: 'name:flour', requirement: null, manual_quantity: { kind: 'exact', value: 500, unit: 'g', originalText: '500 g' },
  plan_linked: false, created_by: ALICE, created_at: at, updated_at: at, position: 0, ...over,
});
const bundle = (head = 1) => ({ listId: LIST, head, items: [itemRow()], events: [], log: [] });
const rpcs = (calls: RecordedCall[], name: string) => calls.filter((c) => c.kind === 'rpc' && c.name === name);

describe('SupabaseShoppingRepository query shape', () => {
  it('snapshot = one shopping_list_snapshot RPC for the session household', async () => {
    const { client, calls } = createFakeSupabase((c) => (c.name === 'shopping_list_snapshot' ? { data: bundle() } : { data: [] }));
    const repo = new SupabaseShoppingRepository({ client, householdId: HH, ctx: defaultEngineContext });
    const s = await repo.snapshot(HH);
    expect(rpcs(calls, 'shopping_list_snapshot')[0]!.args).toEqual({ p_household_id: HH });
    expect(s.cursor).toBe(1);
    expect(s.state.items[ITEM]).toMatchObject({ displayName: 'Flour', key: 'name:flour', manualQuantity: { value: 500 } });
    await expect(repo.snapshot('someone-else')).rejects.toThrow(/household/);
  });

  it('a tick sends the engine outstanding + active count, and is retried ONCE under a derived id after needs_engine_outstanding', async () => {
    let n = 0;
    const { client, calls } = createFakeSupabase((c) => {
      if (c.name === 'shopping_list_snapshot') return { data: bundle() };
      if (c.name === 'record_purchase') {
        n++;
        return { data: n === 1 ? { status: 'rejected', reason: 'needs_engine_outstanding', activeEventCount: 1 } : { status: 'applied', eventId: c.args!.p_event_id, quantity: { kind: 'exact', value: 500, unit: 'g' } } };
      }
      return { data: null };
    });
    const repo = new SupabaseShoppingRepository({ client, householdId: HH, ctx: defaultEngineContext });
    const cmdId = 'c1000000-0000-4000-8000-000000000001';
    const out = await repo.submit(HH, { type: 'tick', commandId: cmdId, actor: ALICE, at, itemId: ITEM });
    const rp = rpcs(calls, 'record_purchase');
    expect(rp.map((c) => c.args)).toEqual([
      { p_event_id: cmdId, p_item_id: ITEM, p_mode: 'tick', p_expected_outstanding: 500, p_expected_event_count: 0 },
      { p_event_id: tickRetryId(cmdId, 1), p_item_id: ITEM, p_mode: 'tick', p_expected_outstanding: 500, p_expected_event_count: 0 },
    ]);
    expect(out.result).toMatchObject({ commandId: cmdId, status: 'applied', eventId: tickRetryId(cmdId, 1) });
  });

  it('an engine-decided command is persisted with the head it was decided at; a stale head reloads and decides again', async () => {
    let applies = 0;
    let head = 1;
    const { client, calls } = createFakeSupabase((c) => {
      if (c.name === 'shopping_list_snapshot') return { data: bundle(head) };
      if (c.name === 'apply_shopping_command') {
        applies++;
        if (applies === 1) { head = 2; return { data: { status: 'stale', head: 2 } }; }
        return { data: c.args!.p_result };
      }
      return { data: null };
    });
    const repo = new SupabaseShoppingRepository({ client, householdId: HH, ctx: defaultEngineContext });
    const out = await repo.submit(HH, { type: 'edit_item', commandId: 'c2000000-0000-4000-8000-000000000002', actor: ALICE, at, itemId: ITEM, patch: { notes: 'strong' } });
    const ap = rpcs(calls, 'apply_shopping_command');
    expect(ap).toHaveLength(2);
    expect(ap.map((c) => c.args!.p_expected_head)).toEqual([1, 2]);
    expect(ap[1]!.args).toMatchObject({ p_list_id: LIST, p_command_type: 'edit', p_result: { status: 'applied', itemId: ITEM } });
    expect((ap[1]!.args!.p_items as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: ITEM, notes: 'strong', isManual: true, position: 0, quantity: { kind: 'exact', value: 500, unit: 'g' },
    });
    expect(out.result.status).toBe('applied');
  });

  it('an engine rejection never calls record_purchase; it is logged through apply_shopping_command with no items', async () => {
    const { client, calls } = createFakeSupabase((c) => (c.name === 'shopping_list_snapshot' ? { data: bundle() } : c.name === 'apply_shopping_command' ? { data: c.args!.p_result } : { data: null }));
    const repo = new SupabaseShoppingRepository({ client, householdId: HH, ctx: defaultEngineContext });
    const out = await repo.submit(HH, { type: 'tick', commandId: 'c3000000-0000-4000-8000-000000000003', actor: ALICE, at, itemId: 'missing' });
    expect(out.result).toMatchObject({ status: 'rejected', reason: 'item_not_found' });
    expect(rpcs(calls, 'record_purchase')).toHaveLength(0);
    expect(rpcs(calls, 'apply_shopping_command')[0]!.args).toMatchObject({ p_command_type: 'tick', p_items: [] });
  });

  it('a household with no list creates one (ensure_shopping_list) only on write', async () => {
    const { client, calls } = createFakeSupabase((c) => {
      if (c.name === 'shopping_list_snapshot') return { data: { listId: null, head: 0, items: [], events: [], log: [] } };
      if (c.name === 'ensure_shopping_list') return { data: LIST };
      if (c.name === 'apply_shopping_command') return { data: c.args!.p_result };
      return { data: [] };
    });
    const repo = new SupabaseShoppingRepository({ client, householdId: HH, ctx: defaultEngineContext });
    await repo.snapshot(HH);
    expect(rpcs(calls, 'ensure_shopping_list')).toHaveLength(0);
    await repo.submit(HH, { type: 'add_item', commandId: 'c4000000-0000-4000-8000-000000000004', actor: ALICE, at, itemId: ITEM, displayName: 'Salt', category: 'Other' });
    expect(rpcs(calls, 'ensure_shopping_list')[0]!.args).toEqual({ p_household_id: HH });
    expect(rpcs(calls, 'apply_shopping_command')[0]!.args).toMatchObject({ p_list_id: LIST, p_expected_head: 0 });
  });

  it('catch-up reads the log after the cursor by list_seq, in order', async () => {
    const { client, calls } = createFakeSupabase((c) => (c.kind === 'from' && c.name === 'shopping_lists' ? { data: [{ id: LIST }] } : { data: [] }));
    const repo = new SupabaseShoppingRepository({ client, householdId: HH, ctx: defaultEngineContext });
    await repo.entriesSince(HH, 7);
    const log = calls.find((c) => c.kind === 'from' && c.name === 'shopping_command_log')!;
    expect(log.ops).toEqual([
      ['select', 'list_seq, command_id, command_type, command, status, reason, result, created_by, created_at'],
      ['eq', 'shopping_list_id', LIST], ['gt', 'list_seq', 7], ['order', 'list_seq', { ascending: true }], ['range', 0, 999],
    ]);
    const lists = calls.find((c) => c.kind === 'from' && c.name === 'shopping_lists')!;
    expect(lists.ops.slice(0, 3)).toEqual([['select', 'id, name'], ['eq', 'household_id', HH], ['eq', 'status', 'active']]);
  });
});

describe('log row -> engine LogEntry (D121)', () => {
  const row = (o: Record<string, unknown>) => ({ list_seq: 3, command_id: 'x1', created_by: ALICE, created_at: at, reason: null, ...o });

  it('an applied SQL tick replays as the purchase of exactly what SQL recorded', () => {
    const e = logRowToEntry(row({ command_type: 'tick', status: 'applied', command: { itemId: ITEM }, result: { status: 'applied', eventId: 'x1', quantity: { kind: 'exact', value: 1.5, unit: 'kg' } } }));
    expect(e).toMatchObject({ seq: 3, command: { type: 'purchase', commandId: 'x1', actor: ALICE, itemId: ITEM, quantity: { kind: 'exact', value: 1.5, unit: 'kg' } }, result: { status: 'applied' } });
  });

  it('an unquantified tick stays a tick; a void is an undo; a mobile purchase keeps price and receipt line', () => {
    expect(logRowToEntry(row({ command_type: 'tick', status: 'applied', command: { itemId: ITEM }, result: { status: 'applied', quantity: { kind: 'unparsed', value: null, unit: null } } })).command.type).toBe('tick');
    expect(logRowToEntry(row({ command_type: 'void', status: 'applied', command: { eventId: 'e9' }, result: { status: 'applied', eventId: 'e9' } })).command).toMatchObject({ type: 'undo', eventId: 'e9' });
    expect(logRowToEntry(row({ command_type: 'purchase', status: 'applied', command: { itemId: ITEM, quantity: { kind: 'exact', value: 2, unit: 'l', originalText: '2 l' }, pricePence: 150, receiptLineId: 'r1' }, result: { status: 'applied' } })).command)
      .toMatchObject({ type: 'purchase', quantity: { value: 2, unit: 'l' }, actualPricePence: 150, receiptLineId: 'r1' });
  });

  it('rejections carry the SQL outcome; needs_engine_outstanding is superseded; deleted actors are a placeholder', () => {
    const e = logRowToEntry(row({ command_type: 'tick', status: 'rejected', reason: 'already_complete', command: { itemId: ITEM }, result: { status: 'rejected', reason: 'already_complete', completedBy: [ALICE, null] } }));
    expect(e.result).toMatchObject({ status: 'rejected', reason: 'already_complete', itemId: ITEM, completedBy: [ALICE, '00000000-0000-0000-0000-000000000000'] });
    expect(engineReason('needs_engine_outstanding')).toBe('superseded');
    expect(engineReason('invalid_price')).toBe('invalid_quantity');
    expect(logRowToEntry(row({ created_by: null, command_type: 'void', status: 'rejected', reason: 'already_voided', command: { eventId: 'e1' }, result: {} })).command.actor).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('engine-written rows round-trip the engine command/result; snapshot outcomes and voids come from the log', () => {
    const cmd = { type: 'remove_item', commandId: 'x1', actor: 'spoofed', at, itemId: ITEM };
    const e = logRowToEntry(row({ command_type: 'remove', status: 'applied', command: cmd, result: { commandId: 'x1', type: 'remove_item', status: 'applied', itemId: ITEM } }));
    expect(e.command).toEqual({ ...cmd, actor: ALICE }); // the logged actor (session user) wins
    const s = stateFromSnapshot({ ...bundle(2), log: [
      row({ list_seq: 1, command_id: 'v1', command_type: 'void', status: 'applied', command: { eventId: 'e1' }, result: { status: 'applied', eventId: 'e1' } }),
      row({ list_seq: 2 }),
    ].map((r, i) => (i === 1 ? { ...r, command_type: 'remove', status: 'applied', command: cmd, result: {} } : r)) });
    expect(s.state.voids.v1).toMatchObject({ eventId: 'e1', by: ALICE });
    expect(Object.keys(s.state.outcomes)).toEqual(['v1', 'x1']);
  });
});

describe('receipts / prices / profile / AI settings mapping', () => {
  it('receiptToRpc: UUID line ids, flattened pack quantity, suggestion vs confirmation', () => {
    const lineId = 'f2000000-0000-4000-8000-000000000001';
    const r = receiptToRpc({
      id: 'f1000000-0000-4000-8000-000000000001', householdId: HH, computedPence: 0, createdAt: at, status: 'needs_review',
      orphanDiscountPence: 0, ignored: [], warnings: [],
      lines: [{ id: lineId, raw: 'X', tokens: [], description: 'x', count: 1, packQuantity: { kind: 'exact', value: 1.23456, unit: 'kg', originalText: '1.2kg' }, discountPence: 0, discountLines: [], match: { classification: 'uncertain', suggestedItemId: ITEM, candidates: [{ shoppingListItemId: ITEM, score: 0.6, reasons: [], flags: [] }] } }],
    });
    expect(r.p_receipt).toMatchObject({ status: 'parsed', reconciledAt: null });
    expect(r.p_lines[0]).toMatchObject({ id: lineId, lineNo: 1, matchStatus: 'suggested', matchedItemId: ITEM, matchScore: 0.6, quantity: { kind: 'exact', value: 1.235, unit: 'kg' } });
  });

  it('price observations: only household kinds go to the DB, a receipt price must name its line', () => {
    const base = { ingredientId: ITEM, pricePence: 10, packQuantity: { kind: 'exact' as const, value: 1, unit: 'kg' as const, originalText: '1kg' }, observedOn: '2026-10-19' };
    expect(receiptLineOf('receipt:r1:l1')).toBe('l1');
    expect(observationToRpc({ ...base, kind: 'receipt', source: 'receipt:r1:l1' })).toMatchObject({ kind: 'receipt', receiptLineId: 'l1' });
    expect(observationToRpc({ ...base, kind: 'receipt', source: 'free text' })).toBeNull();
    expect(observationToRpc({ ...base, kind: 'generic_estimate', source: 'g' })).toBeNull();
    expect(observationToRpc({ ...base, kind: 'user_confirmed', source: 'me' })).toMatchObject({ receiptLineId: null });
  });

  it('the price store reads through household_price_observations and keeps reads synchronous', async () => {
    const { client, calls } = createFakeSupabase(() => ({ data: [{ ingredient_id: ITEM, price_pence: 99, quantity_kind: 'exact', quantity_value: '1', unit: 'kg', original_text: '1kg', kind: 'retailer_verified', observed_on: '2026-10-01', source: 'shop' }] }));
    const store = new SupabasePriceStore([], async () => ({ client, householdId: HH, userId: ALICE }));
    expect(store.observationsFor(HH)).toEqual([]); // not loaded yet: generic only
    await store.refresh(HH);
    expect(rpcs(calls, 'household_price_observations')[0]!.args).toEqual({ p_household_id: HH });
    expect(store.observationsFor(HH)).toMatchObject([{ kind: 'retailer_verified', pricePence: 99 }]);
    await store.refresh(HH); // within the TTL: no second read
    expect(rpcs(calls, 'household_price_observations')).toHaveLength(1);
  });

  it('profile mapping: intolerance is a dietary hard exclusion, avoid is a dislike', () => {
    expect(profileFromJson(HH, { id: HH, members: [], exclusions: [{ name: 'milk', kind: 'intolerance' }, { name: 'olives', kind: 'avoid' }, { name: 'peanuts', kind: 'allergy' }], withheldExclusions: 2 }))
      .toMatchObject({ hardExclusions: [{ ingredientName: 'milk', kind: 'dietary' }, { ingredientName: 'olives', kind: 'dislike' }, { ingredientName: 'peanuts', kind: 'allergy' }], withheldExclusions: 2 });
    expect(profileFromJson(HH, null)).toBeNull();
  });

  it('AI settings backend: owner-only write refusal becomes a SettingsWriteRefused; payload has ciphertext only', async () => {
    const { client, calls } = createFakeSupabase(() => ({ error: { message: 'only the owner', code: '42501' } }));
    const b = new SupabaseSettingsBackend(client, HH);
    const s = { version: 1 as const, provider: 'openai' as const, openai: { baseUrl: 'https://api.openai.com/v1', model: 'm', organization: '' }, azure: { endpoint: '', deployment: '', apiVersion: 'v' }, anthropic: { model: 'a' }, keys: { openai: { enc: 'v1.a.b.c', hint: 'sk-…wxyz' } }, updatedAt: at };
    await expect(b.write(s)).rejects.toBeInstanceOf(SettingsWriteRefused);
    expect(rpcs(calls, 'save_household_ai_settings')[0]!.args).toEqual({
      p_household_id: HH, p_provider: 'openai', p_config: { openai: s.openai, azure: s.azure, anthropic: s.anthropic }, p_keys: s.keys,
    });
    expect(b.aad('openai')).toBe(`ai-key:${HH}:openai`);
  });
});
