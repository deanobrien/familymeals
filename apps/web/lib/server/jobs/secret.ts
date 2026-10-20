import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Shared-secret check for machine-to-machine job endpoints (DX1, D256). The scheduler (Azure Logic App / GitHub
 * Actions) sends `x-jobs-secret: <JOBS_SECRET>`; `Authorization: Bearer <JOBS_SECRET>` is accepted too.
 *  - JOBS_SECRET unset or shorter than 32 characters: the endpoint is OFF ('unconfigured', 503), never open.
 *  - Comparison is constant-time over SHA-256 digests (no length or prefix leak).
 */
export const JOBS_SECRET_HEADER = 'x-jobs-secret';
export const MIN_JOBS_SECRET_LENGTH = 32;

export type JobsAuth = 'ok' | 'unconfigured' | 'unauthorized';

function presented(headers: Headers): string | null {
  const h = headers.get(JOBS_SECRET_HEADER)?.trim();
  if (h) return h;
  const m = /^Bearer\s+(\S+)$/i.exec(headers.get('authorization')?.trim() ?? '');
  return m ? m[1]! : null;
}

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

export function checkJobsSecret(headers: Headers, secret: string | undefined = process.env.JOBS_SECRET): JobsAuth {
  const expected = secret?.trim();
  if (!expected || expected.length < MIN_JOBS_SECRET_LENGTH) return 'unconfigured';
  const got = presented(headers);
  if (!got) return 'unauthorized';
  return timingSafeEqual(digest(got), digest(expected)) ? 'ok' : 'unauthorized';
}
