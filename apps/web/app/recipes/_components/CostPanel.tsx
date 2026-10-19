'use client';

import { Badge, formatPence } from '@fr/ui';
import type { CostResult } from '../../../lib/calc/types';
import { PRICE_KIND_LABEL } from '../../../lib/calc/format';
import styles from '../recipes.module.css';

/** Cost panel for the recipe detail page. `cost` is computed for the recipe's own servings; `factor` scales the total. */
export function CostPanel({ cost, servings, factor }: { cost: CostResult; servings: number; factor: number }) {
  if (cost.totalPence == null || cost.perServingPence == null) {
    return (
      <section className={styles.panel} aria-labelledby="cost-h">
        <h2 id="cost-h">Cost</h2>
        <p className={styles.costBig} data-testid="cost-unknown">Cost unknown</p>
        <p className="fr-muted">No ingredient in this recipe could be priced.</p>
        <UncostedList cost={cost} />
      </section>
    );
  }
  const total = Math.round(cost.totalPence * factor);
  const lead = cost.isPartial ? 'At least ' : '';
  const pricedCount = cost.lines.filter((l) => l.status === 'costed').length;
  const lineCount = cost.lines.filter((l) => l.status !== 'skipped_optional').length;
  return (
    <section className={styles.panel} aria-labelledby="cost-h">
      <h2 id="cost-h">Cost</h2>
      <p className={styles.costBig} data-testid="cost-per-serving">
        {lead}{formatPence(cost.perServingPence)} per serving
      </p>
      <p data-testid="cost-total">
        {lead}{formatPence(total)} for {servings} {servings === 1 ? 'serving' : 'servings'}{' '}
        {cost.kind && <Badge tone={cost.kind === 'generic_estimate' ? 'warning' : 'success'}>{PRICE_KIND_LABEL[cost.kind]}</Badge>}{' '}
        {cost.isPartial && <Badge tone="warning">partial</Badge>}
      </p>
      <p className="fr-muted" data-testid="cost-coverage">
        {pricedCount} of {lineCount} ingredients priced ({Math.round(cost.coveragePct)}%).
        {cost.isPartial ? ' Unpriced ingredients are not included, so the real cost is higher.' : ''}
      </p>
      {cost.sources.map((s) => (
        <p key={`${s.kind}-${s.source}`} className="fr-muted" data-testid="cost-source">
          {PRICE_KIND_LABEL[s.kind]}: {s.source} (as of {s.observedOn})
        </p>
      ))}
      <UncostedList cost={cost} />
      {cost.lines.some((l) => l.basis === 'range_max') && (
        <p className="fr-muted">Amounts given as a range are priced at the top of the range.</p>
      )}
    </section>
  );
}

function UncostedList({ cost }: { cost: CostResult }) {
  if (cost.uncosted.length === 0) return null;
  return (
    <div data-testid="uncosted-lines">
      <p><strong>Not priced ({cost.uncosted.length})</strong></p>
      <ul aria-label="Ingredients not priced">
        {cost.uncosted.map((l) => (
          <li key={l.lineId}>{l.name}: {l.reasonLabel}</li>
        ))}
      </ul>
    </div>
  );
}
