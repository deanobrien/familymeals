'use client';

// Minimum pantry stock (PR1, D280-D289): "Set minimum" form, "Running low" panel, minimums list + auto-add setting.
import { useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Card, CardBody, Checkbox, Input, Select } from '@fr/ui';
import { SNOOZE_DAYS, type ParView, type RestockSuggestionView, type RestockView } from '../../lib/restock/types';
import { categoryLabel, type IngredientHit } from '../../lib/pantry/types';
import { searchIngredientsAction } from '../../lib/server/pantry/actions';
import {
  addRestockToListAction, removeParAction, setParAction, snoozeRestockAction, updateRestockSettingsAction,
} from '../../lib/server/restock/actions';
import { unitOptions } from './add-item';
import { usePantryAction } from './use-pantry-action';
import s from './pantry.module.css';

/* ---------- Set / edit one minimum ---------- */
export interface ParFormProps {
  /** Fixed ingredient / name (from a pantry row or an existing minimum). Absent = the form asks for it. */
  fixed?: { name: string; ingredientId?: string };
  existing?: ParView;
  defaultUnit?: string;
  onDone: () => void;
}

export function ParForm({ fixed, existing, defaultUnit, onDone }: ParFormProps) {
  const { pending, run } = usePantryAction();
  const label = fixed?.name ?? existing?.name ?? 'item';
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<IngredientHit[]>([]);
  const [chosen, setChosen] = useState<IngredientHit | null>(null);
  const [min, setMin] = useState(existing ? String(existing.minValue) : '');
  const [unit, setUnit] = useState(existing?.unit ?? defaultUnit ?? 'item');
  const [restockTo, setRestockTo] = useState(existing?.restockToValue !== undefined ? String(existing.restockToValue) : '');
  const [packValue, setPackValue] = useState(existing?.pack ? String(existing.pack.value) : '');
  const [packUnit, setPackUnit] = useState<string>(existing?.pack?.unit ?? 'g');
  const seq = useRef(0);

  async function onQuery(q: string) {
    setQuery(q);
    setChosen(null);
    const mine = ++seq.current;
    if (!q.trim()) return setMatches([]);
    const hits = await searchIngredientsAction(q);
    if (mine === seq.current) setMatches(hits);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const ingredientId = fixed ? fixed.ingredientId : chosen?.id ?? existing?.ingredientId;
    const name = fixed ? fixed.name : chosen?.name ?? (query || existing?.name || '');
    run(
      () =>
        setParAction({
          ...(ingredientId ? { ingredientId } : {}),
          name, unit, min: Number(min),
          restockTo: restockTo.trim() ? Number(restockTo) : null,
          packValue: packValue.trim() ? Number(packValue) : null,
          packUnit: packValue.trim() ? packUnit : null,
        }),
      onDone,
    );
  }

  return (
    <form className={s.inlineForm} onSubmit={submit} aria-label={`Set minimum for ${label}`}>
      {!fixed && !existing && (
        <div style={{ flex: '1 1 100%', display: 'flex', flexDirection: 'column', gap: 'var(--fr-space-2)' }}>
          <Input label="Ingredient" value={query} onChange={(e) => void onQuery(e.target.value)} autoComplete="off"
            placeholder="Start typing, e.g. tinned tomatoes"
            hint={chosen ? undefined : 'Pick a match, or leave as typed to save it by name only.'} />
          {chosen && <div className={s.badges}><Badge tone="success">Matched: {chosen.name}</Badge><span className={s.muted}>{categoryLabel(chosen.category)}</span></div>}
          {matches.length > 0 && (
            <ul className={s.matches} aria-label="Ingredient matches">
              {matches.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => { setChosen(m); setQuery(m.name); setMatches([]); }}>
                    {m.name} <span className={s.muted}>({categoryLabel(m.category)})</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Input label="Minimum to keep" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="e.g. 6" />
      <Select label="Unit" options={unitOptions} value={unit} onChange={(e) => setUnit(e.target.value)} />
      <Input label="Restock to (optional)" inputMode="decimal" value={restockTo} onChange={(e) => setRestockTo(e.target.value)} placeholder="same as minimum" />
      <Input label="Pack size (optional)" inputMode="decimal" value={packValue} onChange={(e) => setPackValue(e.target.value)} placeholder="e.g. 400" />
      <Select label="Pack unit" options={unitOptions} value={packUnit} onChange={(e) => setPackUnit(e.target.value)} />
      <Button type="submit" size="sm" loading={pending}>Save minimum</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
    </form>
  );
}

/* ---------- Pantry row: "Set minimum" / "Min 6 can" button, and the editor shown under the row ---------- */
export function MinimumButton({ name, par, open, onToggle }: { name: string; par?: ParView; open: boolean; onToggle: () => void }) {
  return (
    <Button size="sm" variant="secondary" aria-expanded={open} aria-label={par ? `Edit minimum for ${name}` : `Set minimum for ${name}`} onClick={onToggle}>
      {par ? `Min ${par.minValue} ${par.unit}` : 'Set minimum'}
    </Button>
  );
}

export function MinimumEditor({ name, ingredientId, unit, par, onDone }: { name: string; ingredientId?: string; unit?: string; par?: ParView; onDone: () => void }) {
  const { pending, run } = usePantryAction();
  return (
    <>
      <ParForm fixed={{ name, ...(ingredientId ? { ingredientId } : {}) }} {...(par ? { existing: par } : {})} {...(unit ? { defaultUnit: unit } : {})} onDone={onDone} />
      {par && (
        <div style={{ paddingTop: 'var(--fr-space-2)' }}>
          <Button size="sm" variant="ghost" loading={pending} aria-label={`Remove minimum for ${name}`} onClick={() => run(() => removeParAction(par.id), onDone)}>
            Remove minimum
          </Button>
        </div>
      )}
    </>
  );
}

/* ---------- Running low ---------- */
function SuggestionRow({ sug }: { sug: RestockSuggestionView }) {
  const { pending, run } = usePantryAction();
  return (
    <li>
      <div className={s.row}>
        <div className={s.rowMain}>
          <span className={s.name}>{sug.name}</span>
          <span className={s.muted}>{sug.explanation}</span>
          {sug.notes.length > 0 && <span className={s.muted}>{sug.notes.join('. ')}</span>}
        </div>
        <div className={s.badges}>
          {sug.checkQuantity && <Badge tone="warning">Check quantity</Badge>}
          {sug.kind === 'will_run_low' && <Badge>After this week&apos;s plan</Badge>}
        </div>
        <div className={s.actions}>
          <Button size="sm" loading={pending} aria-label={`Add ${sug.quantityLabel} ${sug.name} to the shopping list`}
            onClick={() => run(() => addRestockToListAction([sug.parId]))}>
            Add {sug.quantityLabel}
          </Button>
          <Button size="sm" variant="ghost" loading={pending} aria-label={`Snooze ${sug.name} for ${SNOOZE_DAYS} days`}
            onClick={() => run(() => snoozeRestockAction(sug.parId, SNOOZE_DAYS))}>
            Snooze {SNOOZE_DAYS} days
          </Button>
        </div>
      </div>
    </li>
  );
}

export function RunningLowPanel({ view }: { view: RestockView }) {
  const { pending, run } = usePantryAction();
  const { suggestions, willRunLow } = view;
  return (
    <section className={s.section} aria-labelledby="low-h">
      <h2 id="low-h">Running low{suggestions.length > 0 ? ` (${suggestions.length})` : ''}</h2>
      {suggestions.length === 0 ? (
        <p className={s.lead}>
          {view.pars.length === 0
            ? 'Set a minimum on any item below (for example 6 tins of tomatoes) and we will suggest what to add to your shopping list when you run low.'
            : 'Nothing is below its minimum.'}
          {view.snoozedCount > 0 && ` ${view.snoozedCount} snoozed.`}
        </p>
      ) : (
        <Card>
          <CardBody>
            <ul className={s.list} aria-label="Below minimum">
              {suggestions.map((x) => <SuggestionRow key={x.parId} sug={x} />)}
            </ul>
            {suggestions.length > 1 && (
              <div>
                <Button loading={pending} onClick={() => run(() => addRestockToListAction())}>Add all to shopping list</Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}
      {willRunLow.length > 0 && (
        <>
          <h3 style={{ margin: 0 }}>Will run low after this week&apos;s plan</h3>
          <Card>
            <CardBody>
              <ul className={s.list} aria-label="Will run low">
                {willRunLow.map((x) => <SuggestionRow key={x.parId} sug={x} />)}
              </ul>
            </CardBody>
          </Card>
        </>
      )}
    </section>
  );
}

/* ---------- Minimums list + household setting ---------- */
function MinimumRow({ par }: { par: ParView }) {
  const [editing, setEditing] = useState(false);
  const { pending, run } = usePantryAction();
  return (
    <li>
      <div className={s.row}>
        <div className={s.rowMain}>
          <span className={s.name}>{par.name}</span>
          <span className={s.muted}>{par.label}</span>
          <span className={s.muted}>{par.status}</span>
        </div>
        <div className={s.badges}>{par.belowMin && <Badge tone="warning">Below minimum</Badge>}</div>
        <div className={s.actions}>
          <Button size="sm" variant="secondary" aria-expanded={editing} aria-label={`Change ${par.name} minimum`} onClick={() => setEditing((v) => !v)}>Edit</Button>
          <Button size="sm" variant="ghost" loading={pending} aria-label={`Delete ${par.name} minimum`} onClick={() => run(() => removeParAction(par.id))}>Remove</Button>
        </div>
      </div>
      {editing && <ParForm existing={par} fixed={{ name: par.name, ...(par.ingredientId ? { ingredientId: par.ingredientId } : {}) }} onDone={() => setEditing(false)} />}
    </li>
  );
}

export function MinimumsPanel({ view }: { view: RestockView }) {
  const { pending, run } = usePantryAction();
  const [adding, setAdding] = useState(false);
  return (
    <section className={s.section} aria-labelledby="mins-h">
      <h2 id="mins-h">Your minimums</h2>
      <Card>
        <CardBody>
          {view.pars.length === 0 ? (
            <p className={s.lead}>No minimums yet. Use &ldquo;Set minimum&rdquo; on an item, or add one here for something you have run out of.</p>
          ) : (
            <ul className={s.list} aria-label="Minimums">
              {view.pars.map((p) => <MinimumRow key={p.id} par={p} />)}
            </ul>
          )}
          <div>
            <Button size="sm" variant="secondary" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>Add a minimum</Button>
          </div>
          {adding && <ParForm onDone={() => setAdding(false)} />}
          <Checkbox
            label="Automatically add restock items to the shopping list"
            checked={view.settings.autoAdd}
            disabled={pending}
            onChange={(e) => run(() => updateRestockSettingsAction({ autoAdd: e.target.checked }))}
          />
          <p className={s.muted} style={{ margin: 0 }}>
            Off by default: below-minimum items are only suggested. When on, they are added whenever your pantry changes
            (items that need a quantity check or are snoozed are left for you).
          </p>
        </CardBody>
      </Card>
    </section>
  );
}
