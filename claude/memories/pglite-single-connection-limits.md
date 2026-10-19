PGlite tests are single-connection: they cannot prove concurrency, lock order or Realtime.

`packages/db` and the `*.pglite.test.ts` contract tests run every migration on in-process Postgres, which is excellent for RLS and RPC semantics but serialises everything. Per-list `list_seq` ordering, FOR UPDATE / FOR SHARE lock-order cycles, the commit-order cursor and Realtime delivery are only really verified on a live Supabase (D128; lane LV1).
