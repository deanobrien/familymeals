// Offline fixture "internet" for e2e and offline dev (URL_IMPORT_SOURCE=mock, set by e2e/playwright.config.ts), like
// RECIPE_SOURCE=mock for discovery. Only the TRANSPORT and DNS lookup are replaced: URL parsing, the SSRF checks, the
// redirect handling and the size/type limits all still run. No network is ever used in this mode.
import 'server-only';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { FetchError, type FetchOptions, type Transport } from './fetch-page';

export const FIXTURE_HOST = 'fixtures.recipes.test';

const DAHL = `<!doctype html><html><head><title>Fixture Lentil Dahl</title><meta property="og:site_name" content="Fixture Kitchen">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Recipe","name":"Fixture Lentil Dahl",
"author":{"@type":"Person","name":"Sam Fixture"},"image":"https://${FIXTURE_HOST}/dahl.jpg","recipeYield":"4 servings",
"prepTime":"PT10M","cookTime":"PT25M","recipeCategory":"Dinner",
"recipeIngredient":["250g red lentils","1 onion, finely chopped","2 cloves garlic, crushed","1 tbsp curry powder","400ml tin coconut milk","salt"],
"recipeInstructions":[{"@type":"HowToStep","text":"Fry the onion and garlic until soft."},{"@type":"HowToStep","text":"Add the curry powder, lentils and coconut milk, then simmer for 25 minutes."}]}</script>
</head><body><main><h1>Fixture Lentil Dahl</h1></main></body></html>`;

const PLAIN = `<!doctype html><html><head><title>Gran's Rice Pudding</title></head><body><main><h1>Gran's rice pudding</h1>
<p>${"A family favourite, baked slowly in the oven until golden. ".repeat(6)}</p>
<ul><li>100g pudding rice</li><li>1 litre whole milk</li><li>3 tbsp sugar</li></ul>
<ol><li>Put everything in a dish.</li><li>Bake at 150C for 2 hours.</li></ol></main></body></html>`;

let jpegPromise: Promise<Buffer> | undefined;
const jpeg = (): Promise<Buffer> => (jpegPromise ??= sharp({ create: { width: 480, height: 320, channels: 3, background: '#cc8844' } }).jpeg().toBuffer());

const transport: Transport = async ({ url }) => {
  if (url.hostname !== FIXTURE_HOST) throw new FetchError('NETWORK', 'offline fixtures only');
  const html = (body: string, status = 200) => ({ status, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Readable.from([Buffer.from(body)]) });
  switch (url.pathname) {
    case '/dahl': return html(DAHL);
    case '/plain': return html(PLAIN);
    case '/refused': return html('Forbidden', 403);
    case '/missing': return html('Not found', 404);
    case '/to-internal': return { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' }, body: Readable.from([]) };
    case '/dahl.jpg': return { status: 200, headers: { 'content-type': 'image/jpeg' }, body: Readable.from([await jpeg()]) };
    default: return html('Not found', 404);
  }
};

export function fixtureFetchOptions(): FetchOptions {
  return { transport, lookup: async () => [{ address: '93.184.216.34', family: 4 }] };
}
