import type { MetadataRoute } from 'next';
import { APP_NAME } from '@fr/domain';

/**
 * Web app manifest (P3-C, D445): makes the web app installable (Add to Home screen / Install). It opens on the shopping list, the
 * page that also works offline (D446). Icons are static PNGs in public/icons (apps/web/scripts/make-pwa-icons.mjs). No secrets and
 * nothing user-specific here: the manifest is fetched without credentials.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: APP_NAME,
    short_name: 'Recipes',
    description: 'Family recipes, meal planning and a shared shopping list that works offline.',
    start_url: '/shopping',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#2E7D32',
    lang: 'en-GB',
    categories: ['food', 'lifestyle', 'shopping'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Shopping list', short_name: 'Shopping', url: '/shopping', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Scan groceries', short_name: 'Scan', url: '/pantry/scan', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
  };
}
