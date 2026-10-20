import React, { useState } from 'react';
import { Pressable, Text as RNText, TextInput, View } from 'react-native';
import { confidenceTone, fmtNum, nameItMyself, withCount, withDate, withQuantity, type DateSource, type IngredientRef } from '@fr/engine/pantry';
import type { CapturedImage } from '@/lib/extraction';
import { UNIT_OPTIONS } from '@/lib/pantryApi';
import type { PhoneScanRow } from '@/lib/pantryScanApi';
import type { ServerApi } from '@/lib/serverApi';
import IngredientPicker from '../IngredientPicker';
import PhotoCapture from '../PhotoCapture';
import { Chip, ChipRow } from '../pantry/shared';
import { Button, ErrorText, MIN_TAP, Muted, Text, useStyles, useTheme } from '../ui';

const SOURCE_LABEL: Record<DateSource, string | null> = {
  none: null,
  scan: 'Read from label',
  closeup: 'Read from close-up',
  user: 'You entered',
  estimate: 'Estimate, not read from the pack',
};

/** A 48dp tick box: include / exclude a row. */
function IncludeToggle({ row, onChange }: { row: PhoneScanRow; onChange: (r: PhoneScanRow) => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`Include ${row.scannedName}`}
      accessibilityState={{ checked: row.include }}
      testID="row-include"
      onPress={() => onChange({ ...row, include: !row.include })}
      style={{ minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}
    >
      <View
        style={{
          width: 26, height: 26, borderRadius: 4, borderWidth: 2, borderColor: t.primary,
          backgroundColor: row.include ? t.primary : 'transparent', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {row.include && <RNText style={{ color: t.primaryText, fontWeight: '700' }}>{'✓'}</RNText>}
      </View>
      <Text style={{ fontWeight: '700', flex: 1 }}>{row.scannedName}</Text>
    </Pressable>
  );
}

function CountStepper({ row, onChange }: { row: PhoneScanRow; onChange: (r: PhoneScanRow) => void }) {
  const styles = useStyles();
  const n = Number(row.count) || 0;
  return (
    <View>
      <Muted>Count{row.packSizeText ? ` (${row.packSizeText} each)` : ''}</Muted>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Button title="-" variant="secondary" accessibilityLabel={`One fewer ${row.scannedName}`} testID="row-count-minus"
          disabled={n <= 1} onPress={() => onChange(withCount(row, fmtNum(Math.max(1, n - 1))))} />
        <TextInput
          style={[styles.input, { flex: 1, marginBottom: 0, textAlign: 'center' }]}
          accessibilityLabel={`Count of ${row.scannedName}`}
          keyboardType="number-pad"
          value={row.count}
          onChangeText={(v) => onChange(withCount(row, v))}
          testID="row-count"
        />
        <Button title="+" variant="secondary" accessibilityLabel={`One more ${row.scannedName}`} testID="row-count-plus"
          onPress={() => onChange(withCount(row, fmtNum(n + 1)))} />
      </View>
    </View>
  );
}

function MatchPicker({ row, api, householdId, onChange }: { row: PhoneScanRow; api: ServerApi; householdId: string; onChange: (r: PhoneScanRow) => void }) {
  const styles = useStyles();
  const theme = useTheme();
  const [changing, setChanging] = useState(false);
  const choose = (i: IngredientRef | null) => { onChange({ ...row, ingredient: i }); setChanging(false); };

  if (row.ingredient && !changing) {
    return (
      <View testID="match-matched">
        <Text>Matched: <RNText style={{ fontWeight: '700' }}>{row.ingredient.name}</RNText></Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title="Change" variant="secondary" accessibilityLabel={`Change ingredient for ${row.scannedName}`} testID="match-change" onPress={() => setChanging(true)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Use my own name" variant="secondary" accessibilityLabel={`Use my own name for ${row.scannedName}`} testID="match-own-name" onPress={() => choose(null)} />
          </View>
        </View>
      </View>
    );
  }

  const ambiguous = row.match.status === 'ambiguous' ? row.match.candidates : [];
  const suggestions = row.match.status === 'unmatched' ? row.match.suggestions : [];
  return (
    <View testID={ambiguous.length ? 'match-ambiguous' : 'match-unmatched'}>
      {ambiguous.length > 0 && (
        <>
          <Muted>{`Which ingredient is "${row.scannedName}"?`}</Muted>
          <ChipRow>
            {ambiguous.map((c) => (
              <Chip key={c.id} label={c.name} selected={false} accessibilityLabel={`Use ${c.name}`} testID="match-candidate" onPress={() => choose(c)} />
            ))}
          </ChipRow>
        </>
      )}
      {suggestions.length > 0 && (
        <>
          <Muted>Did you mean:</Muted>
          <ChipRow>
            {suggestions.map((c) => (
              <Chip key={c.id} label={c.name} selected={false} accessibilityLabel={`Use ${c.name}`} testID="match-suggestion" onPress={() => choose(c)} />
            ))}
          </ChipRow>
        </>
      )}
      <Muted>
        {ambiguous.length
          ? 'Several ingredients could fit: pick one, or keep your own name.'
          : 'No exact match in the ingredient list: it will be saved under this name.'}
      </Muted>
      <TextInput
        style={styles.input}
        accessibilityLabel={`Name for ${row.scannedName}`}
        placeholder="Name"
        placeholderTextColor={theme.muted}
        value={row.freeName}
        onChangeText={(v) => onChange({ ...row, freeName: v })}
        testID="row-name"
      />
      <IngredientPicker api={api} householdId={householdId} onPick={(h) => choose(h)} placeholder="Find an ingredient" testIdPrefix="row-ingredient" />
    </View>
  );
}

function DateField({ label, value, source, onChange, testID, error }: { label: string; value: string; source: DateSource; onChange: (v: string) => void; testID: string; error?: string | null }) {
  const styles = useStyles();
  const theme = useTheme();
  const badge = SOURCE_LABEL[source];
  return (
    <View style={{ flex: 1 }}>
      <Muted>{label}</Muted>
      <TextInput
        style={styles.input}
        accessibilityLabel={`${label} date, YYYY-MM-DD`}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={theme.muted}
        keyboardType="numbers-and-punctuation"
        value={value}
        onChangeText={onChange}
        testID={testID}
      />
      {badge && <Muted testID={source === 'estimate' ? 'estimate-badge' : `${testID}-source`}>{badge}</Muted>}
      <ErrorText message={error ?? null} />
    </View>
  );
}

/**
 * One reviewed scan row (photo or barcode): include, ingredient match (matched / ambiguous / unmatched with suggestions,
 * search and free text), count stepper, quantity + unit, use-by / best-before (YYYY-MM-DD), confidence, notes and a
 * single-photo close-up re-scan for a date label the scan could not read. The transitions are the engine's (web parity).
 */
export default function ScanRowCard({
  row, api, householdId, error, dateErrors, onChange, onCloseUp, onRetry,
}: {
  row: PhoneScanRow;
  api: ServerApi;
  householdId: string;
  error?: string | undefined;
  dateErrors: { useBy?: string; bestBefore?: string };
  onChange: (r: PhoneScanRow) => void;
  onCloseUp: (img: CapturedImage) => void;
  onRetry?: ((barcode: string) => void) | undefined;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const [datesOpen, setDatesOpen] = useState(!row.rapid);
  const [closeUpImages, setCloseUpImages] = useState<CapturedImage[]>([]);
  const [closeUpOpen, setCloseUpOpen] = useState(false);
  const code = row.barcode ?? row.scanBarcode;
  const conf = confidenceTone(row.confidence);
  const card = [styles.banner, { opacity: row.include ? 1 : 0.6 }];

  if (row.lookup === 'pending') {
    return (
      <View testID="scan-row" accessibilityLabel={`Scanned item: ${row.scannedName}`} style={card}>
        <IncludeToggle row={row} onChange={onChange} />
        <Muted accessibilityLiveRegion="polite" testID="row-looking-up">Looking this product up. It fills in by itself when it is found.</Muted>
        <CountStepper row={row} onChange={onChange} />
        <Button title="Name it myself" variant="secondary" accessibilityLabel={`Name ${row.scannedName} myself`} testID="row-name-myself" onPress={() => onChange(nameItMyself(row))} />
        <ErrorText message={error ?? null} />
      </View>
    );
  }

  const showCloseUp = row.needsCloseUp || row.closeUp !== 'idle' || !!row.rapid;
  const confidenceText = `${conf.label} (${Math.round(row.confidence * 100)}%)`;

  return (
    <View testID="scan-row" accessibilityLabel={`Scanned item: ${row.scannedName}`} style={card}>
      <IncludeToggle row={row} onChange={onChange} />
      {code ? (
        <Muted testID="row-barcode">From barcode {code}</Muted>
      ) : (
        <Muted testID="row-confidence" style={{ color: conf.tone === 'danger' ? theme.danger : conf.tone === 'warning' ? theme.warn : theme.muted }}>
          {confidenceText}{row.frameRefs.length ? `, seen in ${row.frameRefs.length === 1 ? 'photo' : 'photos'} ${row.frameRefs.join(', ')}` : ''}
        </Muted>
      )}
      {row.notes ? <Muted testID="row-notes">{row.notes}</Muted> : null}
      {row.product && (
        <Muted testID="row-product">
          {[row.product.brand, row.product.packSizeText, row.product.allergenText].filter(Boolean).join(' | ')}
        </Muted>
      )}
      {row.lookupMessage && row.lookup && row.lookup !== 'manual' && (
        <View testID="row-lookup-note">
          <Muted accessibilityLiveRegion="polite">{row.lookupMessage}</Muted>
          {row.lookup === 'failed' && code && onRetry && (
            <Button title="Try the lookup again" variant="secondary" testID="row-lookup-retry" onPress={() => onRetry(code)} />
          )}
        </View>
      )}

      <MatchPicker row={row} api={api} householdId={householdId} onChange={onChange} />

      <CountStepper row={row} onChange={onChange} />
      <Muted>Quantity</Muted>
      <TextInput
        style={styles.input}
        accessibilityLabel={`Quantity of ${row.scannedName}`}
        keyboardType="decimal-pad"
        value={row.value}
        onChangeText={(v) => onChange(withQuantity(row, { value: v }))}
        testID="row-quantity"
      />
      <ChipRow>
        {UNIT_OPTIONS.map((u) => (
          <Chip key={u} label={u} selected={row.unit === u} accessibilityLabel={`Unit ${u}`} testID={`row-unit-${u}`} onPress={() => onChange(withQuantity(row, { unit: u }))} />
        ))}
      </ChipRow>

      {row.rapid && (
        <Button
          title={datesOpen ? 'Hide dates and close-up' : 'Dates and close-up (optional)'}
          variant="secondary"
          testID="row-dates-toggle"
          onPress={() => setDatesOpen((o) => !o)}
        />
      )}
      {datesOpen && (
        <View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <DateField label="Use by" value={row.useBy} source={row.useBySource} error={dateErrors.useBy} testID="row-use-by" onChange={(v) => onChange(withDate(row, 'useBy', v))} />
            <DateField label="Best before" value={row.bestBefore} source={row.bestBeforeSource} error={dateErrors.bestBefore} testID="row-best-before" onChange={(v) => onChange(withDate(row, 'bestBefore', v))} />
          </View>
          {showCloseUp && (
            <View testID="closeup-block">
              <Muted accessibilityLiveRegion="polite">
                {row.closeUpMessage ?? (row.rapid ? 'Optional: photograph the date label to read it.' : 'A date label is visible but too small to read.')}
              </Muted>
              {row.closeUp !== 'done' && !closeUpOpen && (
                <Button title="Take close-up" variant="secondary" accessibilityLabel={`Take a close-up of ${row.scannedName}`} testID="closeup-open"
                  disabled={row.closeUp === 'busy'} onPress={() => setCloseUpOpen(true)} />
              )}
              {closeUpOpen && (
                <View>
                  <PhotoCapture images={closeUpImages} onChange={setCloseUpImages} max={1} noun="close-up" testIdPrefix="closeup" />
                  <Button
                    title="Read the date"
                    testID="closeup-send"
                    disabled={closeUpImages.length === 0}
                    onPress={() => {
                      const img = closeUpImages[0];
                      if (!img) return;
                      setCloseUpOpen(false);
                      setCloseUpImages([]);
                      onCloseUp(img);
                    }}
                  />
                  <Button title="Cancel close-up" variant="secondary" testID="closeup-cancel" onPress={() => { setCloseUpOpen(false); setCloseUpImages([]); }} />
                </View>
              )}
            </View>
          )}
        </View>
      )}
      <ErrorText message={error ?? null} />
    </View>
  );
}
