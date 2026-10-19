import { getPlanPageData } from '../../lib/server/plan/handlers';
import { getAppContext } from '../../lib/server/context';
import { loadPlanServices } from '../../lib/server/plan/services';
import { Planner } from './planner';

export const metadata = { title: 'Meal planner' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const data = await getPlanPageData(await loadPlanServices((await getAppContext()).householdId), week);
  return (
    <>
      <h1>Meal planner</h1>
      <Planner key={`${data.doc.weekStart}-${data.doc.id}`} data={data} />
    </>
  );
}
