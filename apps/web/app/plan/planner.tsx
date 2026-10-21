'use client';

import { useMemo, useState, useTransition, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Checkbox, EmptyState, IconButton, Input, SearchField, Select, Sheet, Stepper } from '@fr/ui';
import { addDays, dateShort, dayShort, weekDates, weekLabel } from '../../lib/plan/dates';
import { formatPence, mealCost, weekCost, weekCostLabel } from '../../lib/plan/cost';
import { weekNutrition } from '../../lib/plan/nutrition';
import { cookedVariety, weekVariety } from '../../lib/plan/variety';
import {
  getEntry, markSlot, mealCount, moveEntry, removeEntry, setLeftover, setMealTypes, setNote, setRecipe, setServings, shiftToWeek, slotKey, swapRecipe,
} from '../../lib/plan/ops';
import { MEAL_LABEL, MEAL_TYPES, type MealType, type PlanDoc, type PlanPageData, type RecipeLite, type SlotRef } from '../../lib/plan/types';
import { approvePlanAction, generateShoppingAction, loadWeekAction, savePlanAction } from './actions';
import { setBusyAction, markEatenAction } from './calendar-actions';
import { CalendarPanel, LeftoverPicker, LeftoverSuggestions } from './calendar-leftovers';
import { PromptPanel } from './prompt-panel';
import { WeekNutritionPanel } from './week-nutrition';
import { WeekVarietyPanel } from './week-variety';
import { WeekGoalsPanel } from './week-goals';
import { cookedGoals, weekGoals, type MyGoalsView } from '../../lib/plan/goals';
import './plan.css';

interface Msg { tone: 'info' | 'error'; text: string; items?: string[]; href?: string; hrefLabel?: string }
type SearchState = { slot: SlotRef; mode: 'add' | 'swap' } | null;

export function Planner({ data, myGoals }: { data: PlanPageData; myGoals?: MyGoalsView | null }) {
  const router = useRouter();
  const [doc, setDoc] = useState<PlanDoc>(data.doc);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(data.isSaved);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [search, setSearch] = useState<SearchState>(null);
  const [active, setActive] = useState<SlotRef | null>(null);
  const [pickFor, setPickFor] = useState<SlotRef | null>(null);
  const [pending, start] = useTransition();

  const recipes = useMemo(() => new Map(data.recipes.map((r) => [r.id, r])), [data.recipes]);
  const days = weekDates(doc.weekStart);
  const meals = MEAL_TYPES.filter((m) => doc.mealTypes.includes(m));
  const cost = weekCost(doc, recipes);
  const nutrition = useMemo(() => weekNutrition(doc, recipes), [doc, recipes]);
  const variety = useMemo(() => weekVariety(doc, recipes), [doc, recipes]);
  const cookedVar = useMemo(() => (data.cooked ? cookedVariety(data.cooked, recipes) : undefined), [data.cooked, recipes]);
  const goalsPlanned = useMemo(() => weekGoals(myGoals, doc, recipes), [myGoals, doc, recipes]);
  const goalsCooked = useMemo(() => (data.cooked ? cookedGoals(myGoals, data.cooked, recipes) : undefined), [myGoals, data.cooked, recipes]);

  const apply = (next: PlanDoc) => {
    setDoc(next);
    setDirty(true);
    setMsg(null);
  };

  const goToWeek = (week: string) => {
    if (dirty && !window.confirm('You have unsaved changes to this week. Discard them?')) return;
    router.push(`/plan?week=${week}`);
  };

  const fail = (res: { message: string; violations?: string[] }) => setMsg({ tone: 'error', text: res.message, items: res.violations });

  const save = () =>
    start(async () => {
      const res = await savePlanAction(doc);
      if (!res.ok) return fail(res);
      setDoc(res.value);
      setDirty(false);
      setSaved(true);
      setMsg({ tone: 'info', text: 'Plan saved. You can reopen it from this week at any time.' });
      router.refresh();
    });

  const approve = () =>
    start(async () => {
      const res = await approvePlanAction(doc);
      if (!res.ok) return fail(res);
      setDoc(res.value);
      setDirty(false);
      setSaved(true);
      setMsg({ tone: 'info', text: 'Plan approved and saved. No shopping list has been created yet.' });
      router.refresh();
    });

  const generate = () =>
    start(async () => {
      const res = await generateShoppingAction(doc.id);
      if (!res.ok) return fail(res);
      setMsg({
        tone: 'info',
        text: `Shopping requirements built from your approved meals (${res.value.count} ingredients).`,
        href: res.value.href,
        hrefLabel: 'Open shopping list',
      });
    });

  const reusePrevious = () =>
    start(async () => {
      const prev = await loadWeekAction(addDays(doc.weekStart, -7));
      if (!prev) return setMsg({ tone: 'error', text: 'There is no saved plan for the previous week to reuse.' });
      apply({ ...shiftToWeek(prev, doc.weekStart, doc.id), mealTypes: prev.mealTypes });
      setMsg({ tone: 'info', text: 'Last week copied into this week as a draft. Save it to keep it.' });
    });

  const onDrop = (e: DragEvent, to: SlotRef) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('text/plain');
    const [date, mealType] = raw.split('|');
    if (!date || !mealType) return;
    apply(moveEntry(doc, { date, mealType: mealType as MealType }, to, e.altKey || e.ctrlKey ? 'duplicate' : 'move'));
  };

  const status = dirty ? <Badge tone="warning">Unsaved changes</Badge> : doc.status === 'approved' ? <Badge tone="success">Approved</Badge> : saved ? <Badge>Saved draft</Badge> : <Badge>Not saved yet</Badge>;
  const activeEntry = active ? getEntry(doc, active) : undefined;
  const titleOf = (id: string) => recipes.get(id)?.title ?? id;
  // P2-C: busy evenings, stored leftovers / freezer meals, eaten leftover slots.
  const busyByDate = useMemo(() => new Map((data.busy ?? []).map((b) => [b.date, b])), [data.busy]);
  const stored = data.leftovers?.batches ?? [];
  const storedTitle = (batchId?: string): string => (batchId ? data.leftovers?.titles[batchId] : undefined) ?? 'Stored meal';
  const storedKind = (batchId?: string): string => (stored.find((b) => b.id === batchId)?.storedIn === 'freezer' ? 'Freezer meal' : 'Leftovers');
  const eaten = new Set(data.eatenSlots ?? []);
  const toggleBusy = (date: string) =>
    start(async () => {
      const manual = busyByDate.get(date)?.sources.includes('manual') ?? false;
      const res = await setBusyAction(date, !manual);
      if (!res.ok) return setMsg({ tone: 'error', text: res.message });
      router.refresh();
    });
  const markEaten = (slot: SlotRef) =>
    start(async () => {
      const res = await markEatenAction(doc.id, slot.date, slot.mealType);
      if (!res.ok) return setMsg({ tone: 'error', text: res.message });
      setMsg({ tone: 'info', text: res.applied ? `Marked eaten. ${res.portionsLeft} portion${res.portionsLeft === 1 ? '' : 's'} of that batch left.` : 'That meal was already marked eaten.' });
      router.refresh();
    });
  const suggestions = (data.leftovers?.suggestions ?? []).filter((x) => x.date >= doc.weekStart && !getEntry(doc, { date: x.date, mealType: x.mealType as MealType }));
  const allSlots = days.flatMap((d) => meals.map((m) => ({ date: d, mealType: m })));

  return (
    <div className="plan">
      <div className="plan__bar">
        <div className="plan__weeknav" role="group" aria-label="Week navigation">
          <IconButton label="Previous week" icon="minus" variant="secondary" onClick={() => goToWeek(addDays(doc.weekStart, -7))} />
          <span className="plan__weeklabel" data-testid="week-label">{weekLabel(doc.weekStart)}</span>
          <IconButton label="Next week" icon="plus" variant="secondary" onClick={() => goToWeek(addDays(doc.weekStart, 7))} />
        </div>
        <div className="plan__status" aria-live="polite">{status}</div>
      </div>

      <fieldset className="plan__meals">
        <legend>Meals shown</legend>
        {MEAL_TYPES.map((m) => (
          <Checkbox
            key={m}
            label={MEAL_LABEL[m]}
            checked={doc.mealTypes.includes(m)}
            onChange={(e) => {
              const next = e.target.checked ? [...doc.mealTypes, m] : doc.mealTypes.filter((x) => x !== m);
              if (next.length === 0) return; // always keep one meal row
              setDoc(setMealTypes(doc, MEAL_TYPES.filter((x) => next.includes(x))));
              setDirty(true);
            }}
          />
        ))}
      </fieldset>

      {msg && (
        <div className={`plan__msg${msg.tone === 'error' ? ' plan__msg--error' : ''}`} role={msg.tone === 'error' ? 'alert' : 'status'} data-testid="plan-message">
          {msg.text}
          {msg.items && <ul>{msg.items.map((i) => <li key={i}>{i}</li>)}</ul>}
          {msg.href && <> <a href={msg.href}>{msg.hrefLabel}</a></>}
        </div>
      )}

      <div className="plan__bar">
        <p className="plan__cost" data-testid="week-cost">
          Week cost: {weekCostLabel(cost)}
          {doc.budgetPence != null && <span className="plan__muted"> (budget {formatPence(doc.budgetPence)})</span>}
        </p>
        <div className="plan__actions">
          <Button variant="secondary" onClick={reusePrevious} disabled={pending}>Reuse previous week</Button>
          <Button variant="secondary" onClick={save} loading={pending} disabled={!dirty && saved}>Save plan</Button>
          <Button onClick={approve} disabled={pending || mealCount(doc) === 0 || (doc.status === 'approved' && !dirty)}>Approve plan</Button>
          {doc.status === 'approved' && !dirty && saved && <Button variant="secondary" onClick={generate} disabled={pending}>Generate shopping list</Button>}
        </div>
      </div>

      {mealCount(doc) === 0 && Object.keys(doc.entries).length === 0 && (
        <EmptyState icon="calendar" title="Nothing planned this week" description="Add a meal to any slot, or describe the week below and review a proposal." />
      )}

      <div className="plan__grid" role="list" aria-label="Weekly plan">
        {days.map((date) => (
          <section key={date} className="plan__day" role="listitem" aria-label={`${dayShort(date)} ${dateShort(date)}`}>
            <h3>{dayShort(date)} {dateShort(date)}</h3>
            <div className="plan__inline">
              <Button
                size="sm"
                variant={busyByDate.get(date)?.sources.includes('manual') ? 'primary' : 'ghost'}
                aria-pressed={busyByDate.get(date)?.sources.includes('manual') ?? false}
                onClick={() => toggleBusy(date)}
                disabled={pending}
                data-testid={`busy-${date}`}
                aria-label={`Mark ${dayShort(date)} ${dateShort(date)} as a busy evening`}
              >
                Busy
              </Button>
              {busyByDate.get(date) && <Badge tone={busyByDate.get(date)!.skip ? 'warning' : 'neutral'} data-testid={`busy-chip-${date}`}>{busyByDate.get(date)!.label}</Badge>}
            </div>
            {meals.map((mealType) => {
              const slot = { date, mealType };
              const e = getEntry(doc, slot);
              const label = MEAL_LABEL[mealType];
              const common = {
                'data-testid': `slot-${date}-${mealType}`,
                onDragOver: (ev: DragEvent) => ev.preventDefault(),
                onDrop: (ev: DragEvent) => onDrop(ev, slot),
              };
              if (!e) {
                return (
                  <div key={mealType} className="plan__slot" {...common}>
                    <span className="plan__slot-label">{label}</span>
                    <Button variant="ghost" onClick={() => setSearch({ slot, mode: 'add' })} aria-label={`Add meal to ${label} on ${dayShort(date)}`}>+ Add meal</Button>
                    {stored.some((b) => b.portionsFree > 0) && <Button variant="ghost" size="sm" onClick={() => setPickFor(slot)} aria-label={`Add a leftover or freezer meal to ${label} on ${dayShort(date)}`}>+ Leftover / freezer</Button>}
                  </div>
                );
              }
              const c = e.kind === 'recipe' ? mealCost(e, recipes) : { status: 'none' as const };
              const title = e.kind === 'recipe' ? titleOf(e.recipeId) : e.kind === 'eating_out' ? 'Eating out' : e.batchId ? `${storedKind(e.batchId)}: ${storedTitle(e.batchId)}` : 'Leftovers';
              const isEaten = eaten.has(slotKey(slot));
              return (
                <div
                  key={mealType}
                  className="plan__slot plan__slot--filled"
                  draggable
                  onDragStart={(ev) => { ev.dataTransfer.setData('text/plain', slotKey(slot)); ev.dataTransfer.effectAllowed = 'copyMove'; }}
                  {...common}
                >
                  <span className="plan__slot-label">{label}</span>
                  <div className="plan__slot-row">
                    <button type="button" className="plan__slot-title" onClick={() => setActive(slot)}>{title}</button>
                    <IconButton label={`Remove ${title} from ${label} on ${dayShort(date)}`} icon="trash" onClick={() => apply(removeEntry(doc, slot))} />
                  </div>
                  <div className="plan__slot-meta">
                    {e.kind === 'recipe' && <span>{e.servings} servings</span>}
                    {c.status === 'estimate' && <span>{c.partial ? 'At least ' : ''}{formatPence(c.pence)} estimate</span>}
                    {c.status === 'uncosted' && <span>Uncosted</span>}
                    {e.kind === 'leftovers' && e.batchId && <span>{e.portions ?? 1} portion{(e.portions ?? 1) === 1 ? '' : 's'}</span>}
                    {e.kind !== 'recipe' && <Badge>{e.kind === 'eating_out' ? 'No shopping' : 'Uses leftovers'}</Badge>}
                    {isEaten && <Badge tone="success">Eaten</Badge>}
                  </div>
                  {e.note && <span className="plan__slot-note">{e.note}</span>}
                  <Button size="sm" variant="ghost" onClick={() => setActive(slot)} aria-label={`Edit ${label} on ${dayShort(date)}`}>Edit</Button>
                  {e.kind === 'leftovers' && e.batchId && !isEaten && (
                    <Button size="sm" variant="secondary" onClick={() => markEaten(slot)} disabled={pending || dirty || !saved} aria-label={`Mark ${title} on ${dayShort(date)} as eaten`} title={dirty || !saved ? 'Save the plan first' : undefined}>Mark eaten</Button>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <p className="plan__muted">Drag a meal to another slot to move it (hold Alt or Ctrl to duplicate). On a phone, use Edit to move, duplicate or swap.</p>

      <LeftoverSuggestions suggestions={suggestions} onPlace={(x) => apply(setLeftover(doc, { date: x.date, mealType: x.mealType as MealType }, x.batchId, x.portions))} />
      <LeftoverPicker
        open={!!pickFor}
        onClose={() => setPickFor(null)}
        batches={stored}
        slotLabel={pickFor ? `${MEAL_LABEL[pickFor.mealType]}, ${dayShort(pickFor.date)} ${dateShort(pickFor.date)}` : ''}
        onPick={(b, portions) => { if (pickFor) apply(setLeftover(doc, pickFor, b.id, portions)); setPickFor(null); }}
      />

      <WeekNutritionPanel data={nutrition} />
      <WeekVarietyPanel planned={variety} {...(cookedVar !== undefined ? { cooked: cookedVar } : {})} />
      <WeekGoalsPanel planned={goalsPlanned} {...(goalsCooked !== undefined ? { cooked: goalsCooked } : {})} />

      <PromptPanel
        weekStart={doc.weekStart}
        recipes={recipes}
        examplePrompt={data.examplePrompt}
        exclusions={data.householdExclusions}
        memberNames={data.memberNames}
        dislikes={data.memberDislikes}
        busy={data.busy}
        onAccept={(next) => apply(next(doc))}
      />

      <CalendarPanel />

      {data.saved.length > 0 && (
        <section className="plan__panel" aria-label="Saved plans">
          <h2>Saved plans</h2>
          <ul className="plan__list">
            {data.saved.map((s) => (
              <li key={s.id} className="plan__row">
                <span>Week of {dateShort(s.weekStart)} <Badge tone={s.status === 'approved' ? 'success' : 'neutral'}>{s.status === 'approved' ? 'Approved' : 'Draft'}</Badge></span>
                <Button size="sm" variant="secondary" onClick={() => goToWeek(s.weekStart)} aria-label={`Open plan for week of ${dateShort(s.weekStart)}`}>Open</Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RecipeSearchSheet
        state={search}
        recipes={data.recipes}
        onClose={() => setSearch(null)}
        onPick={(r) => {
          if (!search) return;
          const fallback = data.defaultServings;
          apply(search.mode === 'swap' ? swapRecipe(doc, search.slot, r.id, fallback) : setRecipe(doc, search.slot, r.id, fallback));
          setSearch(null);
          setActive(null);
        }}
      />

      <Sheet
        open={!!active && !!activeEntry}
        onOpenChange={(o) => !o && setActive(null)}
        title={active && activeEntry ? `${activeEntry.kind === 'recipe' ? titleOf(activeEntry.recipeId) : activeEntry.kind === 'eating_out' ? 'Eating out' : activeEntry.batchId ? `${storedKind(activeEntry.batchId)}: ${storedTitle(activeEntry.batchId)}` : 'Leftovers'}` : 'Meal'}
        description={active ? `${MEAL_LABEL[active.mealType]}, ${dayShort(active.date)} ${dateShort(active.date)}` : undefined}
      >
        {active && activeEntry && (
          <SlotActions
            key={slotKey(active)}
            slot={active}
            entry={activeEntry}
            allSlots={allSlots}
            onServings={(n) => apply(setServings(doc, active, n))}
            onPortions={(n) => activeEntry.kind === 'leftovers' && activeEntry.batchId && apply(setLeftover(doc, active, activeEntry.batchId, n))}
            maxPortions={Math.max(1, (stored.find((b) => b.id === (activeEntry.kind === 'leftovers' ? activeEntry.batchId : undefined))?.portionsLeft ?? 99))}
            onSwap={() => setSearch({ slot: active, mode: 'swap' })}
            onKind={(k) => { apply(markSlot(doc, active, k)); setActive(null); }}
            onNote={(t) => apply(setNote(doc, active, t))}
            onMove={(to, mode) => { apply(moveEntry(doc, active, to, mode)); setActive(null); }}
            onRemove={() => { apply(removeEntry(doc, active)); setActive(null); }}
          />
        )}
      </Sheet>
    </div>
  );
}

function SlotActions(props: {
  slot: SlotRef;
  entry: NonNullable<ReturnType<typeof getEntry>>;
  allSlots: SlotRef[];
  onServings: (n: number) => void;
  onPortions: (n: number) => void;
  maxPortions: number;
  onSwap: () => void;
  onKind: (k: 'eating_out' | 'leftovers') => void;
  onNote: (t: string) => void;
  onMove: (to: SlotRef, mode: 'move' | 'duplicate') => void;
  onRemove: () => void;
}) {
  const { slot, entry } = props;
  const options = props.allSlots
    .filter((s) => slotKey(s) !== slotKey(slot))
    .map((s) => ({ value: slotKey(s), label: `${dayShort(s.date)} ${dateShort(s.date)}, ${MEAL_LABEL[s.mealType]}` }));
  const [target, setTarget] = useState(options[0]?.value ?? '');
  const [note, setNoteText] = useState(entry.note ?? '');
  const to = (): SlotRef | null => {
    const [date, mealType] = target.split('|');
    return date && mealType ? { date, mealType: mealType as MealType } : null;
  };
  return (
    <div>
      {entry.kind === 'recipe' && (
        <div className="plan__sheet-section">
          <Stepper label="Servings" value={entry.servings} min={1} max={99} onChange={props.onServings} />
        </div>
      )}
      {entry.kind === 'leftovers' && entry.batchId && (
        <div className="plan__sheet-section">
          <Stepper label="Portions" value={entry.portions ?? 1} min={1} max={props.maxPortions} onChange={props.onPortions} />
        </div>
      )}
      <div className="plan__sheet-section">
        <div className="plan__inline">
          <Button variant="secondary" onClick={props.onSwap}>{entry.kind === 'recipe' ? 'Swap recipe' : 'Choose a recipe'}</Button>
          {entry.kind !== 'eating_out' && <Button variant="secondary" onClick={() => props.onKind('eating_out')}>Mark eating out</Button>}
          {entry.kind !== 'leftovers' && <Button variant="secondary" onClick={() => props.onKind('leftovers')}>Mark leftovers</Button>}
        </div>
      </div>
      <div className="plan__sheet-section">
        <div className="plan__inline">
          <Input label="Note" value={note} maxLength={200} onChange={(e) => setNoteText(e.target.value)} onBlur={() => props.onNote(note)} />
          <Button variant="secondary" onClick={() => props.onNote(note)}>Save note</Button>
        </div>
      </div>
      {options.length > 0 && (
        <div className="plan__sheet-section">
          <Select label="Move or duplicate to" hint="If the target already has a meal, moving swaps the two." options={options} value={target} onChange={(e) => setTarget(e.target.value)} />
          <div className="plan__inline">
            <Button variant="secondary" onClick={() => { const t = to(); if (t) props.onMove(t, 'move'); }}>Move</Button>
            <Button variant="secondary" onClick={() => { const t = to(); if (t) props.onMove(t, 'duplicate'); }}>Duplicate</Button>
          </div>
        </div>
      )}
      <div className="plan__sheet-section">
        <Button variant="danger" onClick={props.onRemove}>Remove from plan</Button>
      </div>
    </div>
  );
}

function RecipeSearchSheet({ state, recipes, onClose, onPick }: { state: SearchState; recipes: RecipeLite[]; onClose: () => void; onPick: (r: RecipeLite) => void }) {
  const [q, setQ] = useState('');
  const mealType = state?.slot.mealType;
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return recipes
      .filter((r) => !needle || r.title.toLowerCase().includes(needle) || r.tags.some((t) => t.includes(needle)))
      .sort((a, b) => Number(b.mealTypes.includes(mealType ?? 'dinner')) - Number(a.mealTypes.includes(mealType ?? 'dinner')) || a.title.localeCompare(b.title));
  }, [recipes, q, mealType]);
  return (
    <Sheet
      open={!!state}
      onOpenChange={(o) => { if (!o) { setQ(''); onClose(); } }}
      title={state?.mode === 'swap' ? 'Swap recipe' : 'Add a recipe'}
      description={state ? `${MEAL_LABEL[state.slot.mealType]}, ${dayShort(state.slot.date)} ${dateShort(state.slot.date)}` : undefined}
    >
      <SearchField label="Search recipes" placeholder="Search your recipes" value={q} onValueChange={setQ} />
      <ul className="plan__list" style={{ marginTop: 'var(--fr-space-3)' }} data-testid="recipe-results">
        {list.length === 0 && <li className="plan__muted">No saved recipes match that search.</li>}
        {list.map((r) => {
          const blocked = r.excludedBy.length > 0;
          return (
            <li key={r.id} className="plan__row">
              <span className="plan__row-main">
                <strong>{r.title}</strong>
                <span className="plan__muted">
                  {r.dietCategory ?? 'recipe'}
                  {r.totalMinutes ? ` · ${r.totalMinutes} min` : ''}
                  {` · ${r.costPerServingPence == null ? 'uncosted' : `${r.costPartial ? 'at least ' : ''}${formatPence(r.costPerServingPence)} per serving (estimate)`}`}
                  {mealType && !r.mealTypes.includes(mealType) ? ` · not usually ${MEAL_LABEL[mealType].toLowerCase()}` : ''}
                </span>
                {blocked && <span className="plan__muted">Excluded: contains {r.excludedBy.join(', ')}</span>}
              </span>
              <Button size="sm" variant="secondary" disabled={blocked} onClick={() => onPick(r)} aria-label={`Select ${r.title}`}>Select</Button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
