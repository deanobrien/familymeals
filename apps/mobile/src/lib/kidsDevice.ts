// The parent PIN gate of kids' mode on THIS phone (P3-A, D424). The PIN record and the lock-out state live in the Android keystore
// (expo-secure-store) only; the server never sees them. The gate logic is the shared, unit-tested `DevicePinGate` from @fr/engine.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { DevicePinGate, type KeyValueStore } from '@fr/engine/kids';

/** SecureStore keys may only contain [A-Za-z0-9._-]; our keys (`fr.kids.<uuid>.<uuid>.pin`) already do. Falls back to AsyncStorage where SecureStore is unavailable. */
export const deviceStore: KeyValueStore = {
  async getItem(key) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return AsyncStorage.getItem(key);
    }
  },
  async setItem(key, value) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      await AsyncStorage.setItem(key, value);
    }
  },
  async removeItem(key) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      await AsyncStorage.removeItem(key);
    }
  },
};

/** A salt is only there to make equal PINs hash differently; it is not a secret, so the JS random source is enough. */
export function randomSalt(): string {
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export const createKidsGate = (householdId: string, userId: string, store: KeyValueStore = deviceStore): DevicePinGate =>
  new DevicePinGate(store, { key: `fr.kids.${householdId}.${userId}`, randomSalt });
