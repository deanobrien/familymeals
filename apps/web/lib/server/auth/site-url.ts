import 'server-only';
import { headers } from 'next/headers';
import { publicOrigin } from '../site-url';

export { buildInviteUrl } from './site-url-pure';

/**
 * Origin used in emailed links and invite URLs: the PUBLIC origin (see ../site-url.ts), never the container's
 * internal host. Prefers NEXT_PUBLIC_SITE_URL; forwarded/Host headers are only honoured for localhost dev.
 */
export async function getSiteUrl(): Promise<string> {
  return publicOrigin({ headers: await headers() });
}
