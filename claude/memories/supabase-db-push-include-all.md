`supabase db push` needs `--include-all` when a pending migration is older than an applied one.

Hosted Supabase has `20261020002900_store_aisles.sql` applied but `20261020002800_pantry_par_levels.sql` (PR1) was merged later with an older timestamp, so a plain push refuses. Use `pnpm exec supabase db push --include-seed --include-all`. Avoid the situation: give each lane a timestamp block later than everything already applied (next free block 20261022...).
