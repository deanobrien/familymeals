# e2e specs share one in-memory dev server

Playwright reuses the dev server on 3100 (`reuseExistingServer` when not CI). App data (recipes, plans, pantry) is in-memory per process and the recipe store is shared by library, import, planner and pantry (D30). Run e2e against a freshly started server (a second run fails on already-mutated state) and warm routes first, because cold route compiles can exceed the 5s expect timeout. Specs must not assume they are the only writers to the recipe store (import adds uncosted recipes).
