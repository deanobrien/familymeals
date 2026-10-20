import { getPlanPageData } from '../../lib/server/plan/handlers';
import { getAppContext } from '../../lib/server/context';
import { loadPlanServices } from '../../lib/server/plan/services';
import { ConsentNotice } from '../consent-notice';
import { Planner } from './planner';

export const metadata = { title: 'Meal planner' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const svc = await loadPlanServices((await getAppContext()).householdId);
  const data = await getPlanPageData(svc, week);
  return (
    <>
      <h1>Meal planner</h1>
      <ConsentNotice withheld={svc.withheldExclusions ?? 0} />
      <Planner key={`${data.doc.weekStart}-${data.doc.id}`} data={data} />
    </>
  );
}
