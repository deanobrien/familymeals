'use client';

// "Where's cheapest for this list?" (P2-B, D402). Per-shop totals for the items each shop has a price for, with coverage
// always shown. Never a quote and never a full-basket claim.
import Link from 'next/link';
import { Badge, Card, CardBody, formatPence } from '@fr/ui';
import type { ListCompareView } from '../../lib/money/types';
import styles from './shopping.module.css';

export function CompareListPanel({ view }: { view: ListCompareView }) {
  return (
    <Card className={styles.compare}>
      <CardBody>
        <details data-testid="compare-panel">
          <summary style={{ cursor: 'pointer', fontWeight: 700, minHeight: 'var(--fr-target)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Where&rsquo;s cheapest for this list? <Badge tone="warning">your prices</Badge>
          </summary>
          {view.shops.length === 0 ? (
            <p className={styles.compareNote} data-testid="compare-empty">{view.note}</p>
          ) : (
            <>
              <table className={`fr-table ${styles.compareTable}`}>
                <caption className="fr-muted">Items with a price at each shop, from your own receipts and prices</caption>
                <thead>
                  <tr><th scope="col">Shop</th><th scope="col">Covers</th><th scope="col">Those items cost</th><th scope="col">How old the prices are</th></tr>
                </thead>
                <tbody>
                  {view.shops.map((s) => (
                    <tr key={s.label} data-testid="compare-row">
                      <th scope="row">{s.label}{!s.linked && <span className="fr-muted"> (not linked to a store)</span>}</th>
                      <td>{s.pricedItems} of {view.totalItems} items ({s.coveragePct}%)</td>
                      <td>{formatPence(s.totalPence)}</td>
                      <td>{s.allRecent ? `up to ${s.oldestText}` : `${s.oldestText}: some prices are old`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {view.likeForLike && (
                <p data-testid="compare-like" style={{ margin: '0.75rem 0 0' }}>
                  <strong>Like for like</strong> ({view.likeForLike.itemNames.length} item{view.likeForLike.itemNames.length === 1 ? '' : 's'} every shop above has priced: {view.likeForLike.itemNames.slice(0, 6).join(', ')}{view.likeForLike.itemNames.length > 6 ? ', …' : ''}):{' '}
                  {view.likeForLike.totals.map((t) => `${t.label} ${formatPence(t.totalPence)}`).join(' · ')}
                  {view.likeForLike.cheapest ? `. Cheapest here: ${view.likeForLike.cheapest}.` : '. No single cheapest.'}
                </p>
              )}
              <p className={styles.compareNote}>{view.note} A shop that covers few items can look cheap; compare the &ldquo;covers&rdquo; column first. <Link href="/spending">Spending</Link></p>
            </>
          )}
        </details>
      </CardBody>
    </Card>
  );
}
