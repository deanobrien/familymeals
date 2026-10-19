import { getShoppingRepository } from '../../lib/server/shopping/repository';
import { currentHouseholdId } from '../../lib/server/shopping/session';
import { ShoppingClient } from './shopping-client';

export const metadata = { title: 'Shopping list' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ plan?: string | string[] }> }) {
  const sp = await searchParams;
  const plan = Array.isArray(sp.plan) ? sp.plan[0] : sp.plan;
  const initial = await getShoppingRepository().snapshot(await currentHouseholdId());
  return (
    <>
      <h1>Shopping list</h1>
      <ShoppingClient initial={initial} {...(plan ? { planId: plan } : {})} />
    </>
  );
}
