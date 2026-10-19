import type { ReactNode } from 'react';
import { resolveAuthMode } from '../../lib/supabase/env';
import { messageFor } from '../../lib/server/auth/errors';

/** Visible in dev/CI when Supabase env is missing (mock auth); an error in production. */
export function AuthModeBanner() {
  const mode = resolveAuthMode();
  if (mode === 'supabase') return null;
  return (
    <p role="status" data-testid="auth-mode-banner" style={{ border: '1px solid currentColor', padding: '0.75rem', borderRadius: 8 }}>
      {mode === 'mock'
        ? 'Local mock auth: Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY). Sign-in is disabled; every page is open as a mock user. This mode is refused in production.'
        : 'Authentication is not configured on this server.'}
    </p>
  );
}

export function ErrorNote({ code }: { code?: string | string[] }) {
  const msg = messageFor(Array.isArray(code) ? code[0] : code);
  return msg ? (
    <p role="alert" data-testid="auth-error">
      {msg}
    </p>
  ) : null;
}

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main id="main" className="fr-auth__card">
      <h1>{title}</h1>
      {children}
    </main>
  );
}

export const formStyle = { display: 'grid', gap: '0.75rem' } as const;
