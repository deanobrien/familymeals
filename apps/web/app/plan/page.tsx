import { getPlanPageData } from '../../lib/server/plan/handlers';
import { getAppContext } from '../../lib/server/context';
import { loadCookedWeek } from '../../lib/server/cooking/service';
import { webCookingCaller } from '../../lib/server/cooking/web-caller';
import { loadGoals } from '../../lib/server/goals/service';
import { loadPlanServices } from '../../lib/server/plan/services';
import { ConsentNotice } from '../consent-notice';
import { Planner } from './planner';

export const metadata = { title: 'Meal planner' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const svc = await loadPlanServices((await getAppContext()).householdId);
  const page = await getPlanPageData(svc, week);
  // Cooked meals this week (P1-A cooking log) turn on the Planned / Cooked toggle in the variety panel.
  const caller = await webCookingCaller();
  const cooked = await loadCookedWeek(caller, page.doc.weekStart);
  const data = cooked?.length ? { ...page, cooked } : page;
  // P3-B (D433): the signed-in person's OWN goals, only with their consent and at least one goal; otherwise nothing is passed.
  const mine = await loadGoals(caller);
  const myGoals = mine.ok && mine.state.consentActive && mine.state.goals.length > 0 ? { goals: mine.state.goals, portionShare: mine.state.portionShare } : null;
  return (
    <>
      <h1>Meal planner</h1>
      <ConsentNotice withheld={svc.withheldExclusions ?? 0} />
      <Planner key={`${data.doc.weekStart}-${data.doc.id}`} data={data} myGoals={myGoals} />
    </>
  );
}
