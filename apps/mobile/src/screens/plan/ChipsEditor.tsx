import React, { useState } from 'react';
import { View } from 'react-native';
import {
  DIETS, WEEKDAYS, WEEKDAY_LABEL, addFavourite, addTerm, describeTarget, quickWeekdays, removeAllergen, removeDietTarget, removeFavourite, removeTag,
  removeTerm, setBudgetPounds, setDays, setDietTarget, setQuickMinutes, setQuickStrict, setServings, toggleQuickDay, type Diet, type TargetKind,
} from '@/lib/plan/requestChips';
import type { PlanRequest } from '@/lib/plan/types';
import { Button, Muted, Text } from '../ui';
import { Chip, ChipRow, Field, Section, Stepper } from './parts';

const KINDS: Array<[TargetKind, string]> = [['percent', 'Percent of meals'], ['count', 'Exactly N meals'], ['min', 'At least N meals'], ['max', 'At most N meals']];

/** The AI's reading of the prompt as editable chips (D133). Edits only change the request; nothing is solved until asked. */
export default function ChipsEditor({ request, onChange, locked, memberNames, notes, dislikes = [] }: { request: PlanRequest; onChange: (r: PlanRequest) => void; locked: string[]; memberNames: string[]; notes: string[]; /** Soft dislikes per member (P1-B): read-only, edited in Settings. */ dislikes?: { memberName: string; terms: string[] }[] }) {
  const [term, setTerm] = useState('');
  const [dietCat, setDietCat] = useState<Diet>('vegetarian');
  const [kind, setKind] = useState<TargetKind>('percent');
  const [amount, setAmount] = useState('50');
  const [budget, setBudget] = useState(request.budgetPence === undefined ? '' : String(request.budgetPence / 100));

  const diets = DIETS.flatMap((d) => (request.dietProportions?.[d] ? [[d, request.dietProportions[d]!] as const] : []));
  const quickDays = new Set(quickWeekdays(request));
  const members = memberNames.filter((m) => !request.favouritesOf.some((f) => f.toLowerCase() === m.toLowerCase()));

  const commitTerm = () => {
    onChange(addTerm(request, term));
    setTerm('');
  };

  return (
    <View testID="constraint-chips" accessibilityLabel="What we understood from your request">
      <Text style={{ fontWeight: '700', fontSize: 18 }} accessibilityRole="header">What we understood</Text>
      <Muted>Check these and fix anything we got wrong. Changing them does not call the AI again.</Muted>

      <Section title="Basics">
        <Stepper label="Servings" value={request.servings} min={1} max={50} onChange={(n) => onChange(setServings(request, n))} />
        <Stepper label="Days" value={request.days ?? 7} min={1} max={31} onChange={(n) => onChange(setDays(request, n))} />
        <Field
          label="Budget in pounds (empty for none)"
          value={budget}
          keyboardType="decimal-pad"
          onChangeText={(t) => {
            setBudget(t);
            const n = t.trim() === '' ? null : Number(t);
            onChange(setBudgetPounds(request, n !== null && Number.isFinite(n) ? n : null));
          }}
        />
        <Muted>{`Meals: ${request.mealTypes.join(', ') || 'dinner'}`}</Muted>
      </Section>

      <Section title="Diet mix">
        <ChipRow>
          {diets.length === 0 ? <Muted>No diet targets.</Muted> : null}
          {diets.map(([d, t]) => <Chip key={d} label={describeTarget(d, t)} removeLabel={`Remove diet target ${d}`} onRemove={() => onChange(removeDietTarget(request, d))} />)}
        </ChipRow>
        <Muted>Diet</Muted>
        <ChipRow>{DIETS.map((d) => <Chip key={d} label={d} selected={dietCat === d} onPress={() => setDietCat(d)} />)}</ChipRow>
        <Muted>Target type</Muted>
        <ChipRow>{KINDS.map(([k, label]) => <Chip key={k} label={label} selected={kind === k} onPress={() => setKind(k)} />)}</ChipRow>
        <Field label="Target amount" value={amount} keyboardType="numeric" onChangeText={setAmount} />
        <Button title="Set diet target" variant="secondary" onPress={() => onChange(setDietTarget(request, dietCat, kind, Number(amount)))} />
      </Section>

      {dislikes.length > 0 ? (
        <Section title="Dislikes (soft)" testID="dislike-chips">
          <ChipRow>{dislikes.flatMap((d) => d.terms.map((t) => <Chip key={`dis-${d.memberName}-${t}`} label={`${d.memberName}: ${t}`} />))}</ChipRow>
          <Muted>Avoided where possible, never a rule. A preference, not an allergy. Change it in Settings.</Muted>
        </Section>
      ) : null}

      <Section title="Exclusions">
        <ChipRow>
          {locked.map((x) => <Chip key={`lock-${x}`} label={x} locked />)}
          {request.excludeTerms.map((x) => <Chip key={`t-${x}`} label={x} onRemove={() => onChange(removeTerm(request, x))} />)}
          {request.excludeAllergens.map((x) => <Chip key={`a-${x}`} label={`${x} (allergen)`} removeLabel={`Remove allergen ${x}`} onRemove={() => onChange(removeAllergen(request, x))} />)}
        </ChipRow>
        {request.excludeDietCategories.length > 0 ? <Muted>{`No ${request.excludeDietCategories.join(', ')} meals.`}</Muted> : null}
        <Field label="Avoid ingredient" value={term} onChangeText={setTerm} />
        <Button title="Add exclusion" variant="secondary" disabled={!term.trim()} onPress={commitTerm} />
      </Section>

      <Section title="Quick meals">
        <ChipRow>
          {WEEKDAYS.map((d) => <Chip key={d} label={WEEKDAY_LABEL[d]} selected={quickDays.has(d)} onPress={() => onChange(toggleQuickDay(request, d))} testID={`quick-${d}`} />)}
        </ChipRow>
        {request.quickMeals ? (
          <>
            <Stepper label="Max minutes" value={request.quickMeals.maxTotalMinutes} min={5} max={240} onChange={(n) => onChange(setQuickMinutes(request, n))} />
            <Chip label="Only quick meals on those days (strict)" selected={request.quickMeals.strict} onPress={() => onChange(setQuickStrict(request, !request.quickMeals!.strict))} />
          </>
        ) : null}
      </Section>

      <Section title="Favourites of">
        <ChipRow>
          {request.favouritesOf.length === 0 ? <Muted>Nobody&apos;s favourites.</Muted> : null}
          {request.favouritesOf.map((m) => <Chip key={m} label={`${m}'s favourites`} removeLabel={`Remove favourites of ${m}`} onRemove={() => onChange(removeFavourite(request, m))} />)}
        </ChipRow>
        {members.length > 0 ? (
          <ChipRow>{members.map((m) => <Chip key={m} label={`Add ${m}'s favourites`} onPress={() => onChange(addFavourite(request, m))} />)}</ChipRow>
        ) : null}
      </Section>

      {request.includeTags.length > 0 ? (
        <Section title="Preferred tags">
          <ChipRow>{request.includeTags.map((t) => <Chip key={t} label={t} onRemove={() => onChange(removeTag(request, t))} />)}</ChipRow>
        </Section>
      ) : null}

      {notes.length > 0 ? <View testID="chip-notes">{notes.map((n) => <Muted key={n}>{n}</Muted>)}</View> : null}
    </View>
  );
}
