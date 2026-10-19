/**
 * Deterministic hashing for tie-breaks. No Math.random anywhere in the planner:
 * the same (constraints, library, seed) always yields the same plan.
 */

/** FNV-1a 32-bit hash. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable pseudo-random rank for an item within a (seed, restart) stream. */
export function tieRank(seed: number, restart: number, id: string): number {
  // Final avalanche (murmur3 fmix32) so small input changes spread across the range.
  let h = fnv1a(`${seed}:${restart}:${id}`);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
