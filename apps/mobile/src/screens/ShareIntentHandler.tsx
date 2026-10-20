import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { sharedUrlOf } from '@/lib/shareUrl';

/**
 * "Share to Family Recipes" (P1-B, D370): when the browser shares a page (Android text/plain intent) this opens the
 * recipe-from-link screen with the address and starts reading it. Anything that is not an http(s) address (an image, a
 * plain note, a file) is dropped without being used. Renders nothing.
 */
export default function ShareIntentHandler() {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();

  useEffect(() => {
    if (!hasShareIntent) return;
    const url = sharedUrlOf(shareIntent);
    resetShareIntent();
    if (url) router.push({ pathname: '/import-link', params: { url, auto: '1' } });
  }, [hasShareIntent, shareIntent, resetShareIntent, router]);

  return null;
}
