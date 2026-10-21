import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import { APP_NAME } from '@fr/domain';
import '@fr/ui/tokens.css';
import '@fr/ui/styles.css';
import { Shell } from './shell';
import { MOCK_HOUSEHOLD_NAME, MOCK_USER_NAME } from '../lib/server/auth/mock';
import { resolveAuthMode } from '../lib/supabase/env';

const MOCK_LABEL = `Demo mode (mock sign-in, Supabase not configured): signed in as ${MOCK_USER_NAME}, household ${MOCK_HOUSEHOLD_NAME}. Data is in memory and resets when the server restarts.`;

const display = Fraunces({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const body = Inter({ subsets: ['latin'], variable: '--font-body', display: 'swap' });

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Family recipe, meal planning and shopping platform',
  // PWA (P3-C, D445): the manifest is app/manifest.ts; iOS ignores manifest icons, so the touch icon is explicit.
  icons: { apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Recipes', statusBarStyle: 'default' },
};

export const viewport: Viewport = { themeColor: '#2E7D32' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB" className={`${display.variable} ${body.variable}`}>
      <body style={{ margin: 0 }}>
        <Shell {...(resolveAuthMode() === 'mock' ? { mockLabel: MOCK_LABEL } : {})}>{children}</Shell>
      </body>
    </html>
  );
}
