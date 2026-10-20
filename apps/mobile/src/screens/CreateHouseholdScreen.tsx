import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { parseCreateHousehold } from '@/lib/accountForms';
import { Field, useAction } from './account/parts';
import { Button, ErrorText, Muted, Text, useStyles } from './ui';

/** Onboarding / "create another household" (web: /household/new). The creator becomes the owner (bootstrap trigger). */
export default function CreateHouseholdScreen() {
  const { ds, setHouseholdId } = useApp();
  const router = useRouter();
  const styles = useStyles();
  const [name, setName] = useState('');
  const [servings, setServings] = useState('4');
  const [budget, setBudget] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, error, run } = useAction();

  async function submit() {
    const parsed = parseCreateHousehold({ name, defaultServings: servings, weeklyBudgetPounds: budget, displayName });
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    const created = await run(() => ds.account.createHousehold(parsed.value));
    if (!created) return;
    setHouseholdId(created.id);
    router.replace('/recipes');
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} style={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">
        Create a household
      </Text>
      <Muted style={{ marginBottom: 12 }}>A household shares recipes, plans and the shopping list. You become its owner and can invite the others.</Muted>
      <Field label="Household name" value={name} onChangeText={setName} error={errors.name} testID="hh-name" maxLength={120} />
      <Field label="Default servings" value={servings} onChangeText={setServings} error={errors.defaultServings} keyboardType="number-pad" testID="hh-servings" />
      <Field
        label="Weekly food budget (£)"
        value={budget}
        onChangeText={setBudget}
        error={errors.weeklyBudgetPounds}
        hint="Optional."
        keyboardType="decimal-pad"
        testID="hh-budget"
      />
      <Field
        label="Your name in this household"
        value={displayName}
        onChangeText={setDisplayName}
        error={errors.displayName}
        hint="Optional. Other members see it on the list and in purchases."
        maxLength={80}
        testID="hh-display-name"
      />
      <ErrorText message={error} />
      <Button title={busy ? 'Creating...' : 'Create household'} onPress={submit} disabled={busy} testID="hh-create" />
    </ScrollView>
  );
}
