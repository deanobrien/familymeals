import { apiError, bodyHousehold, guarded, isRecord, json, queryHousehold, readJson } from '../../../lib/server/api/bearer-route';
import { kidsCallerOf, respondKids } from '../../../lib/server/kids/callers';
import { addKid, castVote, closeRound, loadKids, openRound, removeKid, roundSeeds } from '../../../lib/server/kids/service';
import { loadPlanServices } from '../../../lib/server/plan/services';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET ?householdId=&week=YYYY-MM-DD -> { kids: { kids, rounds, me }, seeds: { planned } }
 * the kid profiles, open rounds first then recent closed ones with their tallies, and (for the plan week) the recipes already
 * planned, as ready-made candidates for a new round.
 */
export async function GET(req: Request) {
  return guarded(req, queryHousehold(req), {}, async (auth) => {
    const caller = kidsCallerOf(auth);
    const r = await loadKids(caller);
    if (!r.ok) return respondKids(r);
    const svc = await loadPlanServices(auth.householdId);
    return json({ kids: r.kids, seeds: await roundSeeds(caller, svc.plans, new URL(req.url).searchParams.get('week') ?? undefined) });
  });
}

/**
 * POST { householdId?, action, ... }
 *   addKid     { displayName, avatar, colour }                          a named profile with no login (name, emoji, colour only)
 *   removeKid  { kidId }
 *   openRound  { recipeIds (3-6), forDate?, days? (1-7), title?, closesAt? }
 *   closeRound { roundId }
 *   vote       { roundId, recipeId, kidId?, value: 'up' | 'heart' | null }   kidId = a kid profile voting on this device; value null takes it back
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), { write: true }, async (auth) => {
    if (!isRecord(body)) return apiError(400, 'BAD_REQUEST', 'Send a JSON object.');
    const caller = kidsCallerOf(auth);
    switch (body.action) {
      case 'addKid': return respondKids(await addKid(caller, body));
      case 'removeKid': return respondKids(await removeKid(caller, body.kidId));
      case 'openRound': return respondKids(await openRound(caller, body));
      case 'closeRound': return respondKids(await closeRound(caller, body.roundId));
      case 'vote': return respondKids(await castVote(caller, body));
      default: return apiError(400, 'BAD_REQUEST', 'Unknown action.');
    }
  });
}
