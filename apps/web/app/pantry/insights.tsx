'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, CardBody, Checkbox, Input } from '@fr/ui';
import type { LeftoverView, PendingAdjustmentView, PantryView, SuggestionView } from '../../lib/pantry/types';
import { acceptAdjustmentAction, dismissAdjustmentAction, planLeftoversAction } from '../../lib/server/pantry/actions';
import { usePantryAction } from './use-pantry-action';
import s from './pantry.module.css';

/* ---------- Use what I have ---------- */
export function UseWhatIHave({ suggestions }: { suggestions: SuggestionView[] }) {
  return (
    <section className={s.section} aria-labelledby="use-h">
      <h2 id="use-h">Use what I have</h2>
      {suggestions.length === 0 ? (
        <p className={s.lead}>Add some stock and we will suggest recipes that make the most of it.</p>
      ) : (
        <ol className={s.list} aria-label="Recipe suggestions">
          {suggestions.map((r) => (
            <li key={r.recipeId}>
              <Card>
                <CardBody>
                  <div className={s.row}>
                    <div className={s.rowMain}>
                      <Link href={r.href} className={s.name}>{r.title}</Link>
                      <span className={s.muted}>{r.headline}</span>
                    </div>
                    <div className={s.badges}>
                      <Badge tone={r.coveragePct >= 70 ? 'success' : 'neutral'}>{r.coveragePct}% covered</Badge>
                      {r.urgencyPct > 0 && <Badge tone="warning">Uses expiring stock</Badge>}
                    </div>
                  </div>
                  <ul className={s.explain}>
                    {r.explanations.map((e) => <li key={e}>{e}</li>)}
                  </ul>
                  {r.missing.length > 0 && <p className={s.muted}>Still needed: {r.missing.join(', ')}</p>}
                </CardBody>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ---------- Pending purchase adjustments (suggest mode) ---------- */
function PendingRow({ p }: { p: PendingAdjustmentView }) {
  const { pending, run } = usePantryAction();
  const [expiry, setExpiry] = useState('');
  return (
    <li>
      <div className={s.row}>
        <div className={s.rowMain}>
          <span className={s.name}>{p.name} <span className={s.muted}>{p.quantityLabel}</span></span>
          <span className={s.muted}>{p.reason}</span>
        </div>
        <div className={s.actions}>
          {p.ingredientId && (
            <Input label={`Expiry for ${p.name} (optional)`} hideLabel type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} wrapperClassName="" />
          )}
          <Button size="sm" loading={pending} aria-label={`Add ${p.name} to pantry`} onClick={() => run(() => acceptAdjustmentAction(p.eventId, expiry || undefined))}>
            Add to pantry
          </Button>
          <Button size="sm" variant="ghost" aria-label={`Ignore ${p.name}`} onClick={() => run(() => dismissAdjustmentAction(p.eventId))}>
            Ignore
          </Button>
        </div>
      </div>
    </li>
  );
}

export function PendingPurchases({ pending, mode }: { pending: PendingAdjustmentView[]; mode: PantryView['settings']['purchaseMode'] }) {
  if (mode === 'off') return null;
  return (
    <section className={s.section} aria-labelledby="pending-h">
      <h2 id="pending-h">Recent purchases to review{pending.length ? ` (${pending.length})` : ''}</h2>
      {pending.length === 0 ? (
        <p className={s.lead}>No purchases waiting for review.</p>
      ) : (
        <Card>
          <CardBody>
            <p className={s.lead}>Add what you bought to your pantry, or ignore it if it is already used or was not for stock.</p>
            <ul className={s.list} aria-label="Pending purchases">
              {pending.map((p) => <PendingRow key={p.eventId} p={p} />)}
            </ul>
          </CardBody>
        </Card>
      )}
    </section>
  );
}

/* ---------- Leftovers ---------- */
function LeftoverCard({ l }: { l: LeftoverView }) {
  return (
    <Card>
      <CardBody>
        <div className={s.row}>
          <div className={s.rowMain}>
            <span className={s.name}>{l.title}</span>
            <span className={s.muted}>{l.summary}</span>
          </div>
          <Link href="/plan">Open meal planner</Link>
        </div>
        {l.suggestions.length > 0 && (
          <ul className={s.explain} aria-label={`Suggested slots for ${l.title}`}>
            {l.suggestions.map((t) => <li key={t}>{t}</li>)}
          </ul>
        )}
        {l.advice.map((a) => <p key={a} className={s.muted}>{a}</p>)}
      </CardBody>
    </Card>
  );
}

export function LeftoversPanel({ leftovers }: { leftovers: LeftoverView[] }) {
  const [title, setTitle] = useState('');
  const [cooked, setCooked] = useState('4');
  const [eaten, setEaten] = useState('1');
  const [freezable, setFreezable] = useState(false);
  const [custom, setCustom] = useState<LeftoverView | null>(null);
  const [error, setError] = useState('');
  const { pending, run } = usePantryAction();

  function plan(e: FormEvent) {
    e.preventDefault();
    setError('');
    run(async () => {
      const res = await planLeftoversAction({ title, portionsCooked: Number(cooked), portionsEaten: Number(eaten), freezable });
      if (res.ok) {
        setCustom(res.plan);
        return { ok: true as const };
      }
      setCustom(null);
      setError(res.error);
      return { ok: false as const, error: res.error };
    });
  }

  return (
    <section className={s.section} aria-labelledby="left-h">
      <h2 id="left-h">Leftovers and batch cooking</h2>
      {leftovers.length === 0 && <p className={s.lead}>No leftovers right now.</p>}
      {leftovers.map((l) => <LeftoverCard key={l.key} l={l} />)}
      <Card>
        <CardBody>
          <form className={s.cardBody} onSubmit={plan} aria-label="Plan leftovers">
            <h3 style={{ margin: 0 }}>Cooked a batch today?</h3>
            <div className={s.formGrid}>
              <Input label="Meal" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Chilli" />
              <Input label="Portions cooked" type="number" min={0} value={cooked} onChange={(e) => setCooked(e.target.value)} />
              <Input label="Portions eaten" type="number" min={0} value={eaten} onChange={(e) => setEaten(e.target.value)} />
            </div>
            <Checkbox label="Freezes well" checked={freezable} onChange={(e) => setFreezable(e.target.checked)} />
            {error && <p className={s.error} role="alert">{error}</p>}
            <div><Button type="submit" variant="secondary" loading={pending}>Suggest slots</Button></div>
          </form>
          {custom && <LeftoverCard l={custom} />}
        </CardBody>
      </Card>
    </section>
  );
}
