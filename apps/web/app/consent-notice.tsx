import Link from 'next/link';
import { CONSENT_REVIEW_HREF, consentNoticeText } from '../lib/consent/notice';

/** Shown on the planner, discover and settings pages while allergy exclusions are withheld for lack of consent (D129). */
export function ConsentNotice({ withheld }: { withheld: number }) {
  const text = consentNoticeText(withheld);
  if (!text) return null;
  return (
    <p role="status" data-testid="consent-notice" style={{ border: '1px solid currentColor', borderRadius: 8, padding: '0.75rem' }}>
      {text} &mdash; <Link href={CONSENT_REVIEW_HREF}>review in Settings</Link>.
    </p>
  );
}
