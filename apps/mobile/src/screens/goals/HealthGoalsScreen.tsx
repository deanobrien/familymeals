import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { GOAL_DEFS, GOAL_IDS, GOALS_CONSENT, GOALS_DISCLAIMER, PORTION_SHARES, type GoalId } from '@fr/engine/nutrition';
import { ServerScreen } from '@/data/ServerApiContext';
import { createGoalsClient, type GoalsClient, type MyGoals } from '@/lib/goalsApi';
import { describeError } from '@/lib/planApi';
import type { ServerApi } from '@/lib/serverApi';
import { openWeb } from '@/lib/webLinks';
import { PRIVACY_PATH } from '@/lib/privacyText';
import { Button, ErrorState, ErrorText, Loading, Muted, Text, useStyles } from '../ui';
import { Checkbox, Notice, Segmented, confirm } from '../account/parts';

/**
 * Health goals (P3-B, D430-D439; web: Settings > Health goals). Optional, off by default, behind its own explicit consent because
 * it is health-related data. Only you can see your goals. Reference values are NHS guidance for adults with the page and review
 * date, linked out. No calorie, weight or medical targets, and no goals for children. Never sent to an AI provider. The goals live
 * on the server (own rows only); nothing is kept on the phone.
 */
export function HealthGoalsBody({ api, householdId, client: injected }: { api: ServerApi; householdId: string; client?: GoalsClient }) {
  const client = useMemo(() => injected ?? createGoalsClient(api, householdId), [injected, api, householdId]);
  const [state, setState] = useState<MyGoals | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [adult, setAdult] = useState(false);
  const [goals, setGoals] = useState<GoalId[]>([]);
  const [portion, setPortion] = useState('1');
  const [nudge, setNudge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (s: MyGoals) => {
    setState(s);
    setGoals(s.goals);
    setPortion(String(s.portionShare));
    setNudge(s.nudgePlan);
    setAdult(s.adultConfirmed);
    setConsent(false);
  };
  const load = useCallback(async () => {
    setLoadError(null);
    try {
      apply(await client.load());
    } catch (e) {
      setLoadError(describeError(e).message);
    }
  }, [client]);
  useEffect(() => { void load(); }, [load]);

  if (loadError && !state) return <ErrorState message={loadError} onRetry={() => void load()} />;
  if (!state) return <Loading label="Loading health goals" />;

  const active = state.consentActive;
  const canPick = active || consent;
  const toggle = (id: GoalId) => setGoals((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function save() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const s = await client.save({ goals, portionShare: Number(portion), nudgePlan: nudge, consent: active || consent, adultConfirmed: adult });
      apply(s);
      setNotice(s.consentActive ? 'Goals saved' : 'Nothing was saved');
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!(await confirm('Withdraw consent?', 'This deletes your nutrition goals and portion choice. You can set them up again at any time.', 'Delete my goals'))) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      apply(await client.withdraw());
      setNotice('Consent withdrawn and your goals deleted');
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Muted style={{ marginBottom: 8 }}>Pick simple weekly goals and see how your planned meals compare with UK guidance. Off unless you turn it on. Only you can see this.</Muted>
      <Text style={{ fontWeight: '600' }} testID="goals-consent-title">{GOALS_CONSENT.title}</Text>
      {active ? (
        <Muted testID="goals-consent-on">Your consent is on file. You can withdraw it below at any time, which deletes your goals.</Muted>
      ) : (
        <View testID="goals-consent">
          {GOALS_CONSENT.paragraphs.map((p) => <Text key={p} style={{ marginBottom: 6 }}>{p}</Text>)}
          <Checkbox label={GOALS_CONSENT.checkbox} checked={consent} onChange={setConsent} testID="goals-consent-box" />
          <Checkbox label={GOALS_CONSENT.adultCheckbox} checked={adult} onChange={setAdult} testID="goals-adult-box" />
        </View>
      )}
      <Muted style={{ marginVertical: 6 }}>See the privacy notice in Settings for how we handle this.</Muted>
      <Button title="Privacy notice" variant="secondary" onPress={() => void openWeb(PRIVACY_PATH)} testID="goals-privacy" />

      {canPick ? (
        <View testID="goals-list" style={{ marginTop: 8 }}>
          <Text style={{ fontWeight: '600' }}>My weekly goals</Text>
          {GOAL_IDS.map((id) => {
            const d = GOAL_DEFS[id];
            return (
              <View key={id} style={{ marginBottom: 6 }}>
                <Checkbox label={d.label} checked={goals.includes(id)} onChange={() => toggle(id)} testID={`goal-${id}`} />
                <Muted>{d.referenceText} {d.source.publisher}: {d.source.title} (page reviewed {d.source.reviewed}).</Muted>
                <Button title="Open the NHS page" variant="secondary" onPress={() => void Linking.openURL(d.source.url)} testID={`goal-source-${id}`} />
              </View>
            );
          })}
          <Segmented
            label="My usual portion"
            value={portion}
            options={PORTION_SHARES.map((p) => ({ value: String(p.value), label: p.label }))}
            onChange={setPortion}
            testID="goals-portion"
          />
          <Checkbox label="Nudge meal plans towards my household's goals" checked={nudge} onChange={setNudge} testID="goal-nudge" />
          <Muted>Off by default. When on, the planner gets an anonymous list of goals (never your name) and only prefers meals that fit them when everything else allows.</Muted>
          {!active && !adult ? <Muted>Confirm you are 18 or over above to save.</Muted> : null}
        </View>
      ) : null}

      <ErrorText message={error} />
      <Notice message={notice} testID="goals-notice" />
      <Button title={busy ? 'Saving...' : 'Save goals'} onPress={() => void save()} disabled={busy || (!active && !consent)} testID="goals-save" />
      {active ? <Button title="Withdraw consent and delete my goals" variant="secondary" onPress={() => void withdraw()} disabled={busy} testID="goals-withdraw" /> : null}
      <Muted style={{ marginTop: 12 }} testID="goals-disclaimer">{GOALS_DISCLAIMER}</Muted>
    </>
  );
}

export default function HealthGoalsScreen() {
  const styles = useStyles();
  return (
    <ServerScreen>
      {(api, householdId) => (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} style={styles.screen} keyboardShouldPersistTaps="handled">
          <HealthGoalsBody api={api} householdId={householdId} />
        </ScrollView>
      )}
    </ServerScreen>
  );
}
