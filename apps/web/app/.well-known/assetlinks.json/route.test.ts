import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANDROID_PACKAGE, assetLinksStatement, parseFingerprints } from '../../../lib/server/auth/app-links';
import { isPublicPath } from '../../../lib/server/auth/routes';
import { GET } from './route';

const FP = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase()).join(':');

afterEach(() => vi.unstubAllEnvs());

describe('Android App Links (assetlinks.json)', () => {
  it('keeps only well-formed SHA-256 fingerprints, upper-cased', () => {
    expect(parseFingerprints(` ${FP.toLowerCase()} , nope, ${FP.slice(0, 20)}`)).toEqual([FP]);
    expect(parseFingerprints(undefined)).toEqual([]);
  });
  it('builds the statement for the app package', () => {
    expect(assetLinksStatement([])).toBeNull();
    expect(assetLinksStatement([FP])).toEqual([
      { relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: [FP] } },
    ]);
  });
  it('is public, 404 while unconfigured, JSON once the fingerprint is set', async () => {
    expect(isPublicPath('/.well-known/assetlinks.json')).toBe(true);
    vi.stubEnv('ANDROID_APP_CERT_SHA256', '');
    expect(GET().status).toBe(404);
    vi.stubEnv('ANDROID_APP_CERT_SHA256', FP);
    const res = GET();
    expect(res.status).toBe(200);
    expect((await res.json())[0].target.sha256_cert_fingerprints).toEqual([FP]);
  });
});
