// A per-request override for the Supabase data context (D213). Kept free of next/headers so route handlers and unit
// tests can import it directly; `sessionDataContext()` consults it before the cookie session.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { DataContext } from './backend';

// One AsyncLocalStorage per PROCESS: Next bundles route handlers and dynamically imported server modules into separate
// chunks, each with its own copy of this module, so a module-level instance would not be shared between them.
const KEY = Symbol.for('fr.supabase.request-data-context');
type Holder = typeof globalThis & { [KEY]?: AsyncLocalStorage<DataContext> };
const store = (): AsyncLocalStorage<DataContext> => ((globalThis as Holder)[KEY] ??= new AsyncLocalStorage<DataContext>());

/** The context installed by `runWithDataContext`, if the current async call chain is inside one. */
export const scopedDataContext = (): DataContext | undefined => store().getStore();

/**
 * Run `fn` with `ctx` as THE data context of everything it awaits. The Android app calls the API with a Bearer token and
 * no cookies; `resolveRequestAuth` has already verified the token and household and built the caller's own client, but the
 * process-wide stores (AI settings, price observations, product snapshots) resolve their context through
 * `sessionDataContext()`, which reads the cookie session and redirected to /sign-in (photo import answered 500).
 * `null` (cookie callers, mock mode) just runs `fn`.
 */
export function runWithDataContext<T>(ctx: DataContext | null | undefined, fn: () => Promise<T>): Promise<T> {
  return ctx ? store().run(ctx, fn) : fn();
}
