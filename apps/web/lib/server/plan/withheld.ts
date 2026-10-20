import 'server-only';
import { getAppContext } from '../context';
import { loadPlanServices } from './services';

/** Allergy exclusions of this household withheld for lack of the recorder's consent (a count only, D125/D129). */
export async function getWithheldExclusionCount(): Promise<number> {
  return (await loadPlanServices((await getAppContext()).householdId)).withheldExclusions ?? 0;
}
