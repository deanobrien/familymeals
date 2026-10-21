// Store locations (P2-A, D390-D392). Client-safe: types, validation and wording shared by the web UI, the JSON routes and
// the Android app's copy of the contract. A location is what a member SAVED for a shop (a point + an arrival radius).
// A live position is compared on the device and is never sent to the server.
import { z } from 'zod';
import { DEFAULT_RADIUS_M, MAX_RADIUS_M, MIN_RADIUS_M, isValidPoint, normalisePostcode } from '@fr/engine/shopping';

export interface StoreLocation {
  storeId: string;
  lat: number;
  lng: number;
  radiusM: number;
  /** 'device' = saved from the member's position in the shop; 'postcode' = looked up from a postcode. */
  source: 'device' | 'postcode';
  postcode: string | null;
}

export const LOCATION_SOURCES = ['device', 'postcode'] as const;

export { DEFAULT_RADIUS_M, MAX_RADIUS_M, MIN_RADIUS_M };

/** Where the postcode coordinates come from (shown next to the lookup and listed on the sources page). */
export const POSTCODES_IO_ATTRIBUTION =
  'Postcode lookup by postcodes.io. Contains OS data © Crown copyright and database right; Royal Mail data © Royal Mail copyright and database right; National Statistics data © Crown copyright and database right. Licensed under the Open Government Licence v3.0.';

export const LocationInput = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    radiusM: z.number().finite().optional(),
    source: z.enum(LOCATION_SOURCES),
    postcode: z.string().trim().max(12).nullish(),
  })
  .transform((v, ctx) => {
    const radiusM = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(v.radiusM ?? DEFAULT_RADIUS_M)));
    let postcode: string | null = null;
    if (v.source === 'postcode') {
      postcode = normalisePostcode(v.postcode ?? '');
      if (!postcode) {
        ctx.addIssue({ code: 'custom', message: 'That does not look like a UK postcode.', path: ['postcode'] });
        return z.NEVER;
      }
    }
    if (!isValidPoint(v)) {
      ctx.addIssue({ code: 'custom', message: 'That position is not valid.', path: ['lat'] });
      return z.NEVER;
    }
    return { lat: v.lat, lng: v.lng, radiusM, source: v.source, postcode };
  });
export type LocationInputValue = z.output<typeof LocationInput>;

export const RadiusOnly = z.number().finite();

/** Six decimal places is ~0.1 m: more precision than a phone has, and nothing to gain from storing more. */
export const roundCoord = (n: number): number => Math.round(n * 1e6) / 1e6;
