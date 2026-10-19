'use client';

import { Badge } from '@fr/ui';
import { allergenLabel, nutritionLines } from '../../../lib/products/labels';
import { PRODUCT_ATTRIBUTION, PRODUCT_ATTRIBUTION_URL, SOURCES_PAGE, type Product } from '../../../lib/products/types';
import s from './scan.module.css';

/** What the product record says, with provenance. Shown on barcode rows in the review. */
export function ProductInfo({ product }: { product: Product }) {
  const a = product.allergens;
  const lines = nutritionLines(product);
  return (
    <div className={s.product} data-testid="product-info">
      <div className={s.productHead}>
        {product.image && (
          // Hotlinked for display only (never stored); licence shown beside it.
          <img src={product.image.url} alt="" width={64} height={64} loading="lazy" referrerPolicy="no-referrer" className={s.productImg} />
        )}
        <div className={s.stack}>
          <strong data-testid="product-name">{product.name}</strong>
          <span className={s.muted}>
            {[product.brand, product.packSizeText, `barcode ${product.barcode}`].filter(Boolean).join(' / ')}
          </span>
        </div>
      </div>

      <div className={s.badges} data-testid="product-allergens">
        {a.status === 'unknown' ? (
          <Badge tone="warning">No allergen information on this record: check the pack</Badge>
        ) : a.contains.length === 0 ? (
          <Badge tone="neutral">No allergens listed (check the pack)</Badge>
        ) : (
          a.contains.map((g) => <Badge key={g} tone="warning">Contains {allergenLabel(g)}</Badge>)
        )}
        {a.traces.map((g) => <Badge key={`t-${g}`} tone="neutral">May contain {allergenLabel(g)}</Badge>)}
      </div>

      {lines.length > 0 ? (
        <details>
          <summary>Nutrition per 100 {product.nutrition.per}</summary>
          <ul className={s.nutrition} data-testid="product-nutrition">
            {lines.map((l) => <li key={l.label}><span>{l.label}</span> <span>{l.text}</span></li>)}
          </ul>
        </details>
      ) : (
        <p className={s.muted}>{product.nutrition.withheldReason ? `Nutrition not used: ${product.nutrition.withheldReason}.` : 'No nutrition on this record.'}</p>
      )}

      <p className={s.muted} data-testid="product-attribution">
        {PRODUCT_ATTRIBUTION}.{' '}
        <a href={product.source.url} target="_blank" rel="noopener noreferrer">This product on Open Food Facts</a>
        {' / '}
        <a href={PRODUCT_ATTRIBUTION_URL} target="_blank" rel="noopener noreferrer">openfoodfacts.org</a>
        {' / '}
        <a href={SOURCES_PAGE}>Data sources</a>
        {product.image && <> {product.image.licenceNote}.</>}
      </p>
    </div>
  );
}
