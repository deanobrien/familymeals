// P3-A (D420-D429) on Android: the share-link screen (preview, save a copy, sign-in prompt), creating and switching off links, kids'
// mode (profiles, PIN, rounds) and the kids' voting screen (no text input, Back held, PIN-only exit). Jest with fakes: the real
// system share sheet, deep link and full-screen behaviour are device checks (docs/ROADMAP.md, P3-A).
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BackHandler } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { DevicePinGate } from '@fr/engine/kids';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { ServerApiProvider } from '@/data/ServerApiContext';
import type { KidsClient, KidsData } from '@/lib/kidsApi';
import type { ServerApi } from '@/lib/serverApi';
import type { ShareSummary, SharePreview, SharingClient } from '@/lib/sharingApi';
import { KidsBody } from '@/screens/kids/KidsScreen';
import { KidPlayBody } from '@/screens/kids/KidPlayScreen';
import { ShareLinkBody } from '@/screens/sharing/ShareLinkScreen';
import RecipeShareSection from '@/screens/sharing/RecipeShareSection';
import { SharedLinksBody } from '@/screens/sharing/SharedLinksScreen';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
}));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

const HH = 'hh-1';
const T = 'cd'.repeat(32);
const API: ServerApi = {
  configured: true,
  get: async () => { throw new Error('unused'); },
  post: async () => { throw new Error('unused'); },
  postForm: async () => { throw new Error('unused'); },
  webUrl: (p) => `https://web.test${p}`,
  authHeaders: async () => ({}),
};

function SetHousehold({ children }: { children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId(HH), [setHouseholdId]);
  return householdId ? <>{children}</> : null;
}
async function mount(ui: React.ReactElement) {
  await render(
    <AppProvider dataSource={new MockDataSource()}>
      <SetHousehold>
        <ServerApiProvider api={API}>{ui}</ServerApiProvider>
      </SetHousehold>
    </AppProvider>,
  );
}
const press = async (id: string) => { await fireEvent.press(await screen.findByTestId(id)); };

const recipe = { id: 'r1', title: 'Chilli', description: 'Warming', sourceAttribution: '', sourceUrl: '', prepMinutes: 15, cookMinutes: 45, servings: 4, cuisine: '', tags: [], ingredients: [{ text: '400 g beef mince', optional: false }], steps: ['Brown the mince.'], imagePath: null };
const full = (over: Partial<Extract<SharePreview, { kind: 'full' }>> = {}): SharePreview => ({ kind: 'full', scope: 'recipe', title: null, attribution: "Shared by Alice's household", recipes: [recipe], expiresAt: null, signedIn: true, own: false, ...over });

function sharingClient(over: Partial<SharingClient> = {}): SharingClient & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {};
  const track = <A extends unknown[], R>(name: string, fn: (...a: A) => R) => (...a: A): R => { (calls[name] ??= []).push(a); return fn(...a); };
  return {
    calls,
    list: track('list', async () => [] as ShareSummary[]),
    create: track('create', async () => ({ id: 's1', token: T, expiresAt: null })),
    revoke: track('revoke', async () => undefined),
    preview: track('preview', async () => ({ preview: full(), signedIn: true })),
    save: track('save', async () => ({ recipeId: 'new1', title: 'Chilli', imageCopied: false })),
    ...over,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('the share link screen', () => {
  it('an invalid, expired or revoked link gives one generic message', async () => {
    await mount(<ShareLinkBody token={T} client={sharingClient({ preview: async () => ({ preview: { kind: 'invalid' }, signedIn: true }) })} />);
    expect(await screen.findByTestId('share-unavailable')).toHaveTextContent(/not available/i);
    expect(screen.queryByTestId('share-sign-in')).toBeNull();
  });

  it('signed out: a minimal preview and a sign-in prompt that remembers the link', async () => {
    const preview: SharePreview = { kind: 'minimal', scope: 'recipe', title: 'Chilli', sharedBy: 'Alice', recipeCount: 1 };
    await mount(<ShareLinkBody token={T} client={sharingClient({ preview: async () => ({ preview, signedIn: false }) })} />);
    expect(await screen.findByTestId('share-title')).toHaveTextContent('Chilli');
    expect(screen.getByText(/Alice's household has shared a recipe/)).toBeTruthy();
    expect(screen.queryByText(/beef mince/)).toBeNull();
    await press('share-sign-in-button');
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in'));
    expect(await AsyncStorage.getItem('fr.pendingNext.v1')).toContain(`/s/${T}`);
  });

  it('signed in: reads the recipe, attributes the sharer and saves a copy', async () => {
    const client = sharingClient();
    await mount(<ShareLinkBody token={T} client={client} />);
    expect(await screen.findByText("Shared by Alice's household")).toBeTruthy();
    expect(screen.getByText('• 400 g beef mince')).toBeTruthy();
    expect(screen.getByText('1. Brown the mince.')).toBeTruthy();
    await press('save-copy-r1');
    expect(await screen.findByTestId('share-saved')).toBeTruthy();
    expect(client.calls.save).toEqual([[T, 'r1']]);
    await press('open-copy-r1');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/recipe/[id]', params: { id: 'new1' } });
    expect(screen.queryByTestId('save-copy-r1')).toBeNull();
  });

  it('the sharer\'s own household cannot save, and a rate-limited look is explained', async () => {
    await mount(<ShareLinkBody token={T} client={sharingClient({ preview: async () => ({ preview: full({ own: true }), signedIn: true }) })} />);
    expect(await screen.findByText(/already yours/)).toBeTruthy();
    expect(screen.queryByTestId('save-copy-r1')).toBeNull();
  });

  it('shows a save failure without losing the recipe', async () => {
    await mount(<ShareLinkBody token={T} client={sharingClient({ save: async () => { throw new Error('This link is not available.'); } })} />);
    await press('save-copy-r1');
    expect(await screen.findByText('This link is not available.')).toBeTruthy();
    expect(screen.getByTestId('save-copy-r1')).toBeTruthy();
  });
});

describe('creating and switching off links', () => {
  const active: ShareSummary = { id: 's1', scope: 'recipe', title: null, recipes: [{ id: 'r1', title: 'Chilli' }], createdAt: '2026-10-21T10:00:00Z', expiresAt: null, status: 'active', publicPreview: false, openedBy: 2, saved: 1 };

  it('a recipe section creates a link, hands it to the share sheet once, and lists only this recipe\'s links', async () => {
    const share = jest.fn(async () => undefined);
    const client = sharingClient({ list: async () => [active, { ...active, id: 's2', recipes: [{ id: 'r9', title: 'Other' }] }] });
    // the section uses the injected share function through CreateShare's default (Android share sheet); stub it via the Share module
    const RN = require('react-native') as typeof import('react-native');
    jest.spyOn(RN.Share, 'share').mockImplementation(share as never);
    await mount(<RecipeShareSection recipeId="r1" recipeTitle="Chilli" client={client} />);
    await press('share-recipe');
    expect(await screen.findByTestId('share-s1')).toBeTruthy();
    expect(screen.queryByTestId('share-s2')).toBeNull();
    await press('expiry-7');
    await press('create-share');
    await screen.findByTestId('new-share-link');
    expect(client.calls.create![0]).toEqual([{ scope: 'recipe', recipeIds: ['r1'], expiresInDays: 7, publicPreview: false }]);
    expect(screen.getByTestId('share-link-text')).toHaveTextContent(`https://web.test/s/${T}`);
    expect(share).toHaveBeenCalledTimes(1);
    expect((share.mock.calls[0] as unknown[])[0]).toMatchObject({ message: expect.stringContaining(`/s/${T}`) });
    await press('share-done');
    expect(screen.queryByTestId('new-share-link')).toBeNull(); // the link is not shown again
  });

  it('switching a link off asks first, then revokes', async () => {
    const client = sharingClient({ list: async () => [active] });
    await mount(<SharedLinksBody api={API} householdId={HH} client={client} />);
    await press('revoke-s1');
    expect(client.calls.revoke).toBeUndefined();
    await press('confirm-revoke-s1');
    await waitFor(() => expect(client.calls.revoke).toEqual([['s1']]));
  });

  it('shares a named collection', async () => {
    const client = sharingClient();
    const RN = require('react-native') as typeof import('react-native');
    jest.spyOn(RN.Share, 'share').mockImplementation((async () => ({ action: 'sharedAction' })) as never);
    await mount(<SharedLinksBody api={API} householdId={HH} client={client} />);
    await press('collection-quick');
    await press('create-share');
    await screen.findByTestId('new-share-link');
    expect(client.calls.create![0]).toEqual([{ scope: 'collection', collection: 'quick', title: 'Quick meals', expiresInDays: 30, publicPreview: false }]);
  });
});

// --------------------------------------------------------------------------------------------------------------- kids' mode

const memoryGate = (now: () => number = Date.now) => {
  const data = new Map<string, string>();
  return new DevicePinGate({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }, { key: 'k', now, randomSalt: () => '0123456789abcdef0123456789abcdef' });
};

const candidates = (up = 0): KidsData['rounds'][number]['candidates'] => ['a', 'b', 'c'].map((id) => ({ recipeId: id, title: `Dish ${id}`, imagePath: null, up, heart: 0, score: up, winner: false }));
const kidsData = (over: Partial<KidsData> = {}): KidsData => ({
  kids: [{ id: 'k1', displayName: 'Mia', avatar: '🦊', colour: 'blue' }],
  rounds: [{ id: 'rd1', title: 'Tonight', forDate: '2026-10-21', days: 1, open: true, closesAt: null, candidates: candidates(), votes: [] }],
  me: 'u1', planned: [{ recipeId: 'a', title: 'Dish a' }, { recipeId: 'b', title: 'Dish b' }, { recipeId: 'c', title: 'Dish c' }],
  recipes: ['a', 'b', 'c', 'd'].map((id) => ({ recipeId: id, title: `Dish ${id}` })), ...over,
});
function kidsClient(data: KidsData | (() => KidsData), over: Partial<KidsClient> = {}): KidsClient & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {};
  const t = <A extends unknown[], R>(n: string, fn: (...a: A) => R) => (...a: A): R => { (calls[n] ??= []).push(a); return fn(...a); };
  return {
    calls,
    load: t('load', async () => (typeof data === 'function' ? data() : data)),
    addKid: t('addKid', async (i: { displayName: string; avatar: string; colour: string }) => ({ id: 'k2', ...i })),
    removeKid: t('removeKid', async () => undefined),
    openRound: t('openRound', async () => 'rd2'),
    closeRound: t('closeRound', async () => undefined),
    vote: t('vote', async () => undefined),
    ...over,
  };
}

describe('kids\' mode (parent side)', () => {
  it('needs a PIN before kids can vote; adds a kid; needs 3 meals to start a vote', async () => {
    const client = kidsClient(kidsData());
    const gate = memoryGate();
    await mount(<KidsBody api={API} householdId={HH} client={client} gate={gate} />);
    await screen.findByTestId('pin-setup');
    expect(screen.queryByTestId('play-rd1')).toBeNull();
    expect(screen.getByText('Set a PIN to let the kids vote.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('pin-input'), '12ab');
    expect(screen.getByTestId('pin-input').props.value).toBe('12'); // digits only
    await fireEvent.changeText(screen.getByTestId('pin-input'), '2468');
    await press('save-pin');
    await waitFor(() => expect(screen.getByTestId('pin-status')).toHaveTextContent('PIN saved on this phone.'));
    expect(await screen.findByTestId('play-rd1')).toBeTruthy();
    await press('play-rd1');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/kids-play', params: { round: 'rd1' } });

    await fireEvent.changeText(screen.getByTestId('kid-name'), 'Zed');
    await press('add-kid');
    await waitFor(() => expect(client.calls.addKid).toEqual([[{ displayName: 'Zed', avatar: '🦊', colour: 'blue' }]]));

    expect(screen.getByTestId('open-round').props.accessibilityState.disabled).toBe(true);
    await press('pick-a');
    await press('pick-b');
    expect(screen.getByTestId('open-round').props.accessibilityState.disabled).toBe(true);
    await press('pick-c');
    await press('open-round');
    await waitFor(() => expect(client.calls.openRound).toEqual([[{ recipeIds: ['a', 'b', 'c'], days: 1 }]]));
  });

  it('the parent can vote and close; a finished round shows the winner and no vote buttons', async () => {
    const client = kidsClient(kidsData());
    await mount(<KidsBody api={API} householdId={HH} client={client} gate={memoryGate()} />);
    await press('my-heart-a');
    await waitFor(() => expect(client.calls.vote).toEqual([[{ roundId: 'rd1', recipeId: 'a', kidId: null, value: 'heart' }]]));
    await press('close-rd1');
    await waitFor(() => expect(client.calls.closeRound).toEqual([['rd1']]));
  });

  it('profiles collect a name, a picture and a colour and nothing else', async () => {
    await mount(<KidsBody api={API} householdId={HH} client={kidsClient(kidsData({ kids: [] }))} gate={memoryGate()} />);
    await screen.findByTestId('no-kids');
    const inputs = screen.queryAllByDisplayValue(/^/).map((i) => i.props.accessibilityLabel);
    expect(inputs).toEqual(expect.arrayContaining(['Name or nickname']));
    expect(inputs.join(' ')).not.toMatch(/email|birth|surname|photo|address/i);
  });
});

describe('kids\' voting screen', () => {
  const play = (over: { data?: KidsData; client?: KidsClient; gate?: DevicePinGate } = {}) => {
    const client = (over.client as ReturnType<typeof kidsClient> | undefined) ?? kidsClient(over.data ?? kidsData());
    const gate = over.gate ?? memoryGate();
    return { client, gate, ui: <KidPlayBody api={API} householdId={HH} roundId="rd1" client={client} gate={gate} /> };
  };

  it('has no text input at all, and holds the system Back button', async () => {
    const spy = jest.spyOn(BackHandler, 'addEventListener');
    const { gate, ui } = play();
    await gate.setPin('2468');
    await mount(ui);
    await screen.findByTestId('pick-kid-k1');
    expect(screen.queryAllByDisplayValue(/^/)).toHaveLength(0);
    const handler = spy.mock.calls.find((c) => c[0] === 'hardwareBackPress')![1] as () => boolean;
    expect(handler()).toBe(true); // Back is swallowed: only the PIN leaves
    await press('pick-kid-k1');
    expect(screen.queryAllByDisplayValue(/^/)).toHaveLength(0);
  });

  it('a kid taps thumbs up and heart; tapping again takes it back; votes are sent as that kid', async () => {
    const { client, ui } = play();
    await mount(ui);
    await press('pick-kid-k1');
    await press('kid-up-a');
    await press('kid-heart-b');
    await press('kid-heart-b');
    await waitFor(() => expect(client.calls.vote).toHaveLength(3));
    expect(client.calls.vote).toEqual([
      [{ roundId: 'rd1', recipeId: 'a', kidId: 'k1', value: 'up' }],
      [{ roundId: 'rd1', recipeId: 'b', kidId: 'k1', value: 'heart' }],
      [{ roundId: 'rd1', recipeId: 'b', kidId: 'k1', value: null }],
    ]);
    expect(screen.getByTestId('kid-up-a').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('kid-heart-b').props.accessibilityState.selected).toBe(false);
    await press('kid-done');
    expect(await screen.findByText(/Thank you/)).toBeTruthy();
  });

  it('leaving needs the PIN: wrong guesses lock it, the right PIN leaves', async () => {
    const { gate, ui } = play();
    await gate.setPin('2468');
    await mount(ui);
    await press('pick-kid-k1');
    await press('kid-exit');
    const enter = async (pin: string) => { for (const d of pin) await press(`pin-${d}`); await press('pin-ok'); };
    await enter('1111');
    expect(await screen.findByText('That is not the PIN.')).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await enter('2222');
    await enter('3333');
    expect(await screen.findByText(/Too many tries\. Try again in 30 seconds\./)).toBeTruthy();
    await enter('2468'); // even the right PIN is refused while locked
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(screen.getByText(/Too many tries/)).toBeTruthy();
  });

  it('the right PIN leaves kids\' mode', async () => {
    const { gate, ui } = play();
    await gate.setPin('2468');
    await mount(ui);
    await press('kid-exit');
    for (const d of '2468') await press(`pin-${d}`);
    await press('pin-ok');
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/kids'));
  });

  it('a finished round shows the winner and takes no votes; with no PIN set the lock leaves at once', async () => {
    const closed = kidsData({ rounds: [{ id: 'rd1', title: null, forDate: '2026-10-21', days: 1, open: false, closesAt: null, candidates: candidates(1).map((c, i) => ({ ...c, winner: i === 0 })), votes: [] }] });
    const { ui } = play({ data: closed });
    await mount(ui);
    expect(await screen.findByText(/The vote has finished/)).toBeTruthy();
    expect(screen.getByText(/Dish a/)).toBeTruthy();
    expect(screen.queryByTestId('kid-up-a')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('kid-exit')).toBeTruthy());
    await press('kid-exit');
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/kids'));
  });

  it('reports a vote that did not save, and one that came too late', async () => {
    const late = Object.assign(new Error('closed'), { status: 409 });
    const client = kidsClient(kidsData(), { vote: async () => { throw late; } });
    await mount(<KidPlayBody api={API} householdId={HH} roundId="rd1" client={client} gate={memoryGate()} />);
    await press('pick-kid-k1');
    await press('kid-up-a');
    expect(await screen.findByText('The vote has just finished.')).toBeTruthy();
  });
});
