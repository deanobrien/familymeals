import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@fr/ui';
import { formatPence } from '../../../../lib/receipts/format';
import { getReview } from '../../../../lib/server/receipts/service';
import { ReviewForm } from './review-form';
import { RetailerStoreLink } from './retailer-store-link';
import { getAppContext } from '../../../../lib/server/context';
import { getSpendingService } from '../../../../lib/server/money/deps';

export const metadata = { title: 'Review receipt' };
export const dynamic = 'force-dynamic';

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await getReview(id);
  if (!found) notFound();
  const { review, reconciliation, photoUrl } = found;
  const ctx = await getAppContext();
  const retailerStatus = review.retailer ? await getSpendingService().retailerStatus(ctx.householdId, review.retailer).catch(() => null) : null;

  return (
    <>
      <p><Link href="/receipts">&larr; All receipts</Link></p>
      <h1>Review receipt</h1>
      <p>
        <strong>{review.retailer ?? 'Unknown retailer'}</strong> · {review.date ?? 'No date'} ·{' '}
        {review.totalPence !== undefined ? `Total ${formatPence(review.totalPence)}` : 'No total read'}{' '}
        <Badge tone={review.status === 'reconciled' ? 'success' : 'warning'}>
          {review.status === 'reconciled' ? 'Reconciled' : 'Needs review'}
        </Badge>
      </p>

      {review.retailer && retailerStatus && (
        <RetailerStoreLink retailer={review.retailer} linked={retailerStatus.linked} suggestion={retailerStatus.suggestion} stores={retailerStatus.stores} readOnly={ctx.readOnly} />
      )}

      {photoUrl && (
        <p>
          <a href={photoUrl} target="_blank" rel="noopener noreferrer" data-testid="receipt-photo-link">View the receipt photo</a>
          {' '}(kept privately; deleted 90 days after you confirm the receipt)
        </p>
      )}

      {review.status === 'reconciled' ? (
        <section aria-labelledby="done-heading">
          <h2 id="done-heading">Reconciled</h2>
          <p role="status">
            {reconciliation?.purchaseEventIds.length ?? 0} purchase(s) recorded. Items you did not confirm stay on your
            shopping list. This receipt is kept as history.
          </p>
          <ul>
            {review.lines.map((l) => {
              const d = reconciliation?.decisions.find((x) => x.lineId === l.lineId);
              return (
                <li key={l.lineId} data-testid="receipt-line">
                  {l.raw}{l.netPence !== undefined ? ` (${formatPence(l.netPence)})` : ''} &rarr;{' '}
                  {d?.outcome === 'purchase'
                    ? `bought: ${d.itemName ?? 'list item'}`
                    : d?.outcome === 'extra'
                      ? `extra${d.addToPantry ? ' (added to pantry)' : ''}`
                      : 'not matched'}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <ReviewForm model={review} />
      )}
    </>
  );
}
