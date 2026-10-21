import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAppContext } from '../../../../lib/server/context';
import { getPriceService } from '../../../../lib/server/money/deps';
import { PriceHistoryClient } from './price-history-client';

export const metadata = { title: 'Price history' };
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ ingredientId: string }> }) {
  const { ingredientId } = await params;
  const ctx = await getAppContext();
  const view = await getPriceService().history(ctx.householdId, decodeURIComponent(ingredientId).slice(0, 80));
  if (!view) notFound();
  return (
    <>
      <p><Link href="/shopping">Back to the shopping list</Link> · <Link href="/spending">Spending</Link></p>
      <h1>{view.name}: prices by shop</h1>
      <PriceHistoryClient view={view} readOnly={ctx.readOnly} />
    </>
  );
}
