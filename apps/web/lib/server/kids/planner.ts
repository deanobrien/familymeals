// The planner's view of kids' rounds (P3-A, D428): the orchestrator's `votes` dependency.
import 'server-only';
import { contextClient } from '../calendar/planner';
import { votePreference } from './service';

/** Liked recipes from closed rounds overlapping the plan's dates (best first), resolved inside the verified data context. */
export async function resolveVotes(householdId: string, _weekStart: string, dates: string[]): Promise<string[]> {
  return votePreference({ householdId, client: await contextClient() }, dates);
}
