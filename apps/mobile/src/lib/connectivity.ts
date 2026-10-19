import NetInfo from '@react-native-community/netinfo';

export type Unsubscribe = () => void;

export interface Connectivity {
  /** Calls `cb` with the current state and on every change. */
  subscribe(cb: (online: boolean) => void): Unsubscribe;
}

/** "Online" = connected and the internet is not known to be unreachable (null/unknown counts as online). */
export const netInfoConnectivity: Connectivity = {
  subscribe(cb) {
    return NetInfo.addEventListener((s) => cb(s.isConnected !== false && s.isInternetReachable !== false));
  },
};
