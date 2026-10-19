import { prepareProblem, type Problem } from './problem';
import { buildEvaluation, type PlanEvaluation } from './report';
import { tieRank } from './rng';
import type { PlanConstraints, PlanConstraintsInput, PlannerOptions, RecipeCandidateInput } from './schemas';
import { score, type Assignment } from './score';

const EPS = 1e-9;

export interface PlanProposal extends PlanEvaluation {
  constraints: PlanConstraints;
  seed: number;
  score: number;
}

/**
 * Deterministic solver.
 *  1. Hard filter (prepareProblem): exclusions/allergens/unverifiable recipes are removed from
 *     every slot's candidate list. Nothing downstream can re-introduce them, so a slot with no
 *     eligible recipe is left EMPTY rather than violating a hard constraint.
 *  2. Soft optimisation: greedy construction (most-constrained slot first) followed by
 *     best-improvement local search over "replace one slot" and "swap two slots" moves, minimising
 *     the weighted penalty in score.ts. Repeated for `restarts` seeded candidate orders; the best
 *     plan wins (ties -> earliest restart). Ties within a step go to the first move in a
 *     seed-derived order, so the same seed always gives the same plan.
 */
export function solvePlan(
  constraints: PlanConstraintsInput,
  library: RecipeCandidateInput[],
  options: PlannerOptions = {},
): PlanProposal {
  const p = prepareProblem(constraints, library, options);
  const seed = options.seed ?? 1;
  const restarts = Math.max(1, options.restarts ?? 4);
  const maxIterations = options.maxIterations ?? 500;

  let best: { a: Assignment; s: number } | null = null;
  for (let r = 0; r < restarts; r++) {
    const rank = p.candidates.map((c) => tieRank(seed, r, c.id));
    const order = (list: number[]): number[] =>
      [...list].sort((x, y) => rank[x]! - rank[y]! || x - y);
    const ordered = p.slots.map((s) => order(s.eligible));
    const a = construct(p, ordered);
    localSearch(p, a, ordered, maxIterations);
    const s = score(p, a).total;
    if (!best || s < best.s - EPS) best = { a, s };
  }
  const evaluation = buildEvaluation(p, best!.a);
  return { ...evaluation, constraints: p.constraints, seed, score: best!.s };
}

function construct(p: Problem, ordered: number[][]): Assignment {
  const a: Assignment = new Array(p.slots.length).fill(null);
  const uses = new Map<number, number>();
  const never = p.constraints.repeats === 'never';
  for (const s of p.slots) {
    if (s.lockedCandidate !== undefined && !s.skipReason) {
      a[s.index] = s.lockedCandidate;
      uses.set(s.lockedCandidate, (uses.get(s.lockedCandidate) ?? 0) + 1);
    }
  }
  const free = p.plannable
    .filter((i) => p.slots[i]!.lockedCandidate === undefined)
    .sort((x, y) => p.slots[x]!.eligible.length - p.slots[y]!.eligible.length || x - y);
  for (const si of free) {
    let bestCi: number | null = null;
    let bestScore = Infinity;
    for (const ci of ordered[si]!) {
      if (never && (uses.get(ci) ?? 0) > 0) continue;
      a[si] = ci;
      const v = score(p, a).total;
      if (v < bestScore - EPS) {
        bestScore = v;
        bestCi = ci;
      }
    }
    a[si] = bestCi;
    if (bestCi !== null) uses.set(bestCi, (uses.get(bestCi) ?? 0) + 1);
  }
  return a;
}

function localSearch(p: Problem, a: Assignment, ordered: number[][], maxIterations: number): void {
  const never = p.constraints.repeats === 'never';
  const free = p.plannable.filter((i) => p.slots[i]!.lockedCandidate === undefined);
  const uses = new Map<number, number>();
  for (const s of p.plannable) {
    const ci = a[s];
    if (ci !== null && ci !== undefined) uses.set(ci, (uses.get(ci) ?? 0) + 1);
  }
  for (let iter = 0; iter < maxIterations; iter++) {
    let bestVal = score(p, a).total;
    let move: { kind: 'set'; s: number; ci: number } | { kind: 'swap'; i: number; j: number } | null = null;

    for (const s of free) {
      const old = a[s] ?? null;
      for (const ci of ordered[s]!) {
        if (ci === old) continue;
        if (never && (uses.get(ci) ?? 0) > 0) continue;
        a[s] = ci;
        const v = score(p, a).total;
        if (v < bestVal - EPS) {
          bestVal = v;
          move = { kind: 'set', s, ci };
        }
      }
      a[s] = old;
    }
    for (let x = 0; x < free.length; x++) {
      const i = free[x]!;
      for (let y = x + 1; y < free.length; y++) {
        const j = free[y]!;
        const ai = a[i] ?? null;
        const aj = a[j] ?? null;
        if (ai === aj) continue;
        if (aj !== null && !p.slots[i]!.eligibleSet.has(aj)) continue;
        if (ai !== null && !p.slots[j]!.eligibleSet.has(ai)) continue;
        a[i] = aj;
        a[j] = ai;
        const v = score(p, a).total;
        if (v < bestVal - EPS) {
          bestVal = v;
          move = { kind: 'swap', i, j };
        }
        a[i] = ai;
        a[j] = aj;
      }
    }
    if (!move) return;
    if (move.kind === 'set') {
      const old = a[move.s];
      if (old !== null && old !== undefined) uses.set(old, (uses.get(old) ?? 1) - 1);
      a[move.s] = move.ci;
      uses.set(move.ci, (uses.get(move.ci) ?? 0) + 1);
    } else {
      const t = a[move.i] ?? null;
      a[move.i] = a[move.j] ?? null;
      a[move.j] = t;
    }
  }
}
