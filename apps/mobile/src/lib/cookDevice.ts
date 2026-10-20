/**
 * Device services for cook mode (P1-A, D362): keep the screen awake, read a step aloud, a local notification that fires when a
 * timer ends even if the app is in the background, and haptics. Every call is best effort and never throws into the UI: a
 * phone without a voice, with notifications blocked, or without a vibrator still gets the in-app timer and alert.
 */
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';

const KEEP_AWAKE_TAG = 'cook-mode';
const CHANNEL = 'cook-timers';

export async function keepAwakeOn(): Promise<boolean> {
  try {
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return true;
  } catch {
    return false;
  }
}

export function keepAwakeOff(): void {
  try {
    void deactivateKeepAwake(KEEP_AWAKE_TAG);
  } catch {
    /* ignore */
  }
}

export function speak(text: string, onDone?: () => void): void {
  try {
    Speech.stop();
    Speech.speak(text, { language: 'en-GB', rate: 0.95, onDone, onStopped: onDone, onError: onDone });
  } catch {
    onDone?.();
  }
}

export function stopSpeaking(): void {
  try {
    Speech.stop();
  } catch {
    /* ignore */
  }
}

/**
 * Local timer notifications ride on the notification setup P1-C owns (D380-D389): its start-up handler (push.ts,
 * configureForegroundHandling) governs how they show in the foreground and its permission state is the same one the Settings
 * toggle shows, so this file sets no handler of its own. It only adds a high-importance "Cooking timers" Android channel,
 * because a kitchen timer must sound and pop up where the default channel would not.
 */
/** Asks for notification permission (once, when the first timer starts) and sets up the Android channel. */
export async function ensureNotifyPermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Cooking timers',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 300, 150, 300, 150, 300],
        sound: 'default',
      });
    }
    const cur = await Notifications.getPermissionsAsync();
    if (cur.status === 'granted') return true;
    if (cur.status === 'denied' && cur.canAskAgain === false) return false;
    return (await Notifications.requestPermissionsAsync()).status === 'granted';
  } catch {
    return false;
  }
}

/** Schedules the "timer done" notification. The identifier is stable, so scheduling again replaces the earlier one. */
export async function scheduleTimerNotification(key: string, label: string, recipeTitle: string, seconds: number): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: key,
      content: { title: `${label} timer done`, body: recipeTitle, sound: 'default' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.max(1, Math.round(seconds)), channelId: CHANNEL },
    });
  } catch {
    /* permission refused or no notification support: the in-app alert still fires */
  }
}

export async function cancelTimerNotification(key: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(key);
  } catch {
    /* ignore */
  }
}

/** A short buzz pattern when a timer ends in the foreground. */
export function alertHaptics(): void {
  try {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setTimeout(() => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined), 600);
    setTimeout(() => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined), 1200);
  } catch {
    /* ignore */
  }
}

export const timerNotificationKey = (recipeId: string, timerId: string): string => `cooktimer-${recipeId}-${timerId}`;
