Realtime "live" = postgres_changes confirmed, not SUBSCRIBED (RT1, D200-D203, 2026-10-20).

supabase-js reports `SUBSCRIBED` when the channel joins; the server activates the postgres_changes listener a moment
later and says so with a `system` message (`extension: 'postgres_changes'`, `status: 'ok'`). Rows committed in between
reach nobody. `live.ts` therefore stays 'down' (controller keeps polling) until that message, then the controller
catches up from its cursor twice (now, +1.5 s). Never "simplify" back to the SUBSCRIBED status. Heartbeat, online and
tab-visible events reconnect/catch up; token refresh calls `realtime.setAuth`. Test with a fake channel in
`apps/web/lib/shopping/live.test.ts` (FakeChannel.confirm()) and `e2e/live/realtime.live.spec.ts` (20x tick race).
