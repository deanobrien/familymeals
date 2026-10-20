import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ExportError } from './exportApi';

/**
 * Download the export zip to the app's private cache and hand it to the Android share sheet (save to Drive / Files, email,
 * ...). The cache copy holds personal data, so it is deleted as soon as the share sheet returns. Native modules sit behind
 * `ExportDeps` so the flow is unit-testable; the real implementation uses expo-file-system's `File.downloadFileAsync`
 * (streams to disk, sends the Bearer header) and expo-sharing.
 */
export interface DownloadedFile {
  uri: string;
  delete(): void;
}

export interface ExportDeps {
  download(url: string, fileName: string, headers: Record<string, string>): Promise<DownloadedFile>;
  isShareAvailable(): Promise<boolean>;
  share(uri: string): Promise<void>;
}

export const realExportDeps: ExportDeps = {
  async download(url, fileName, headers) {
    const target = new File(Paths.cache, fileName);
    const file = await File.downloadFileAsync(url, target, { headers, idempotent: true });
    return { uri: file.uri, delete: () => file.delete() };
  },
  isShareAvailable: () => Sharing.isAvailableAsync(),
  async share(uri) {
    await Sharing.shareAsync(uri, { mimeType: 'application/zip', dialogTitle: 'Save or share your Family Recipes export', UTI: 'public.zip-archive' });
  },
};

export function exportFileName(now: Date = new Date()): string {
  return `family-recipes-export-${now.toISOString().slice(0, 10).replace(/-/g, '')}.zip`;
}

export async function downloadAndShare(
  url: string,
  token: string,
  deps: ExportDeps = realExportDeps,
  now: Date = new Date(),
): Promise<void> {
  if (!(await deps.isShareAvailable())) {
    throw new ExportError('unknown', 'Sharing is not available on this device, so the export cannot be saved from here. Use the website instead.');
  }
  let file: DownloadedFile;
  try {
    file = await deps.download(url, exportFileName(now), { Authorization: `Bearer ${token}` });
  } catch {
    throw new ExportError('network', 'The download did not finish. The link works for one hour: try again, or start a new export tomorrow.');
  }
  try {
    await deps.share(file.uri);
  } finally {
    try {
      file.delete();
    } catch {
      /* the OS clears the cache */
    }
  }
}
