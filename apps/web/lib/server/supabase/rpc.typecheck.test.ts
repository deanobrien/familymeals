// Compile-time contract for callRpc (D141): names and argument names come from the generated Database types.
// vitest only checks the file loads; `pnpm typecheck` is what fails if an @ts-expect-error stops being an error.
import { describe, expect, it } from 'vitest';
import { callRpc, type SupabaseClient } from './rpc';

declare const client: SupabaseClient;

export function contract() {
  void callRpc<{ total: number }>(client, 'list_recipes', { p_household_id: 'h', p_user_id: 'u', p_query: '' });
  void callRpc(client, 'record_purchase', { p_event_id: 'e', p_item_id: 'i', p_mode: 'tick' });
  // @ts-expect-error unknown SQL function
  void callRpc(client, 'no_such_function', {});
  // @ts-expect-error misspelt argument name
  void callRpc(client, 'get_recipes', { p_household_id: 'h', p_user_id: 'u', p_idz: [] });
  // @ts-expect-error missing required argument
  void callRpc(client, 'void_purchase', { p_void_id: 'v' });
}

describe('callRpc types', () => {
  it('is a function', () => expect(typeof callRpc).toBe('function'));
});
