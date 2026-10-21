import React from 'react';
import { View } from 'react-native';
import type { MonthRow, WeekRow } from '@/lib/moneyApi';
import { gbp } from '@/lib/moneyApi';
import { Muted, Text, useTheme } from '../ui';

export interface BarRow {
  key: string;
  label: string;
  budgetPence: number | null;
  plannedPence: number | null;
  plannedPartial: boolean;
  actualPence: number;
  inProgress: boolean;
}

export const weekBars = (w: readonly WeekRow[]): BarRow[] =>
  [...w].reverse().map((x) => ({ key: x.weekStart, label: x.label, budgetPence: x.budgetPence, plannedPence: x.plannedPence, plannedPartial: x.plannedPartial, actualPence: x.actualPence, inProgress: x.inProgress }));
export const monthBars = (m: readonly MonthRow[]): BarRow[] =>
  [...m].reverse().map((x) => ({ key: x.month, label: x.label, budgetPence: x.budgetPence, plannedPence: x.plannedPence, plannedPartial: x.plannedPartial, actualPence: x.actualPence, inProgress: false }));

/**
 * Budget vs planned estimate vs spent, one row per week or month (newest first), on one pounds scale. Identity is never
 * colour alone: spent = solid bar, planned estimate = outlined bar with "(estimate)" in the text, budget = a vertical tick,
 * and every row also says its numbers in words (the accessibility label carries the same sentence).
 */
export function SpendChart({ rows }: { rows: readonly BarRow[] }) {
  const t = useTheme();
  const max = Math.max(1, ...rows.flatMap((r) => [r.actualPence, r.plannedPence ?? 0, r.budgetPence ?? 0]));
  return (
    <View testID="spend-chart" accessibilityRole="list">
      {rows.map((r) => {
        const sentence = `${r.label}${r.inProgress ? ' so far' : ''}: spent ${gbp(r.actualPence)}${r.plannedPence !== null ? `, planned ${r.plannedPartial ? 'at least ' : ''}${gbp(r.plannedPence)} estimate` : ''}${r.budgetPence !== null ? `, budget ${gbp(r.budgetPence)}` : ''}`;
        return (
          <View key={r.key} accessible accessibilityLabel={sentence} style={{ marginVertical: 6 }} testID="spend-bar-row">
            <Text style={{ fontWeight: '600' }}>{r.label}{r.inProgress ? ' (this week)' : ''}</Text>
            <View style={{ height: 22, justifyContent: 'center', marginVertical: 3 }}>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: t.surface }} />
              {r.plannedPence !== null && (
                <View style={{ position: 'absolute', left: 0, top: 1, height: 8, width: `${Math.max(1, (r.plannedPence / max) * 100)}%`, borderWidth: 1, borderStyle: 'dashed', borderColor: t.muted, borderRadius: 4 }} />
              )}
              <View style={{ position: 'absolute', left: 0, top: 11, height: 8, width: `${Math.max(r.actualPence > 0 ? 1 : 0, (r.actualPence / max) * 100)}%`, backgroundColor: t.primary, borderRadius: 4, opacity: r.inProgress ? 0.75 : 1 }} />
              {r.budgetPence !== null && <View style={{ position: 'absolute', left: `${Math.min(100, (r.budgetPence / max) * 100)}%`, top: 0, width: 2, height: 22, backgroundColor: t.text }} />}
            </View>
            <Muted>
              Spent {gbp(r.actualPence)}
              {r.plannedPence !== null ? ` · planned ${r.plannedPartial ? 'at least ' : ''}${gbp(r.plannedPence)} (estimate)` : ''}
              {r.budgetPence !== null ? ` · budget ${gbp(r.budgetPence)}` : ''}
            </Muted>
          </View>
        );
      })}
      <Muted>Solid bar: spent. Dashed outline: planned (estimate). Black tick: budget.</Muted>
    </View>
  );
}
