import Link from 'next/link';
import { Badge, Card, CardBody, EmptyState } from '@fr/ui';
import { formatPence } from '../../lib/receipts/format';
import { listReceipts } from '../../lib/server/receipts/service';
import { shoppingUsesRealtime } from '../../lib/server/shopping/store';
import { UploadForm } from './upload-form';

export const metadata = { title: 'Receipts' };
export const dynamic = 'force-dynamic';

export default async function ReceiptsPage() {
  const receipts = await listReceipts();
  return (
    <>
      <h1>Receipts</h1>
      <p>Scan a till receipt to record what you actually paid and tick off your shopping list.</p>

      <section aria-labelledby="new-receipt">
        <h2 id="new-receipt">New receipt</h2>
        <UploadForm phoneRealtime={shoppingUsesRealtime()} />
      </section>

      <section aria-labelledby="past-receipts" style={{ marginTop: 'var(--fr-space-5, 24px)' }}>
        <h2 id="past-receipts">Past receipts</h2>
        {receipts.length === 0 ? (
          <EmptyState icon="inbox" title="No receipts yet" description="Scanned receipts are kept here for spending reports." />
        ) : (
          <ul aria-label="Past receipts" style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
            {receipts.map((r) => (
              <li key={r.id} data-testid="receipt-row">
                <Card>
                  <CardBody>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <strong>{r.retailer ?? 'Unknown retailer'}</strong>
                        <div>
                          {r.date ?? 'No date'} · {r.lineCount} {r.lineCount === 1 ? 'line' : 'lines'} ·{' '}
                          {r.totalPence !== undefined ? formatPence(r.totalPence) : 'No total'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <Badge tone={r.status === 'reconciled' ? 'success' : 'warning'}>
                          {r.status === 'reconciled' ? 'Reconciled' : 'Needs review'}
                        </Badge>
                        <Link className="fr-btn fr-btn--ghost fr-btn--sm" href={`/receipts/${r.id}/review`}>{r.status === 'reconciled' ? 'View' : 'Review'}</Link>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
