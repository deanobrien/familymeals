import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { gbp, type ListCompareView } from '@/lib/moneyApi';
import { Muted, MIN_TAP, Text, useStyles } from '../ui';

/**
 * "Where's cheapest for this list?" on the shopping screen (P2-B, D402). Per-shop totals for the items each shop has a price
 * for, coverage always shown, never a quote. Collapsed by default so the list stays the main thing.
 */
export function CompareListCard({ view }: { view: ListCompareView }) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.banner} testID="compare-card">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Where is cheapest for this list?"
        onPress={() => setOpen((o) => !o)}
        style={{ minHeight: MIN_TAP, justifyContent: 'center' }}
        testID="compare-toggle"
      >
        <Text style={{ fontWeight: '700' }}>Where&rsquo;s cheapest for this list? {open ? '▲' : '▼'}</Text>
        <Muted>From your own receipts and prices</Muted>
      </Pressable>
      {open && (view.shops.length === 0 ? (
        <Muted testID="compare-empty">{view.note}</Muted>
      ) : (
        <View>
          {view.shops.map((s) => (
            <View key={s.label} style={{ marginVertical: 4 }} accessible accessibilityLabel={`${s.label}: ${s.pricedItems} of ${view.totalItems} items, ${gbp(s.totalPence)}`} testID="compare-row">
              <Text style={{ fontWeight: '600' }}>{s.label}{s.linked ? '' : ' (not linked to a store)'}</Text>
              <Muted>Covers {s.pricedItems} of {view.totalItems} items ({s.coveragePct}%): {gbp(s.totalPence)}</Muted>
              <Muted>{s.allRecent ? `Prices up to ${s.oldestText}` : `Some prices are old (${s.oldestText})`}</Muted>
            </View>
          ))}
          {view.likeForLike ? (
            <Text testID="compare-like">
              Like for like ({view.likeForLike.itemNames.length} item{view.likeForLike.itemNames.length === 1 ? '' : 's'} every shop has priced): {view.likeForLike.totals.map((t) => `${t.label} ${gbp(t.totalPence)}`).join(' · ')}
              {view.likeForLike.cheapest ? `. Cheapest here: ${view.likeForLike.cheapest}.` : '. No single cheapest.'}
            </Text>
          ) : null}
          <Muted>{view.note} A shop that covers few items can look cheap: read the coverage first.</Muted>
        </View>
      ))}
    </View>
  );
}
