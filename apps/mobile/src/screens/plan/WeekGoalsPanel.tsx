import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { GOAL_DEFS, type GoalProgress, type GoalStatus } from '@fr/engine/nutrition';
import type { WeekGoals } from '@/lib/plan/ops';
import { Button, Muted, Text } from '../ui';
import { Section } from './parts';

const STATUS_TEXT: Record<GoalStatus, string> = { met: 'In line', close: 'Close', off: 'Some way off', unclear: 'Not enough data to say', none: 'No meals yet' };

/**
 * My goals this week (P3-B, D433; web: planner "My goals this week"). Only the signed-in person's own goals, only with their
 * consent. An estimate from planned (or cooked) recipes and their usual portion; "at least" when data is missing; gentle hints,
 * never advice. The screen renders nothing without consent. The Cooked toggle appears only when the server sends cooked meals.
 */
export default function WeekGoalsPanel({ planned, cooked }: { planned: WeekGoals | null; cooked?: WeekGoals | null }) {
  const [view, setView] = useState<'planned' | 'cooked'>('planned');
  const base = planned ?? cooked;
  if (!base) return null;
  const data = view === 'cooked' ? cooked ?? null : planned;
  const s = data?.summary;
  return (
    <Section title="My goals this week" testID="week-goals">
      {cooked !== undefined ? (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }} accessibilityRole="radiogroup">
          <Button title="Planned" variant={view === 'planned' ? 'primary' : 'secondary'} onPress={() => setView('planned')} testID="goals-planned" />
          <Button title="Cooked" variant={view === 'cooked' ? 'primary' : 'secondary'} onPress={() => setView('cooked')} testID="goals-cooked" />
        </View>
      ) : null}
      {!data || !s ? (
        <Muted testID="week-goals-empty">{view === 'cooked' ? 'Nothing cooked this week yet.' : 'Plan some recipe meals to see this.'}</Muted>
      ) : (
        <>
          <Muted>{`Only you can see this. Worked out for your usual portion (${s.portionShare === 1 ? 'one serving' : `${s.portionShare} of a serving`} of each meal).`}</Muted>
          {s.progress.map((p) => <GoalRow key={p.goal} p={p} />)}
          {data.hints.length > 0 ? (
            <View testID="goal-hints" style={{ marginTop: 8 }}>
              {data.hints.map((h) => <Text key={h.goal} style={{ marginBottom: 4 }}>{h.text}</Text>)}
            </View>
          ) : null}
          <Muted style={{ marginTop: 6 }}>{s.shareNote}</Muted>
        </>
      )}
      <Muted testID="week-goals-disclaimer">{base.summary.disclaimer}</Muted>
    </Section>
  );
}

function GoalRow({ p }: { p: GoalProgress }) {
  const def = GOAL_DEFS[p.goal];
  return (
    <View style={{ marginTop: 8 }} testID={`goal-progress-${p.goal}`} accessible accessibilityLabel={`${p.label}. ${STATUS_TEXT[p.status]}. ${p.headline}`}>
      <Text style={{ fontWeight: '600' }}>{`${p.label}: ${STATUS_TEXT[p.status]}`}</Text>
      <Text testID={`goal-headline-${p.goal}`}>{p.headline}</Text>
      <Muted>{`${p.detail}${p.caveat ? ` ${p.caveat}` : ''}`}</Muted>
      <Muted>{`${def.referenceText} ${def.source.publisher} (reviewed ${def.source.reviewed}).`}</Muted>
      <Button title="Open the NHS page" variant="secondary" onPress={() => void Linking.openURL(def.source.url)} testID={`goal-open-${p.goal}`} />
    </View>
  );
}
