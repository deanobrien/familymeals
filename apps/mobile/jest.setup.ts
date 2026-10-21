import '@testing-library/react-native/matchers';
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));
// expo-share-intent is a native module (Android "Share to Family Recipes"): tests drive a controllable stand-in.
jest.mock('expo-share-intent', () => {
  const state = {
    isReady: true,
    error: null as string | null,
    hasShareIntent: false,
    shareIntent: { text: null as string | null, webUrl: null as string | null, files: null, type: null as string | null },
    resetShareIntent: jest.fn(),
  };
  return {
    __state: state,
    ShareIntentProvider: ({ children }: { children: unknown }) => children,
    useShareIntentContext: () => state,
  };
});
jest.mock('expo-audio', () => {
  const player = { seekTo: jest.fn(async () => undefined), play: jest.fn() };
  return { createAudioPlayer: jest.fn(() => player), setAudioModeAsync: jest.fn(async () => undefined), __player: player };
});
// Cook mode (P1-A): device services are mocked here; the real calls are device checks (docs/ROADMAP.md, P1-A).
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => undefined),
  deactivateKeepAwake: jest.fn(async () => undefined),
  useKeepAwake: jest.fn(),
}));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => undefined),
  impactAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
// expo-notifications (P1-C push + P1-A local cook timers): native module; tests drive it through this fake.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined', canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
  setNotificationChannelAsync: jest.fn(async () => null),
  getExpoPushTokenAsync: jest.fn(async () => ({ type: 'expo', data: 'ExponentPushToken[testtoken1234]' })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

// expo-calendar (P2-C): native module; tests drive it through this fake. Events carry no title on purpose.
jest.mock('expo-calendar', () => {
  const state = { permission: 'undetermined' as 'granted' | 'denied' | 'undetermined', events: [] as unknown[], calendars: [{ id: 'cal-1' }] };
  return {
    __state: state,
    getCalendarPermissionsAsync: jest.fn(async () => ({ status: state.permission, granted: state.permission === 'granted', canAskAgain: state.permission !== 'denied' })),
    requestCalendarPermissionsAsync: jest.fn(async () => {
      state.permission = state.permission === 'denied' ? 'denied' : 'granted';
      return { status: state.permission, granted: state.permission === 'granted', canAskAgain: false };
    }),
    getCalendarsAsync: jest.fn(async () => state.calendars),
    getEventsAsync: jest.fn(async () => state.events),
    EntityTypes: { EVENT: 'event', REMINDER: 'reminder' },
    Availability: { BUSY: 'busy', FREE: 'free', TENTATIVE: 'tentative', UNAVAILABLE: 'unavailable', NOT_SUPPORTED: 'notSupported' },
    EventStatus: { NONE: 'none', CONFIRMED: 'confirmed', TENTATIVE: 'tentative', CANCELED: 'canceled' },
  };
});
