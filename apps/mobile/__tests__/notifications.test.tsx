import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { linkToRoute, parseSettings } from '@/lib/notificationsApi';
import { enablePush, disablePush, pushState } from '@/lib/push';
import type { ServerApi } from '@/lib/serverApi';
import { NotificationsBody } from '@/screens/notifications/NotificationsScreen';
import { NotificationSettingsBody, type PushControls } from '@/screens/notifications/NotificationSettingsScreen';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }), useFocusEffect: jest.fn() }));

type Call = { method: 'GET' | 'POST'; path: string; payload: Record<string, unknown> };
const baseSettings = parseSettings({
  quietEnabled: true, quietStart: '21:30', quietEnd: '07:30', timeZone: 'Europe/London', morningHour: 8, expiryLeadDays: 1,
  types: { expiry: { inApp: true, push: true }, list_changed_while_shopping: { inApp: true, push: true } },
});

function fakeApi() {
  const calls: Call[] = [];
  let items = [
    { id: 'n1', type: 'expiry', title: 'Chicken: use by tomorrow', body: 'Cook it...', link: '/pantry?item=x', createdAt: new Date().toISOString(), read: false },
    { id: 'n2', type: 'test', title: 'Test notification', body: '', link: '/notifications', createdAt: new Date().toISOString(), read: true },
  ];
  let settings = baseSettings;
  const api: ServerApi = {
    configured: true,
    get: async (path, query) => {
      calls.push({ method: 'GET', path, payload: (query ?? {}) as Record<string, unknown> });
      if (path === '/api/notifications') return { centre: { items, unread: items.filter((i) => !i.read).length } } as never;
      if (path === '/api/notifications/activity') return { events: [{ id: 'e1', type: 'recipe_added', actor: 'Bob', text: 'added the recipe Soup', link: '/recipes/r-1', at: new Date().toISOString(), mine: false }] } as never;
      if (path === '/api/notifications/settings') return { settings, devices: { web: 1, android: 0 } } as never;
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path, body) => {
      const b = body as Record<string, unknown>;
      calls.push({ method: 'POST', path, payload: b });
      if (path === '/api/notifications') {
        items = items.map((i) => (b.action === 'read_all' || (b.ids as string[]).includes(i.id) ? { ...i, read: true } : i));
        return { unread: items.filter((i) => !i.read).length } as never;
      }
      if (path === '/api/notifications/settings') {
        settings = parseSettings(b.settings);
        return { settings, devices: { web: 1, android: 0 } } as never;
      }
      if (path === '/api/notifications/test') return { outcome: 'no_devices' } as never;
      if (path === '/api/notifications/devices') return { devices: { web: 1, android: b.action === 'register' ? 1 : 0 } } as never;
      throw new Error(`unexpected POST ${path}`);
    },
    postForm: async () => {
      throw new Error('unused');
    },
    webUrl: () => null,
    authHeaders: async () => ({}),
  };
  return { api, calls, posts: () => calls.filter((c) => c.method === 'POST') };
}

beforeEach(async () => {
  mockPush.mockClear();
  await AsyncStorage.clear();
});

describe('linkToRoute', () => {
  it('maps web paths to app screens and falls back to the notification list', () => {
    expect(linkToRoute('/pantry?item=abc')).toBe('/pantry');
    expect(linkToRoute('/shopping')).toBe('/(tabs)/shopping');
    expect(linkToRoute('/recipes/r-1')).toBe('/recipe/r-1');
    expect(linkToRoute('/plan')).toBe('/plan');
    expect(linkToRoute('/household')).toBe('/household');
    expect(linkToRoute('https://evil.example/')).toBe('/notifications');
    expect(linkToRoute(undefined)).toBe('/notifications');
  });
});

describe('push registration (expo-notifications)', () => {
  it('asks permission only when enabling, registers the Expo token for the household, and unregisters it', async () => {
    const f = fakeApi();
    expect(await pushState()).toBe('off');
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    const r = await enablePush(f.api, 'hh-1');
    expect(r).toEqual({ state: 'on', devices: { web: 1, android: 1 } });
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(f.posts()[0]).toMatchObject({ path: '/api/notifications/devices', payload: { householdId: 'hh-1', action: 'register', platform: 'android', channel: 'expo', token: 'ExponentPushToken[testtoken1234]' } });
    await disablePush(f.api, 'hh-1');
    expect(f.posts()[1]).toMatchObject({ payload: { action: 'unregister', token: 'ExponentPushToken[testtoken1234]' } });
  });
  it('a refused permission or a build without FCM is reported, not thrown', async () => {
    const f = fakeApi();
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'denied', canAskAgain: false });
    expect((await enablePush(f.api, 'hh-1')).state).toBe('denied');
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockRejectedValueOnce(new Error('no FCM'));
    expect((await enablePush(f.api, 'hh-1')).state).toBe('unavailable');
    expect(f.posts()).toHaveLength(0);
  });
});

describe('NotificationsBody', () => {
  it('lists notifications, opens one (marks it read) and marks all read; shows household activity', async () => {
    const f = fakeApi();
    await render(<NotificationsBody api={f.api} householdId="hh-1" />);
    expect(await screen.findByText('Chicken: use by tomorrow')).toBeOnTheScreen();
    expect(screen.getByText('For you (1 new)')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('notification-n1'));
    expect(mockPush).toHaveBeenCalledWith('/pantry');
    await waitFor(() => expect(f.posts()[0]).toMatchObject({ path: '/api/notifications', payload: { action: 'read', ids: ['n1'] } }));
    await fireEvent.press(screen.getByTestId('tab-household'));
    await fireEvent.press(screen.getByLabelText('Bob added the recipe Soup'));
    expect(mockPush).toHaveBeenLastCalledWith('/recipe/r-1');
  });
});

describe('NotificationSettingsBody', () => {
  const fakePush = (): PushControls & { enable: jest.Mock } => ({
    state: async () => 'off',
    enable: jest.fn(async () => ({ state: 'on' as const, devices: { web: 1, android: 1 } })),
    disable: jest.fn(async () => ({ web: 1, android: 0 })),
  });

  it('saves per-type toggles and quiet hours; push needs in-app', async () => {
    const f = fakeApi();
    await render(<NotificationSettingsBody api={f.api} householdId="hh-1" push={fakePush()} />);
    expect(await screen.findByText('Food to use soon')).toBeOnTheScreen();
    expect(screen.getByTestId('type-recipe_added-push')).toBeDisabled();
    await fireEvent(screen.getByTestId('type-recipe_added-inapp'), 'valueChange', true);
    await fireEvent(screen.getByTestId('type-recipe_added-push'), 'valueChange', true);
    await fireEvent(screen.getByTestId('type-expiry-push'), 'valueChange', false);
    await fireEvent.changeText(screen.getByTestId('quiet-start'), '22:00');
    await fireEvent.press(screen.getByTestId('lead-days-2'));
    await fireEvent.press(screen.getByTestId('save-notification-settings'));
    expect(await screen.findByText('Notification settings saved.')).toBeOnTheScreen();
    const saved = f.posts().find((p) => p.path === '/api/notifications/settings')!.payload.settings as ReturnType<typeof parseSettings>;
    expect(saved).toMatchObject({ quietStart: '22:00', expiryLeadDays: 2, types: { recipe_added: { inApp: true, push: true }, expiry: { inApp: true, push: false } } });
  });

  it('turns push on only from the button, and sends a test notification', async () => {
    const f = fakeApi();
    const push = fakePush();
    await render(<NotificationSettingsBody api={f.api} householdId="hh-1" push={push} />);
    await screen.findByTestId('push-enable');
    expect(push.enable).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('push-enable'));
    expect(await screen.findByText('Notifications are on for this phone.')).toBeOnTheScreen();
    expect(push.enable).toHaveBeenCalledWith(f.api, 'hh-1');
    expect(screen.getByTestId('push-disable')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('send-test'));
    expect(await screen.findByText(/Added to your notifications/)).toBeOnTheScreen();
  });
});
