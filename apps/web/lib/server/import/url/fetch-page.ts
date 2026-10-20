// Guarded single-page fetch for "recipe from a web link" (P1-B, D371). One GET per hop, no cookies, bounded size and time,
// redirects followed by hand (each hop re-validated and re-resolved), and the connection pinned to the address that passed
// the SSRF check. The transport is injectable so the guard is unit-testable without a network.
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { IncomingHttpHeaders } from 'node:http';
import type { Readable } from 'node:stream';
import { UrlRejectedError, parseImportUrl, resolvePublic, systemLookup, type LookupFn, type ResolvedAddress } from './ssrf';

export type FetchErrorCode =
  | 'TIMEOUT' | 'TOO_LARGE' | 'NOT_HTML' | 'NOT_IMAGE' | 'HTTP_STATUS' | 'TOO_MANY_REDIRECTS' | 'NETWORK' | 'BAD_REDIRECT' | 'UNSUPPORTED_ENCODING';

export class FetchError extends Error {
  constructor(readonly code: FetchErrorCode, message: string, readonly status?: number) {
    super(message);
    this.name = 'FetchError';
  }
}

export interface TransportRequest {
  url: URL;
  address: ResolvedAddress;
  headers: Record<string, string>;
  timeoutMs: number;
}
export interface TransportResponse { status: number; headers: IncomingHttpHeaders; body: Readable }
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

export const USER_AGENT = 'FamilyRecipes/1.0 (personal household recipe import; one page on request, no crawling)';

/** Connects to the already-validated address (never re-resolves the name), TLS verified against the host name. */
export const nodeTransport: Transport = ({ url, address, headers, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const secure = url.protocol === 'https:';
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const lib = secure ? https : http;
    const req = lib.request(
      {
        hostname: host,
        port: url.port || (secure ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers,
        agent: false,
        timeout: timeoutMs,
        ...(secure && !isIP(host) ? { servername: host } : {}),
        lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
          if (opts?.all) cb(null, [{ address: address.address, family: address.family }]);
          else cb(null, address.address, address.family);
        }) as never,
      },
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res }),
    );
    req.on('timeout', () => req.destroy(new FetchError('TIMEOUT', 'timed out')));
    req.on('error', (e) => reject(e instanceof FetchError ? e : new FetchError('NETWORK', e.message)));
    req.end();
  });

export interface FetchOptions {
  lookup?: LookupFn;
  transport?: Transport;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** What the response must be. */
  expect?: 'html' | 'image';
  now?: () => number;
}

export interface FetchedBody {
  finalUrl: string;
  status: number;
  contentType: string;
  bytes: Uint8Array;
  redirects: number;
}

const HTML_TYPE = /^(?:text\/html|application\/xhtml\+xml)\b/i;
const IMAGE_TYPE = /^image\/(?:jpeg|jpg|png|webp|gif)\b/i;

function decoderFor(encoding: string | undefined): (() => Readable & NodeJS.WritableStream) | undefined {
  switch ((encoding ?? '').trim().toLowerCase()) {
    case '': case 'identity': return undefined;
    case 'gzip': case 'x-gzip': return createGunzip;
    case 'deflate': return createInflate;
    case 'br': return createBrotliDecompress;
    default: throw new FetchError('UNSUPPORTED_ENCODING', 'unsupported content encoding');
  }
}

async function readBounded(body: Readable, encoding: string | undefined, maxBytes: number, deadline: number, now: () => number): Promise<Uint8Array> {
  const make = decoderFor(encoding);
  const stream: Readable = make ? body.pipe(make() as never) : body;
  if (make) body.on('error', (e) => stream.destroy(e as Error));
  const timer = setTimeout(() => { stream.destroy(new FetchError('TIMEOUT', 'timed out')); body.destroy(); }, Math.max(1, deadline - now()));
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      total += b.length;
      if (total > maxBytes) throw new FetchError('TOO_LARGE', 'response too large');
      chunks.push(b);
    }
  } catch (e) {
    stream.destroy();
    body.destroy();
    if (e instanceof FetchError) throw e;
    throw new FetchError('NETWORK', e instanceof Error ? e.message : 'read failed');
  } finally {
    clearTimeout(timer);
  }
  return Buffer.concat(chunks);
}

/**
 * GET `rawUrl` (a user-supplied address) with every guard on. Throws UrlRejectedError for an address that is not a public
 * web page (including after DNS resolution and on any redirect hop) and FetchError for transport / size / type problems.
 */
export async function guardedGet(rawUrl: string, opts: FetchOptions = {}): Promise<FetchedBody> {
  const lookup = opts.lookup ?? systemLookup;
  const transport = opts.transport ?? nodeTransport;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxRedirects = opts.maxRedirects ?? 4;
  const expect = opts.expect ?? 'html';
  const now = opts.now ?? Date.now;
  const deadline = now() + timeoutMs;

  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = parseImportUrl(current);
    const addresses = await resolvePublic(parsed.host, lookup);
    const headers: Record<string, string> = {
      'user-agent': USER_AGENT,
      accept: expect === 'html' ? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' : 'image/jpeg,image/png,image/webp,image/gif;q=0.9',
      'accept-language': 'en-GB,en;q=0.8',
      'accept-encoding': 'gzip, deflate, br',
      connection: 'close',
      // Deliberately NO cookie, authorization or referer header: the fetch is anonymous.
    };
    let res: TransportResponse | undefined;
    let lastErr: unknown;
    for (const address of addresses.slice(0, 3)) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new FetchError('TIMEOUT', 'timed out');
      try {
        res = await transport({ url: parsed.url, address, headers, timeoutMs: remaining });
        break;
      } catch (e) {
        lastErr = e;
        if (e instanceof FetchError && e.code === 'TIMEOUT') throw e;
      }
    }
    if (!res) throw lastErr instanceof FetchError ? lastErr : new FetchError('NETWORK', 'could not connect');

    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      res.body.destroy();
      if (hop === maxRedirects) throw new FetchError('TOO_MANY_REDIRECTS', 'too many redirects');
      const loc = Array.isArray(res.headers.location) ? res.headers.location[0]! : res.headers.location;
      try { current = new URL(loc, parsed.url).toString(); } catch { throw new FetchError('BAD_REDIRECT', 'bad redirect'); }
      continue; // re-validated (scheme, port, host name, resolved addresses) at the top of the loop
    }
    if (res.status < 200 || res.status >= 300) {
      res.body.destroy();
      throw new FetchError('HTTP_STATUS', `status ${res.status}`, res.status);
    }
    const contentType = String(res.headers['content-type'] ?? '');
    const typeOk = expect === 'html' ? HTML_TYPE.test(contentType) || contentType === '' : IMAGE_TYPE.test(contentType);
    if (!typeOk) {
      res.body.destroy();
      throw new FetchError(expect === 'html' ? 'NOT_HTML' : 'NOT_IMAGE', `unexpected content type ${contentType.slice(0, 60)}`);
    }
    const encoding = Array.isArray(res.headers['content-encoding']) ? res.headers['content-encoding'][0] : res.headers['content-encoding'];
    const declared = Number(res.headers['content-length']);
    if (!encoding && Number.isFinite(declared) && declared > maxBytes) {
      res.body.destroy();
      throw new FetchError('TOO_LARGE', 'response too large');
    }
    const bytes = await readBounded(res.body, encoding, maxBytes, deadline, now);
    return { finalUrl: parsed.url.toString(), status: res.status, contentType, bytes, redirects: hop };
  }
  throw new FetchError('TOO_MANY_REDIRECTS', 'too many redirects');
}

/** Decode page bytes: header charset, then <meta charset>, then UTF-8 (a bad label never throws). */
export function decodeHtml(bytes: Uint8Array, contentType: string): string {
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1];
  const head = Buffer.from(bytes.subarray(0, 4096)).toString('latin1');
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1];
  for (const label of [fromHeader, fromMeta, 'utf-8']) {
    if (!label) continue;
    try { return new TextDecoder(label).decode(bytes); } catch { /* unknown label: next */ }
  }
  return Buffer.from(bytes).toString('utf8');
}

export { UrlRejectedError };
