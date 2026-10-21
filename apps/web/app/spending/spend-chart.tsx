'use client';

// Budget vs planned estimate vs actual, per week or month (P2-B, D405). One axis (pounds). Identity never rests on colour
// alone: actual = solid bar, planned estimate = hatched bar (it is an estimate), budget = dashed line with a label, and a
// table of the same numbers sits under the chart. Colours are design-system tokens, so light and dark both work.
import { useId } from 'react';
import { formatPence } from '@fr/ui';
import type { MonthRow, WeekRow } from '../../lib/money/types';
import s from './spending.module.css';

export interface ChartRow {
  key: string;
  label: string;
  short: string;
  budgetPence: number | null;
  plannedPence: number | null;
  plannedPartial: boolean;
  actualPence: number;
  inProgress: boolean;
}

export const weekChartRows = (w: readonly WeekRow[]): ChartRow[] =>
  w.map((x) => ({ key: x.weekStart, label: `Week of ${x.label}`, short: x.weekStart.slice(8) + '/' + x.weekStart.slice(5, 7), budgetPence: x.budgetPence, plannedPence: x.plannedPence, plannedPartial: x.plannedPartial, actualPence: x.actualPence, inProgress: x.inProgress }));

export const monthChartRows = (m: readonly MonthRow[]): ChartRow[] =>
  m.map((x) => ({ key: x.month, label: x.label, short: x.label.split(' ')[0] ?? x.label, budgetPence: x.budgetPence, plannedPence: x.plannedPence, plannedPartial: x.plannedPartial, actualPence: x.actualPence, inProgress: false }));

const W = 640;
const H = 240;
const PAD = { l: 46, r: 12, t: 14, b: 28 };

function niceMax(v: number): number {
  const pounds = Math.max(10, v / 100);
  const mag = 10 ** Math.floor(Math.log10(pounds));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= pounds) return m * mag * 100;
  return pounds * 100;
}

export function SpendChart({ rows, unit }: { rows: readonly ChartRow[]; unit: 'week' | 'month' }) {
  const uid = useId().replace(/:/g, '');
  const hatch = `hatch-${uid}`;
  const top = niceMax(Math.max(0, ...rows.flatMap((r) => [r.actualPence, r.plannedPence ?? 0, r.budgetPence ?? 0])));
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const y = (p: number) => PAD.t + plotH - (p / top) * plotH;
  const band = rows.length ? plotW / rows.length : plotW;
  const barW = Math.max(4, Math.min(22, band * 0.34));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));
  const budget = rows.find((r) => r.budgetPence !== null)?.budgetPence ?? null;
  const labelEvery = rows.length > 14 ? Math.ceil(rows.length / 10) : 1;

  return (
    <figure className={s.chart} data-testid="spend-chart" data-unit={unit}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Spend per ${unit}: actual spend, planned estimate and weekly budget in pounds. The table below has the same numbers.`}>
        <defs>
          <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--fr-surface)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--fr-text-muted)" strokeWidth="2.5" />
          </pattern>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--fr-border)" strokeWidth="1" />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className={s.axis}>£{Math.round(t / 100)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = PAD.l + band * i + band / 2;
          const planned = r.plannedPence;
          return (
            <g key={r.key} data-testid="spend-bar-group">
              <title>{`${r.label}: spent ${formatPence(r.actualPence)}${r.inProgress ? ' so far' : ''}${planned !== null ? `; planned ${r.plannedPartial ? 'at least ' : ''}${formatPence(planned)} (estimate)` : ''}${r.budgetPence !== null ? `; budget ${formatPence(r.budgetPence)}` : ''}`}</title>
              <rect x={cx - band / 2} y={PAD.t} width={band} height={plotH} fill="transparent" />
              {planned !== null && planned > 0 && (
                <rect x={cx - barW - 1} y={y(planned)} width={barW} height={Math.max(1, y(0) - y(planned))} rx="3" fill={`url(#${hatch})`} stroke="var(--fr-text-muted)" strokeWidth="1" />
              )}
              {r.actualPence > 0 && (
                <rect x={cx + 1} y={y(r.actualPence)} width={barW} height={Math.max(1, y(0) - y(r.actualPence))} rx="3" fill="var(--fr-accent)" opacity={r.inProgress ? 0.7 : 1} />
              )}
              {i % labelEvery === 0 && <text x={cx} y={H - 8} textAnchor="middle" className={s.axis}>{r.short}</text>}
            </g>
          );
        })}
        {budget !== null && rows.some((r) => r.budgetPence !== null) && (
          <g>
            {rows.map((r, i) => r.budgetPence === null ? null : (
              <line key={r.key} x1={PAD.l + band * i + 2} x2={PAD.l + band * (i + 1) - 2} y1={y(r.budgetPence)} y2={y(r.budgetPence)} stroke="var(--fr-text)" strokeWidth="2" strokeDasharray="5 3" />
            ))}
          </g>
        )}
      </svg>
      <ul className={s.legend} aria-label="Legend">
        <li><span className={s.swatchActual} aria-hidden="true" />Spent (actual)</li>
        <li><span className={s.swatchPlanned} aria-hidden="true" />Planned (estimate)</li>
        {budget !== null && <li><span className={s.swatchBudget} aria-hidden="true" />{unit === 'week' ? 'Weekly' : 'Monthly'} budget</li>}
      </ul>
      <details className={s.tableView}>
        <summary>View as a table</summary>
        <table className="fr-table">
          <caption className="fr-muted">{unit === 'week' ? 'Per week' : 'Per month'}; planned figures are estimates</caption>
          <thead><tr><th scope="col">{unit === 'week' ? 'Week' : 'Month'}</th><th scope="col">Budget</th><th scope="col">Planned (estimate)</th><th scope="col">Spent</th></tr></thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}{r.inProgress ? ' (so far)' : ''}</th>
                <td>{r.budgetPence === null ? 'Not set' : formatPence(r.budgetPence)}</td>
                <td>{r.plannedPence === null ? 'No plan' : `${r.plannedPartial ? 'At least ' : ''}${formatPence(r.plannedPence)}`}</td>
                <td>{formatPence(r.actualPence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
