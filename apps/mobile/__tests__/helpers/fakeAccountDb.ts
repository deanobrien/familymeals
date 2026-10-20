import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A recording supabase-js double for the account source: every builder call is logged as [method, ...args] and the awaited result
 * is whatever the responder returns for that call, so tests assert the exact query shape / RPC arguments the app sends. Auth is a
 * set of jest.fn()s over a fixed signed-in user.
 */
export interface Call {
  kind: 'rpc' | 'from';
  name: string;
  args?: Record<string, unknown>;
  ops: Array<[string, ...unknown[]]>;
}
export type Result = { data?: unknown; error?: { message: string; code?: string; status?: number } | null };
export type Responder = (call: Call) => Result | undefined;

export const ME = { id: '00000000-0000-4000-8000-000000000901', email: 'dean@example.com' };

export function fakeAccountDb(respond: Responder = () => ({ data: null }), authOverrides: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const settle = (call: Call) => {
    const r = respond(call) ?? { data: null };
    return { data: r.data ?? null, error: r.error ?? null };
  };
  const chain = (call: Call): unknown =>
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
  const auth = {
    getSession: jest.fn(async () => ({ data: { session: { user: ME, access_token: 'tok' } }, error: null })),
    signUp: jest.fn(async () => ({ data: { session: null, user: { id: 'new' } }, error: null })),
    resend: jest.fn(async () => ({ data: {}, error: null })),
    resetPasswordForEmail: jest.fn(async () => ({ data: {}, error: null })),
    updateUser: jest.fn(async () => ({ data: { user: ME }, error: null })),
    signOut: jest.fn(async () => ({ error: null })),
    ...authOverrides,
  };
  const client = {
    from: (name: string) => {
      const call: Call = { kind: 'from', name, ops: [] };
      calls.push(call);
      return chain(call);
    },
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      const call: Call = { kind: 'rpc', name, args, ops: [] };
      calls.push(call);
      return chain(call);
    },
    auth,
  } as unknown as SupabaseClient;
  return { client, calls, auth };
}

export const rpcs = (calls: Call[], name?: string) => calls.filter((c) => c.kind === 'rpc' && (!name || c.name === name));
export const froms = (calls: Call[], table: string) => calls.filter((c) => c.kind === 'from' && c.name === table);
export const ops = (c: Call, method: string) => c.ops.filter((o) => o[0] === method);
