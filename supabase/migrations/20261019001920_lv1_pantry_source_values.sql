-- PRJ-018 LV1 (DECISIONS D147): the pantry engine writes source 'correction' (Correct / stock check) and 'leftover'
-- (leftovers helper), but public.pantry_source only had manual/purchase/receipt, so replace_pantry_items failed with
-- 22P02 on the first correction against a real database (found live; PGlite tests never corrected an item).
alter type public.pantry_source add value if not exists 'correction';
alter type public.pantry_source add value if not exists 'leftover';
