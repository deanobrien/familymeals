'use client';

// Kids' voting screen (P3-A, D424, D427): big pictures, two big buttons, no text input. The only way out is the parent PIN (the
// small lock at the bottom). A web page cannot lock the browser itself: the Back button is held on this page, and the Android app
// goes further (full screen, hardware Back blocked).
import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { lockLabel } from '@fr/engine/kids';
import type { KidView, RoundView, VoteValue } from '../../../lib/kids/types';
import { voteAction } from '../actions';
import { webKidsGate } from '../device-gate';

const COLOURS: Record<string, string> = { red: '#e5484d', orange: '#f76808', yellow: '#f2c94c', green: '#46a758', teal: '#2a9d8f', blue: '#3e63dd', purple: '#8e4ec6', pink: '#e93d82' };
const big = { minHeight: 72, minWidth: 72, fontSize: '2.25rem', borderRadius: 18, border: '3px solid var(--fr-border)', background: 'var(--fr-surface)', cursor: 'pointer' } as const;

function PinPad({ householdId, userId, onOpen, onCancel }: { householdId: string; userId: string; onOpen: () => void; onCancel: () => void }) {
  const [digits, setDigits] = useState('');
  const [msg, setMsg] = useState('');
  const submit = async (pin: string) => {
    const r = await webKidsGate(householdId, userId).verify(pin);
    if (r.ok) return onOpen();
    setDigits('');
    if (r.reason === 'locked' || (r.reason === 'wrong' && r.retryAfterMs > 0)) setMsg(`Too many tries. Try again in ${lockLabel(r.retryAfterMs)}.`);
    else setMsg('That is not the PIN.');
  };
  const press = (d: string) => {
    if (digits.length >= 6) return;
    setMsg('');
    setDigits(digits + d);
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Grown-up PIN" data-testid="pin-pad"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div style={{ background: 'var(--fr-surface)', padding: 24, borderRadius: 20, display: 'grid', gap: 12, justifyItems: 'center', maxWidth: 340 }}>
        <p style={{ margin: 0, fontWeight: 600 }}>Grown-up PIN</p>
        <p aria-live="polite" data-testid="pin-dots" style={{ margin: 0, fontSize: '2rem', letterSpacing: 8, minHeight: '2.5rem' }}>{'●'.repeat(digits.length) || '• • • •'}</p>
        <p role="status" style={{ margin: 0, minHeight: '1.5rem', color: 'var(--fr-danger)', textAlign: 'center' }} data-testid="pin-message">{msg}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 72px)', gap: 10 }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} type="button" style={big} onClick={() => press(d)} aria-label={d}>{d}</button>
          ))}
          <button type="button" style={big} onClick={() => setDigits(digits.slice(0, -1))} aria-label="Delete">{'⌫'}</button>
          <button type="button" style={big} onClick={() => press('0')} aria-label="0">0</button>
          <button type="button" style={{ ...big, background: 'var(--fr-accent)', color: 'white' }} onClick={() => void submit(digits)} aria-label="Unlock" disabled={digits.length < 4}>{'✔'}</button>
        </div>
        <button type="button" onClick={onCancel} style={{ minHeight: 44, background: 'none', border: 0, textDecoration: 'underline', cursor: 'pointer' }}>Back to voting</button>
      </div>
    </div>
  );
}

export function KidPlay({ round, kids, householdId, userId }: { round: RoundView | null; kids: KidView[]; householdId: string; userId: string }) {
  const router = useRouter();
  const [kid, setKid] = useState<KidView | null>(null);
  const [thanks, setThanks] = useState(false);
  const [pin, setPin] = useState(false);
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [votes, setVotes] = useState(round?.votes ?? []);
  const [, start] = useTransition();

  useEffect(() => {
    void webKidsGate(householdId, userId).hasPin().then(setHasPin);
  }, [householdId, userId]);

  // Hold the Back button on this page (best effort on the web).
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);
    const hold = () => window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', hold);
    return () => window.removeEventListener('popstate', hold);
  }, []);

  const exit = useCallback(() => router.push('/kids'), [router]);
  const lock = (
    <button type="button" onClick={() => (hasPin === false ? exit() : setPin(true))} aria-label="Grown-ups: leave kids mode" data-testid="kid-exit"
      style={{ position: 'fixed', bottom: 12, right: 12, minWidth: 48, minHeight: 48, borderRadius: 24, border: '1px solid var(--fr-border)', background: 'var(--fr-surface)', opacity: 0.7 }}>
      {'🔒'}
    </button>
  );
  const shell = (children: React.ReactNode) => (
    <main style={{ minHeight: '100vh', padding: 16, display: 'grid', gap: 16, alignContent: 'start', background: 'var(--fr-bg)' }} data-testid="kid-screen">
      {children}
      {lock}
      {pin && <PinPad householdId={householdId} userId={userId} onOpen={exit} onCancel={() => setPin(false)} />}
    </main>
  );

  if (!round || !round.open) {
    return shell(
      <>
        <h1 style={{ fontSize: '2.5rem', textAlign: 'center' }}>{round ? 'The vote has finished! 🎉' : 'No vote right now'}</h1>
        {round && round.candidates.filter((c) => c.winner).map((c) => <p key={c.recipeId} style={{ fontSize: '2rem', textAlign: 'center' }}>{'🏆'} {c.title}</p>)}
      </>,
    );
  }

  if (!kid) {
    return shell(
      <>
        <h1 style={{ fontSize: '2.25rem', textAlign: 'center' }}>{thanks ? 'Thank you! 🎉 Who is next?' : 'Who is voting?'}</h1>
        {kids.length === 0 && <p style={{ textAlign: 'center' }}>Ask a grown-up to add you in Kids&apos; mode.</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
          {kids.map((k) => (
            <button key={k.id} type="button" onClick={() => { setKid(k); setThanks(false); }} aria-label={k.displayName} data-testid={`pick-kid-${k.id}`}
              style={{ ...big, width: 150, minHeight: 150, display: 'grid', placeItems: 'center', gap: 4, background: COLOURS[k.colour] ?? '#3e63dd', color: 'white', borderColor: 'transparent' }}>
              <span style={{ fontSize: '4rem' }} aria-hidden="true">{k.avatar}</span>
              <span style={{ fontSize: '1.25rem', fontWeight: 700 }}>{k.displayName}</span>
            </button>
          ))}
        </div>
      </>,
    );
  }

  const mine = (recipeId: string): VoteValue | null => votes.find((v) => v.recipeId === recipeId && v.voter.kind === 'kid' && v.voter.id === kid.id)?.value ?? null;
  const tap = (recipeId: string, value: VoteValue) => {
    const next = mine(recipeId) === value ? null : value;
    setError('');
    setVotes((vs) => [...vs.filter((v) => !(v.recipeId === recipeId && v.voter.kind === 'kid' && v.voter.id === kid.id)), ...(next ? [{ recipeId, voter: { kind: 'kid' as const, id: kid.id }, value: next }] : [])]);
    start(async () => {
      const r = await voteAction({ roundId: round.id, recipeId, kidId: kid.id, value: next });
      if (!r.ok) setError(r.error === 'round_closed' ? 'The vote has just finished.' : 'That did not save. Try again.');
    });
  };

  return shell(
    <>
      <h1 style={{ fontSize: '2rem', textAlign: 'center' }}><span aria-hidden="true">{kid.avatar}</span> {kid.displayName}, what shall we eat?</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        {round.candidates.map((c) => (
          <div key={c.recipeId} data-testid={`kid-card-${c.recipeId}`} style={{ background: 'var(--fr-surface)', borderRadius: 20, border: '1px solid var(--fr-border)', overflow: 'hidden', display: 'grid' }}>
            <div style={{ aspectRatio: '4 / 3', background: 'var(--fr-accent-soft)', display: 'grid', placeItems: 'center' }}>
              {c.imagePath ? <img src={c.imagePath} alt={c.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: '4rem' }} role="img" aria-label={c.title}>{'🍽️'}</span>}
            </div>
            <p style={{ margin: 0, padding: '8px 12px', fontSize: '1.4rem', fontWeight: 700, textAlign: 'center' }}>{c.title}</p>
            <div style={{ display: 'flex', gap: 12, padding: 12, justifyContent: 'center' }}>
              <button type="button" aria-pressed={mine(c.recipeId) === 'up'} aria-label={`Thumbs up for ${c.title}`} data-testid={`kid-up-${c.recipeId}`} onClick={() => tap(c.recipeId, 'up')}
                style={{ ...big, minWidth: 96, minHeight: 88, fontSize: '2.75rem', background: mine(c.recipeId) === 'up' ? '#cfe8ff' : 'var(--fr-surface)', borderColor: mine(c.recipeId) === 'up' ? '#3e63dd' : 'var(--fr-border)' }}>{'👍'}</button>
              <button type="button" aria-pressed={mine(c.recipeId) === 'heart'} aria-label={`Heart for ${c.title}`} data-testid={`kid-heart-${c.recipeId}`} onClick={() => tap(c.recipeId, 'heart')}
                style={{ ...big, minWidth: 96, minHeight: 88, fontSize: '2.75rem', background: mine(c.recipeId) === 'heart' ? '#ffd6e5' : 'var(--fr-surface)', borderColor: mine(c.recipeId) === 'heart' ? '#e93d82' : 'var(--fr-border)' }}>{'❤️'}</button>
            </div>
          </div>
        ))}
      </div>
      {error && <p role="alert" style={{ textAlign: 'center', fontSize: '1.25rem' }}>{error}</p>}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16 }}>
        <button type="button" onClick={() => { setKid(null); setThanks(true); }} data-testid="kid-done" aria-label="All done"
          style={{ ...big, minWidth: 220, fontSize: '1.75rem', background: 'var(--fr-accent)', color: 'white' }}>{'✅'} All done</button>
        <button type="button" onClick={() => setKid(null)} aria-label="Not me" style={{ ...big, fontSize: '1.5rem' }}>{'↩️'}</button>
      </div>
    </>,
  );
}
