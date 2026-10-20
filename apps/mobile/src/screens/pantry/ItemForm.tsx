import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import type { ServerApi } from '@/lib/serverApi';
import { UNIT_OPTIONS, expiryError, parseQuantity } from '@/lib/pantryApi';
import IngredientPicker, { type IngredientHit } from '../IngredientPicker';
import { Button, ErrorText, Muted, Text, useStyles, useTheme } from '../ui';
import { Chip, ChipRow } from './shared';

export interface ItemFormValues {
  ingredientId?: string;
  name?: string;
  value: number;
  unit: string;
  /** null = no expiry (clears it when editing). */
  expiry: string | null;
}

/**
 * Add (canonical ingredient via the picker, or a free-text name) and edit (quantity, unit, expiry) share one form.
 * Validation mirrors the server; the server still has the last word and its message is shown by the caller.
 */
export default function ItemForm({
  api, householdId, mode, initial, busy, onSubmit, onCancel,
}: {
  api: ServerApi;
  householdId: string;
  mode: 'add' | 'edit';
  initial?: { name: string; value?: number; unit?: string; expiry?: string };
  busy?: boolean;
  onSubmit: (v: ItemFormValues) => void;
  onCancel: () => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const [picked, setPicked] = useState<IngredientHit | null>(null);
  const [name, setName] = useState('');
  const [qty, setQty] = useState(initial?.value !== undefined ? String(initial.value) : '');
  const [unit, setUnit] = useState(initial?.unit ?? 'item');
  const [expiry, setExpiry] = useState(initial?.expiry ?? '');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const value = parseQuantity(qty);
    if (mode === 'add' && !picked && !name.trim()) return setError('Choose an ingredient or type a name.');
    if (value === null) return setError('Enter a quantity as a number.');
    if (value <= 0) return setError('Quantity must be more than zero. Use Remove to take an item out.');
    const bad = expiryError(expiry);
    if (bad) return setError(bad);
    setError(null);
    onSubmit({
      value, unit, expiry: expiry.trim() ? expiry.trim() : null,
      ...(mode === 'add' ? (picked ? { ingredientId: picked.id } : { name: name.trim() }) : {}),
    });
  }

  return (
    <View style={styles.banner} testID={`${mode}-form`}>
      <Text style={{ fontWeight: '600', marginBottom: 6 }} accessibilityRole="header">
        {mode === 'add' ? 'Add an item' : `Edit ${initial?.name ?? 'item'}`}
      </Text>
      {mode === 'add' ? (
        picked ? (
          <View style={{ marginBottom: 8 }}>
            <Text>Ingredient: {picked.name}</Text>
            <Button title="Choose a different ingredient" variant="secondary" onPress={() => setPicked(null)} testID="add-unpick" />
          </View>
        ) : (
          <View>
            <IngredientPicker api={api} householdId={householdId} onPick={setPicked} testIdPrefix="add-ingredient" />
            <Muted style={{ marginBottom: 4 }}>Not in the list? Type a name instead.</Muted>
            <TextInput
              style={styles.input} value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={theme.muted}
              accessibilityLabel="Item name" testID="item-name" maxLength={80}
            />
          </View>
        )
      ) : null}
      <TextInput
        style={styles.input} value={qty} onChangeText={setQty} keyboardType="decimal-pad" placeholder="Quantity"
        placeholderTextColor={theme.muted} accessibilityLabel="Quantity" testID="item-value"
      />
      <ChipRow>
        {UNIT_OPTIONS.map((u) => (
          <Chip key={u} label={u} selected={unit === u} onPress={() => setUnit(u)} testID={`unit-${u}`} accessibilityLabel={`Unit ${u}`} />
        ))}
      </ChipRow>
      <TextInput
        style={styles.input} value={expiry} onChangeText={setExpiry} placeholder="Expiry (YYYY-MM-DD), optional"
        placeholderTextColor={theme.muted} accessibilityLabel="Expiry date, year month day, optional" testID="item-expiry"
        autoCapitalize="none" keyboardType="numbers-and-punctuation" maxLength={10}
      />
      {mode === 'edit' && expiry ? <Button title="Clear expiry" variant="secondary" onPress={() => setExpiry('')} testID="item-clear-expiry" /> : null}
      <ErrorText message={error} />
      <Button title={mode === 'add' ? 'Add to pantry' : 'Save changes'} onPress={submit} disabled={busy} testID="item-save" />
      <Button title="Cancel" variant="secondary" onPress={onCancel} testID="item-cancel" />
    </View>
  );
}
