// Verifies the Android app's Bearer-token calls against a RUNNING web app wired to the LOCAL Supabase stack (D213).
//   pnpm exec supabase start
//   pnpm dev:live            (or PORT=3171 pnpm dev:live)   # DATA_BACKEND=supabase, mock AI
//   node scripts/verify-mobile-bearer.mjs http://localhost:3131
// It creates a throw-away confirmed user + household on the LOCAL stack (well-known local keys, *.fr-live.test), signs in
// with the anon key exactly like the app does, then calls /api/products/<barcode>, /api/extract and /api/extract/save with
// `Authorization: Bearer <access token>` and checks status codes and bodies. Exit code 1 on any failed check.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localSupabaseEnv } from './local-supabase-env.mjs';

const base = (process.argv[2] ?? 'http://localhost:3131').replace(/\/+$/, '');
const env = localSupabaseEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
if (!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) throw new Error(`Refusing to run against a non-local Supabase: ${url}`);

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed += 1;
};
const json = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const email = `m3.${stamp}@fr-live.test`;
const password = 'Live-Test-Passw0rd!';

// 1. user + sign-in (as the app does: password grant with the anon key)
let res = await fetch(`${url}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: service, Authorization: `Bearer ${service}`, 'content-type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
check('create local test user', res.ok, `HTTP ${res.status}`);
res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const session = await json(res);
const token = session?.access_token;
check('password sign-in returns an access token', Boolean(token), `HTTP ${res.status}`);
if (!token) process.exit(1);

// 2. household (what the web onboarding does; the owner row comes from a trigger)
res = await fetch(`${url}/rest/v1/households`, {
  method: 'POST',
  headers: { apikey: anon, Authorization: `Bearer ${token}`, 'content-type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ name: `M3 bearer check ${stamp}` }),
});
const hh = (await json(res))?.[0]?.id;
check('create household', Boolean(hh), `HTTP ${res.status}`);
if (!hh) process.exit(1);

const bearer = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

// 3. GET /api/products/<barcode>?householdId=...  (mock provider fixture: baked beans)
const BEANS = '5009000000015';
res = await fetch(`${base}/api/products/${BEANS}?householdId=${encodeURIComponent(hh)}`, { headers: bearer });
let body = await json(res);
check('products: bearer + household -> 200 with a product', res.status === 200 && typeof body?.product?.name === 'string', `HTTP ${res.status}`);
res = await fetch(`${base}/api/products/${BEANS}?householdId=${encodeURIComponent(hh)}`, { headers: { Accept: 'application/json' }, redirect: 'manual' });
check('products: no token -> 401 JSON (not a redirect)', res.status === 401, `HTTP ${res.status}`);
res = await fetch(`${base}/api/products/${BEANS}?householdId=${encodeURIComponent(hh)}`, { headers: { Authorization: 'Bearer not-a-real-token', Accept: 'application/json' } });
check('products: bad token -> 401', res.status === 401, `HTTP ${res.status}`);
res = await fetch(`${base}/api/products/${BEANS}?householdId=00000000-0000-4000-8000-0000000000ff`, { headers: bearer });
check('products: household the user is not in -> 403', res.status === 403, `HTTP ${res.status}`);
res = await fetch(`${base}/api/products/${BEANS}`, { headers: bearer });
check('products: no householdId, single membership -> 200', res.status === 200, `HTTP ${res.status}`);

// 4. POST /api/extract (multipart: images[] + householdId, no Content-Type) then /api/extract/save
// Any decodable image works (the server sniffs the magic bytes and re-encodes; the mock AI reads a canned recipe). The app sends a JPEG.
const png = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'mobile', 'assets', 'icon.png'));
const form = new FormData();
form.append('householdId', hh);
form.append('images', new Blob([png], { type: 'image/jpeg' }), 'page-1.jpg');
res = await fetch(`${base}/api/extract`, { method: 'POST', headers: bearer, body: form });
body = await json(res);
check('extract: bearer multipart -> 200 with uploadId + draft', res.status === 200 && typeof body?.uploadId === 'string' && typeof body?.draft === 'object', `HTTP ${res.status}${body?.error ? ` ${body.error.message}` : ''}`);
const noAuth = new FormData();
noAuth.append('householdId', hh);
noAuth.append('images', new Blob([png], { type: 'image/jpeg' }), 'page-1.jpg');
res = await fetch(`${base}/api/extract`, { method: 'POST', headers: { Accept: 'application/json' }, body: noAuth, redirect: 'manual' });
check('extract: no token -> 401', res.status === 401, `HTTP ${res.status}`);

if (body?.uploadId) {
  res = await fetch(`${base}/api/extract/save`, {
    method: 'POST',
    headers: { ...bearer, 'content-type': 'application/json' },
    body: JSON.stringify({ uploadId: body.uploadId, draft: body.draft }),
  });
  const saved = await json(res);
  check('extract/save: bearer -> 200 with a recipe id', res.status === 200 && typeof saved?.id === 'string', `HTTP ${res.status}${saved?.error ? ` ${saved.error.message}` : ''}`);
  if (saved?.id) {
    // RLS read-back exactly as the app lists recipes
    res = await fetch(`${url}/rest/v1/recipes?select=id,title&id=eq.${saved.id}`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
    const rows = await json(res);
    check('saved recipe is visible to the user through RLS', Array.isArray(rows) && rows.length === 1, `HTTP ${res.status}`);
  }
}

console.log(failed === 0 ? '\nAll bearer checks passed.' : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
