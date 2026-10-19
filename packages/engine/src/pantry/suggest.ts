import type { Quantity, Uuid } from '../contract';
import { allocate } from './allocate';
import { assessConfidence, daysBetween, fmtQ, isExact, round6, today } from './common';
import type { EngineCtx, PantryItem } from './types';

export interface RecipeSummary {
  id: Uuid; title: string;
  lines: { ingredientId?: Uuid; displayName?: string; quantity: Quantity; optional?: boolean }[];
}
export interface RankOpts {
  /** Stock expiring within this many days counts as urgent. Default 5. */
  urgencyDays?: number;
  /** Weight of coverage vs expiry urgency in the final score (0..1 coverage share). Default 0.7. */
  coverageWeight?: number;
}
export interface RankedRecipe {
  recipeId: Uuid; title: string; score: number; coverage: number; urgency: number;
  covered: string[]; missing: string[]; explanations: string[];
}

/** 1 for expiring today, falling linearly to 0 at `urgencyDays`; 0 with no expiry. Expired stock is never used. */
export function urgencyOf(expiry: string | undefined, now: string, urgencyDays: number): number {
  if (!expiry) return 0;
  const d = daysBetween(today(now), expiry);
  if (d < 0 || d >= urgencyDays) return 0;
  return round6(1 - d / urgencyDays);
}

/**
 * "Use what I have": rank recipes by pantry coverage, boosted by use of soon-to-expire stock.
 * Only confident, non-expired stock counts; stale stock is mentioned but not scored.
 * Deterministic: ties break on recipe title then id.
 */
export function rankRecipesByPantry(
  recipes: readonly RecipeSummary[], pantry: readonly PantryItem[], ctx: EngineCtx, opts: RankOpts = {},
): RankedRecipe[] {
  const urgencyDays = opts.urgencyDays ?? 5;
  const cw = opts.coverageWeight ?? 0.7;
  const byId = new Map(pantry.map((p) => [p.id, p]));
  const ranked = recipes.map((r): RankedRecipe => {
    const lines = r.lines.filter((l) => !l.optional);
    const explanations: string[] = [];
    const covered: string[] = [];
    const missing: string[] = [];
    let covSum = 0;
    let urgSum = 0;
    for (const l of lines) {
      const name = l.displayName ?? l.ingredientId ?? l.quantity.originalText;
      if (!l.ingredientId) { missing.push(name); continue; }
      const stock = pantry.filter((p) => p.ingredientId === l.ingredientId);
      const trusted = stock.filter((p) => assessConfidence(p, ctx.now, ctx.policy).status === 'confident' || (assessConfidence(p, ctx.now, ctx.policy).status === 'approximate'));
      let cov = 0;
      let urg = 0;
      if (isExact(l.quantity)) {
        const res = allocate(pantry, l.ingredientId, l.quantity.value, l.quantity.unit, ctx);
        cov = Math.min(1, (l.quantity.value - res.remaining) / l.quantity.value);
        for (const a of res.allocations) urg = Math.max(urg, urgencyOf(byId.get(a.itemId)?.expiry, ctx.now, urgencyDays));
      } else if (trusted.length) {
        cov = 1; // presence is enough for to-taste / approximate lines
        for (const t of trusted) urg = Math.max(urg, urgencyOf(t.expiry, ctx.now, urgencyDays));
      }
      const staleOnly = cov === 0 && stock.some((p) => assessConfidence(p, ctx.now, ctx.policy).status === 'stale');
      if (cov >= 1) {
        covered.push(name);
        explanations.push(urg > 0 ? `${name}: in pantry and expiring soon` : `${name}: in pantry`);
      } else if (cov > 0) {
        missing.push(name);
        explanations.push(`${name}: partly covered (${Math.round(cov * 100)}% of ${fmtQ(l.quantity)})`);
      } else {
        missing.push(name);
        if (staleOnly) explanations.push(`${name}: pantry stock is stale — please confirm to count it`);
      }
      covSum += cov;
      urgSum += cov * urg;
    }
    const n = lines.length;
    const coverage = n ? round6(covSum / n) : 0;
    const urgency = n ? round6(urgSum / n) : 0;
    const score = n ? round6(cw * coverage + (1 - cw) * urgency) : 0;
    explanations.unshift(n ? `${Math.round(coverage * 100)}% of ingredients covered by pantry` : 'no scoreable ingredients');
    return { recipeId: r.id, title: r.title, score, coverage, urgency, covered, missing, explanations };
  });
  return ranked.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.recipeId.localeCompare(b.recipeId));
}
