import 'server-only';
import type { NextResponse } from 'next/server';
import { apiError, json } from '../api/bearer-route';
import type { ShareError, ShareResult } from '../../sharing/types';

const STATUS: Record<ShareError, number> = { invalid_input: 422, forbidden: 403, read_only: 403, not_found: 404, rate_limited: 429, own_share: 409, unknown: 500 };

/** A service result as the standard envelope: `{ ...fields }` or `{ error: { code, message, retryable } }`. */
export function respondShare<T extends object>(r: ShareResult<T>): NextResponse {
  if (r.ok) {
    const rest: Record<string, unknown> = { ...r };
    delete rest.ok;
    return json(rest);
  }
  if (r.error === 'invalid_input' && r.fieldErrors) return json({ error: { code: 'INVALID_INPUT', message: r.message, retryable: false, fieldErrors: r.fieldErrors } }, 422);
  return apiError(STATUS[r.error], r.error.toUpperCase(), r.message, r.error === 'unknown' || r.error === 'rate_limited');
}
