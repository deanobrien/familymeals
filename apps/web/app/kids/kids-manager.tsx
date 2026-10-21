'use client';

// The parent's side of kids' mode (P3-A, D425-D429): kid profiles, the device PIN, opening / closing rounds, and a way into the
// kids' screen. Kids themselves never see this page: they use /kids/play, which has no way out except the PIN.
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KID_AVATARS, KID_COLOURS, ROUND_MAX_CANDIDATES, ROUND_MIN_CANDIDATES } from '@fr/engine/kids';
import { Badge, Button, Card, CardBody, Checkbox, Input } from '@fr/ui';
import type { KidView, RoundView } from '../../lib/kids/types';
import { addKidAction, closeRoundAction, openRoundAction, removeKidAction, voteAction } from './actions';
import { webKidsGate } from './device-gate';
import s from '../pantry/pantry.module.css';

const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function PinSetup({ householdId, userId, onChange }: { householdId: string; userId: string; onChange: (has: boolean) => void }) {
  const [has, setHas] = useState<boolean | null>(null);
  const [pin, setPin] = useState('');
  const [current, setCurrent] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    void webKidsGate(householdId, userId).hasPin().then((h) => {
      setHas(h);
      onChange(h);
    });
  }, [householdId, userId, onChange]);
  if (has === null) return null;

  const save = async () => {
    const ok = await webKidsGate(householdId, userId).setPin(pin, has ? current : undefined);
    if (!ok) return setMsg(has ? 'That did not work. Check the current PIN, and use 4 to 6 digits.' : 'Use 4 to 6 digits.');
    setMsg('PIN saved on this device.');
    setPin('');
    setCurrent('');
    setHas(true);
    onChange(true);
  };
  return (
    <Card>
      <CardBody className={s.cardBody}>
        <h3 style={{ margin: 0 }}>Parent PIN for this device</h3>
        <p className={s.muted} style={{ margin: 0 }}>
          Kids&apos; mode stays on the screen until this PIN is entered. It is kept on this device only, never sent to us. {has ? 'A PIN is set.' : 'Set one before starting kids’ mode.'}
        </p>
        <div className={s.inlineForm}>
          {has && <Input label="Current PIN" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={current} onChange={(e) => setCurrent(e.target.value.replace(/\D/g, ''))} />}
          <Input label={has ? 'New PIN' : 'PIN (4 to 6 digits)'} type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} data-testid="pin-input" />
          <Button onClick={() => void save()} data-testid="save-pin">{has ? 'Change PIN' : 'Set PIN'}</Button>
        </div>
        <p role="status" className={s.muted} data-testid="pin-status">{msg}</p>
      </CardBody>
    </Card>
  );
}

function Kids({ kids, readOnly }: { kids: KidView[]; readOnly: boolean }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(KID_AVATARS[0]!);
  const [colour, setColour] = useState(KID_COLOURS[5]!);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const add = () =>
    start(async () => {
      setError('');
      const r = await addKidAction({ displayName: name, avatar, colour });
      if (!r.ok) return setError(r.message);
      setName('');
      router.refresh();
    });
  return (
    <section className={s.section} aria-labelledby="kids-h">
      <h2 id="kids-h">Kid profiles</h2>
      <p className={s.lead}>A name or nickname, a picture and a colour. No email, no photo and nothing else is kept: a kid profile cannot sign in.</p>
      {kids.length === 0 && <p className={s.lead} data-testid="no-kids">No kid profiles yet.</p>}
      <ul className={s.list} data-testid="kid-list">
        {kids.map((k) => (
          <li key={k.id}>
            <div className={s.row}>
              <span className={s.name}><span aria-hidden="true" style={{ fontSize: '1.5rem' }}>{k.avatar}</span> {k.displayName}</span>
              <Button size="sm" variant="ghost" disabled={readOnly || pending} onClick={() => start(async () => { await removeKidAction(k.id); router.refresh(); })} aria-label={`Remove ${k.displayName}`}>Remove</Button>
            </div>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className={s.inlineForm}>
          <Input label="Name or nickname" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} data-testid="kid-name" />
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className={s.muted}>Picture</legend>
            <div className={s.actions}>
              {KID_AVATARS.map((a) => (
                <button key={a} type="button" aria-pressed={avatar === a} aria-label={`Picture ${a}`} onClick={() => setAvatar(a)}
                  style={{ fontSize: '1.5rem', minWidth: 44, minHeight: 44, borderRadius: 8, border: avatar === a ? '3px solid var(--fr-accent)' : '1px solid var(--fr-border)', background: 'var(--fr-surface)' }}>{a}</button>
              ))}
            </div>
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className={s.muted}>Colour</legend>
            <div className={s.actions}>
              {KID_COLOURS.map((c) => (
                <button key={c} type="button" aria-pressed={colour === c} aria-label={`Colour ${c}`} onClick={() => setColour(c)}
                  style={{ minWidth: 44, minHeight: 44, borderRadius: 22, background: c === 'yellow' ? '#f2c94c' : c === 'teal' ? '#2a9d8f' : c, border: colour === c ? '4px solid var(--fr-text)' : '1px solid var(--fr-border)' }} />
              ))}
            </div>
          </fieldset>
          <Button onClick={add} loading={pending} data-testid="add-kid">Add kid</Button>
        </div>
      )}
      {error && <p role="alert" className={s.error}>{error}</p>}
    </section>
  );
}

function NewRound({ planned, recipes, onOpened }: { planned: Array<{ recipeId: string; title: string }>; recipes: Array<{ id: string; title: string }>; onOpened: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [forDate, setForDate] = useState(today());
  const [days, setDays] = useState(1);
  const [title, setTitle] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= ROUND_MAX_CANDIDATES ? p : [...p, id]));
  const open = () =>
    start(async () => {
      setError('');
      const r = await openRoundAction({ recipeIds: picked, forDate, days, ...(title ? { title } : {}), closesAt: closesAt ? new Date(closesAt).toISOString() : null });
      if (!r.ok) return setError(r.message);
      setPicked([]);
      setTitle('');
      onOpened();
    });
  return (
    <section className={s.section} aria-labelledby="round-h">
      <h2 id="round-h">Start a vote</h2>
      <Card>
        <CardBody className={s.cardBody}>
          {planned.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setPicked(planned.map((p) => p.recipeId).slice(0, ROUND_MAX_CANDIDATES))} data-testid="use-plan">Use this week&apos;s plan ({Math.min(planned.length, ROUND_MAX_CANDIDATES)} meals)</Button>
          )}
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>Pick {ROUND_MIN_CANDIDATES} to {ROUND_MAX_CANDIDATES} meals ({picked.length} chosen)</legend>
            <div style={{ display: 'grid', gap: 4, maxHeight: 260, overflow: 'auto' }} data-testid="round-recipes">
              {recipes.map((r) => (
                <Checkbox key={r.id} label={r.title} checked={picked.includes(r.id)} onChange={() => toggle(r.id)} disabled={!picked.includes(r.id) && picked.length >= ROUND_MAX_CANDIDATES} />
              ))}
            </div>
          </fieldset>
          <div className={s.formGrid}>
            <Input label="For (day or week start)" type="date" value={forDate} onChange={(e) => setForDate(e.target.value)} />
            <label className="fr-field">
              <span>Covers</span>
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ minHeight: 44 }}>
                <option value={1}>One day</option>
                <option value={7}>A week</option>
              </select>
            </label>
            <Input label="Name (optional)" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
            <Input label="Closes automatically (optional)" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
          </div>
          <div><Button onClick={open} loading={pending} disabled={picked.length < ROUND_MIN_CANDIDATES} data-testid="open-round">Start the vote</Button></div>
          {error && <p role="alert" className={s.error}>{error}</p>}
        </CardBody>
      </Card>
    </section>
  );
}

function Round({ r, hasPin, readOnly, onChanged }: { r: RoundView; hasPin: boolean; readOnly: boolean; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const close = () =>
    start(async () => {
      const res = await closeRoundAction(r.id);
      if (!res.ok) return setError(res.message);
      onChanged();
    });
  const vote = (recipeId: string, value: 'up' | 'heart' | null) =>
    start(async () => {
      const res = await voteAction({ roundId: r.id, recipeId, value });
      if (!res.ok) return setError(res.message);
      onChanged();
    });
  const mine = (recipeId: string) => r.votes.find((v) => v.recipeId === recipeId && v.voter.kind === 'member')?.value ?? null;
  return (
    <li data-testid={`round-${r.id}`}>
      <div className={s.row}>
        <div className={s.rowMain}>
          <span className={s.name}>{r.title ?? 'Dinner vote'} <Badge tone={r.open ? 'accent' : 'neutral'}>{r.open ? 'Open' : 'Finished'}</Badge></span>
          <span className={s.muted}>
            {r.days > 1 ? `Week of ${r.forDate}` : r.forDate}
            {r.closesAt && r.open ? ` · closes ${new Date(r.closesAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
          </span>
        </div>
        {r.open && !readOnly && (
          <div className={s.actions}>
            {hasPin ? (
              <Link href={`/kids/play?round=${r.id}`} className="fr-btn fr-btn--primary" data-testid={`play-${r.id}`}>Let the kids vote</Link>
            ) : (
              <span className={s.muted}>Set a PIN to let the kids vote</span>
            )}
            <Button size="sm" variant="secondary" loading={pending} onClick={close} data-testid={`close-${r.id}`}>Close the vote</Button>
          </div>
        )}
      </div>
      <ul className={s.list} style={{ marginTop: 8 }}>
        {r.candidates.map((c) => (
          <li key={c.recipeId} data-testid={`candidate-${c.recipeId}`}>
            <div className={s.row}>
              <span className={s.name}>{c.winner ? '🏆 ' : ''}{c.title}</span>
              <span className={s.muted} aria-label={`${c.up} thumbs up, ${c.heart} hearts`}>👍 {c.up} · ❤️ {c.heart}</span>
              {r.open && !readOnly && (
                <span className={s.actions}>
                  <Button size="sm" variant={mine(c.recipeId) === 'up' ? 'primary' : 'secondary'} aria-pressed={mine(c.recipeId) === 'up'} onClick={() => vote(c.recipeId, mine(c.recipeId) === 'up' ? null : 'up')} aria-label={`I like ${c.title}`}>👍</Button>
                  <Button size="sm" variant={mine(c.recipeId) === 'heart' ? 'primary' : 'secondary'} aria-pressed={mine(c.recipeId) === 'heart'} onClick={() => vote(c.recipeId, mine(c.recipeId) === 'heart' ? null : 'heart')} aria-label={`I love ${c.title}`}>❤️</Button>
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!r.open && <p className={s.muted}>The meals with the most votes get a nudge when you plan that {r.days > 1 ? 'week' : 'day'}.</p>}
      {error && <p role="alert" className={s.error}>{error}</p>}
    </li>
  );
}

export function KidsManager({
  kids, rounds, planned, recipes, householdId, userId, readOnly,
}: {
  kids: KidView[];
  rounds: RoundView[];
  planned: Array<{ recipeId: string; title: string }>;
  recipes: Array<{ id: string; title: string }>;
  householdId: string;
  userId: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [hasPin, setHasPin] = useState(false);
  return (
    <>
      <PinSetup householdId={householdId} userId={userId} onChange={setHasPin} />
      <Kids kids={kids} readOnly={readOnly} />
      {!readOnly && <NewRound planned={planned} recipes={recipes} onOpened={() => router.refresh()} />}
      <section className={s.section} aria-labelledby="rounds-h">
        <h2 id="rounds-h">Votes</h2>
        {rounds.length === 0 && <p className={s.lead} data-testid="no-rounds">No votes yet.</p>}
        <ul className={s.list} data-testid="round-list">
          {rounds.map((r) => (
            <Round key={r.id} r={r} hasPin={hasPin} readOnly={readOnly} onChanged={() => router.refresh()} />
          ))}
        </ul>
      </section>
    </>
  );
}
