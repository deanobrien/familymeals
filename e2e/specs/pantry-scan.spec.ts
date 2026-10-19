// Pantry scan (photo / video frames -> pantry) with the mock AI provider: a fixed sample list, no live model call.
// The pantry is a process-wide in-memory store, so these tests are serial and build on each other.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

test.describe.configure({ mode: 'serial' });

const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const photo = (color: string) =>
  sharp({ create: { width: 480, height: 360, channels: 3, background: color } }).jpeg().toBuffer()
    .then((buffer) => ({ name: `${color.slice(1)}.jpg`, mimeType: 'image/jpeg', buffer }));
const row = (page: Page, name: string) => page.getByRole('listitem', { name: `Scanned item: ${name}` });

async function scanPhotos(page: Page, n = 2) {
  await page.goto('/pantry/scan');
  const files = await Promise.all(['#88aa44', '#aa8844', '#4488aa'].slice(0, n).map(photo));
  await page.getByTestId('photo-input').setInputFiles(files);
  await expect(page.getByTestId('thumb')).toHaveCount(n);
  await page.getByRole('button', { name: `Scan ${n} images` }).click();
  await expect(page.getByTestId('scan-row')).toHaveCount(6);
}

test('the Pantry page and Home link to the scanner', async ({ page }) => {
  await page.goto('/pantry');
  await page.getByRole('link', { name: 'Scan groceries' }).click();
  await expect(page).toHaveURL(/\/pantry\/scan$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Scan groceries' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Scan groceries' })).toBeVisible();
});

test('photo path: review every detected item, nothing is written until confirm, then the pantry updates', async ({ page, context }) => {
  await page.route('**/api/pantry/scan', async (route) => {
    await new Promise((r) => setTimeout(r, 700));
    await route.continue();
  });
  await page.goto('/pantry/scan');
  await expect(page.getByTestId('mock-banner')).toBeVisible();
  await expect(page.getByTestId('scan-provider')).toContainText('Reading with');
  // The capture inputs: gallery, camera and video (video/* with capture for a phone camera).
  await expect(page.getByTestId('camera-input')).toHaveAttribute('capture', 'environment');
  await expect(page.getByTestId('video-input')).toHaveAttribute('accept', 'video/*');
  await expect(page.getByText(/dates are read best from close-up photos/i).first()).toBeVisible();

  const files = await Promise.all(['#88aa44', '#aa8844'].map(photo));
  await page.getByTestId('photo-input').setInputFiles(files);
  await expect(page.getByRole('img', { name: 'Photo 1 to scan' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Photo 2 to scan' })).toBeVisible();
  await page.getByRole('button', { name: 'Scan 2 images' }).click();
  await expect(page.getByTestId('scanning')).toContainText('Scanning');
  await expect(page.getByTestId('scan-row')).toHaveCount(6);
  await expect(page.getByText('Nothing has been added yet')).toBeVisible();

  // banana: a clean match with a count, no date, no estimate.
  const banana = row(page, 'banana');
  await expect(banana.getByTestId('match-badge')).toContainText('Matched: banana');
  await expect(banana.getByLabel('Count')).toHaveValue('6');
  await expect(banana.getByLabel('Quantity')).toHaveValue('6');
  await expect(banana.getByLabel('Unit')).toHaveValue('item');
  await expect(banana.getByLabel('Use by')).toHaveValue('');
  await expect(banana.getByTestId('confidence')).toContainText('High confidence');
  await expect(banana).toContainText('images 1, 2');

  // chicken breast: pack size becomes grams; the use-by date is prefilled from the label.
  const chicken = row(page, 'chicken breast');
  await expect(chicken.getByLabel('Quantity')).toHaveValue('650');
  await expect(chicken.getByLabel('Unit')).toHaveValue('g');
  await expect(chicken.getByLabel('Use by')).toHaveValue(iso(2));
  await expect(chicken.getByLabel('Best before')).toHaveValue('');
  await expect(chicken).toContainText('Read from label');

  // tinned chickpeas: tins are counted as cans; best before is separate from use by.
  const chickpeas = row(page, 'tinned chickpeas');
  await expect(chickpeas.getByTestId('match-badge')).toContainText('chickpeas');
  await expect(chickpeas.getByLabel('Quantity')).toHaveValue('2');
  await expect(chickpeas.getByLabel('Unit')).toHaveValue('can');
  await expect(chickpeas.getByLabel('Use by')).toHaveValue('');
  await expect(chickpeas.getByLabel('Best before')).toHaveValue(iso(400));

  // yoghurt: the date label is visible but unreadable, so a close-up is offered and no date is guessed.
  const yoghurt = row(page, 'natural yoghurt');
  await expect(yoghurt.getByTestId('closeup-block')).toContainText('too small to read');
  await expect(yoghurt.getByLabel('Use by')).toHaveValue('');
  await expect(yoghurt.getByLabel('Best before')).toHaveValue('');
  await expect(yoghurt.getByTestId('confidence')).toContainText('Check this one');

  // unmatched foods are free text, never auto-matched.
  const kohlrabi = row(page, 'kohlrabi');
  await expect(kohlrabi.getByTestId('match-badge')).toHaveCount(0);
  await expect(kohlrabi.getByLabel('Name', { exact: true })).toHaveValue('kohlrabi');
  await expect(kohlrabi.getByTestId('confidence')).toContainText('Low confidence');

  // Nothing has been written yet: the pantry itself does not have a banana.
  const other = await context.newPage();
  await other.goto('/pantry');
  await expect(other.getByRole('heading', { level: 1, name: 'Pantry' })).toBeVisible();
  await expect(other.getByRole('list', { name: 'Fruit and veg' })).not.toContainText('banana');
  await other.close();

  // Shelf-life estimates are OFF by default; turning them on labels them, and only where no date exists.
  const toggle = page.getByTestId('estimate-toggle');
  await expect(toggle).not.toBeChecked();
  await expect(page.getByTestId('estimate-badge')).toHaveCount(0);
  await toggle.check();
  await expect(banana.getByTestId('estimate-badge')).toContainText('Estimate');
  await expect(banana.getByLabel('Best before')).toHaveValue(iso(7));
  await expect(chicken.getByTestId('estimate-badge')).toHaveCount(0);
  await expect(chicken.getByLabel('Use by')).toHaveValue(iso(2));
  await toggle.uncheck();
  await expect(page.getByTestId('estimate-badge')).toHaveCount(0);
  await expect(banana.getByLabel('Best before')).toHaveValue('');

  // Close-up: a single photo of the yoghurt reads its use-by date.
  await yoghurt.getByTestId('closeup-input').setInputFiles(await photo('#cccccc'));
  await expect(yoghurt.getByLabel('Use by')).toHaveValue(iso(3));
  await expect(yoghurt).toContainText('Read from close-up');
  await expect(yoghurt.getByTestId('closeup-block')).toContainText('Date read from the close-up');

  // Edit: a count change re-derives the quantity; excluded rows are left out.
  await banana.getByLabel('Count').fill('7');
  await expect(banana.getByLabel('Quantity')).toHaveValue('7');
  await row(page, 'kohlrabi').getByRole('checkbox', { name: 'Include kohlrabi' }).uncheck();
  await row(page, 'pepper').getByRole('checkbox', { name: 'Include pepper' }).uncheck();

  const preview = page.getByTestId('merge-preview');
  await expect(preview.getByTestId('preview-line')).toHaveCount(4);
  await expect(preview).toContainText('banana');
  await expect(preview).toContainText('new line: 7 item');
  await expect(preview).not.toContainText('kohlrabi');

  await page.getByRole('button', { name: 'Add 4 items to pantry' }).click();
  await expect(page.getByTestId('scan-done')).toContainText('Added 4 items to your pantry');
  await page.getByRole('link', { name: 'Back to pantry' }).click();

  const fruit = page.getByRole('list', { name: 'Fruit and veg' });
  await expect(fruit).toContainText('banana');
  await expect(fruit).toContainText('7 item');
  const meat = page.getByRole('list', { name: 'Meat and poultry' });
  await expect(meat).toContainText('chicken breast');
  await expect(meat).toContainText('650 g');
  await expect(meat).toContainText('Expires in 2 days'); // the use-by date is the pantry expiry
  await expect(page.getByRole('list', { name: 'Tinned and jarred' })).toContainText('2 can');
  await expect(page.getByRole('list', { name: 'Dairy and eggs' })).toContainText('natural yoghurt');
  await expect(page.getByRole('list', { name: 'Expiring items' })).toContainText('chicken breast');
});

test('a second scan previews the merge with existing stock (before to after) without writing it', async ({ page }) => {
  await scanPhotos(page, 2);
  for (const name of ['chicken breast', 'tinned chickpeas', 'natural yoghurt', 'pepper', 'kohlrabi']) {
    await row(page, name).getByRole('checkbox', { name: `Include ${name}` }).uncheck();
  }
  const preview = page.getByTestId('merge-preview');
  await expect(preview.getByTestId('preview-line')).toHaveCount(1);
  await expect(preview).toContainText('7 item');
  await expect(preview).toContainText('13 item');
  await expect(preview).toContainText('Merged with stock');
  // leaving without confirming changes nothing
  await page.goto('/pantry');
  await expect(page.getByRole('list', { name: 'Fruit and veg' })).toContainText('7 item');
  await expect(page.getByRole('list', { name: 'Fruit and veg' })).not.toContainText('13 item');
});

test('video path: frames are picked in the browser, shown as thumbnails, and only JPEG frames are uploaded', async ({ page }) => {
  await page.goto('/pantry/scan');
  const recorded = await page.evaluate(async () => {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported('video/webm')) return false;
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext('2d')!;
    let n = 0;
    const timer = setInterval(() => {
      ctx.fillStyle = `hsl(${(n * 17) % 360} 70% 45%)`;
      ctx.fillRect(0, 0, 320, 240);
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 30; i++) ctx.fillRect((i * 37 + n * 6) % 320, (i * 53) % 240, 14, 14);
      n++;
    }, 40);
    const rec = new MediaRecorder(canvas.captureStream(25), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => { rec.onstop = r; });
    rec.start();
    await new Promise((r) => setTimeout(r, 2500));
    rec.stop();
    await stopped;
    clearInterval(timer);
    const dt = new DataTransfer();
    dt.items.add(new File([new Blob(chunks, { type: 'video/webm' })], 'shelf.webm', { type: 'video/webm' }));
    const input = document.querySelector('[data-testid=video-input]') as HTMLInputElement;
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
  test.skip(!recorded, 'this browser cannot record a test video; the frame picker is covered by unit tests');

  await expect(page.getByTestId('thumb').first()).toBeVisible({ timeout: 45_000 });
  const count = await page.getByTestId('thumb').count();
  expect(count).toBeGreaterThanOrEqual(6);
  expect(count).toBeLessThanOrEqual(10);
  await expect(page.getByTestId('capture-notice')).toContainText('Only these frames are sent, never the video');
  // every thumbnail decoded to a real image
  const widths = await page.getByTestId('thumb').locator('img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).naturalWidth));
  expect(widths.every((w) => w > 0)).toBe(true);

  // Playwright cannot read multipart File parts, so record what the page itself sends.
  await page.evaluate(() => {
    const w = window as unknown as { __sent: Array<[string, string, string]>; fetch: typeof fetch };
    w.__sent = [];
    const orig = w.fetch.bind(window);
    w.fetch = (input, init) => {
      if (init?.body instanceof FormData) {
        for (const [k, v] of init.body.entries()) w.__sent.push([k, v instanceof File ? v.name : String(v), v instanceof File ? v.type : 'text']);
      }
      return orig(input, init);
    };
  });
  await page.getByRole('button', { name: /^Scan \d+ images$/ }).click();
  await expect(page.getByTestId('scan-row')).toHaveCount(6);
  const sent = await page.evaluate(() => (window as unknown as { __sent: Array<[string, string, string]> }).__sent);
  expect(sent).toHaveLength(count);
  expect(sent.every(([k, , type]) => k === 'images' && type === 'image/jpeg')).toBe(true);
  expect(sent[0]![1]).toBe('frame-1.jpg');
  expect(sent.some(([, name]) => /\.webm$/.test(name))).toBe(false);
});

test('an ambiguous name asks which ingredient (owner chooses, nothing is guessed)', async ({ page }) => {
  const here = dirname(fileURLToPath(import.meta.url));
  const catalogue = JSON.parse(readFileSync(join(here, '../../packages/refdata/data/out/ingredients.json'), 'utf8')) as Array<{ id: string; name: string; category: string }>;
  const pick = (n: string) => { const i = catalogue.find((c) => c.name === n)!; return { id: i.id, name: i.name, category: i.category }; };
  await page.route('**/api/pantry/scan', (route) => route.fulfill({
    json: {
      warnings: [],
      rows: [{
        key: 's1', name: 'pepper', form: 'fresh', packaging: 'loose', count: 2, datesLegible: false, needsCloseUp: false, confidence: 0.8, frameRefs: [1],
        match: { status: 'ambiguous', candidates: [pick('red pepper'), pick('black pepper')] },
      }],
    },
  }));
  await page.goto('/pantry/scan');
  await page.getByTestId('photo-input').setInputFiles(await photo('#88aa44'));
  await page.getByRole('button', { name: 'Scan 1 image' }).click();
  const r = row(page, 'pepper');
  await expect(r.getByTestId('match-badge')).toHaveCount(0);
  await r.getByLabel('Which ingredient is "pepper"?').selectOption({ label: 'red pepper' });
  await expect(r.getByTestId('match-badge')).toContainText('Matched: red pepper');
  await r.getByRole('button', { name: 'Use my own name for pepper' }).click();
  await expect(r.getByLabel('Name', { exact: true })).toHaveValue('pepper');
});

test('a missing AI provider shows the Settings link and keeps the photos for another try', async ({ page }) => {
  await page.route('**/api/pantry/scan', (route) => route.fulfill({
    status: 412,
    json: { error: { code: 'PROVIDER_NOT_CONFIGURED', message: 'No AI provider is set up yet. Add one in Settings > AI provider.', retryable: false } },
  }));
  await page.goto('/pantry/scan');
  await page.getByTestId('photo-input').setInputFiles(await photo('#88aa44'));
  await page.getByRole('button', { name: 'Scan 1 image' }).click();
  await expect(page.getByTestId('scan-error')).toContainText('No AI provider is set up');
  await expect(page.getByTestId('scan-error').getByRole('link', { name: /Settings/ })).toBeVisible();
  await expect(page.getByTestId('thumb')).toHaveCount(1);
});
