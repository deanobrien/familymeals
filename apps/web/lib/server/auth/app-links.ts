/**
 * Android App Links (Digital Asset Links) for `/invite/<token>`: lets https invitation links open the Android app directly.
 * Served at `/.well-known/assetlinks.json` from `ANDROID_APP_CERT_SHA256` (comma-separated SHA-256 signing-certificate
 * fingerprints of the app: the EAS upload/Play app-signing keys, `AA:BB:..` 32 bytes each). Unset = 404 and links simply open in the
 * browser (the web accept page works, with an "Open in the Android app" fallback link). Pure, so it is unit-tested (P0-A, D323).
 */
export const ANDROID_PACKAGE = 'uk.ac.northumbria.familyrecipes';

const FINGERPRINT_RE = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function parseFingerprints(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => FINGERPRINT_RE.test(s));
}

export function assetLinksStatement(fingerprints: string[]): unknown[] | null {
  if (fingerprints.length === 0) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
    },
  ];
}
