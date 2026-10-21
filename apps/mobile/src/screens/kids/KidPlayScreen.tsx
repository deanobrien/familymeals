import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Image, Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ServerScreen } from '@/data/ServerApiContext';
import { COLOUR_HEX, createKidsClient, type Candidate, type Kid, type KidsClient, type KidsData, type Round, type VoteValue } from '@/lib/kidsApi';
import { createKidsGate } from '@/lib/kidsDevice';
import type { ServerApi } from '@/lib/serverApi';
import type { DevicePinGate } from '@fr/engine/kids';
import { Loading, useTheme } from '../ui';
import PinPad from './PinPad';

/** A candidate picture through the bearer-protected image route (null = a plate emoji). */
function Picture({ api, path, label }: { api: ServerApi; path: string | null; label: string }) {
  const t = useTheme();
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  useEffect(() => {
    let live = true;
    const uri = path ? (/^https?:\/\//i.test(path) ? path : api.webUrl(path)) : null;
    if (!uri) return;
    api.authHeaders().then((headers) => live && setSource({ uri, headers }), () => undefined);
    return () => {
      live = false;
    };
  }, [api, path]);
  if (!source) return <View style={{ height: 160, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }}><RNText style={{ fontSize: 64 }} accessibilityLabel={label}>{'🍽️'}</RNText></View>;
  return <Image source={source} accessibilityLabel={label} style={{ height: 160, width: '100%' }} resizeMode="cover" />;
}

/**
 * Kids' voting screen (P3-A, D424, D427): big pictures, two big buttons, NO text input. Full screen with the system Back button
 * and gestures held; the only way out is the grown-up PIN (a small lock in the corner). The PIN is checked on this phone only.
 */
export function KidPlayBody({ api, householdId, roundId, client: injected, gate: injectedGate }: {
  api: ServerApi; householdId: string; roundId: string; client?: KidsClient; gate?: DevicePinGate;
}) {
  const t = useTheme();
  const router = useRouter();
  const client = useMemo(() => injected ?? createKidsClient(api, householdId), [injected, api, householdId]);
  const [data, setData] = useState<KidsData | null>(null);
  const [kid, setKid] = useState<Kid | null>(null);
  const [thanks, setThanks] = useState(false);
  const [pin, setPin] = useState(false);
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [votes, setVotes] = useState<Round['votes']>([]);
  const gate = useMemo(() => injectedGate ?? (data ? createKidsGate(householdId, data.me) : null), [injectedGate, data, householdId]);

  useEffect(() => {
    let live = true;
    client.load().then((d) => {
      if (!live) return;
      setData(d);
      setVotes(d.rounds.find((r) => r.id === roundId)?.votes ?? []);
    }, () => live && setError('Could not load the vote. Ask a grown-up.'));
    return () => {
      live = false;
    };
  }, [client, roundId]);
  useEffect(() => {
    void gate?.hasPin().then(setHasPin);
  }, [gate]);

  // Hold the system Back button: only the PIN leaves this screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const exit = useCallback(() => router.replace('/kids' as never), [router]);
  const round = data?.rounds.find((r) => r.id === roundId) ?? null;

  const lock = (
    <Pressable
      accessibilityRole="button" accessibilityLabel="Grown-ups: leave kids mode" testID="kid-exit" onPress={() => (hasPin === false ? exit() : setPin(true))}
      style={{ position: 'absolute', bottom: 12, right: 12, width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center', opacity: 0.8 }}
    >
      <RNText style={{ fontSize: 22 }}>{'🔒'}</RNText>
    </Pressable>
  );
  const frame = (children: React.ReactNode) => (
    <View style={{ flex: 1, backgroundColor: t.bg }} testID="kid-screen">
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <StatusBar hidden />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }}>{children}</ScrollView>
      {lock}
      {pin && gate ? <PinPad gate={gate} onOpen={exit} onCancel={() => setPin(false)} /> : null}
    </View>
  );
  const title = (s: string) => <RNText accessibilityRole="header" style={{ fontSize: 30, fontWeight: '700', textAlign: 'center', color: t.text, marginVertical: 12 }}>{s}</RNText>;

  if (error && !data) return frame(title(error));
  if (!data) return <Loading label="Loading the vote" />;
  if (!round || !round.open) {
    return frame(
      <>
        {title(round ? 'The vote has finished! 🎉' : 'No vote right now')}
        {round?.candidates.filter((c) => c.winner).map((c) => <RNText key={c.recipeId} style={{ fontSize: 26, textAlign: 'center', color: t.text }}>{`🏆 ${c.title}`}</RNText>)}
      </>,
    );
  }

  if (!kid) {
    return frame(
      <>
        {title(thanks ? 'Thank you! 🎉 Who is next?' : 'Who is voting?')}
        {data.kids.length === 0 ? <RNText style={{ textAlign: 'center', color: t.text }}>Ask a grown-up to add you in Kids mode.</RNText> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
          {data.kids.map((k) => (
            <Pressable
              key={k.id} accessibilityRole="button" accessibilityLabel={k.displayName} testID={`pick-kid-${k.id}`} onPress={() => { setKid(k); setThanks(false); }}
              style={{ width: 140, height: 140, margin: 8, borderRadius: 20, backgroundColor: COLOUR_HEX[k.colour] ?? '#3e63dd', alignItems: 'center', justifyContent: 'center' }}
            >
              <RNText style={{ fontSize: 56 }}>{k.avatar}</RNText>
              <RNText style={{ fontSize: 18, fontWeight: '700', color: '#fff' }}>{k.displayName}</RNText>
            </Pressable>
          ))}
        </View>
      </>,
    );
  }

  const mine = (recipeId: string): VoteValue | null => votes.find((v) => v.recipeId === recipeId && v.voter.kind === 'kid' && v.voter.id === kid.id)?.value ?? null;
  const tap = (recipeId: string, value: VoteValue) => {
    const next = mine(recipeId) === value ? null : value;
    setError(null);
    setVotes((vs) => [...vs.filter((v) => !(v.recipeId === recipeId && v.voter.kind === 'kid' && v.voter.id === kid.id)), ...(next ? [{ recipeId, voter: { kind: 'kid' as const, id: kid.id }, value: next }] : [])]);
    client.vote({ roundId, recipeId, kidId: kid.id, value: next }).catch((e: unknown) => {
      setError((e as { status?: number } | null)?.status === 409 ? 'The vote has just finished.' : 'That did not save. Try again.');
    });
  };
  const card = (c: Candidate) => (
    <View key={c.recipeId} testID={`kid-card-${c.recipeId}`} style={{ borderRadius: 20, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface, overflow: 'hidden', marginBottom: 16 }}>
      <Picture api={api} path={c.imagePath} label={c.title} />
      <RNText style={{ fontSize: 24, fontWeight: '700', textAlign: 'center', padding: 10, color: t.text }}>{c.title}</RNText>
      <View style={{ flexDirection: 'row', justifyContent: 'center', paddingBottom: 12 }}>
        {(['up', 'heart'] as const).map((v) => (
          <Pressable
            key={v} accessibilityRole="button" accessibilityLabel={`${v === 'up' ? 'Thumbs up' : 'Heart'} for ${c.title}`} accessibilityState={{ selected: mine(c.recipeId) === v }}
            testID={`kid-${v}-${c.recipeId}`} onPress={() => tap(c.recipeId, v)}
            style={{ width: 110, height: 90, margin: 8, borderRadius: 18, borderWidth: 3, alignItems: 'center', justifyContent: 'center', borderColor: mine(c.recipeId) === v ? (v === 'up' ? '#3e63dd' : '#e93d82') : t.border, backgroundColor: mine(c.recipeId) === v ? (v === 'up' ? '#cfe8ff' : '#ffd6e5') : t.bg }}
          >
            <RNText style={{ fontSize: 46 }}>{v === 'up' ? '👍' : '❤️'}</RNText>
          </Pressable>
        ))}
      </View>
    </View>
  );
  return frame(
    <>
      {title(`${kid.avatar} ${kid.displayName}, what shall we eat?`)}
      {round.candidates.map(card)}
      {error ? <RNText accessibilityRole="alert" style={{ textAlign: 'center', fontSize: 20, color: t.danger }}>{error}</RNText> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="All done" testID="kid-done" onPress={() => { setKid(null); setThanks(true); }}
          style={{ minWidth: 200, height: 72, borderRadius: 18, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', marginHorizontal: 8 }}>
          <RNText style={{ fontSize: 26, color: t.primaryText }}>{'✅ All done'}</RNText>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Not me" testID="kid-back" onPress={() => setKid(null)}
          style={{ width: 72, height: 72, borderRadius: 18, borderWidth: 2, borderColor: t.border, alignItems: 'center', justifyContent: 'center' }}>
          <RNText style={{ fontSize: 28 }}>{'↩️'}</RNText>
        </Pressable>
      </View>
    </>,
  );
}

export default function KidPlayScreen() {
  const params = useLocalSearchParams<{ round?: string | string[] }>();
  const raw = Array.isArray(params.round) ? params.round[0] : params.round;
  return <ServerScreen>{(api, householdId) => <KidPlayBody api={api} householdId={householdId} roundId={raw ?? ''} />}</ServerScreen>;
}
