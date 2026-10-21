import { getAppContext } from '../../lib/server/context';
import { getSpendingService } from '../../lib/server/money/deps';
import { SpendingClient } from './spending-client';

export const metadata = { title: 'Spending' };
export const dynamic = 'force-dynamic';

const RANGES = [4, 12, 26, 52];

export default async function Page({ searchParams }: { searchParams: Promise<{ weeks?: string | string[] }> }) {
  const sp = await searchParams;
  const raw = Number(Array.isArray(sp.weeks) ? sp.weeks[0] : sp.weeks);
  const weeks = RANGES.includes(raw) ? raw : 12;
  const ctx = await getAppContext();
  const view = await getSpendingService().spending(ctx.householdId, { weeks });
  return (
    <>
      <h1>Spending</h1>
      <SpendingClient view={view} weeks={weeks} ranges={RANGES} readOnly={ctx.readOnly} />
    </>
  );
}
