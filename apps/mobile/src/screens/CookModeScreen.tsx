import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  cookSessionKey, createTimer, formatClock, ingredientsForStep, parseCookSession, parseStepTimers, pauseTimer, resetTimer, secondsLeft,
  serializeCookSession, startTimer, tickTimers, type CookSwap, type CookTimer,
} from '@fr/engine/cooking';
import { useApp } from '@/data/AppContext';
import { alertHaptics, cancelTimerNotification, ensureNotifyPermission, keepAwakeOff, keepAwakeOn, scheduleTimerNotification, speak, stopSpeaking, timerNotificationKey } from '@/lib/cookDevice';
import { takePendingSwaps } from '@/lib/cookHandoff';
import type { RecipeDetailData } from '@/lib/recipesApi';
import { MAX_SERVINGS, resolveInitialServings, scaledAmount, validServings } from '@/lib/servings';
import { MarkCookedForm } from './cooking/MarkCookedForm';
import { SubstitutionSheet } from './cooking/SubstitutionSheet';
import { Button, EmptyState, ErrorState, Loading, Muted, Text, useStyles, useTheme } from './ui';
import { Section, Stepper } from './widgets';

const SWIPE_PX = 70;

export default function CookModeScreen() {
  const { ds, recipes, householdId } = useApp();
  const { id, servings: servingsParam } = useLocalSearchParams<{ id: string; servings?: string }>();
  const [data, setData] = useState<RecipeDetailData | null | undefined>(undefined);
  const [userId, setUserId] = useState('anonymous');
  const [error, setError] = useState<string | null>(null);
  const [swaps0] = useState<CookSwap[]>(() => takePendingSwaps());

  const load = useCallback(() => {
    if (!id || !householdId) return;
    setError(null);
    Promise.all([recipes.get(householdId, id), ds.getSession()])
      .then(([d, s]) => {
        setUserId(s?.userId ?? 'anonymous');
        setData(d);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load recipe'));
  }, [recipes, ds, id, householdId]);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (data === undefined || !householdId || !id) return <Loading label="Loading recipe" />;
  if (data === null) return <EmptyState title="Recipe not found." hint="It may have been deleted or archived." />;
  const pinned = Number(servingsParam);
  return (
    <CookMode
      data={data}
      householdId={householdId}
      userId={userId}
      initialServings={validServings(pinned) ? pinned : resolveInitialServings(data.householdServings)}
      servingsPinned={validServings(pinned)}
      incomingSwaps={swaps0}
    />
  );
}

function CookMode({ data, householdId, userId, initialServings, servingsPinned, incomingSwaps }: { data: RecipeDetailData; householdId: string; userId: string; initialServings: number; servingsPinned: boolean; incomingSwaps: CookSwap[] }) {
  const { recipes } = useApp();
  const router = useRouter();
  const styles = useStyles();
  const t = useTheme();
  const { recipe } = data;
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
  const [reading, setReading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [subFor, setSubFor] = useState<{ id: string; name: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [spare, setSpare] = useState<string | null>(null);
  const timersRef = useRef(timers);
  timersRef.current = timers;
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const permissionAsked = useRef(false);

  const last = steps.length;
  const onDonePage = step >= last;
  const swapOf = (lineId: string) => swaps.find((s) => s.lineId === lineId);

  // ---- restore (resume where you left off) ----
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(key)
      .catch(() => null)
      .then((raw) => {
        if (!live) return;
        const s = parseCookSession(raw, Date.now());
        if (s) {
          setStep(Math.min(s.step, steps.length));
          if (!servingsPinned) setServings(s.servings);
          setChecked(s.checked);
          setSwaps((cur) => [...s.swaps.filter((x) => !cur.some((c) => c.lineId === x.lineId)), ...cur]);
          setTimers(s.timers);
          setResumed(s.step > 0 || s.timers.length > 0);
          // A running timer keeps its notification across an app restart: schedule it again (same key, so it replaces).
          for (const tm of s.timers) {
            if (tm.status === 'running' && tm.endsAt) void scheduleTimerNotification(timerNotificationKey(recipe.id, tm.id), tm.label, recipe.title, (tm.endsAt - Date.now()) / 1000);
          }
        }
        setRestored(true);
      });
    return () => {
      live = false;
    };
  }, [key]);

  // ---- persist ----
  useEffect(() => {
    if (!restored) return;
    void AsyncStorage.setItem(key, serializeCookSession({ step, servings, checked, swaps, timers }, Date.now())).catch(() => undefined);
  }, [restored, key, step, servings, checked, swaps, timers]);

  // ---- keep the screen awake while cooking ----
  useEffect(() => {
    void keepAwakeOn();
    return () => {
      keepAwakeOff();
      stopSpeaking();
    };
  }, []);

  // ---- ticking ----
  useEffect(() => {
    const idv = setInterval(() => {
      const cur = timersRef.current;
      if (!cur.some((x) => x.status === 'running')) return;
      const n = Date.now();
      setNow(n);
      const r = tickTimers(cur, n);
      if (r.finished.length) {
        timersRef.current = r.timers; // before the next tick, so a finished timer is announced once
        setTimers(r.timers);
        setAlerts((a) => [...a, ...r.finished.map((f) => ({ id: f.id, label: f.label }))]);
        alertHaptics();
      }
    }, 500);
    return () => clearInterval(idv);
  }, []);

  const go = (delta: number) => {
    stopSpeaking();
    setReading(false);
    setStep((s) => Math.max(0, Math.min(last, s + delta)));
  };

  const current = steps[step];
  const detected = useMemo(() => (current ? parseStepTimers(current.text) : []), [current]);
  const stepLines = useMemo(() => (current ? ingredientsForStep(current.text, lines.map((l) => ({ id: l.id, name: l.name }))) : []), [current, lines]);
  const shownLines = showAll ? lines : lines.filter((l) => stepLines.some((s) => s.id === l.id));
  const stepSwaps = swaps.filter((s) => stepLines.some((l) => l.id === s.lineId));

  const readStep = () => {
    if (!current) return;
    if (reading) {
      stopSpeaking();
      setReading(false);
      return;
    }
    setReading(true);
    speak(`Step ${step + 1}. ${current.text}`, () => setReading(false));
  };

  const timerKey = (tid: string) => timerNotificationKey(recipe.id, tid);
  const addTimer = async (d: { label: string; seconds: number }, idx: number) => {
    if (!permissionAsked.current) {
      permissionAsked.current = true;
      await ensureNotifyPermission();
    }
    const tid = `s${idx}-${d.seconds}`;
    const n = Date.now();
    const existing = timersRef.current.find((x) => x.id === tid);
    const started = existing ? startTimer(existing.status === 'done' ? resetTimer(existing) : existing, n) : startTimer(createTimer(tid, `${d.label} (step ${idx + 1})`, d.seconds, idx), n);
    setNow(n);
    setTimers((cur) => (existing ? cur.map((x) => (x.id === tid ? started : x)) : [...cur, started]));
    void scheduleTimerNotification(timerKey(tid), started.label, recipe.title, secondsLeft(started, n));
  };
  const updateTimer = (tid: string, fn: (t: CookTimer, n: number) => CookTimer) => {
    const n = Date.now();
    setNow(n);
    const cur = timersRef.current.find((x) => x.id === tid);
    if (!cur) return;
    const next = fn(cur, n);
    setTimers((all) => all.map((x) => (x.id === tid ? next : x)));
    if (next.status === 'running') void scheduleTimerNotification(timerKey(tid), next.label, recipe.title, secondsLeft(next, n));
    else void cancelTimerNotification(timerKey(tid));
  };
  const removeTimer = (tid: string) => {
    void cancelTimerNotification(timerKey(tid));
    setTimers((c) => c.filter((x) => x.id !== tid));
  };

  const toggleChecked = (lid: string) => setChecked((c) => (c.includes(lid) ? c.filter((x) => x !== lid) : [...c, lid]));

  const exit = () => router.back();

  if (steps.length === 0) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>{recipe.title}</Text>
        <Muted>This recipe has no method steps yet, so there is nothing to step through.</Muted>
        <Button title="Back to recipe" onPress={exit} testID="exit-cook" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }} testID="cook-mode">
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <Text style={{ fontSize: 18, fontWeight: '700' }} numberOfLines={1} accessibilityRole="header">
          {recipe.title}
        </Text>
        <Stepper label="Servings" value={servings} min={1} max={MAX_SERVINGS} onChange={setServings} testID="cook-servings" />
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        onTouchStart={(e) => {
          swipe.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
        }}
        onTouchEnd={(e) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s) return;
          const dx = e.nativeEvent.pageX - s.x;
          if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(e.nativeEvent.pageY - s.y) * 1.5) go(dx < 0 ? 1 : -1);
        }}
      >
        {alerts.map((a, i) => (
          <View key={`${a.id}-${i}`} style={[styles.banner, { borderColor: t.danger, borderWidth: 2 }]} accessibilityRole="alert" testID="timer-alert">
            <Text style={{ fontWeight: '700', fontSize: 18 }}>{a.label}: time is up</Text>
            <Button title="Dismiss" onPress={() => setAlerts((x) => x.filter((_, j) => j !== i))} testID="dismiss-alert" />
          </View>
        ))}
        {resumed && step > 0 && !onDonePage ? <Muted testID="resumed-note">Picked up where you left off.</Muted> : null}

        {!onDonePage && current ? (
          <>
            <Muted testID="step-count">
              Step {step + 1} of {steps.length}
            </Muted>
            <Text style={{ fontSize: 26, lineHeight: 36, marginVertical: 10 }} testID="step-text">
              {current.text}
            </Text>
            <Button title={reading ? 'Stop reading' : 'Read aloud'} variant="secondary" onPress={readStep} testID="read-aloud" />
            {detected.map((d, i) => (
              <Button key={`${d.start}-${i}`} title={`Start ${d.label} timer`} variant="secondary" onPress={() => void addTimer(d, step)} testID="start-timer" />
            ))}
            {stepSwaps.length > 0 ? (
              <Section testID="swap-note">
                {stepSwaps.map((s) => (
                  <Text key={s.lineId}>
                    Using {s.name} instead of {lines.find((l) => l.id === s.lineId)?.name}
                    {s.guidance ? `: ${s.guidance}` : ''}
                  </Text>
                ))}
              </Section>
            ) : null}
            <Text style={styles.heading} accessibilityRole="header">
              {showAll ? 'All ingredients' : 'This step'}
            </Text>
            <View testID="step-ingredients">
              {shownLines.map((l) => {
                const sw = swapOf(l.id);
                const done = checked.includes(l.id);
                return (
                  <View key={l.id} style={styles.row}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: done }}
                      accessibilityLabel={sw ? `${sw.name} instead of ${l.name}` : `${scaledAmount(l.quantity, recipe.servings, servings)} ${l.name}`.trim()}
                      testID={`check-${l.id}`}
                      onPress={() => toggleChecked(l.id)}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 48 }}
                    >
                      <RNText style={{ fontSize: 24, color: t.primary, width: 34 }}>{done ? '☑' : '☐'}</RNText>
                      <Text style={[{ flex: 1, fontSize: 18 }, done && { textDecorationLine: 'line-through', color: t.muted }]}>
                        {sw ? `${sw.name} (instead of ${l.name})` : `${scaledAmount(l.quantity, recipe.servings, servings)} ${l.name}${l.preparation ? `, ${l.preparation}` : ''}`.trim()}
                      </Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Out of ${l.name}?`} testID={`out-of-${l.id}`} onPress={() => setSubFor({ id: l.id, name: l.name })} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 }}>
                      <Muted>Out of it?</Muted>
                    </Pressable>
                  </View>
                );
              })}
              {shownLines.length === 0 ? <Muted>No ingredients named in this step.</Muted> : null}
            </View>
            <Button title={showAll ? 'Only this step' : 'Show all ingredients'} variant="secondary" onPress={() => setShowAll((s) => !s)} testID="toggle-all-ingredients" />
            {subFor ? (
              <SubstitutionSheet
                recipes={recipes}
                householdId={householdId}
                recipeId={recipe.id}
                line={subFor}
                existingSwaps={swaps}
                onClose={() => setSubFor(null)}
                onApply={(sw) => setSwaps((c) => [...c.filter((x) => x.lineId !== sw.lineId), sw])}
              />
            ) : null}
            {swaps.length > 0 ? <Button title="Undo all swaps" variant="secondary" onPress={() => setSwaps([])} testID="undo-swaps" /> : null}
          </>
        ) : (
          <View testID="cook-done">
            <Text style={styles.title}>All done</Text>
            {saved ? (
              <>
                <Muted accessibilityRole="alert" testID="cook-saved">
                  Saved to your cooked history.{spare ? ` ${spare}` : ''}
                </Muted>
                <Button title="Back to recipe" onPress={exit} testID="exit-cook" />
              </>
            ) : (
              <MarkCookedForm
                recipes={recipes}
                householdId={householdId}
                recipeId={recipe.id}
                servings={servings}
                currentRating={data.cooking?.myRating ?? null}
                onSaved={(_c, l) => {
                  if (l) setSpare(`${l.portionsMade} spare portion${l.portionsMade === 1 ? '' : 's'} added to your ${l.storedIn} list.`);
                  setSaved(true);
                  void AsyncStorage.removeItem(key).catch(() => undefined);
                  for (const tm of timersRef.current) void cancelTimerNotification(timerKey(tm.id));
                }}
                onCancel={() => go(-1)}
              />
            )}
          </View>
        )}

        {timers.length > 0 ? (
          <View testID="timers" style={{ marginTop: 16 }}>
            <Text style={styles.heading} accessibilityRole="header">
              Timers
            </Text>
            {timers.map((tm) => (
              <Section key={tm.id} testID="timer">
                <Text testID="timer-clock" style={{ fontSize: 32, fontWeight: '700', color: tm.status === 'done' ? t.danger : t.text }} accessibilityLabel={`${tm.label}, ${formatClock(secondsLeft(tm, now))} left`}>
                  {formatClock(secondsLeft(tm, now))}
                </Text>
                <Muted testID="timer-status">{`${tm.label} · ${tm.status}`}</Muted>
                {tm.status === 'running' ? (
                  <Button title="Pause" variant="secondary" onPress={() => updateTimer(tm.id, (x, n) => pauseTimer(x, n))} testID="pause-timer" />
                ) : (
                  <Button title={tm.status === 'paused' ? 'Resume' : 'Start'} onPress={() => updateTimer(tm.id, (x, n) => startTimer(x, n))} testID="resume-timer" />
                )}
                <Button title="Reset" variant="secondary" onPress={() => updateTimer(tm.id, (x) => resetTimer(x))} testID="reset-timer" />
                <Button title="Remove" variant="secondary" onPress={() => removeTimer(tm.id)} testID="remove-timer" />
              </Section>
            ))}
          </View>
        ) : null}
        <Muted style={{ marginTop: 12 }}>The screen stays on while you cook. Swipe left or right to change step.</Muted>
      </ScrollView>

      <View style={{ flexDirection: 'row', gap: 12, padding: 12, borderTopWidth: 1, borderTopColor: t.border }}>
        <View style={{ flex: 1 }}>
          <Button title="Previous" variant="secondary" onPress={() => go(-1)} disabled={step === 0} testID="prev-step" />
        </View>
        <View style={{ flex: 1 }}>
          <Button title={step === last - 1 ? 'Finish' : 'Next'} onPress={() => go(1)} disabled={onDonePage} testID="next-step" />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Exit" variant="secondary" onPress={exit} testID="exit-cook-bar" />
        </View>
      </View>
    </View>
  );
}
