import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Display-only preferences that live on this device, like the web settings page where units and locale are "display only"
 * (never stored on the household; your recipes keep their original quantities). Default servings and the weekly budget ARE
 * household values and are saved to the household by the owner.
 */
export type UnitSystem = 'metric' | 'imperial';
export type Locale = 'en-GB' | 'en-IE';

export interface DevicePrefs {
  units: UnitSystem;
  locale: Locale;
  /** Short confirmation beep on each new barcode read (default on). */
  scanSound: boolean;
}

export const DEFAULT_DEVICE_PREFS: DevicePrefs = { units: 'metric', locale: 'en-GB', scanSound: true };
const KEY = 'fr.devicePrefs.v1';

export async function loadDevicePrefs(): Promise<DevicePrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_DEVICE_PREFS;
    const v = JSON.parse(raw) as Partial<DevicePrefs>;
    return {
      units: v.units === 'imperial' ? 'imperial' : 'metric',
      locale: v.locale === 'en-IE' ? 'en-IE' : 'en-GB',
      scanSound: v.scanSound !== false,
    };
  } catch {
    return DEFAULT_DEVICE_PREFS;
  }
}

export async function saveDevicePrefs(prefs: DevicePrefs): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(prefs));
}
