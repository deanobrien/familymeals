import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import { APP_NAME } from '@fr/domain';
import '@fr/ui/tokens.css';
import '@fr/ui/styles.css';
import { Shell } from './shell';

const display = Fraunces({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const body = Inter({ subsets: ['latin'], variable: '--font-body', display: 'swap' });

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Family recipe, meal planning and shopping platform',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB" className={`${display.variable} ${body.variable}`}>
      <body style={{ margin: 0 }}>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
