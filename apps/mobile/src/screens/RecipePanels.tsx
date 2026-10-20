import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { NUTRIENT_DISPLAY, PRICE_KIND_LABEL, formatPence, nutrientCell, printedKey } from '@/lib/calcFormat';
import type { CostResult, NutritionResult, PrintedNutrition } from '@/lib/recipesApi';
import type { NutrientKey } from '@fr/domain';
import { Muted, Text, useStyles } from './ui';
import { Badge, Chip, ChipWrap, Section } from './widgets';

/**
 * Cost panel (web: CostPanel). `cost` was computed for the recipe's own servings; the per-serving figure does not change when
 * the cook scales the recipe, the total scales with `factor`. Estimates and partial totals are labelled, never hidden.
 */
export function CostPanel({ cost, servings, factor }: { cost: CostResult; servings: number; factor: number }) {
  const styles = useStyles();
  const uncosted = cost.uncosted.length > 0 && (
    <View testID="uncosted-lines">
      <Text style={{ fontWeight: '600', marginTop: 8 }}>Not priced ({cost.uncosted.length})</Text>
      {cost.uncosted.map((l) => (
        <Muted key={l.lineId}>
          {l.name}: {l.reasonLabel}
        </Muted>
      ))}
    </View>
  );
  if (cost.totalPence == null || cost.perServingPence == null) {
    return (
      <Section testID="cost-panel">
        <Text style={styles.heading} accessibilityRole="header">
          Cost
        </Text>
        <Text testID="cost-unknown" style={{ fontSize: 20, fontWeight: '700' }}>
          Cost unknown
        </Text>
        <Muted>No ingredient in this recipe could be priced.</Muted>
        {uncosted}
      </Section>
    );
  }
  const total = Math.round(cost.totalPence * factor);
  const lead = cost.isPartial ? 'At least ' : '';
  const priced = cost.lines.filter((l) => l.status === 'costed').length;
  const lineCount = cost.lines.filter((l) => l.status !== 'skipped_optional').length;
  return (
    <Section testID="cost-panel">
      <Text style={styles.heading} accessibilityRole="header">
        Cost
      </Text>
      <Text testID="cost-per-serving" style={{ fontSize: 20, fontWeight: '700' }}>
        {lead}
        {formatPence(cost.perServingPence)} per serving
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
        <Text testID="cost-total">
          {lead}
          {formatPence(total)} for {servings} {servings === 1 ? 'serving' : 'servings'}
        </Text>
        {cost.kind && <Badge label={PRICE_KIND_LABEL[cost.kind]} tone={cost.kind === 'generic_estimate' ? 'warn' : 'good'} />}
        {cost.isPartial && <Badge label="partial" tone="warn" />}
      </View>
      <Muted testID="cost-coverage">
        {priced} of {lineCount} ingredients priced ({Math.round(cost.coveragePct)}%).
        {cost.isPartial ? ' Unpriced ingredients are not included, so the real cost is higher.' : ''}
      </Muted>
      {cost.sources.map((s) => (
        <Muted key={`${s.kind}-${s.source}`} testID="cost-source">
          {PRICE_KIND_LABEL[s.kind]}: {s.source} (as of {s.observedOn})
        </Muted>
      ))}
      {uncosted}
      {cost.lines.some((l) => l.basis === 'range_max') && <Muted>Amounts given as a range are priced at the top of the range.</Muted>}
    </Section>
  );
}

function NutritionTable({
  nutrition,
  multiplier,
  printed,
  testPrefix,
}: {
  nutrition: NutritionResult;
  multiplier: number;
  printed: PrintedNutrition | null;
  testPrefix: string;
}) {
  const styles = useStyles();
  const printedBy = new Map<NutrientKey, { amount: number; unit: string }>();
  const extra: Array<{ name: string; amount: number; unit: string }> = [];
  for (const v of printed?.values ?? []) {
    const key = printedKey(v.nutrient, v.unit);
    if (key && !printedBy.has(key)) printedBy.set(key, { amount: v.amount, unit: v.unit });
    else extra.push({ name: v.nutrient, amount: v.amount, unit: v.unit });
  }
  return (
    <View testID={testPrefix}>
      {printed && (
        <View style={[styles.row, { minHeight: 32 }]} accessible={false}>
          <Muted style={{ flex: 1 }}>Nutrient</Muted>
          <Muted style={{ width: 110, textAlign: 'right' }}>Calculated</Muted>
          <Muted style={{ width: 96, textAlign: 'right' }}>Recipe card</Muted>
        </View>
      )}
      {NUTRIENT_DISPLAY.map(({ key, label }) => {
        const c = nutrientCell(nutrition.perServing[key], multiplier);
        const p = printedBy.get(key);
        return (
          <View key={key} style={[styles.row, { minHeight: 44 }]} accessible accessibilityLabel={`${label}: ${c.text}${c.estimate ? ', estimate' : ''}${p ? `, recipe card ${p.amount} ${p.unit}` : ''}`}>
            <Text style={{ flex: 1 }}>{label}</Text>
            <View style={{ width: 110, alignItems: 'flex-end' }}>
              <Text testID={`${testPrefix}-${key}`}>
                {c.estimate && !c.unknown ? '~' : ''}
                {c.text}
              </Text>
              {c.note ? <Muted>{c.note}</Muted> : null}
            </View>
            {printed && <Text style={{ width: 96, textAlign: 'right' }}>{p ? `${p.amount} ${p.unit}` : '-'}</Text>}
          </View>
        );
      })}
      {printed &&
        extra.map((e) => (
          <View key={`x-${e.name}`} style={[styles.row, { minHeight: 44 }]}>
            <Text style={{ flex: 1 }}>{e.name}</Text>
            <Text style={{ width: 110, textAlign: 'right' }}>Unknown</Text>
            <Text style={{ width: 96, textAlign: 'right' }}>
              {e.amount} {e.unit}
            </Text>
          </View>
        ))}
      {printed && (
        <Muted testID="printed-nutrition">
          Recipe card figures are as printed, {printed.basis}
          {printed.note ? ` (${printed.note})` : ''}. They are source-provided, not calculated by this app, and are not scaled.
        </Muted>
      )}
    </View>
  );
}

/** Nutrition panel (web: NutritionPanel): per serving or per recipe, Unknown is never 0, CoFID attribution, printed card column. */
export function NutritionPanel({ nutrition, servings, printed }: { nutrition: NutritionResult; servings: number; printed: PrintedNutrition | null }) {
  const styles = useStyles();
  const [basis, setBasis] = useState<'serving' | 'recipe'>('serving');
  const [showMissing, setShowMissing] = useState(false);
  const nothing = nutrition.coveragePct === 0;
  return (
    <Section testID="nutrition-panel">
      <Text style={styles.heading} accessibilityRole="header">
        Nutrition
      </Text>
      {nothing ? (
        <Muted testID="nutrition-none">Nutrition could not be calculated: no ingredient has usable nutrition data and a known weight.</Muted>
      ) : (
        <>
          <Muted testID="nutrition-coverage">
            Based on {Math.round(nutrition.coveragePct)}% of ingredients
            {nutrition.coveragePct < 100 ? '; values that depend on the rest show as Unknown' : ''}.
          </Muted>
          <ChipWrap>
            <Chip label="Per serving" selected={basis === 'serving'} onPress={() => setBasis('serving')} testID="nutrition-basis-serving" />
            <Chip label="Per recipe" selected={basis === 'recipe'} onPress={() => setBasis('recipe')} testID="nutrition-basis-recipe" />
          </ChipWrap>
          {basis === 'serving' ? (
            <NutritionTable nutrition={nutrition} multiplier={1} printed={printed} testPrefix="nutrition" />
          ) : (
            <>
              <Muted>Per recipe ({servings} servings)</Muted>
              <NutritionTable nutrition={nutrition} multiplier={servings} printed={null} testPrefix="nutrition-recipe" />
            </>
          )}
        </>
      )}
      {nutrition.missing.length > 0 && (
        <View>
          <Chip label={`${showMissing ? 'Hide' : 'Show'} ingredients without nutrition data (${nutrition.missing.length})`} selected={showMissing} onPress={() => setShowMissing((s) => !s)} testID="nutrition-missing-toggle" />
          {showMissing && (
            <View testID="nutrition-missing">
              {nutrition.missing.map((m) => (
                <Muted key={m.name}>
                  {m.name}: {m.reasonLabel}
                </Muted>
              ))}
            </View>
          )}
        </View>
      )}
      {nutrition.warnings.length > 0 && <Muted>{nutrition.warnings.join('; ')}.</Muted>}
      {nutrition.productSources?.map((p) => (
        <Muted key={p.ingredientId} onPress={() => void Linking.openURL(p.url)}>
          {p.ingredientName}: from the product label ({p.productName}, barcode {p.barcode}, Open Food Facts)
        </Muted>
      ))}
      <Muted testID="nutrition-attribution">{nutrition.attribution}</Muted>
      <Muted>{nutrition.disclaimer}</Muted>
    </Section>
  );
}
