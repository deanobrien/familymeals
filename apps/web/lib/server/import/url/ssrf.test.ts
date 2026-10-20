import { describe, expect, it } from 'vitest';
import { UrlRejectedError, isBlockedIp, parseImportUrl, resolvePublic, type LookupFn } from './ssrf';

const rejects = (raw: string): string | undefined => {
  try { parseImportUrl(raw); return undefined; } catch (e) { return e instanceof UrlRejectedError ? e.code : 'OTHER'; }
};

describe('isBlockedIp', () => {
  it.each([
    '0.0.0.0', '10.0.0.1', '10.255.255.255', '127.0.0.1', '127.1.2.3', '100.64.0.1', '100.127.255.255', '169.254.169.254', '169.254.0.1',
    '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.0.2.5', '192.168.1.1', '192.168.203.7', '198.18.0.1', '198.19.255.255',
    '198.51.100.1', '203.0.113.9', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:10.1.2.3', '::ffff:169.254.169.254', '::ffff:7f00:1', '::127.0.0.1',
    '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::1', '2002:a9fe:a9fe::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:db8::1',
    'fc00::1', 'fd12:3456:789a::1', 'fe80::1', 'fe80::1%eth0', 'febf::1', 'fec0::1', 'ff02::1', '[::1]',
  ])('blocks %s', (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each([
    '1.1.1.1', '8.8.8.8', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.253.1.1', '192.0.1.1',
    '192.169.0.1', '198.17.0.1', '198.20.0.1', '223.255.255.255',
    '2606:4700:4700::1111', '2a00:1450:4009:81f::200e', '::ffff:8.8.8.8', '2002:0808:0808::1', '64:ff9b::808:808',
  ])('allows %s', (ip) => expect(isBlockedIp(ip)).toBe(false));

  it('treats anything that is not an IP as blocked', () => {
    expect(isBlockedIp('example.com')).toBe(true);
    expect(isBlockedIp('')).toBe(true);
    expect(isBlockedIp('999.1.1.1')).toBe(true);
    expect(isBlockedIp('1:2:3:4:5:6:7:8:9')).toBe(true);
  });
});

describe('parseImportUrl', () => {
  it('accepts ordinary public pages and drops the fragment', () => {
    const p = parseImportUrl(' https://www.bbc.co.uk/food/recipes/x?utm=1#top ');
    expect(p.url.toString()).toBe('https://www.bbc.co.uk/food/recipes/x?utm=1');
    expect(p.host).toBe('www.bbc.co.uk');
    expect(parseImportUrl('http://example.com:8080/a').port).toBe(8080);
  });

  it('rejects non-web schemes', () => {
    for (const u of ['file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com', 'javascript:alert(1)', 'data:text/html,<p>x</p>', 'ws://example.com', 'blob:https://example.com/1']) {
      expect(rejects(u)).toBe('BAD_URL');
    }
  });

  it('rejects junk, empty and over-long input', () => {
    expect(rejects('')).toBe('BAD_URL');
    expect(rejects('not a url')).toBe('BAD_URL');
    expect(rejects('https://')).toBe('BAD_URL');
    expect(rejects(`https://example.com/${'a'.repeat(2100)}`)).toBe('BAD_URL');
  });

  it('rejects credentials in the address', () => {
    expect(rejects('https://user:pw@example.com/')).toBe('BAD_URL');
    expect(rejects('https://user@example.com/')).toBe('BAD_URL');
  });

  it('rejects ports outside the allow-list', () => {
    for (const u of ['http://example.com:22/', 'https://example.com:6379/', 'http://example.com:3306/', 'https://example.com:9200/']) expect(rejects(u)).toBe('BAD_URL');
    expect(rejects('https://example.com:443/')).toBeUndefined();
  });

  it('rejects private IP literals in every spelling', () => {
    for (const u of [
      'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://[fd00::1]/', 'http://[fe80::1]/',
      'http://0.0.0.0/', 'http://100.100.100.200/', 'http://[64:ff9b::7f00:1]/',
    ]) {
      expect(rejects(u), u).toBe('BLOCKED_ADDRESS');
    }
  });

  it('rejects internal-looking host names', () => {
    for (const u of [
      'http://localhost/', 'http://LOCALHOST:8080/', 'http://localhost./', 'http://app.localhost/', 'http://printer.local/', 'http://db.internal/',
      'http://metadata.google.internal/computeMetadata/v1/', 'http://router.lan/', 'http://intranet/', 'http://nas.home.arpa/', 'http://wiki.corp/',
    ]) {
      expect(rejects(u), u).toBe('BLOCKED_HOST');
    }
  });

  it('allows a public IP literal', () => {
    expect(rejects('https://93.184.216.34/')).toBeUndefined();
    expect(rejects('https://[2606:4700:4700::1111]/')).toBeUndefined();
  });
});

describe('resolvePublic (DNS answers)', () => {
  const answer = (...ips: string[]): LookupFn => async () => ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }) as const);

  it('returns public answers', async () => {
    expect(await resolvePublic('example.com', answer('93.184.216.34'))).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });
  it('refuses a name that resolves to a private address', async () => {
    await expect(resolvePublic('evil.example.com', answer('10.0.0.5'))).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
    await expect(resolvePublic('evil.example.com', answer('169.254.169.254'))).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
    await expect(resolvePublic('evil.example.com', answer('::1'))).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
    await expect(resolvePublic('evil.example.com', answer('::ffff:192.168.0.1'))).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
  });
  it('refuses when ANY answer is internal (mixed answers)', async () => {
    await expect(resolvePublic('mixed.example.com', answer('93.184.216.34', '127.0.0.1'))).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
    await expect(resolvePublic('mixed.example.com', answer('127.0.0.1', '93.184.216.34'))).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
  });
  it('maps resolver failure and empty answers to DNS_FAILED', async () => {
    await expect(resolvePublic('nope.example.com', async () => { throw new Error('ENOTFOUND'); })).rejects.toMatchObject({ code: 'DNS_FAILED' });
    await expect(resolvePublic('nope.example.com', answer())).rejects.toMatchObject({ code: 'DNS_FAILED' });
  });
  it('does not resolve IP literals through DNS', async () => {
    let called = false;
    const spy: LookupFn = async () => { called = true; return []; };
    expect(await resolvePublic('8.8.8.8', spy)).toEqual([{ address: '8.8.8.8', family: 4 }]);
    expect(called).toBe(false);
    await expect(resolvePublic('127.0.0.1', spy)).rejects.toMatchObject({ code: 'BLOCKED_ADDRESS' });
  });
});
