import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { ServerApi } from './serverApi';
import { csvPath } from './moneyApi';

/**
 * Spend as a CSV through the Android share sheet (P2-B, D406). The file is downloaded from the server with the Bearer header
 * into the app's private cache, handed to the share sheet and deleted as soon as it returns (it is personal data).
 * Native modules sit behind `CsvDeps` so the flow is unit-testable.
 */
export interface CsvDeps {
  download(url: string, fileName: string, headers: Record<string, string>): Promise<{ uri: string; delete(): void }>;
  isShareAvailable(): Promise<boolean>;
  share(uri: string): Promise<void>;
}

export const realCsvDeps: CsvDeps = {
  async download(url, fileName, headers) {
    const target = new File(Paths.cache, fileName);
    const file = await File.downloadFileAsync(url, target, { headers, idempotent: true });
    return { uri: file.uri, delete: () => file.delete() };
  },
  isShareAvailable: () => Sharing.isAvailableAsync(),
  async share(uri) {
    await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Save or share your spending', UTI: 'public.comma-separated-values-text' });
  },
};

export const csvFileName = (now: Date = new Date()): string => `family-recipes-spend-${now.toISOString().slice(0, 10).replace(/-/g, '')}.csv`;

export async function shareSpendCsv(api: ServerApi, householdId: string, weeks = 52, deps: CsvDeps = realCsvDeps, now: Date = new Date()): Promise<void> {
  const base = api.webUrl(`${csvPath(weeks)}&householdId=${encodeURIComponent(householdId)}`);
  if (!base) throw new Error('This needs the Family Recipes server.');
  if (!(await deps.isShareAvailable())) throw new Error('Sharing is not available on this device. Use the website to download the CSV.');
  const headers = await api.authHeaders();
  if (!headers.Authorization) throw new Error('Please sign in again to export your spending.');
  let file: Awaited<ReturnType<CsvDeps['download']>>;
  try {
    file = await deps.download(base, csvFileName(now), headers);
  } catch {
    throw new Error('The download did not finish. Check your connection and try again.');
  }
  try {
    await deps.share(file.uri);
  } finally {
    try { file.delete(); } catch { /* the OS clears the cache */ }
  }
}
