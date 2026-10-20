import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ServerScreen } from '@/data/ServerApiContext';
import { consentNoticeText, createPlanClient, describeError, type PlanClient } from '@/lib/planApi';
import { addDays, dateShort, dayShort, todayIso, weekDates, weekLabel } from '@/lib/plan/dates';
import {
  formatPence, getEntry, markSlot, mealCost, mealCount, moveEntry, removeEntry, setMealTypes, setNote, setRecipe, setServings, shiftToWeek, slotKey,
  cookedVariety, swapRecipe, weekCost, weekCostLabel, weekNutrition, weekVariety,
} from '@/lib/plan/ops';
import { MEAL_LABEL, MEAL_TYPES, type PlanDoc, type PlanEntry, type PlanPage, type RecipeLite, type ShoppingHandoff, type SlotRef } from '@/lib/plan/types';
import type { ServerApi } from '@/lib/serverApi';
import { Button, EmptyState, ErrorState, Loading, MIN_TAP, Muted, Text, useStyles, useTheme } from '../ui';
import { Chip, ChipRow, Notice, Section } from './parts';
import PromptPlanner from './PromptPlanner';
import RecipePicker from './RecipePicker';
import SlotEditor from './SlotEditor';
import WeekSummary from './WeekSummary';
import WeekVarietyPanel from './WeekVarietyPanel';

type View_ = { name: 'week' } | { name: 'slot'; slot: SlotRef } | { name: 'pick'; slot: SlotRef; mode: 'add' | 'swap' };
interface Msg { tone: 'info' | 'error'; text: string; items?: string[] }

export default function PlanScreen() {
  return <ServerScreen>{(api, householdId) => <PlanLoader api={api} householdId={householdId} />}</ServerScreen>;
}

function PlanLoader({ api, householdId }: { api: ServerApi; householdId: string }) {
  const client = useMemo(() => createPlanClient(api, householdId), [api, householdId]);
  return <PlanWeek client={client} />;
}

const titleOf = (e: PlanEntry, recipes: ReadonlyMap<string, RecipeLite>) =>
  e.kind === 'recipe' ? recipes.get(e.recipeId)?.title ?? e.recipeId : e.kind === 'eating_out' ? 'Eating out' : 'Leftovers';

export function PlanWeek({ client }: { client: PlanClient }) {
  const router = useRouter();
  const { add } = useLocalSearchParams<{ add?: string }>();
  // A recipe handed over from its detail / Discover "Add to plan": the next empty slot tapped receives it.
  const [addId, setAddId] = useState<string | null>(null);
  useEffect(() => { if (typeof add === 'string' && /^[\w-]{1,64}$/.test(add)) setAddId(add); }, [add]);
  const styles = useStyles();
  const theme = useTheme();
  const [page, setPage] = useState<PlanPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [doc, setDoc] = useState<PlanDoc | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [handoff, setHandoff] = useState<ShoppingHandoff | null>(null);
  const [view, setView] = useState<View_>({ name: 'week' });
  const [busy, setBusy] = useState(false);
  const [pendingWeek, setPendingWeek] = useState<string | null>(null);

  const load = useCallback(async (week?: string) => {
    setLoadError(null);
    try {
      const p = await client.loadWeek(week);
      setPage(p);
      setDoc(p.doc);
      setDirty(false);
      setSaved(p.isSaved);
      setMsg(null);
      setHandoff(null);
      setPendingWeek(null);
      setView({ name: 'week' });
    } catch (e) {
      setLoadError(describeError(e).message);
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  // Android back inside a sub-view returns to the week instead of leaving the screen.
  useEffect(() => {
    if (view.name === 'week') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setView({ name: 'week' }); return true; });
    return () => sub.remove();
  }, [view.name]);

  const recipes = useMemo(() => new Map((page?.recipes ?? []).map((r) => [r.id, r])), [page?.recipes]);
  const nutrition = useMemo(() => (doc ? weekNutrition(doc, recipes) : null), [doc, recipes]);
  const variety = useMemo(() => (doc ? weekVariety(doc, recipes) : null), [doc, recipes]);
  const cookedVar = useMemo(() => (page?.cooked ? cookedVariety(page.cooked, recipes) : undefined), [page?.cooked, recipes]);

  if (!page || !doc) return loadError ? <ErrorState message={loadError} onRetry={() => void load()} /> : <Loading label="Loading meal plan" />;

  const apply = (next: PlanDoc) => { setDoc(next); setDirty(true); setMsg(null); };
  const fail = (e: unknown) => { const f = describeError(e); setMsg({ tone: 'error', text: f.message, items: f.violations }); };
  const remember = (d: PlanDoc) =>
    setPage((p) => (p ? { ...p, isSaved: true, saved: [...p.saved.filter((s) => s.id !== d.id), { id: d.id, weekStart: d.weekStart, status: d.status }].sort((a, b) => a.weekStart.localeCompare(b.weekStart)) } : p));

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (e) { fail(e); } finally { setBusy(false); }
  }

  const goToWeek = (week: string) => (dirty ? setPendingWeek(week) : void load(week));

  const save = () => run(async () => {
    const d = await client.save(doc);
    setDoc(d); setDirty(false); setSaved(true); remember(d);
    setMsg({ tone: 'info', text: 'Plan saved. You can reopen it from this week at any time.' });
  });

  const approve = () => run(async () => {
    const d = await client.approve(doc);
    setDoc(d); setDirty(false); setSaved(true); remember(d);
    setMsg({ tone: 'info', text: 'Plan approved and saved. No shopping list has been created yet.' });
  });

  const generate = () => run(async () => {
    const h = await client.generateShopping(doc.id);
    setHandoff(h);
    setMsg({ tone: 'info', text: `Shopping requirements built from your approved meals (${h.count} ingredients).` });
  });

  const reusePrevious = () => run(async () => {
    const prev = await client.loadSaved(addDays(doc.weekStart, -7));
    if (!prev) { setMsg({ tone: 'error', text: 'There is no saved plan for the previous week to reuse.' }); return; }
    apply({ ...shiftToWeek(prev, doc.weekStart, doc.id), mealTypes: prev.mealTypes });
    setMsg({ tone: 'info', text: 'Last week copied into this week as a draft. Save it to keep it.' });
  });

  const days = weekDates(doc.weekStart);
  const meals = MEAL_TYPES.filter((m) => doc.mealTypes.includes(m));
  const allSlots: SlotRef[] = days.flatMap((d) => meals.map((m) => ({ date: d, mealType: m })));
  const cost = weekCost(doc, recipes);
  const consent = consentNoticeText(page.withheldExclusions);
  const status = dirty ? 'Unsaved changes' : doc.status === 'approved' ? 'Approved' : saved ? 'Saved draft' : 'Not saved yet';
  const toWeek = () => setView({ name: 'week' });

  // Sub-views render in front; the week (and the prompt planner's state) stays mounted behind, hidden.
  let sub: React.ReactNode = null;
  if (view.name === 'pick') {
    sub = (
      <RecipePicker
        slot={view.slot}
        mode={view.mode}
        recipes={page.recipes}
        onBack={() => setView(getEntry(doc, view.slot) ? { name: 'slot', slot: view.slot } : { name: 'week' })}
        onPick={(r) => {
          apply(view.mode === 'swap' ? swapRecipe(doc, view.slot, r.id, page.defaultServings) : setRecipe(doc, view.slot, r.id, page.defaultServings));
          toWeek();
        }}
      />
    );
  } else if (view.name === 'slot') {
    const entry = getEntry(doc, view.slot);
    if (entry) {
      const slot = view.slot;
      sub = (
        <SlotEditor
          key={slotKey(slot)}
          slot={slot}
          entry={entry}
          title={titleOf(entry, recipes)}
          allSlots={allSlots}
          onServings={(n) => apply(setServings(doc, slot, n))}
          onSwap={() => setView({ name: 'pick', slot, mode: 'swap' })}
          onKind={(k) => { apply(markSlot(doc, slot, k)); toWeek(); }}
          onNote={(t) => apply(setNote(doc, slot, t))}
          onMove={(to, mode) => { apply(moveEntry(doc, slot, to, mode)); toWeek(); }}
          onRemove={() => { apply(removeEntry(doc, slot)); toWeek(); }}
          onBack={toWeek}
        />
      );
    }
  }

  const week = (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled" testID="plan-week">
      <Text style={styles.title} accessibilityRole="header">Meal planner</Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }} accessibilityRole="toolbar" accessibilityLabel="Week navigation">
        <Button title="Previous" accessibilityLabel="Previous week" variant="secondary" onPress={() => goToWeek(addDays(doc.weekStart, -7))} testID="prev-week" />
        <Text testID="week-label" style={{ fontWeight: '700' }}>{weekLabel(doc.weekStart)}</Text>
        <Button title="Next" accessibilityLabel="Next week" variant="secondary" onPress={() => goToWeek(addDays(doc.weekStart, 7))} testID="next-week" />
      </View>
      <Button title="This week" variant="secondary" onPress={() => goToWeek(todayIso())} testID="this-week" />
      <Text testID="plan-status" accessibilityLiveRegion="polite" accessibilityLabel={`Plan status: ${status}`} style={{ fontWeight: '600', color: dirty ? theme.warn : theme.text }}>{status}</Text>

      {pendingWeek ? (
        <Notice tone="error" testID="discard-confirm" text="You have unsaved changes to this week. Discard them?">
          <Button title="Discard and go" onPress={() => void load(pendingWeek)} testID="discard-go" />
          <Button title="Keep editing" variant="secondary" onPress={() => setPendingWeek(null)} testID="discard-keep" />
        </Notice>
      ) : null}

      {addId ? (
        <Notice tone="info" testID="add-pending" text={`Choose a slot for ${recipes.get(addId)?.title ?? 'this recipe'}.`}>
          <Button title="Cancel" variant="secondary" onPress={() => { setAddId(null); router.setParams({ add: undefined }); }} testID="add-cancel" />
        </Notice>
      ) : null}

      {consent ? (
        <View testID="consent-notice" accessibilityRole="alert" style={styles.banner}>
          <Text>{`${consent} - `}</Text>
          <Button title="Review in Settings" variant="secondary" onPress={() => router.push('/(tabs)/settings')} testID="consent-review" />
        </View>
      ) : null}

      {msg ? <Notice tone={msg.tone} text={msg.text} {...(msg.items ? { items: msg.items } : {})} testID="plan-message" /> : null}

      <Muted>Meals shown</Muted>
      <ChipRow>
        {MEAL_TYPES.map((m) => (
          <Chip
            key={m}
            label={MEAL_LABEL[m]}
            selected={doc.mealTypes.includes(m)}
            onPress={() => {
              const next = doc.mealTypes.includes(m) ? doc.mealTypes.filter((x) => x !== m) : [...doc.mealTypes, m];
              if (next.length === 0) return; // always keep one meal row
              setDoc(setMealTypes(doc, MEAL_TYPES.filter((x) => next.includes(x))));
              setDirty(true);
            }}
          />
        ))}
      </ChipRow>

      <Text testID="week-cost">
        {`Week cost: ${weekCostLabel(cost)}`}{doc.budgetPence != null ? ` (budget ${formatPence(doc.budgetPence)})` : ''}
      </Text>

      <Button title="Reuse previous week" variant="secondary" disabled={busy} onPress={() => void reusePrevious()} testID="reuse-previous" />
      <Button title="Save plan" variant="secondary" disabled={busy || (!dirty && saved)} onPress={() => void save()} testID="save-plan" />
      <Button title="Approve plan" disabled={busy || mealCount(doc) === 0 || (doc.status === 'approved' && !dirty)} onPress={() => void approve()} testID="approve-plan" />
      {doc.status === 'approved' && !dirty && saved ? (
        <Button title="Generate shopping list" variant="secondary" disabled={busy} onPress={() => void generate()} testID="generate-shopping" accessibilityHint="Builds your shopping list from the approved meals" />
      ) : null}

      {handoff ? (
        <Section title="Shopping list" testID="shopping-handoff">
          <Text>{`${handoff.count} ingredients added from this plan.`}</Text>
          {handoff.preview.map((p) => <Muted key={p.name}>{`- ${p.name}${p.quantity ? `: ${p.quantity}` : ''}`}</Muted>)}
          {handoff.count > handoff.preview.length ? <Muted>{`and ${handoff.count - handoff.preview.length} more`}</Muted> : null}
          <Button title="Open shopping list" onPress={() => router.push('/shopping' as never)} testID="open-shopping" />
        </Section>
      ) : null}

      {mealCount(doc) === 0 && Object.keys(doc.entries).length === 0 ? (
        <EmptyState title="Nothing planned this week" hint="Add a meal to any slot, or describe the week below and review a proposal." />
      ) : null}

      {days.map((date) => (
        <View key={date} testID={`day-${date}`} accessibilityLabel={`${dayShort(date)} ${dateShort(date)}`} style={styles.banner}>
          <Text style={{ fontWeight: '700', marginBottom: 4 }} accessibilityRole="header">{`${dayShort(date)} ${dateShort(date)}`}</Text>
          {meals.map((mealType) => {
            const slot = { date, mealType };
            const e = getEntry(doc, slot);
            const label = MEAL_LABEL[mealType];
            if (!e) {
              return (
                <Pressable
                  key={mealType}
                  testID={`slot-${date}-${mealType}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Add meal to ${label} on ${dayShort(date)}`}
                  onPress={() => {
                    if (addId) {
                      apply(setRecipe(doc, slot, addId, page.defaultServings));
                      setAddId(null);
                      router.setParams({ add: undefined });
                    } else setView({ name: 'pick', slot, mode: 'add' });
                  }}
                  style={{ minHeight: MIN_TAP, justifyContent: 'center' }}
                >
                  <Muted>{`${label}: + Add meal`}</Muted>
                </Pressable>
              );
            }
            const c = e.kind === 'recipe' ? mealCost(e, recipes) : { status: 'none' as const };
            const meta = [
              e.kind === 'recipe' ? `${e.servings} servings` : e.kind === 'eating_out' ? 'No shopping' : 'Uses leftovers',
              c.status === 'estimate' ? `${c.partial ? 'At least ' : ''}${formatPence(c.pence)} estimate` : c.status === 'uncosted' ? 'Uncosted' : '',
            ].filter(Boolean).join(' · ');
            return (
              <Pressable
                key={mealType}
                testID={`slot-${date}-${mealType}`}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${label} on ${dayShort(date)}: ${titleOf(e, recipes)}`}
                onPress={() => setView({ name: 'slot', slot })}
                style={{ minHeight: MIN_TAP, justifyContent: 'center', paddingVertical: 6 }}
              >
                <Muted>{label}</Muted>
                <Text style={{ fontWeight: '600' }}>{titleOf(e, recipes)}</Text>
                <Muted>{meta}</Muted>
                {e.note ? <Muted>{e.note}</Muted> : null}
              </Pressable>
            );
          })}
        </View>
      ))}

      <WeekSummary data={nutrition} />
      <WeekVarietyPanel planned={variety} {...(cookedVar !== undefined ? { cooked: cookedVar } : {})} />

      <PromptPlanner
        client={client}
        weekStart={doc.weekStart}
        recipes={recipes}
        examplePrompt={page.examplePrompt}
        exclusions={page.householdExclusions}
        memberNames={page.memberNames}
        onAccept={(next) => { apply(next(doc)); setHandoff(null); }}
      />

      {page.saved.length > 0 ? (
        <Section title="Saved plans">
          {page.saved.map((s) => (
            <Pressable
              key={s.id}
              testID={`saved-${s.weekStart}`}
              accessibilityRole="button"
              accessibilityLabel={`Open plan for week of ${dateShort(s.weekStart)}`}
              onPress={() => goToWeek(s.weekStart)}
              style={[styles.row, { minHeight: MIN_TAP }]}
            >
              <Text>{`Week of ${dateShort(s.weekStart)}`}</Text>
              <Muted>{s.status === 'approved' ? 'Approved' : 'Draft'}</Muted>
            </Pressable>
          ))}
        </Section>
      ) : null}
    </ScrollView>
  );

  return (
    <View style={{ flex: 1 }}>
      {sub}
      <View style={sub ? { display: 'none' } : { flex: 1 }}>{week}</View>
    </View>
  );
}
