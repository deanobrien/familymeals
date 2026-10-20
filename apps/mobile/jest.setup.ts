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
// expo-notifications (P1-C): native module; tests drive it through this fake (permission, token, listeners).
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined', canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
  setNotificationChannelAsync: jest.fn(async () => null),
  getExpoPushTokenAsync: jest.fn(async () => ({ type: 'expo', data: 'ExponentPushToken[testtoken1234]' })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { DEFAULT: 3 },
}));
