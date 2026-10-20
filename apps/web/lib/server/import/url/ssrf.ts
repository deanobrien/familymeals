// SSRF guard for "recipe from a web link" (P1-B, D371). Pure functions plus an injectable DNS lookup.
// Rules: http/https only, no credentials, ports 80/443/8080/8443 only, no internal-looking host names, and EVERY resolved
// address (checked again for each redirect hop) must be a public unicast address. The fetcher then connects to the address
// that was checked (pinning), so a DNS answer that changes between the check and the connect (rebinding) cannot reach an
// internal host.
import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

export class UrlRejectedError extends Error {
  constructor(readonly code: 'BAD_URL' | 'BLOCKED_HOST' | 'BLOCKED_ADDRESS' | 'DNS_FAILED', message: string) {
    super(message);
    this.name = 'UrlRejectedError';
  }
}

export const ALLOWED_PORTS: readonly number[] = [80, 443, 8080, 8443];
const MAX_URL_LENGTH = 2000;

/** Host names that are never public, whatever they resolve to. */
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet', '.private', '.home.arpa', '.localdomain'];
const BLOCKED_NAMES = new Set(['localhost', 'metadata', 'metadata.google.internal', 'instance-data']);

function ipv4Bytes(ip: string): number[] | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  const b = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return b.every((x) => x >= 0 && x <= 255) ? b : undefined;
}

/** Expand an IPv6 literal (with optional zone and embedded dotted v4) to 16 bytes. */
function ipv6Bytes(input: string): number[] | undefined {
  let ip = input.replace(/^\[|\]$/g, '');
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  if (ip.includes(':::')) return undefined;
  let tail: number[] = [];
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (v4) {
    const b = ipv4Bytes(v4[1]!);
    if (!b) return undefined;
    tail = b;
    ip = ip.slice(0, ip.length - v4[1]!.length) + '0:0';
  }
  const halves = ip.split('::');
  if (halves.length > 2) return undefined;
  const toGroups = (s: string): number[] | undefined => {
    if (s === '') return [];
    const out: number[] = [];
    for (const g of s.split(':')) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return undefined;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(halves[0]!);
  const rest = halves.length === 2 ? toGroups(halves[1]!) : [];
  if (!head || !rest) return undefined;
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return undefined;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return undefined;
  const bytes = groups.flatMap((g) => [g >> 8, g & 255]);
  if (tail.length) { bytes[12] = tail[0]!; bytes[13] = tail[1]!; bytes[14] = tail[2]!; bytes[15] = tail[3]!; }
  return bytes;
}

function blockedV4(b: number[]): boolean {
  const [a, c, d] = [b[0]!, b[1]!, b[2]!];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||               // this-net, private, loopback, multicast + reserved + broadcast
    (a === 100 && c >= 64 && c <= 127) ||                          // CGNAT
    (a === 169 && c === 254) ||                                    // link-local incl. cloud metadata 169.254.169.254
    (a === 172 && c >= 16 && c <= 31) ||                           // private
    (a === 192 && c === 0 && (d === 0 || d === 2)) ||              // IETF protocol assignments, TEST-NET-1
    (a === 192 && c === 88 && d === 99) ||                         // 6to4 relay anycast
    (a === 192 && c === 168) ||                                    // private
    (a === 198 && (c === 18 || c === 19)) ||                       // benchmarking
    (a === 198 && c === 51 && d === 100) ||                        // TEST-NET-2
    (a === 203 && c === 0 && d === 113)                            // TEST-NET-3
  );
}

/** True when `ip` (v4 or v6 text) is NOT a public unicast address, or is not an IP at all. */
export function isBlockedIp(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '');
  const kind = isIP(bare.replace(/%.*$/, ''));
  if (kind === 4) { const b = ipv4Bytes(bare); return !b || blockedV4(b); }
  if (kind === 6) {
    const b = ipv6Bytes(bare);
    if (!b) return true;
    const allZeroTo = (n: number) => b.slice(0, n).every((x) => x === 0);
    if (allZeroTo(15) && (b[15] === 0 || b[15] === 1)) return true;                  // :: and ::1
    const v4 = b.slice(12);
    if (allZeroTo(10) && b[10] === 0xff && b[11] === 0xff) return blockedV4(v4);      // ::ffff:a.b.c.d (mapped)
    if (allZeroTo(12)) return blockedV4(v4);                                          // ::a.b.c.d (deprecated compatible)
    if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) return blockedV4(v4); // 64:ff9b::/96 NAT64
    if (b[0] === 0x20 && b[1] === 0x02) return blockedV4(b.slice(2, 6));              // 2002::/16 6to4 embeds a v4
    if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return true;      // 2001::/32 Teredo
    if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32 documentation
    if ((b[0]! & 0xfe) === 0xfc) return true;                                         // fc00::/7 unique local
    if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true;                        // fe80::/10 link-local
    if (b[0] === 0xfe && (b[1]! & 0xc0) === 0xc0) return true;                        // fec0::/10 site-local (deprecated)
    if (b[0] === 0xff) return true;                                                   // multicast
    return false;
  }
  return true;
}

export interface ParsedImportUrl { url: URL; host: string; port: number; secure: boolean }

/** Validate the text a user typed or shared. Throws UrlRejectedError; never makes a network call. */
export function parseImportUrl(raw: string, base?: string): ParsedImportUrl {
  const text = raw.trim();
  if (!text || text.length > MAX_URL_LENGTH) throw new UrlRejectedError('BAD_URL', 'That does not look like a web address.');
  let url: URL;
  try {
    url = new URL(text, base);
  } catch {
    throw new UrlRejectedError('BAD_URL', 'That does not look like a web address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlRejectedError('BAD_URL', 'Only http and https web addresses can be imported.');
  }
  if (url.username || url.password) throw new UrlRejectedError('BAD_URL', 'Web addresses with a user name or password are not accepted.');
  const secure = url.protocol === 'https:';
  const port = url.port ? Number(url.port) : secure ? 443 : 80;
  if (!ALLOWED_PORTS.includes(port)) throw new UrlRejectedError('BAD_URL', 'That web address uses a port that is not allowed.');
  // WHATWG parsing has already normalised decimal / hex / octal IPv4 spellings to dotted decimal.
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host) throw new UrlRejectedError('BAD_URL', 'That does not look like a web address.');
  if (isIP(host.replace(/%.*$/, ''))) {
    if (isBlockedIp(host)) throw new UrlRejectedError('BLOCKED_ADDRESS', 'That address is not a public web site.');
  } else {
    if (BLOCKED_NAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s)) || !host.includes('.')) {
      throw new UrlRejectedError('BLOCKED_HOST', 'That address is not a public web site.');
    }
  }
  url.hash = '';
  return { url, host, port, secure };
}

export interface ResolvedAddress { address: string; family: 4 | 6 }
export type LookupFn = (host: string) => Promise<ResolvedAddress[]>;

export const systemLookup: LookupFn = async (host) => {
  const rows = await dnsLookup(host, { all: true, verbatim: true });
  return rows.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

/**
 * Resolve `host` and require EVERY answer to be public (one internal answer among public ones is refused: a resolver
 * under an attacker's control can mix them). Returns the addresses to connect to, in resolver order.
 */
export async function resolvePublic(host: string, lookup: LookupFn = systemLookup): Promise<ResolvedAddress[]> {
  if (isIP(host.replace(/%.*$/, ''))) {
    if (isBlockedIp(host)) throw new UrlRejectedError('BLOCKED_ADDRESS', 'That address is not a public web site.');
    return [{ address: host, family: isIP(host) === 6 ? 6 : 4 }];
  }
  let rows: ResolvedAddress[];
  try {
    rows = await lookup(host);
  } catch {
    throw new UrlRejectedError('DNS_FAILED', 'That web site could not be found.');
  }
  if (rows.length === 0) throw new UrlRejectedError('DNS_FAILED', 'That web site could not be found.');
  if (rows.some((r) => isBlockedIp(r.address))) throw new UrlRejectedError('BLOCKED_ADDRESS', 'That address is not a public web site.');
  return rows;
}
