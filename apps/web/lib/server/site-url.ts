/**
 * Public origin of this site, for every absolute URL we build (emailed links, redirects).
 *
 * Behind Azure App Service (Linux container + reverse proxy) `request.url`, `nextUrl.origin` and the Host header
 * carry the CONTAINER's internal host (e.g. https://65339094faad:8080), because App Service sets HOSTNAME to the
 * container id. Never build redirects from those. Order of preference:
 *   1. NEXT_PUBLIC_SITE_URL (validated absolute URL; https required in production).
 *   2. x-forwarded-proto + x-forwarded-host (first value), ONLY if the host is on the allowlist
 *      (the NEXT_PUBLIC_SITE_URL host, localhost/127.0.0.1/[::1] for dev).
 *   3. The request origin (development/test only, and only for localhost-ish hosts).
 * Arbitrary Host / X-Forwarded-Host values are never trusted (open redirect / host-header poisoning).
 * Pure module (no next/headers) so it also runs in middleware.
 */

import { effectiveNodeEnv } from '../e2e-mode';

type HeaderSource = { get(name: string): string | null };
export interface PublicOriginInput {
  headers?: HeaderSource | null;
  url?: string | null;
}
export interface PublicOriginEnv {
  NEXT_PUBLIC_SITE_URL?: string;
  NODE_ENV?: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEV_FALLBACK = 'http://localhost:3100';

function hostnameOf(host: string): string {
  return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!;
}

/** Parses NEXT_PUBLIC_SITE_URL to an origin, or null when absent/invalid (http only allowed outside production). */
export function configuredOrigin(env: PublicOriginEnv = process.env as PublicOriginEnv): string | null {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const prod = effectiveNodeEnv(env) === 'production';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !prod)) return null;
    if (!u.hostname) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function first(v: string | null | undefined): string {
  return (v ?? '').split(',')[0]!.trim().toLowerCase();
}

export function publicOrigin(req?: PublicOriginInput | null, env: PublicOriginEnv = process.env as PublicOriginEnv): string {
  const configured = configuredOrigin(env);
  if (configured) return configured;
  const prod = effectiveNodeEnv(env) === 'production';

  const fHost = first(req?.headers?.get('x-forwarded-host'));
  const fProto = first(req?.headers?.get('x-forwarded-proto'));
  if (fHost && (fProto === 'http' || fProto === 'https') && /^[a-z0-9.\-:[\]]+$/.test(fHost)) {
    const isLocal = LOCAL_HOSTS.has(hostnameOf(fHost));
    // Allowlist = localhost (dev only). The configured-host case never reaches here (configured wins above).
    if (isLocal && !prod) return `${fProto}://${fHost}`;
  }

  if (!prod && req?.url) {
    try {
      const u = new URL(req.url);
      if (LOCAL_HOSTS.has(u.hostname)) return u.origin;
    } catch {
      /* fall through */
    }
  }
  return DEV_FALLBACK;
}

/** Absolute URL for an app-relative path on the public origin. */
export function publicUrl(path: string, req?: PublicOriginInput | null, env?: PublicOriginEnv): URL {
  return new URL(path, publicOrigin(req, env));
}
