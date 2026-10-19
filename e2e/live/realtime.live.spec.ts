// Live Supabase Realtime (D143): postgres_changes on shopping_command_log reach members of the household and NOBODY
// else (RLS applied by Realtime, not only the client-side filter).
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { createConfirmedUser, userClient } from './support/live.js';

type Row = Record<string, unknown>;

function listen(c: SupabaseClient, name: string, filter?: string): Promise<{ events: Row[]; channel: RealtimeChannel }> {
  const events: Row[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name}: postgres_changes never became ready`)), 20_000);
    const channel: RealtimeChannel = c
      .channel(`${name}-${randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shopping_command_log', ...(filter ? { filter } : {}) }, (p) => {
        events.push(p.new as Row);
      })
      // SUBSCRIBED only means the channel joined; the server confirms the postgres_changes listener separately.
      .on('system', {}, (msg: { extension?: string; status?: string; message?: string }) => {
        if (msg.extension === 'postgres_changes' && msg.status === 'ok') {
          clearTimeout(timer);
          resolve({ events, channel });
        } else if (msg.extension === 'postgres_changes') {
          clearTimeout(timer);
          reject(new Error(`${name}: ${msg.status} ${msg.message ?? ''}`));
        }
      })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`${name}: ${status} ${err?.message ?? ''}`));
      });
  });
}

test('shopping_command_log events reach the other member, never another household', async () => {
  const a1 = await createConfirmedUser('rt-a1');
  const a2 = await createConfirmedUser('rt-a2');
  const b = await createConfirmedUser('rt-b');
  const c1 = await userClient(a1);
  const c2 = await userClient(a2);
  const cb = await userClient(b);
  const { data: hh } = await c1.from('households').insert({ name: 'RT home' }).select('id').single();
  const hid = hh!.id as string;
  const { data: inv } = await c1.rpc('create_invitation', { p_household_id: hid });
  expect((await c2.rpc('accept_invitation', { p_token: (Array.isArray(inv) ? inv[0] : inv).token })).error).toBeNull();
  await cb.from('households').insert({ name: 'RT other' });

  // The client's own Realtime connection carries the user's JWT (supabase-js sets it on sign-in).
  const member = await listen(c2, 'member', `household_id=eq.${hid}`);
  const memberUnfiltered = await listen(c2, 'member-all');
  // Household B: unfiltered AND deliberately filtered on A's id. RLS must hide both.
  const outsider = await listen(cb, 'outsider-all');
  const snoop = await listen(cb, 'outsider-snoop', `household_id=eq.${hid}`);

  const { data: list } = await c1.from('shopping_lists').insert({ household_id: hid, name: 'Weekly' }).select('id').single();
  const { data: item } = await c1
    .from('shopping_list_items')
    .insert({ shopping_list_id: list!.id, household_id: hid, display_name: 'eggs', quantity_kind: 'exact', quantity_value: 6, unit: 'item', original_text: '6' })
    .select('id')
    .single();
  const tick = await c1.rpc('record_purchase', { p_event_id: randomUUID(), p_item_id: item!.id, p_mode: 'tick' });
  expect(tick.data.status).toBe('applied');

  await expect.poll(() => member.events.length, { timeout: 15_000 }).toBe(1);
  expect(member.events[0]).toMatchObject({ household_id: hid, command_type: 'tick', status: 'applied' });
  expect(Number(member.events[0]!.list_seq)).toBeGreaterThan(0);
  await expect.poll(() => memberUnfiltered.events.length, { timeout: 15_000 }).toBe(1);
  // Give any leak time to arrive before asserting silence.
  await new Promise((r) => setTimeout(r, 3000));
  expect(outsider.events).toHaveLength(0);
  expect(snoop.events).toHaveLength(0);

  // A member who is removed stops receiving events (RLS is evaluated per event).
  const { data: m2 } = await c1.from('household_members').select('id').eq('household_id', hid).eq('user_id', a2.id).single();
  expect((await c1.from('household_members').update({ status: 'revoked' }).eq('id', m2!.id).select('id')).data).toHaveLength(1);
  await c1.rpc('void_purchase', { p_void_id: randomUUID(), p_event_id: tick.data.eventId });
  await new Promise((r) => setTimeout(r, 3000));
  expect(member.events).toHaveLength(1);

  for (const c of [c1, c2, cb]) await c.removeAllChannels();
});
