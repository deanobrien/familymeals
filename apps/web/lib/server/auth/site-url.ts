import 'server-only';
import { headers } from 'next/headers';

export { buildInviteUrl } from './site-url-pure';

/** Origin used in emailed links and invite URLs. Prefers NEXT_PUBLIC_SITE_URL, else the request host. */
export async function getSiteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3100';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}
