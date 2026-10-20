import React from 'react';

/** A controllable stand-in for expo-router. Use: jest.mock('expo-router', () => require('./helpers/router').routerModule()). */
export const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
export const params: { current: Record<string, string> } = { current: {} };

export function resetRouter(next: Record<string, string> = {}) {
  router.push.mockClear();
  router.replace.mockClear();
  router.back.mockClear();
  params.current = next;
}

export const routerModule = () => ({
  useRouter: () => router,
  useLocalSearchParams: () => params.current,
  // Runs like a focus effect that fires once on mount.
  useFocusEffect: (cb: () => void | (() => void)) => {
    React.useEffect(cb, [cb]);
  },
});
