'use client';

import { Badge, Tabs } from '@fr/ui';
import type { NutritionResult } from '../../../lib/calc/types';
import { PRODUCT_NUTRITION_LABEL } from '../../../lib/products/types';
import {
  NUTRIENT_DISPLAY,
  nutrientCell,
  printedKey,
} from '../../../lib/calc/format';
import type { NutrientKey, PrintedNutritionView } from '../../../lib/recipes/types';
import styles from '../recipes.module.css';

interface Props {
  nutrition: NutritionResult;
  /** Servings chosen on the page. Ingredients scale with servings, so per-serving values stay put and per-recipe values grow. */
  servings: number;
  printed: PrintedNutritionView | null;
}

function Table({ caption, nutrition, multiplier, printed }: { caption: string; nutrition: NutritionResult; multiplier: number; printed: PrintedNutritionView | null }) {
  const printedBy = new Map<NutrientKey, { amount: number; unit: string; name: string }>();
  const printedExtra: { name: string; amount: number; unit: string }[] = [];
  for (const v of printed?.values ?? []) {
    const key = printedKey(v.nutrient, v.unit);
    if (key && !printedBy.has(key)) printedBy.set(key, { amount: v.amount, unit: v.unit, name: v.nutrient });
    else printedExtra.push({ name: v.nutrient, amount: v.amount, unit: v.unit });
  }
  return (
    <div className="fr-table__wrap">
      <table className="fr-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Nutrient</th>
            <th scope="col" className="fr-num">Calculated</th>
            {printed && <th scope="col" className="fr-num">From the recipe card</th>}
          </tr>
        </thead>
        <tbody>
          {NUTRIENT_DISPLAY.map(({ key, label }) => {
            const c = nutrientCell(nutrition.perServing[key], multiplier);
            const p = printedBy.get(key);
            return (
              <tr key={key}>
                <th scope="row">{label}</th>
                <td className={`fr-num${c.unknown ? ' fr-unknown' : ''}`}>
                  {c.text}
                  {!c.unknown && c.estimate && <> <Badge tone="warning">estimate</Badge></>}
                  {c.note && <small className="fr-muted"> ({c.note})</small>}
                </td>
                {printed && <td className="fr-num">{p ? `${p.amount} ${p.unit}` : '—'}</td>}
              </tr>
            );
          })}
          {printed && printedExtra.map((e) => (
            <tr key={`x-${e.name}`}>
              <th scope="row">{e.name}</th>
              <td className="fr-num fr-unknown">—</td>
              <td className="fr-num">{e.amount} {e.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {printed && (
        <p className="fr-muted" style={{ fontSize: 'var(--fr-text-xs)' }} data-testid="printed-nutrition">
          Recipe card figures are as printed, {printed.basis}{printed.note ? ` (${printed.note})` : ''}. They are source-provided, not calculated by this app, and are not scaled.
        </p>
      )}
    </div>
  );
}

export function NutritionPanel({ nutrition, servings, printed }: Props) {
  const nothing = nutrition.coveragePct === 0;
  return (
    <section className={styles.panel} aria-labelledby="nut-h">
      <h2 id="nut-h">Nutrition</h2>
      {nothing ? (
        <p className="fr-muted" data-testid="nutrition-none">
          Nutrition could not be calculated: no ingredient has usable nutrition data and a known weight.
        </p>
      ) : (
        <>
          <p className="fr-muted" data-testid="nutrition-coverage">
            Based on {Math.round(nutrition.coveragePct)}% of ingredients
            {nutrition.coveragePct < 100 ? '; values that depend on the rest show as Unknown' : ''}.
          </p>
          <Tabs
            label="Nutrition basis"
            items={[
              { value: 'serving', label: 'Per serving', content: <Table caption="Nutrition per serving" nutrition={nutrition} multiplier={1} printed={printed} /> },
              { value: 'recipe', label: 'Per recipe', content: <Table caption={`Nutrition per recipe (${servings} servings)`} nutrition={nutrition} multiplier={servings} printed={null} /> },
            ]}
          />
        </>
      )}
      {nutrition.missing.length > 0 && (
        <details>
          <summary>Ingredients without nutrition data ({nutrition.missing.length})</summary>
          <ul data-testid="nutrition-missing">
            {nutrition.missing.map((m) => <li key={m.name}>{m.name}: {m.reasonLabel}</li>)}
          </ul>
        </details>
      )}
      {nutrition.warnings.length > 0 && (
        <p className="fr-muted" style={{ fontSize: 'var(--fr-text-xs)' }}>{nutrition.warnings.join('; ')}.</p>
      )}
      {nutrition.productSources && nutrition.productSources.length > 0 && (
        <ul className="fr-muted" style={{ fontSize: 'var(--fr-text-xs)' }} data-testid="nutrition-product-sources" aria-label="Nutrition from product labels">
          {nutrition.productSources.map((p) => (
            <li key={p.ingredientId}>
              {p.ingredientName}: {PRODUCT_NUTRITION_LABEL} ({p.productName}, barcode {p.barcode},{' '}
              <a href={p.url} target="_blank" rel="noopener noreferrer">Open Food Facts</a>)
            </li>
          ))}
        </ul>
      )}
      <p className="fr-muted" style={{ fontSize: 'var(--fr-text-xs)' }} data-testid="nutrition-attribution">{nutrition.attribution}</p>
      <p className="fr-muted" style={{ fontSize: 'var(--fr-text-xs)' }}>{nutrition.disclaimer}</p>
    </section>
  );
}
