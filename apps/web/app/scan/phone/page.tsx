import type { Metadata } from 'next';
import { PhoneScanner } from './phone-scanner';

// The address holds a session id in the query and a secret in the fragment: keep it out of Referer headers and search results.
export const metadata: Metadata = {
  title: 'Scan for a computer',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-static';

/**
 * Public page (the phone is not signed in): opened from the QR code a signed-in desktop user shows. The session id + token in the
 * address are the credential (P3-C, D447). Everything happens in the client component; nothing about any household is rendered here.
 */
export default function PhoneScannerPage() {
  return <PhoneScanner />;
}
