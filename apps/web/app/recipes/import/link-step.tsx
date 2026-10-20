'use client';

import { useState } from 'react';
import { Button, Card, CardBody, Input } from '@fr/ui';
import type { Extracted } from './import-flow';
import type { ApiError } from './import-flow';

const NETWORK_ERROR: ApiError = { code: 'NETWORK', message: 'We could not reach the server. Check your connection and try again.', retryable: true };

/** Recipe from a web link (P1-B, D370): the server fetches ONE page and reads its recipe data; the review screen is shared. */
export function LinkStep({ initialUrl, onRead }: { initialUrl?: string | undefined; onRead: (e: Extracted, via: 'structured' | 'ai') => void }) {
  const [url, setUrl] = useState(initialUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function read() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/import/url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError((json.error as ApiError | undefined) ?? NETWORK_ERROR);
        return;
      }
      onRead(
        { uploadId: json.uploadId as string, draft: json.draft as Extracted['draft'], existing: (json.existing as Extracted['existing']) ?? [] },
        json.via === 'ai' ? 'ai' : 'structured',
      );
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <form
          data-testid="link-import"
          style={{ display: 'grid', gap: '0.75rem' }}
          onSubmit={(e) => { e.preventDefault(); if (url.trim() && !busy) void read(); }}
        >
          <Input
            label="Web address of a recipe"
            hint="Paste a link to one recipe page. We read the recipe from that page, you check it, and it is saved with a link back to the original."
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://"
            value={url}
            maxLength={2000}
            onChange={(e) => setUrl(e.target.value)}
          />
          {error && (
            <div role="alert" data-testid="link-error" style={{ padding: '0.75rem 1rem', borderRadius: 8, background: 'var(--fr-danger-soft)', color: 'var(--fr-danger)' }}>
              {error.message}
            </div>
          )}
          {busy && <p role="status" data-testid="link-progress" className="fr-muted" style={{ margin: 0 }}>Reading the page&hellip; this can take a few seconds.</p>}
          <div>
            <Button type="submit" disabled={busy || !url.trim()} loading={busy}>Read recipe from link</Button>
          </div>
          <p className="fr-muted" style={{ margin: 0 }}>
            For your own household&rsquo;s use. One page at a time; recipes stay credited to their author and site. Some sites block automatic reading: use a photo or screenshot instead.
          </p>
        </form>
      </CardBody>
    </Card>
  );
}
