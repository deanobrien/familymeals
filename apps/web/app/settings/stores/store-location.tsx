'use client';

// Settings > Stores > a store's location (P2-A, D390-D392). Two ways to set it, neither needs a map: "use my current
// location while I am in the shop" (browser Geolocation, one reading, on a button press) or a UK postcode lookup
// (postcodes.io through our server; only the postcode is sent). The member can change the arrival radius and remove it.
import { useState } from 'react';
import { Badge, Button, Input, Select, useToast } from '@fr/ui';
import type { Store } from '../../../lib/shopping/engine';
import { DEFAULT_RADIUS_M, POSTCODES_IO_ATTRIBUTION, type StoreLocation } from '../../../lib/stores/locations';
import {
  GeolocationFailure, changeLocation, geocodePostcode, readPosition, type LocationsPayload,
} from '../../../lib/stores/location-client';
import s from '../../../lib/dashboard/dashboard.module.css';
import m from './stores.module.css';

const RADII = [50, 100, 150, 200, 300, 500, 1000];

export function StoreLocationPanel({ store, location, disabled, onChange }: {
  store: Store; location: StoreLocation | undefined; disabled: boolean; onChange: (p: LocationsPayload) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [postcode, setPostcode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const radius = location?.radiusM ?? DEFAULT_RADIUS_M;

  async function run(fn: () => Promise<LocationsPayload>, done: string) {
    setBusy(true);
    setError(null);
    try {
      onChange(await fn());
      toast({ message: done });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  const useHere = () => run(async () => {
    try {
      const fix = await readPosition();
      return await changeLocation({ storeId: store.id, action: 'set', lat: fix.lat, lng: fix.lng, radiusM: radius, source: 'device' });
    } catch (e) {
      if (e instanceof GeolocationFailure) throw e;
      throw e;
    }
  }, `Saved where ${store.name} is.`);

  const lookup = () => run(async () => {
    const g = await geocodePostcode(postcode);
    return changeLocation({ storeId: store.id, action: 'set', lat: g.lat, lng: g.lng, radiusM: radius, source: 'postcode', postcode: g.postcode });
  }, `Saved ${store.name} at ${postcode.trim().toUpperCase()}.`);

  const setRadius = (r: number) => {
    if (!location) return;
    const base = { storeId: store.id, action: 'set' as const, lat: location.lat, lng: location.lng, radiusM: r };
    void run(() => changeLocation(location.source === 'postcode' && location.postcode ? { ...base, source: 'postcode', postcode: location.postcode } : { ...base, source: 'device' }), `Radius set to ${r} m.`);
  };

  return (
    <div data-testid={`location-${store.name}`}>
      <h3>Location (for finding this store)</h3>
      <p className={s.muted}>
        {location
          ? <>Saved{location.source === 'postcode' && location.postcode ? ` from postcode ${location.postcode}` : ' from your position in the shop'}. <Badge>{radius} m</Badge></>
          : 'No location yet. Optional: it lets the shopping list pick this store for you when you are there.'}
      </p>
      {error && <p role="alert" className={m.error} data-testid="location-error">{error}</p>}
      <div className={m.row}>
        <Button variant="secondary" disabled={disabled || busy} loading={busy} onClick={() => void useHere()}>Use my current location</Button>
        <Input label="Or a postcode" value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="NE1 7RU" maxLength={10} />
        <Button variant="secondary" disabled={disabled || busy || !postcode.trim()} onClick={() => void lookup()}>Look up postcode</Button>
      </div>
      <p className={s.muted}>
        &quot;Current location&quot; reads your position once, when you press the button, and saves it for this store only. Do it while you are in the shop.
        A postcode lookup sends just the postcode to postcodes.io. {POSTCODES_IO_ATTRIBUTION}
      </p>
      {location && (
        <div className={m.row}>
          <Select
            label="Counts as at the store within" value={String(radius)} disabled={disabled || busy}
            onChange={(e) => setRadius(Number(e.target.value))}
            options={RADII.map((r) => ({ value: String(r), label: `${r} m` }))}
          />
          <Button variant="ghost" disabled={disabled || busy} onClick={() => void run(() => changeLocation({ storeId: store.id, action: 'clear' }), 'Location removed.')}>Remove location</Button>
        </div>
      )}
    </div>
  );
}
