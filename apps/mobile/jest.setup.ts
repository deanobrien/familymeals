import '@testing-library/react-native/matchers';
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));
jest.mock('expo-audio', () => {
  const player = { seekTo: jest.fn(async () => undefined), play: jest.fn() };
  return { createAudioPlayer: jest.fn(() => player), setAudioModeAsync: jest.fn(async () => undefined), __player: player };
});
