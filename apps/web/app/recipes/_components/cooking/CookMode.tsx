'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Button, Checkbox, Stepper } from '@fr/ui';
import {
  cookSessionKey, createTimer, formatClock, ingredientsForStep, parseCookSession, parseStepTimers, pauseTimer, resetTimer, secondsLeft,
  serializeCookSession, startTimer, tickTimers, type CookSwap, type CookTimer,
} from '@fr/engine/cooking';
import { scaleQuantityLabel, servingsFactor } from '../../../../lib/recipes/scale';
import type { RecipeView } from '../../../../lib/recipes/types';
import {
  beep, keepScreenAwake, notifyState, primeAudio, requestNotifyPermission, showTimerNotification, speak, speechSupported, stopSpeaking, vibrate, type NotifyState,
} from './alerts';
import { MarkCookedForm } from './MarkCookedForm';
import { SubstitutionPanel } from './SubstitutionPanel';
import styles from './cooking.module.css';

interface Props {
  recipe: RecipeView;
  initialServings: number;
  /** True when the page URL pinned the servings (then a saved session does not override them). */
  servingsPinned: boolean;
  householdId: string;
  userId: string;
  /** Swaps handed over from the recipe page ("Cook with this swap"). */
  incomingSwaps: CookSwap[];
  currentRating: number | null;
}

const SWIPE_PX = 70;

export function CookMode({ recipe, initialServings, servingsPinned, householdId, userId, incomingSwaps, currentRating }: Props) {
  const steps = useMemo(() => [...recipe.steps].sort((a, b) => a.order - b.order), [recipe.steps]);
  const lines = useMemo(() => [...recipe.ingredients].sort((a, b) => a.order - b.order), [recipe.ingredients]);
  const key = cookSessionKey(householdId, userId, recipe.id);

  const [step, setStep] = useState(0);
  const [servings, setServings] = useState(initialServings);
  const [checked, setChecked] = useState<string[]>([]);
  const [swaps, setSwaps] = useState<CookSwap[]>(incomingSwaps);
  const [timers, setTimers] = useState<CookTimer[]>([]);
  const [restored, setRestored] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [alerts, setAlerts] = useState<{ id: string; label: string }[]>([]);
  const [notify, setNotify] = useState<NotifyState>('unsupported');
  const [awake, setAwake] = useState<'on' | 'off' | 'unsupported'>('off');
  const [reading, setReading] = useState(false);
  const [autoRead, setAutoRead] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [subFor, setSubFor] = useState<{ id: string; name: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const timersRef = useRef(timers);
  timersRef.current = timers;
  const bodyRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const factor = servingsFactor(recipe.servings, servings);
  const last = steps.length; // index of the "all done" page
  const onDonePage = step >= last;
  const swapOf = (lineId: string) => swaps.find((s) => s.lineId === lineId);

  // ---- restore (resume where you left off) ----
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      /* storage unavailable */
    }
    const s = parseCookSession(raw, Date.now());
    if (s) {
      setStep(Math.min(s.step, steps.length));
      if (!servingsPinned) setServings(s.servings);
      setChecked(s.checked);
      setSwaps((cur) => [...s.swaps.filter((x) => !cur.some((c) => c.lineId === x.lineId)), ...cur]);
      setTimers(s.timers);
      setResumed(s.step > 0 || s.timers.length > 0);
    }
    setNotify(notifyState());
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // ---- persist ----
  useEffect(() => {
    if (!restored) return;
    try {
      window.localStorage.setItem(key, serializeCookSession({ step, servings, checked, swaps, timers }, Date.now()));
    } catch {
      /* best effort */
    }
  }, [restored, key, step, servings, checked, swaps, timers]);

  // ---- keep the screen awake ----
  useEffect(() => {
    let release: (() => void) | undefined;
    let cancelled = false;
    void keepScreenAwake().then((w) => {
      if (cancelled) return w.release();
      release = w.release;
      setAwake(w.supported ? 'on' : 'unsupported');
    });
    return () => {
      cancelled = true;
      release?.();
      stopSpeaking();
    };
  }, []);

  // ---- ticking ----
  const fire = useCallback(
    (finished: CookTimer[]) => {
      if (finished.length === 0) return;
      setAlerts((a) => [...a, ...finished.map((t) => ({ id: t.id, label: t.label }))]);
      beep();
      vibrate();
      for (const t of finished) showTimerNotification(t.label, recipe.title);
    },
    [recipe.title],
  );
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = Date.now();
      const cur = timersRef.current;
      if (!cur.some((x) => x.status === 'running')) return;
      setNow(t);
      const r = tickTimers(cur, t);
      if (r.finished.length) {
        setTimers(r.timers);
        fire(r.finished);
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [fire]);
  // A timer that finished while the tab slept is announced when the tab wakes.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      const t = Date.now();
      setNow(t);
      const r = tickTimers(timersRef.current, t);
      if (r.finished.length) {
        setTimers(r.timers);
        fire(r.finished);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [fire]);

  // ---- navigation ----
  const go = useCallback(
    (delta: number) => {
      setStep((s) => Math.max(0, Math.min(last, s + delta)));
      bodyRef.current?.scrollTo?.({ top: 0 });
    },
    [last],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const current = steps[step];
  const detected = useMemo(() => (current ? parseStepTimers(current.text) : []), [current]);
  const stepLines = useMemo(() => (current ? ingredientsForStep(current.text, lines.map((l) => ({ id: l.id, name: l.name }))) : []), [current, lines]);
  const shownLines = showAll ? lines : lines.filter((l) => stepLines.some((s) => s.id === l.id));

  // ---- read aloud ----
  const readStep = useCallback(() => {
    if (!current) return;
    setReading(speak(`Step ${step + 1}. ${current.text}`));
  }, [current, step]);
  useEffect(() => {
    if (autoRead && current) readStep();
    else {
      stopSpeaking();
      setReading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, autoRead]);

  // ---- timers ----
  const addTimer = async (d: { label: string; seconds: number }, idx: number) => {
    primeAudio();
    const id = `s${idx}-${d.seconds}`;
    setTimers((cur) => {
      const existing = cur.find((t) => t.id === id);
      const t = Date.now();
      if (existing) return cur.map((x) => (x.id === id ? startTimer(x.status === 'done' ? resetTimer(x) : x, t) : x));
      return [...cur, startTimer(createTimer(id, `${d.label} (step ${idx + 1})`, d.seconds, idx), t)];
    });
    setNow(Date.now());
    if (notify === 'default') setNotify(await requestNotifyPermission());
  };
  const updateTimer = (id: string, fn: (t: CookTimer, now: number) => CookTimer) => {
    const t = Date.now();
    setNow(t);
    setTimers((cur) => cur.map((x) => (x.id === id ? fn(x, t) : x)));
  };

  const toggleChecked = (id: string) => setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  if (steps.length === 0) {
    return (
      <div className={styles.cook} role="dialog" aria-label="Cook mode">
        <div className={styles.cookBody}>
          <h1 className={styles.cookTitle}>{recipe.title}</h1>
          <p>This recipe has no method steps yet, so there is nothing to step through.</p>
          <Link className="fr-btn fr-btn--secondary" href={`/recipes/${recipe.id}`}>Back to recipe</Link>
        </div>
      </div>
    );
  }

  const stepSwaps = swaps.filter((s) => stepLines.some((l) => l.id === s.lineId));

  return (
    <div className={styles.cook} role="dialog" aria-label={`Cook mode: ${recipe.title}`} data-testid="cook-mode">
      <div className={styles.cookBar}>
        <h1 className={styles.cookTitle}>{recipe.title}</h1>
        <Stepper label="Servings" value={servings} min={1} max={100} onChange={setServings} />
        <Link className="fr-btn fr-btn--secondary" href={`/recipes/${recipe.id}`} data-testid="exit-cook">Exit</Link>
      </div>

      <div
        className={styles.cookBody}
        ref={bodyRef}
        onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s) return;
          const dx = e.clientX - s.x;
          if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) go(dx < 0 ? 1 : -1);
        }}
      >
        {alerts.map((a, i) => (
          <div key={`${a.id}-${i}`} className={styles.alertBanner} role="alert" data-testid="timer-alert">
            <span>{a.label}: time is up</span>
            <Button size="sm" onClick={() => setAlerts((x) => x.filter((_, j) => j !== i))}>Dismiss</Button>
          </div>
        ))}
        {resumed && step > 0 && !onDonePage && <p className="fr-muted" role="status" data-testid="resumed-note">Picked up where you left off.</p>}

        {!onDonePage && current ? (
          <>
            <p className={styles.stepCount} data-testid="step-count">Step {step + 1} of {steps.length}</p>
            <p className={styles.stepText} data-testid="step-text">{current.text}</p>
            <div className={styles.chipRow}>
              {speechSupported() && (
                <Button variant="secondary" onClick={() => (reading ? (stopSpeaking(), setReading(false)) : readStep())} aria-pressed={reading} data-testid="read-aloud">
                  {reading ? 'Stop reading' : 'Read aloud'}
                </Button>
              )}
              {speechSupported() && <Checkbox label="Read each step" checked={autoRead} onChange={(e) => setAutoRead(e.target.checked)} />}
              {detected.map((d, i) => (
                <Button key={`${d.start}-${i}`} variant="secondary" onClick={() => void addTimer(d, step)} data-testid="start-timer">
                  Start {d.label} timer
                </Button>
              ))}
            </div>
            {stepSwaps.length > 0 && (
              <div className={styles.swapBanner} data-testid="swap-note">
                {stepSwaps.map((s) => {
                  const orig = lines.find((l) => l.id === s.lineId);
                  return <span key={s.lineId}>Using <strong>{s.name}</strong> instead of {orig?.name}{s.guidance ? `: ${s.guidance}` : ''}</span>;
                })}
              </div>
            )}
            <section aria-label="Ingredients for this step">
              <ul className={styles.stepIngredients} data-testid="step-ingredients">
                {shownLines.map((l) => {
                  const sw = swapOf(l.id);
                  return (
                    <li key={l.id}>
                      <label className={checked.includes(l.id) ? styles.checked : undefined}>
                        <input type="checkbox" checked={checked.includes(l.id)} onChange={() => toggleChecked(l.id)} style={{ width: '1.5rem', height: '1.5rem' }} />
                        <span>
                          <strong>{sw ? sw.name : scaleQuantityLabel(l.quantity, factor)}</strong>{' '}
                          {sw ? <>(instead of {l.name})</> : <>{l.name}{l.preparation ? `, ${l.preparation}` : ''}</>}
                          {l.optional ? ' (optional)' : ''}
                        </span>
                      </label>
                      <Button variant="ghost" size="sm" onClick={() => setSubFor({ id: l.id, name: l.name })} aria-label={`Out of ${l.name}?`}>Out of this?</Button>
                    </li>
                  );
                })}
                {shownLines.length === 0 && <li className="fr-muted">No ingredients named in this step.</li>}
              </ul>
              <Button variant="ghost" size="sm" onClick={() => setShowAll((s) => !s)} data-testid="toggle-all-ingredients">{showAll ? 'Only this step' : 'Show all ingredients'}</Button>
            </section>
            {subFor && (
              <SubstitutionPanel recipeId={recipe.id} line={subFor} existingSwaps={swaps} onClose={() => setSubFor(null)} onApply={(sw) => setSwaps((c) => [...c.filter((x) => x.lineId !== sw.lineId), sw])} />
            )}
            {swaps.length > 0 && (
              <div className={styles.chipRow}>
                <Button variant="ghost" size="sm" onClick={() => setSwaps([])} data-testid="undo-swaps">Undo all swaps</Button>
              </div>
            )}
          </>
        ) : (
          <div className={styles.doneCard} data-testid="cook-done">
            <h2>All done</h2>
            {saved ? (
              <>
                <p role="status" data-testid="cook-saved">Saved to your cooked history.</p>
                <Link className="fr-btn fr-btn--primary" href={`/recipes/${recipe.id}`}>Back to recipe</Link>
              </>
            ) : (
              <MarkCookedForm
                recipeId={recipe.id}
                recipeTitle={recipe.title}
                servings={servings}
                currentRating={currentRating}
                onSaved={() => {
                  setSaved(true);
                  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
                }}
                onCancel={() => go(-1)}
              />
            )}
          </div>
        )}

        {timers.length > 0 && (
          <section className={styles.timerBox} aria-label="Timers" data-testid="timers">
            {timers.map((t) => (
              <div key={t.id} className={`${styles.timerRow} ${t.status === 'done' ? styles.timerDone : ''}`} data-testid="timer" data-status={t.status}>
                <span className={styles.clock} aria-label={`${t.label}, ${formatClock(secondsLeft(t, now))} left`}>{formatClock(secondsLeft(t, now))}</span>
                <span style={{ flex: 1 }}>{t.label}</span>
                {t.status === 'running' ? (
                  <Button size="sm" variant="secondary" onClick={() => updateTimer(t.id, (x, n) => pauseTimer(x, n))} data-testid="pause-timer">Pause</Button>
                ) : (
                  <Button size="sm" onClick={() => { primeAudio(); updateTimer(t.id, (x, n) => startTimer(x, n)); }} data-testid="resume-timer">{t.status === 'paused' ? 'Resume' : 'Start'}</Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => updateTimer(t.id, (x) => resetTimer(x))} data-testid="reset-timer">Reset</Button>
                <Button size="sm" variant="ghost" onClick={() => setTimers((c) => c.filter((x) => x.id !== t.id))} aria-label={`Remove ${t.label} timer`}>Remove</Button>
              </div>
            ))}
          </section>
        )}
        <p className="fr-muted" style={{ fontSize: 'var(--fr-text-sm)' }}>
          {awake === 'on' ? 'Screen stays on while you cook.' : awake === 'unsupported' ? 'This browser cannot keep the screen on; adjust your device sleep setting.' : ''}
          {notify === 'denied' ? ' Notifications are blocked, so timers will beep and show here only.' : ''}
        </p>
      </div>

      <div className={styles.cookNav}>
        <Button variant="secondary" onClick={() => go(-1)} disabled={step === 0} data-testid="prev-step">Previous</Button>
        <Button onClick={() => go(1)} disabled={onDonePage} data-testid="next-step">{step === last - 1 ? 'Finish' : 'Next'}</Button>
      </div>
    </div>
  );
}
