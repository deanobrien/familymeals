'use client';

import { Badge } from '@fr/ui';
import { NUTRIENT_DISPLAY, nutrientCell } from '../../lib/calc/format';
import type { WeekNutrition } from '../../lib/plan/nutrition';

/** Weekly nutrition summary: totals and averages of estimated values. Descriptive only, no adequacy claims. */
export function WeekNutritionPanel({ data }: { data: WeekNutrition | null }) {
  if (!data) return null;
  const { summary } = data;
  const cell = (n: Parameters<typeof nutrientCell>[0]) => {
    const c = nutrientCell(n);
    return (
      <td className={`fr-num${c.unknown ? ' fr-unknown' : ''}`}>
        {c.text}
        {!c.unknown && c.estimate && <> <Badge tone="warning">estimate</Badge></>}
        {c.note && <small className="fr-muted"> ({c.note})</small>}
      </td>
    );
  };
  return (
    <section className="plan__nutrition" aria-labelledby="week-nut-h" data-testid="week-nutrition">
      <h2 id="week-nut-h">Nutrition this week</h2>
      <p className="plan__muted">
        {data.meals} planned recipe {data.meals === 1 ? 'meal' : 'meals'} over {summary.dayCount} {summary.dayCount === 1 ? 'day' : 'days'};
        {' '}{summary.totalServings} {summary.totalServings === 1 ? 'serving' : 'servings'} in total.
        {data.mealsWithoutNutrition > 0 && ` ${data.mealsWithoutNutrition} ${data.mealsWithoutNutrition === 1 ? 'meal has' : 'meals have'} no nutrition data, so totals are incomplete.`}
      </p>
      <div className="fr-table__wrap">
        <table className="fr-table">
          <caption>Estimated nutrition for the planned week</caption>
          <thead>
            <tr>
              <th scope="col">Nutrient</th>
              <th scope="col" className="fr-num">Week total</th>
              <th scope="col" className="fr-num">Average per planned day</th>
              <th scope="col" className="fr-num">Average per serving</th>
            </tr>
          </thead>
          <tbody>
            {NUTRIENT_DISPLAY.map(({ key, label }) => (
              <tr key={key}>
                <th scope="row">{label}</th>
                {cell(summary.totals[key])}
                {cell(summary.perDayAverage[key])}
                {cell(summary.perServingAverage[key])}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="plan__muted" data-testid="week-nutrition-disclaimer">{summary.disclaimer}</p>
      <p className="plan__muted">Unknown means we do not have data, not that the amount is zero. Estimated from UK CoFID data.</p>
    </section>
  );
}
