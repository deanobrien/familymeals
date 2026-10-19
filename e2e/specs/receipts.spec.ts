import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// Runs against the mock AI provider (AI_PROVIDER defaults to mock), which always returns the same receipt:
// RED LENTILS 500G, BRITISH ONIONS 1KG, 2 x SEMI SKIMMED MILK 2L (total 5.74).
const RECEIPT_IMAGE = fileURLToPath(new URL('../fixtures/receipts/r1-weekly-shop.png', import.meta.url));

test('receipts page lists past receipts and offers upload', async ({ page }) => {
  await page.goto('/receipts');
  await expect(page.getByRole('heading', { level: 1, name: 'Receipts' })).toBeVisible();
  await expect(page.getByLabel('Receipt photo')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scan receipt' })).toBeVisible();
  const history = page.getByRole('list', { name: 'Past receipts' });
  await expect(history.getByTestId('receipt-row').first()).toContainText('Example Supermarket');
  await expect(history.getByText('Reconciled').first()).toBeVisible();
});

test('upload, review, explicitly confirm one match, keep the rest outstanding', async ({ page }) => {
  await page.goto('/receipts');
  await page.getByLabel('Receipt photo').setInputFiles(RECEIPT_IMAGE);
  await page.getByRole('button', { name: 'Scan receipt' }).click();

  // first server-action compile in dev can be slow
  await expect(page).toHaveURL(/\/receipts\/[^/]+\/review$/, { timeout: 60_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Review receipt' })).toBeVisible();
  const lines = page.getByTestId('receipt-line');
  await expect(lines).toHaveCount(3);
  await expect(page.getByTestId('total-ok')).toBeVisible();
  await expect(page.getByTestId('total-discrepancy')).toHaveCount(0);

  // Suggested matches are pre-selected but nothing is confirmed until the user ticks Confirm.
  const lentilSelect = page.getByLabel('Match for RED LENTILS 500G');
  await expect(lentilSelect.locator('option:checked')).toContainText('red lentils');
  await expect(page.getByLabel('Confirm RED LENTILS 500G as bought')).not.toBeChecked();
  await expect(page.getByTestId('confirm-summary')).toContainText('0 purchases');
  await expect(page.getByRole('button', { name: 'Save receipt' })).toBeDisabled();

  // Quantity can be adjusted, then explicitly confirm just the lentils.
  await page.getByLabel(/Quantity bought/).first().fill('500');
  await page.getByLabel('Confirm RED LENTILS 500G as bought').check();
  await expect(page.getByTestId('confirm-summary')).toContainText('1 purchase will be recorded');
  await page.getByRole('button', { name: 'Confirm 1 purchase' }).click();

  await expect(page.getByRole('status').filter({ hasText: '1 purchase(s) recorded' })).toBeVisible();
  await expect(page.getByTestId('receipt-line').filter({ hasText: 'RED LENTILS 500G' })).toContainText('bought: red lentils');
  await expect(page.getByTestId('receipt-line').filter({ hasText: 'ONIONS' })).toContainText('not matched');

  // Receipt is kept as history.
  await page.getByRole('link', { name: /All receipts/ }).click();
  await expect(page.getByRole('list', { name: 'Past receipts' }).getByTestId('receipt-row')).toHaveCount(2);
});
