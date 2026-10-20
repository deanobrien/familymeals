import type { CookSwap } from '@fr/engine/cooking';

/**
 * "Cook with this swap" from the recipe screen to cook mode. Held in memory (not in the route), so a crafted deep link
 * cannot put an arbitrary substitute into a cook session: only a swap the server suggested and the user tapped gets here.
 */
let pending: CookSwap[] = [];

export function setPendingSwaps(swaps: CookSwap[]): void {
  pending = swaps;
}

export function takePendingSwaps(): CookSwap[] {
  const out = pending;
  pending = [];
  return out;
}
