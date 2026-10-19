import type { Pence } from '../contract';

/**
 * Rounding policy: HALF-UP (0.5 rounds up for non-negatives), applied once per costed line /
 * pack line, never to running totals, so breakdowns always sum exactly to the total.
 * Why not banker's rounding: users compare against receipts and shop tills, which round half-up;
 * banker's only reduces aggregate bias over huge samples, irrelevant at household scale, and is
 * surprising per line (2.5p -> 2p). A 1e-9 guard absorbs float noise (e.g. 1.005 * 100).
 * `roundBankers` is exported for callers that explicitly want it.
 */
export function roundHalfUp(x: number): Pence {
  return Math.floor(x + 0.5 + 1e-9);
}

export function roundBankers(x: number): Pence {
  const f = Math.floor(x);
  if (Math.abs(x - f - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}
