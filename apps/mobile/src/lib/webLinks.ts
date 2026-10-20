import { Linking } from 'react-native';

/** Absolute URL on the web app (`EXPO_PUBLIC_API_BASE_URL`), or null when the build has no base URL (demo mode). */
export function webUrl(path: string, base: string | undefined = process.env.EXPO_PUBLIC_API_BASE_URL): string | null {
  const b = base?.trim().replace(/\/+$/, '');
  return b ? `${b}${path.startsWith('/') ? '' : '/'}${path}` : null;
}

/** Open a page of the web app in the browser. Returns false when there is no base URL or nothing can open it. */
export async function openWeb(path: string): Promise<boolean> {
  const url = webUrl(path);
  if (!url) return false;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
