import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import * as Location from 'expo-location';
import { DEFAULT_RADIUS_M, MAX_FIX_ACCURACY_M, describeDistance } from '@fr/engine/shopping';
import { ServerScreen } from '@/data/ServerApiContext';
import { eraseGeoData, enableSwitching, loadGeoState, saveGeoState, setNearStoreWanted, syncGeofencing, type LocationMode } from '@/lib/geofence';
import { changeLocation, fencesOf, geocode, getLocations, type LocationsView, type StoreLocation } from '@/lib/locationApi';
import { getSettings, saveSettings } from '@/lib/notificationsApi';
import type { ServerApi } from '@/lib/serverApi';
import { Field } from '../widgets';
import { Button, ErrorState, Loading, Muted, Text, useStyles } from '../ui';

const RADII = [50, 100, 150, 200, 300, 500, 1000];

export const POSTCODES_ATTRIBUTION =
  'Postcode lookup by postcodes.io. Contains OS data © Crown copyright and database right; Royal Mail data © Royal Mail copyright and database right; National Statistics data © Crown copyright and database right. Licensed under the Open Government Licence v3.0.';

function Toggle({ label, value, onChange, disabled, testID }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; testID: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
      <Text style={{ flexShrink: 1, marginRight: 8 }}>{label}</Text>
      <Switch accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, checked: value }} value={value} onValueChange={onChange} disabled={!!disabled} testID={testID} />
    </View>
  );
}

/** What this feature does, in plain words (shown before anything is turned on). */
export const LOCATION_EXPLANATION = [
  'Each store can have a saved spot (the shop’s position and how close counts as "there"). When you turn on "Switch store when I arrive", this phone compares where it is with those saved spots and switches "Shopping at" on your list to the store you are in, so the aisle order is ready.',
  'Your position is only compared on this phone. It is never sent to Family Recipes, never stored on our servers and never logged. The server only keeps the store spots you save.',
  'Off by default. Turn it off any time; "Turn off and erase" also deletes everything this feature keeps on the phone.',
];

export function LocationSettingsBody({ api, householdId }: { api: ServerApi; householdId: string }) {
  const styles = useStyles();
  const [view, setView] = useState<LocationsView | null>(null);
  const [mode, setMode] = useState<LocationMode>('off');
  const [near, setNear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [postcodes, setPostcodes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const [v, g] = await Promise.all([getLocations(api, householdId), loadGeoState()]);
      setView(v);
      setMode(g.householdId === householdId || g.mode === 'off' ? g.mode : 'off');
      try {
        setNear((await getSettings(api, householdId)).settings.types.near_store.inApp);
      } catch {
        /* the notification preference is optional here */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Store locations could not be loaded.');
    }
  }, [api, householdId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error && !view) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!view) return <Loading label="Loading store locations" />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const applyView = async (v: LocationsView) => {
    setView(v);
    if (mode !== 'off') await syncGeofencing(fencesOf(v), mode);
  };

  const setMode_ = (next: LocationMode) =>
    run(async () => {
      if (next === 'off') {
        await saveGeoState({ mode: 'off', householdId });
        await syncGeofencing([], 'off');
        setMode('off');
        return;
      }
      if (fencesOf(view).length === 0) {
        setMessage('Save a location for at least one store first (below).');
        return;
      }
      const r = await enableSwitching(next, householdId, fencesOf(view));
      if (r.ok) {
        setMode(next);
        setMessage(next === 'background' ? 'On, including when the app is closed.' : 'On while the shopping list is open.');
      } else if (r.reason === 'background_denied') {
        // keep foreground working; say how to allow background
        const fg = await enableSwitching('foreground', householdId, fencesOf(view));
        if (fg.ok) setMode('foreground');
        setMessage('Background location was not allowed, so it works only while the shopping list is open. To allow it, choose "Allow all the time" for Family Recipes in Android settings.');
      } else if (r.reason === 'denied') {
        setMessage('Location is blocked for Family Recipes. Allow it in Android settings, then try again.');
      } else {
        setMessage('Location is not available on this phone.');
      }
    });

  const setNearPref = (on: boolean) =>
    run(async () => {
      const cur = await getSettings(api, householdId);
      const saved = await saveSettings(api, householdId, { ...cur.settings, types: { ...cur.settings.types, near_store: { inApp: on, push: on } } });
      const v = saved.settings.types.near_store.inApp;
      setNear(v);
      await setNearStoreWanted(v);
      setMessage(v ? 'You will get "You’re near a store" nudges (needs notifications allowed for the app).' : 'Nudges are off.');
    });

  const useHere = (storeId: string, radiusM: number) =>
    run(async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setMessage('Location is blocked for Family Recipes. Allow it in Android settings, or use a postcode.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (typeof pos.coords.accuracy === 'number' && pos.coords.accuracy > MAX_FIX_ACCURACY_M) {
        setMessage('Your position is too rough to save. Try again outdoors, or use a postcode.');
        return;
      }
      await applyView(await changeLocation(api, householdId, { storeId, action: 'set', lat: pos.coords.latitude, lng: pos.coords.longitude, radiusM, source: 'device' }));
      setMessage('Saved where this store is.');
    });

  const lookup = (storeId: string, radiusM: number) =>
    run(async () => {
      const g = await geocode(api, householdId, postcodes[storeId] ?? '');
      await applyView(await changeLocation(api, householdId, { storeId, action: 'set', lat: g.lat, lng: g.lng, radiusM, source: 'postcode', postcode: g.postcode }));
      setMessage(`Saved at ${g.postcode}${g.area ? ` (${g.area})` : ''}.`);
    });

  const setRadius = (loc: StoreLocation, radiusM: number) =>
    run(async () => {
      const base = { storeId: loc.storeId, action: 'set' as const, lat: loc.lat, lng: loc.lng, radiusM };
      await applyView(await changeLocation(api, householdId, loc.source === 'postcode' && loc.postcode ? { ...base, source: 'postcode', postcode: loc.postcode } : { ...base, source: 'device' }));
    });

  const clear = (storeId: string) =>
    run(async () => {
      await applyView(await changeLocation(api, householdId, { storeId, action: 'clear' }));
      setMessage('Location removed.');
    });

  const eraseAll = () =>
    run(async () => {
      await eraseGeoData();
      setMode('off');
      setNear(false);
      setMessage('Turned off. Everything location-related on this phone was deleted. Saved store spots stay (remove them below).');
    });

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">Location</Text>
      {LOCATION_EXPLANATION.map((t) => <Muted key={t}>{t}</Muted>)}
      {message ? <Text accessibilityRole="alert" testID="location-message">{message}</Text> : null}

      <Text style={{ fontWeight: '700', marginTop: 16 }}>Switch store when I arrive</Text>
      <Toggle label="Switch store while the shopping list is open" value={mode !== 'off'} onChange={(v) => void setMode_(v ? 'foreground' : 'off')} disabled={busy} testID="geo-foreground" />
      <Toggle label="Also when the app is closed" value={mode === 'background'} onChange={(v) => void setMode_(v ? 'background' : 'foreground')} disabled={busy || mode === 'off'} testID="geo-background" />
      <Muted>
        "When the app is closed" asks Android for location "all the time" and uses a few geofences (one per store you saved). It can use a little more battery.
      </Muted>
      <Toggle label={'Tell me "You’re near a store" with the number of items on my list'} value={near} onChange={(v) => void setNearPref(v)} disabled={busy || mode !== 'background'} testID="geo-nudge" />
      <Muted>At most once every four hours per store. Off by default. Works only with "when the app is closed" on and notifications allowed.</Muted>

      <Text style={{ fontWeight: '700', marginTop: 16 }}>Store locations</Text>
      {view.stores.length === 0 && <Muted testID="no-stores">No stores yet. Add your stores and aisles on the website (Settings, Stores), then save their locations here.</Muted>}
      {view.stores.map((s) => {
        const loc = view.locations.find((l) => l.storeId === s.id);
        const radius = loc?.radiusM ?? DEFAULT_RADIUS_M;
        return (
          <View key={s.id} style={{ marginTop: 12, gap: 6 }} testID={`loc-store-${s.id}`}>
            <Text style={{ fontWeight: '600' }}>{s.name}</Text>
            <Muted testID={`loc-status-${s.id}`}>
              {loc ? `Saved${loc.source === 'postcode' && loc.postcode ? ` from ${loc.postcode}` : ' from your position in the shop'}. Counts as there within ${describeDistance(loc.radiusM)}.` : 'No location yet.'}
            </Muted>
            <Button title="Use my current location (I'm in the shop)" variant="secondary" onPress={() => void useHere(s.id, radius)} disabled={busy} testID={`loc-here-${s.id}`} />
            <Field label="Or a UK postcode" value={postcodes[s.id] ?? ''} onChangeText={(v) => setPostcodes({ ...postcodes, [s.id]: v })} testID={`loc-postcode-${s.id}`} />
            <Button title="Look up postcode" variant="secondary" onPress={() => void lookup(s.id, radius)} disabled={busy || !(postcodes[s.id] ?? '').trim()} testID={`loc-lookup-${s.id}`} />
            {loc && (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityLabel={`Radius for ${s.name}`}>
                  {RADII.map((r) => (
                    <Button key={r} title={`${r} m`} variant={r === loc.radiusM ? 'primary' : 'secondary'} onPress={() => void setRadius(loc, r)} disabled={busy} testID={`loc-radius-${s.id}-${r}`} />
                  ))}
                </View>
                <Button title="Remove location" variant="secondary" onPress={() => void clear(s.id)} disabled={busy} testID={`loc-clear-${s.id}`} />
              </>
            )}
          </View>
        );
      })}
      <Muted>{POSTCODES_ATTRIBUTION} Only the postcode is sent for a lookup.</Muted>

      <Text style={{ fontWeight: '700', marginTop: 16 }}>Turn off and erase</Text>
      <Muted>Stops switching, removes the geofences and deletes what this feature keeps on this phone.</Muted>
      <Button title="Turn off and erase on this phone" variant="secondary" onPress={() => void eraseAll()} disabled={busy} testID="geo-erase" />
    </ScrollView>
  );
}

export default function LocationSettingsScreen() {
  return <ServerScreen>{(api, householdId) => <LocationSettingsBody api={api} householdId={householdId} />}</ServerScreen>;
}
