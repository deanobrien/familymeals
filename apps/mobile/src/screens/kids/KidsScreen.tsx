import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ServerScreen } from '@/data/ServerApiContext';
import { COLOUR_HEX, KID_AVATARS, KID_COLOURS, createKidsClient, type KidsClient, type KidsData, type Round, type VoteValue } from '@/lib/kidsApi';
import { createKidsGate } from '@/lib/kidsDevice';
import type { ServerApi } from '@/lib/serverApi';
import type { DevicePinGate } from '@fr/engine/kids';
import { Button, ErrorState, ErrorText, Loading, Muted, Text, useStyles } from '../ui';
import { Chip, ChipWrap, Field, Section } from '../widgets';

const MIN = 3;
const MAX = 6;

function PinSetup({ gate, onChange }: { gate: DevicePinGate; onChange: (has: boolean) => void }) {
  const [has, setHas] = useState<boolean | null>(null);
  const [pin, setPin] = useState('');
  const [current, setCurrent] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    void gate.hasPin().then((h) => {
      setHas(h);
      onChange(h);
    });
  }, [gate, onChange]);
  if (has === null) return null;
  const digits = (s: string) => s.replace(/\D/g, '').slice(0, 6);
  const save = async () => {
    const ok = await gate.setPin(pin, has ? current : undefined);
    if (!ok) return setMsg(has ? 'That did not work. Check the current PIN, and use 4 to 6 digits.' : 'Use 4 to 6 digits.');
    setMsg('PIN saved on this phone.');
    setPin('');
    setCurrent('');
    setHas(true);
    onChange(true);
  };
  return (
    <Section testID="pin-setup">
      <Text style={{ fontWeight: '700' }}>Parent PIN for this phone</Text>
      <Muted>Kids&apos; mode stays on the screen until this PIN is entered. It is kept on this phone only, never sent to us. {has ? 'A PIN is set.' : 'Set one before starting kids’ mode.'}</Muted>
      {has ? <Field label="Current PIN" value={current} onChangeText={(s) => setCurrent(digits(s))} keyboardType="numeric" secureTextEntry testID="pin-current" /> : null}
      <Field label={has ? 'New PIN' : 'PIN (4 to 6 digits)'} value={pin} onChangeText={(s) => setPin(digits(s))} keyboardType="numeric" secureTextEntry testID="pin-input" />
      <Button title={has ? 'Change PIN' : 'Set PIN'} onPress={() => void save()} testID="save-pin" />
      <Muted testID="pin-status">{msg}</Muted>
    </Section>
  );
}

export function KidsBody({ api, householdId, client: injected, gate: injectedGate, onPlay }: {
  api: ServerApi; householdId: string; client?: KidsClient; gate?: DevicePinGate; onPlay?: (roundId: string) => void;
}) {
  const styles = useStyles();
  const router = useRouter();
  const client = useMemo(() => injected ?? createKidsClient(api, householdId), [injected, api, householdId]);
  const [data, setData] = useState<KidsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [hasPin, setHasPin] = useState(false);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string>(KID_AVATARS[0]);
  const [colour, setColour] = useState<string>('blue');
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [week, setWeek] = useState(false);
  const [busy, setBusy] = useState(false);
  const gate = useMemo(() => injectedGate ?? (data ? createKidsGate(householdId, data.me) : null), [injectedGate, data, householdId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await client.load());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kids' mode could not be loaded.");
    }
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!data) return <Loading label="Loading kids' mode" />;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX ? p : [...p, id]));
  const mine = (r: Round, recipeId: string): VoteValue | null => r.votes.find((v) => v.recipeId === recipeId && v.voter.kind === 'member' && v.voter.id === data.me)?.value ?? null;
  const play = (id: string) => (onPlay ? onPlay(id) : router.push({ pathname: '/kids-play', params: { round: id } } as never));

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">Kids&apos; mode: help pick dinner</Text>
      <Muted>Open a vote with 3 to 6 meals. Everyone taps a thumbs up or a heart, and the kids can do it on this phone with big pictures and no typing. When you close the vote, the liked meals get a nudge in the planner. It is only ever a nudge: allergies, budget and variety still win.</Muted>
      <ErrorText message={actionError} />

      {gate ? <PinSetup gate={gate} onChange={setHasPin} /> : null}

      <Text style={styles.heading} accessibilityRole="header">Kid profiles</Text>
      <Muted>A name or nickname, a picture and a colour. No email, no photo and nothing else is kept: a kid profile cannot sign in.</Muted>
      {data.kids.length === 0 ? <Muted testID="no-kids">No kid profiles yet.</Muted> : null}
      {data.kids.map((k) => (
        <View key={k.id} testID={`kid-${k.id}`} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
          <Text>{`${k.avatar} ${k.displayName}`}</Text>
          <Button title="Remove" variant="secondary" disabled={busy} onPress={() => void run(() => client.removeKid(k.id))} accessibilityLabel={`Remove ${k.displayName}`} testID={`remove-kid-${k.id}`} />
        </View>
      ))}
      <Field label="Name or nickname" value={name} onChangeText={setName} maxLength={24} testID="kid-name" />
      <ChipWrap>
        {KID_AVATARS.map((a) => (
          <Chip key={a} label={a} selected={avatar === a} onPress={() => setAvatar(a)} accessibilityLabel={`Picture ${a}`} testID={`avatar-${a}`} />
        ))}
      </ChipWrap>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {KID_COLOURS.map((c) => (
          <Pressable
            key={c} accessibilityRole="button" accessibilityLabel={`Colour ${c}`} accessibilityState={{ selected: colour === c }} testID={`colour-${c}`} onPress={() => setColour(c)}
            style={{ width: 44, height: 44, borderRadius: 22, margin: 4, backgroundColor: COLOUR_HEX[c], borderWidth: colour === c ? 4 : 1, borderColor: colour === c ? '#000' : '#888' }}
          />
        ))}
      </View>
      <Button title="Add kid" disabled={busy || !name.trim()} onPress={() => void run(async () => { await client.addKid({ displayName: name.trim(), avatar, colour }); setName(''); })} testID="add-kid" />

      <Text style={styles.heading} accessibilityRole="header">Start a vote</Text>
      {data.planned.length > 0 ? (
        <Button title={`Use this week's plan (${Math.min(data.planned.length, MAX)} meals)`} variant="secondary" onPress={() => setPicked(data.planned.map((p) => p.recipeId).slice(0, MAX))} testID="use-plan" />
      ) : null}
      <Muted>{`Pick ${MIN} to ${MAX} meals (${picked.length} chosen)`}</Muted>
      <ChipWrap>
        {data.recipes.map((r) => (
          <Chip key={r.recipeId} label={r.title} selected={picked.includes(r.recipeId)} onPress={() => toggle(r.recipeId)} testID={`pick-${r.recipeId}`} />
        ))}
      </ChipWrap>
      <Field label="Name (optional)" value={title} onChangeText={setTitle} maxLength={60} testID="round-title" />
      <ChipWrap>
        <Chip label="One day" selected={!week} onPress={() => setWeek(false)} testID="round-day" />
        <Chip label="A week" selected={week} onPress={() => setWeek(true)} testID="round-week" />
      </ChipWrap>
      <Button
        title="Start the vote" disabled={busy || picked.length < MIN} testID="open-round"
        onPress={() => void run(async () => { await client.openRound({ recipeIds: picked, days: week ? 7 : 1, ...(title.trim() ? { title: title.trim() } : {}) }); setPicked([]); setTitle(''); })}
      />

      <Text style={styles.heading} accessibilityRole="header">Votes</Text>
      {data.rounds.length === 0 ? <Muted testID="no-rounds">No votes yet.</Muted> : null}
      {data.rounds.map((r) => (
        <Section key={r.id} testID={`round-${r.id}`}>
          <Text style={{ fontWeight: '700' }}>{`${r.title ?? 'Dinner vote'} · ${r.open ? 'Open' : 'Finished'}`}</Text>
          <Muted>{r.days > 1 ? `Week of ${r.forDate}` : r.forDate}</Muted>
          {r.candidates.map((c) => (
            <View key={c.recipeId} testID={`candidate-${c.recipeId}`} style={{ paddingVertical: 4 }}>
              <Text>{`${c.winner ? '🏆 ' : ''}${c.title}`}</Text>
              <Muted>{`👍 ${c.up} · ❤️ ${c.heart}`}</Muted>
              {r.open ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button title="👍" variant={mine(r, c.recipeId) === 'up' ? 'primary' : 'secondary'} disabled={busy} accessibilityLabel={`I like ${c.title}`} testID={`my-up-${c.recipeId}`}
                    onPress={() => void run(() => client.vote({ roundId: r.id, recipeId: c.recipeId, kidId: null, value: mine(r, c.recipeId) === 'up' ? null : 'up' }))} />
                  <Button title="❤️" variant={mine(r, c.recipeId) === 'heart' ? 'primary' : 'secondary'} disabled={busy} accessibilityLabel={`I love ${c.title}`} testID={`my-heart-${c.recipeId}`}
                    onPress={() => void run(() => client.vote({ roundId: r.id, recipeId: c.recipeId, kidId: null, value: mine(r, c.recipeId) === 'heart' ? null : 'heart' }))} />
                </View>
              ) : null}
            </View>
          ))}
          {r.open ? (
            <View>
              {hasPin ? <Button title="Let the kids vote" onPress={() => play(r.id)} testID={`play-${r.id}`} /> : <Muted>Set a PIN to let the kids vote.</Muted>}
              <Button title="Close the vote" variant="secondary" disabled={busy} onPress={() => void run(() => client.closeRound(r.id))} testID={`close-${r.id}`} />
            </View>
          ) : <Muted>The meals with the most votes get a nudge when you plan that {r.days > 1 ? 'week' : 'day'}.</Muted>}
        </Section>
      ))}
      <RNText style={{ height: 24 }}>{''}</RNText>
    </ScrollView>
  );
}

export default function KidsScreen() {
  return <ServerScreen>{(api, householdId) => <KidsBody api={api} householdId={householdId} />}</ServerScreen>;
}
