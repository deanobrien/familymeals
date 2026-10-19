apps/web/.data holds the OWNER's encrypted AI key: tests and agents must never read or write it.

Dev AI provider settings (ai-settings.json) and the dev encryption secret (app-secret) live in `apps/web/.data/` (untracked). Run e2e and any scripted run with `APP_DATA_DIR=<temp>` and `NEXT_DIST_DIR=.next-e2e` on a fresh port so the owner's key is never used or overwritten; tests use the mock provider. Never print or copy that folder. Deleting app-secret makes stored keys unreadable (re-enter them in Settings).
