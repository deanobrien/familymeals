Shopping log cursor: use list_seq, never seq (D121, 2026-10-19).

`shopping_command_log.seq` is a global identity: shared by every list and able to commit out of order, so a reader can
see seq 11 before seq 10 commits. The engine cursor must be contiguous per list, so S2 added `list_seq`, assigned by a
trigger through a counter row (`shopping_list_log_heads`) held until commit. Any new log writer must insert through the
normal INSERT path (the trigger) and take the counter last, after list/item locks, or it risks a lock-order cycle with
`record_purchase`. The Android app (D71) still uses `seq` and resnapshots on gaps; moving it to `list_seq` is open (D129).
