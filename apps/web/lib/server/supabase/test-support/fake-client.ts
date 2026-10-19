// TEST SUPPORT: a recording supabase-js double. Every builder call is logged as [method, ...args] and the awaited result is
// whatever the responder returns for that call, so tests can assert the exact query shape the repositories send.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface RecordedCall {
  kind: 'rpc' | 'from';
  /** function name (rpc) or table name (from) */
  name: string;
  /** rpc named arguments */
  args?: Record<string, unknown>;
  /** builder chain in call order, e.g. [['select','*'],['eq','household_id','x']] */
  ops: Array<[string, ...unknown[]]>;
}
export type FakeResult = { data?: unknown; error?: { message: string; code?: string } | null };
export type Responder = (call: RecordedCall) => FakeResult | undefined;

export function createFakeSupabase(respond: Responder = () => ({ data: null })) {
  const calls: RecordedCall[] = [];
  const settle = (call: RecordedCall) => {
    const r = respond(call) ?? { data: null };
    return { data: r.data ?? null, error: r.error ?? null };
  };
  const chain = (call: RecordedCall): unknown =>
    new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === 'then') {
            const res = settle(call);
            return (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(res).then(ok, bad);
          }
          return (...a: unknown[]) => {
            call.ops.push([prop, ...a]);
            return chain(call);
          };
        },
      },
    );
  const client = {
    from: (name: string) => {
      const call: RecordedCall = { kind: 'from', name, ops: [] };
      calls.push(call);
      return chain(call);
    },
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      const call: RecordedCall = { kind: 'rpc', name, args, ops: [] };
      calls.push(call);
      return chain(call);
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}
