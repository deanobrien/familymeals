/**
 * Android push via expo-notifications (P1-C, D382/D389). The permission prompt is shown ONLY when the person taps
 * "Turn on notifications on this phone" in Settings; nothing asks on start-up. The Expo push token is registered with the
 * server per household; FCM delivery needs the owner's Firebase/EAS setup (docs/DEPLOY-APP-SERVICE.md 3e). In Expo Go or
 * on an emulator without Google Play services the token call fails and the screen says so (the in-app list still works).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ServerApi } from './serverApi';
import { registerPushToken, unregisterPushToken, type DeviceCounts } from './notificationsApi';

const TOKEN_KEY = 'fr:push:token:v1';

export type PushState = 'on' | 'off' | 'denied' | 'unavailable';

export function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

/** Foreground behaviour: show the banner and list entry, no sound (the in-app bell updates too). Called once at start-up. */
export function configureForegroundHandling(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

export async function storedToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Current state without prompting. */
export async function pushState(): Promise<PushState> {
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.status === 'denied' && !p.canAskAgain) return 'denied';
    if (p.status !== 'granted') return 'off';
    return (await storedToken()) ? 'on' : 'off';
  } catch {
    return 'unavailable';
  }
}

/** From a button tap: ask permission, create the Android channel, get the Expo token, register it for this household. */
export async function enablePush(api: ServerApi, householdId: string): Promise<{ state: PushState; devices?: DeviceCounts; message?: string }> {
  let status: string;
  try {
    const current = await Notifications.getPermissionsAsync();
    status = current.status === 'granted' ? 'granted' : (await Notifications.requestPermissionsAsync()).status;
  } catch {
    return { state: 'unavailable', message: 'Notifications are not available on this device.' };
  }
  if (status !== 'granted') return { state: 'denied', message: 'Notifications are turned off for Family Recipes in Android settings.' };
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Family Recipes', importance: Notifications.AndroidImportance.DEFAULT }).catch(() => undefined);
  }
  let token: string;
  try {
    const pid = projectId();
    token = (await Notifications.getExpoPushTokenAsync(pid ? { projectId: pid } : undefined)).data;
  } catch {
    return {
      state: 'unavailable',
      message: 'This build cannot receive push notifications yet (it needs the Firebase setup and an EAS build). Notifications still appear in the app.',
    };
  }
  const devices = await registerPushToken(api, householdId, token, `${Constants.deviceName ?? 'Android phone'}`.slice(0, 80));
  await AsyncStorage.setItem(TOKEN_KEY, token).catch(() => undefined);
  return { state: 'on', devices };
}

export async function disablePush(api: ServerApi, householdId: string): Promise<DeviceCounts | undefined> {
  const token = await storedToken();
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
  if (!token) return undefined;
  return unregisterPushToken(api, householdId, token).catch(() => undefined);
}
