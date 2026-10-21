import { getAppContext } from '../../lib/server/context';
import { getMealPlanStore } from '../../lib/server/plan/repository';
import { loadPriceBook } from '../../lib/server/shopping/price-book';
import { getShoppingStore, shoppingUsesRealtime } from '../../lib/server/shopping/store';
import { getRestockService } from '../../lib/server/restock/deps';
import { getStoreBook } from '../../lib/server/stores/store';
import { getStoreLocations } from '../../lib/server/stores/location-store';
import { RestockBanner } from '../restock-banner';
import { ShoppingClient } from './shopping-client';

export const metadata = { title: 'Shopping list' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ plan?: string | string[] }> }) {
  const sp = await searchParams;
  const plan = Array.isArray(sp.plan) ? sp.plan[0] : sp.plan;
  const ctx = await getAppContext();
  const store = getShoppingStore();
  const initial = await store.snapshot(ctx.householdId);
  const lists = await store.listLists(ctx.householdId);
  const storeBook = await getStoreBook().book(ctx.householdId);
  const restockBanner = await getRestockService(ctx.householdId).getBanner(ctx.householdId).catch(() => null);
  const latestApproved = (await getMealPlanStore().list(ctx.householdId)).find((d) => d.status === 'approved');
  return (
    <>
      <h1>Shopping list</h1>
      <RestockBanner initial={restockBanner} />
      <ShoppingClient
        // A different list (switched, or started by a scan) is a fresh client: new controller, cursor and pending state.
        key={initial.meta.listId ?? 'none'}
        initial={initial}
        lists={lists}
        actorId={ctx.userId}
        storeBook={storeBook}
        storeLocations={await getStoreLocations().list(ctx.householdId).catch(() => [])}
        householdId={ctx.householdId}
        prices={await loadPriceBook(ctx.householdId)}
        {...(shoppingUsesRealtime() ? { realtimeHouseholdId: ctx.householdId } : {})}
        {...(latestApproved ? { approvedPlanId: latestApproved.id } : {})}
        {...(plan ? { planId: plan } : {})}
      />
    </>
  );
}
