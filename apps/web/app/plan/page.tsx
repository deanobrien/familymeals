import { getPlanPageData } from '../../lib/server/plan/handlers';
import { getAppContext } from '../../lib/server/context';
import { loadCookedWeek } from '../../lib/server/cooking/service';
import { webCookingCaller } from '../../lib/server/cooking/web-caller';
import { loadPlanServices } from '../../lib/server/plan/services';
import Link from 'next/link';
import { ConsentNotice } from '../consent-notice';
import { Planner } from './planner';

export const metadata = { title: 'Meal planner' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const svc = await loadPlanServices((await getAppContext()).householdId);
  const page = await getPlanPageData(svc, week);
  // Cooked meals this week (P1-A cooking log) turn on the Planned / Cooked toggle in the variety panel.
  const cooked = await loadCookedWeek(await webCookingCaller(), page.doc.weekStart);
  const data = cooked?.length ? { ...page, cooked } : page;
  return (
    <>
      <h1>Meal planner</h1>
      <p><Link href="/kids" data-testid="kids-link">Kids&apos; mode: let the family vote on dinner</Link></p>
      <ConsentNotice withheld={svc.withheldExclusions ?? 0} />
      <Planner key={`${data.doc.weekStart}-${data.doc.id}`} data={data} />
    </>
  );
}
