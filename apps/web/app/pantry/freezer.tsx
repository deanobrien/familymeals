'use client';

// Leftovers and freezer inventory (P2-C, D416-D419): the batches recorded by "Cook x2" or added by hand, what is left of each,
// the use-by, and the quick actions. Portions come from the ledger on the server, never a number kept here.
import Link from 'next/link';
import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, CardBody, Input, Select } from '@fr/ui';
import type { BatchView } from '../../lib/leftovers/types';
import { addBatchAction, freezeBatchAction, removeBatchAction, takePortionsAction } from '../plan/calendar-actions';
import s from './pantry.module.css';

const localToday = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function BatchRow({ b, busy, run }: { b: BatchView; busy: boolean; run: (fn: () => Promise<{ ok: boolean; message?: string }>) => void }) {
  const tone = b.status === 'past_use_by' ? 'danger' : b.status === 'use_soon' ? 'warning' : 'neutral';
  return (
    <li data-testid={`batch-${b.id}`}>
      <div className={s.row}>
        <div className={s.rowMain}>
          <span className={s.name}>{b.title}</span>
          <span className={s.muted}>
            {b.portionsLeft} of {b.portionsMade} portion{b.portionsMade === 1 ? '' : 's'} left
            {b.portionsPlanned > 0 ? ` · ${b.portionsPlanned} planned` : ''}
          </span>
        </div>
        <div className={s.badges}>
          <Badge tone={tone}>{b.status === 'past_use_by' ? `Past use-by (${b.useByLabel})` : b.useByLabel}</Badge>
        </div>
      </div>
      <div className={s.actions} style={{ marginTop: 'var(--fr-space-2)' }}>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => takePortionsAction(b.id, 1, 'eaten'))} aria-label={`Ate one portion of ${b.title}`}>Ate 1</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => takePortionsAction(b.id, 1, 'discarded'))} aria-label={`Threw away one portion of ${b.title}`}>Threw 1 away</Button>
        {b.storedIn === 'fridge' && b.status !== 'past_use_by' && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => freezeBatchAction(b.id, localToday()))} aria-label={`Move ${b.title} to the freezer`}>Move to freezer</Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => removeBatchAction(b.id))} aria-label={`Remove ${b.title} from the list`}>Remove</Button>
      </div>
    </li>
  );
}

export function FreezerPanel({ batches }: { batches: BatchView[] }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [portions, setPortions] = useState('4');
  const [storedIn, setStoredIn] = useState<'fridge' | 'freezer'>('freezer');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      setError('');
      const r = await fn();
      if (!r.ok) return setError(r.message ?? 'Something went wrong.');
      router.refresh();
    });

  const add = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await addBatchAction({ title, portions: Number(portions), storedIn, today: localToday() });
      if (r.ok) setTitle('');
      return r;
    });
  };

  const fridge = batches.filter((b) => b.storedIn === 'fridge');
  const freezer = batches.filter((b) => b.storedIn === 'freezer');
  return (
    <section className={s.section} aria-labelledby="stored-h" data-testid="freezer-panel">
      <h2 id="stored-h">Leftovers and freezer</h2>
      <p className={s.lead}>
        Cooked extra? Mark a meal cooked with "Cook x2" and the spare portions land here, ready to put in a plan slot on a{' '}
        <Link href="/plan">busy evening</Link>. Fridge leftovers are good for 2 days, freezer meals for 3 months.
      </p>
      {batches.length === 0 && <p className={s.lead} data-testid="no-stored">Nothing stored right now.</p>}
      {fridge.length > 0 && (
        <Card>
          <CardBody>
            <h3 style={{ margin: 0 }}>Fridge</h3>
            <ul className={s.list} aria-label="Fridge leftovers">{fridge.map((b) => <BatchRow key={b.id} b={b} busy={pending} run={run} />)}</ul>
          </CardBody>
        </Card>
      )}
      {freezer.length > 0 && (
        <Card>
          <CardBody>
            <h3 style={{ margin: 0 }}>Freezer ({freezer.reduce((n, b) => n + b.portionsLeft, 0)} portions)</h3>
            <ul className={s.list} aria-label="Freezer meals">{freezer.map((b) => <BatchRow key={b.id} b={b} busy={pending} run={run} />)}</ul>
          </CardBody>
        </Card>
      )}
      <Card>
        <CardBody>
          <form className={s.cardBody} onSubmit={add} aria-label="Add a stored meal">
            <h3 style={{ margin: 0 }}>Add a freezer or fridge meal</h3>
            <div className={s.formGrid}>
              <Input label="Meal" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Chilli" maxLength={120} />
              <Input label="Portions" type="number" min={1} max={100} value={portions} onChange={(e) => setPortions(e.target.value)} />
              <Select label="Stored in" value={storedIn} onChange={(e) => setStoredIn(e.target.value as 'fridge' | 'freezer')} options={[{ value: 'freezer', label: 'Freezer (3 months)' }, { value: 'fridge', label: 'Fridge (2 days)' }]} />
            </div>
            {error && <p className={s.error} role="alert">{error}</p>}
            <div><Button type="submit" variant="secondary" loading={pending} disabled={!title.trim()}>Add</Button></div>
          </form>
        </CardBody>
      </Card>
    </section>
  );
}
