'use client';

import { Badge, Button, Checkbox, IconButton } from '@fr/ui';
import { formatPence } from '@fr/ui';
import type { ItemView } from '../../lib/shopping/engine';
import { formatAmount, formatQuantity } from '../../lib/shopping/format';
import { PRICE_KIND_LABEL, type ItemCost } from '../../lib/shopping/prices';
import type { ListMeta } from '../../lib/shopping/types';
import { Popover } from './popover';
import styles from './shopping.module.css';

export function quantityLabel(v: ItemView): string {
  if (!v.quantified) return v.item.requirement?.quantity.originalText ?? formatQuantity(v.item.manualQuantity);
  const left = formatAmount(v.outstanding, v.unit);
  if (v.status === 'partial') return `${left} left`;
  if (v.status === 'complete' || v.status === 'over_purchased') return formatAmount(v.purchased, v.unit);
  return left;
}

export function partialLabel(v: ItemView): string | undefined {
  if (v.status !== 'partial' || !v.quantified) return undefined;
  return `${formatAmount(v.purchased, v.unit)} of ${formatAmount(v.required, v.unit)} bought`;
}

/** Provenance: which recipes contributed to the plan requirement (plus any manual quantity). */
function Provenance({ view, meta }: { view: ItemView; meta: ListMeta }) {
  const req = view.item.requirement;
  const byRecipe = new Map<string, string[]>();
  for (const c of req?.contributions ?? []) {
    const arr = byRecipe.get(c.recipeId) ?? [];
    arr.push(formatQuantity(c.quantity));
    byRecipe.set(c.recipeId, arr);
  }
  return (
    <Popover label={`From plan: where ${view.item.displayName} comes from`} trigger="From plan">
      <h4>{view.item.displayName} is needed for</h4>
      <ul>
        {[...byRecipe.entries()].map(([recipeId, qtys]) => (
          <li key={recipeId}>
            <strong>{meta.recipeTitles[recipeId] ?? 'A planned recipe'}</strong> - {qtys.join(' + ')}
          </li>
        ))}
        {byRecipe.size === 0 && <li>The plan no longer needs this.</li>}
        {view.item.manualQuantity && view.item.planLinked && (
          <li>Added by hand - {formatQuantity(view.item.manualQuantity)}</li>
        )}
      </ul>
    </Popover>
  );
}

export interface ItemRowProps {
  view: ItemView;
  meta: ListMeta;
  pending: boolean;
  cost?: ItemCost | undefined;
  onTick: (v: ItemView) => void;
  onUntick: (v: ItemView) => void;
  onPartial: (v: ItemView) => void;
  onEdit: (v: ItemView) => void;
}

export function ItemRow({ view, meta, pending, cost, onTick, onUntick, onPartial, onEdit }: ItemRowProps) {
  const done = view.status === 'complete' || view.status === 'over_purchased';
  const name = view.item.displayName;
  const part = partialLabel(view);
  const extra = view.unresolvedRequired.filter((q) => q.kind !== 'to_taste' && q.kind !== 'unparsed');
  return (
    <li className={styles.row} data-complete={done} data-testid={`item-${view.item.id}`} data-item-name={name} data-status={view.status}>
      <div className={styles.rowMain}>
        <Checkbox
          large
          checked={done}
          onChange={(e) => (e.target.checked ? onTick(view) : onUntick(view))}
          label={
            <span className={styles.text}>
              <span className={styles.name}>{name}</span>
              <span className={styles.qty}>{[quantityLabel(view), part].filter(Boolean).join(' · ')}</span>
              {extra.length > 0 && <span className={styles.qty}>+ {extra.map(formatQuantity).join(', ')} not combined</span>}
              {view.item.notes && <span className={styles.note}>{view.item.notes}</span>}
            </span>
          }
        />
        <div className={styles.meta}>
          {view.item.planLinked && view.item.requirement ? <Provenance view={view} meta={meta} /> : <Badge>Added by hand</Badge>}
          {cost && (
            <span className={styles.cost} title={`Estimate: ${PRICE_KIND_LABEL[cost.kind]}`}>
              ~{formatPence(cost.pence)} est.
            </span>
          )}
          {pending && <Badge tone="warning" data-testid="pending-badge">Pending sync</Badge>}
        </div>
      </div>
      <div className={styles.actions}>
        {!done && view.quantified && (
          <IconButton label={`Bought some ${name}`} icon="plus" variant="secondary" onClick={() => onPartial(view)} />
        )}
        <Button size="sm" variant="ghost" aria-label={`Edit ${name}`} onClick={() => onEdit(view)}>Edit</Button>
      </div>
    </li>
  );
}
