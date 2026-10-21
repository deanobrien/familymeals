'use client';

// The parent PIN gate of kids' mode on THIS browser (P3-A, D424): the PIN record and lock-out state live in localStorage only.
import { DevicePinGate, type KeyValueStore } from '@fr/engine/kids';

const browserStore: KeyValueStore = {
  getItem: (k) => {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    window.localStorage.setItem(k, v);
  },
  removeItem: (k) => {
    try {
      window.localStorage.removeItem(k);
    } catch {
      /* nothing stored */
    }
  },
};

const randomSalt = (): string => {
  const b = new Uint8Array(16);
  window.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

export const webKidsGate = (householdId: string, userId: string): DevicePinGate =>
  new DevicePinGate(browserStore, { key: `fr.kids.${householdId}.${userId}`, randomSalt });
