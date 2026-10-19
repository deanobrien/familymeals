import { getAppContext } from '../../lib/server/context';
import { getPlanStore } from '../../lib/server/plan/repository';
import { buildPriceBook } from '../../lib/server/shopping/price-book';
import { getShoppingRepository } from '../../lib/server/shopping/repository';
import { ShoppingClient } from './shopping-client';

export const metadata = { title: 'Shopping list' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ plan?: string | string[] }> }) {
  const sp = await searchParams;
  const plan = Array.isArray(sp.plan) ? sp.plan[0] : sp.plan;
  const ctx = await getAppContext();
  const initial = await getShoppingRepository().snapshot(ctx.householdId);
  const latestApproved = (await getPlanStore().list(ctx.householdId)).find((d) => d.status === 'approved');
  return (
    <>
      <h1>Shopping list</h1>
      <ShoppingClient
        initial={initial}
        actorId={ctx.userId}
        prices={buildPriceBook(ctx.householdId)}
        {...(latestApproved ? { approvedPlanId: latestApproved.id } : {})}
        {...(plan ? { planId: plan } : {})}
      />
    </>
  );
}
