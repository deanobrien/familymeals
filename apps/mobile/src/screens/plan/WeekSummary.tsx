import React from 'react';
import { View } from 'react-native';
import type { NutrientKey } from '@fr/domain';
import { formatNutrient, NUTRIENT_LABELS } from '@/lib/format';
import type { WeekNutrition } from '@/lib/plan/ops';
import { Muted, Text } from '../ui';
import { Section } from './parts';

const SHOWN: NutrientKey[] = ['energy_kcal', 'protein', 'carbohydrate', 'fat', 'salt'];

/** Weekly nutrition: totals and averages of estimated values. Descriptive only; unknown is shown as Unknown, never 0. */
export default function WeekSummary({ data }: { data: WeekNutrition | null }) {
  if (!data) return null;
  const { summary } = data;
  return (
    <Section title="Nutrition this week" testID="week-nutrition">
      <Muted>
        {`${data.meals} planned recipe ${data.meals === 1 ? 'meal' : 'meals'} over ${summary.dayCount} ${summary.dayCount === 1 ? 'day' : 'days'}; ${summary.totalServings} ${summary.totalServings === 1 ? 'serving' : 'servings'} in total.`}
        {data.mealsWithoutNutrition > 0 ? ` ${data.mealsWithoutNutrition} ${data.mealsWithoutNutrition === 1 ? 'meal has' : 'meals have'} no nutrition data, so totals are incomplete.` : ''}
      </Muted>
      {SHOWN.map((k) => (
        <View key={k} style={{ marginTop: 6 }} accessible accessibilityLabel={`${NUTRIENT_LABELS[k]}: week total ${formatNutrient(summary.totals[k])}, average per day ${formatNutrient(summary.perDayAverage[k])}`}>
          <Text style={{ fontWeight: '600' }}>{NUTRIENT_LABELS[k]}</Text>
          <Muted>{`Week ${formatNutrient(summary.totals[k])} · per day ${formatNutrient(summary.perDayAverage[k])} · per serving ${formatNutrient(summary.perServingAverage[k])}`}</Muted>
        </View>
      ))}
      <Muted testID="week-nutrition-disclaimer">{summary.disclaimer}</Muted>
      <Muted>Unknown means we do not have data, not that the amount is zero. Estimated from UK CoFID data.</Muted>
    </Section>
  );
}
