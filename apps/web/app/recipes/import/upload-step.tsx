'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, CardBody, Input } from '@fr/ui';
import { downscaleImage } from '../../../lib/images/downscale';
import type { ApiError, ProviderInfo } from './import-flow';

const MAX_PAGES = 6;

/** Errors the owner fixes in Settings > AI provider; the kept photos can then be retried without re-uploading. */
export const SETTINGS_ERROR_CODES = new Set(['PROVIDER_NOT_CONFIGURED', 'PROVIDER_AUTH', 'MODEL_NOT_FOUND', 'PROVIDER_UNREACHABLE']);

interface Page {
  id: number;
  file: File;
  url: string;
}

interface Props {
  onExtract: (body: FormData | { uploadId: string; title?: string }) => Promise<{ error?: ApiError; uploadId?: string }>;
  provider?: ProviderInfo;
}

/** Turn an image a quarter turn clockwise in the browser (before upload). Bakes in EXIF orientation first. */
export async function rotateImageFile(file: File, quarterTurnsClockwise = 1): Promise<File> {
  const out = await downscaleImage(file, { quarterTurns: quarterTurnsClockwise });
  if (out === file && quarterTurnsClockwise % 4 !== 0) throw new Error('could not rotate image');
  return out;
}

export function UploadStep({ onExtract, provider }: Props) {
  const [pages, setPages] = useState<Page[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [retryId, setRetryId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [rotating, setRotating] = useState<number | null>(null);
  const nextId = useRef(1);
  const pagesRef = useRef<Page[]>([]);
  pagesRef.current = pages;

  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = [...list].filter((f) => f.type === '' || f.type.startsWith('image/'));
    const room = MAX_PAGES - pages.length;
    const accepted = incoming.slice(0, Math.max(0, room));
    setNotice(
      incoming.length < list.length
        ? 'Only image files can be added.'
        : incoming.length > room
          ? `You can add up to ${MAX_PAGES} pages; extra photos were ignored.`
          : null,
    );
    setRetryId(null);
    setError(null);
    if (accepted.length === 0) return;
    setPreparing(true);
    const files = await Promise.all(accepted.map((f) => downscaleImage(f)));
    setPreparing(false);
    setPages((cur) => [...cur, ...files.slice(0, Math.max(0, MAX_PAGES - cur.length)).map((file) => ({ id: nextId.current++, file, url: URL.createObjectURL(file) }))]);
  }

  function move(i: number, d: -1 | 1) {
    setPages((cur) => {
      const j = i + d;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  function remove(i: number) {
    setRetryId(null);
    setPages((cur) => {
      const gone = cur[i];
      if (gone) URL.revokeObjectURL(gone.url);
      return cur.filter((_, k) => k !== i);
    });
  }

  async function rotate(i: number) {
    const target = pages[i];
    if (!target) return;
    setRotating(target.id);
    setNotice(null);
    try {
      const file = await rotateImageFile(target.file, 1);
      const url = URL.createObjectURL(file);
      setRetryId(null); // the kept server copy is the un-rotated one: upload again
      setPages((cur) => cur.map((p) => {
        if (p.id !== target.id) return p;
        URL.revokeObjectURL(p.url);
        return { ...p, file, url };
      }));
    } catch {
      setNotice('That photo could not be rotated here. Try rotating it in your photos app first.');
    } finally {
      setRotating(null);
    }
  }

  async function submit(retry?: string) {
    setBusy(true);
    setError(null);
    let result: { error?: ApiError; uploadId?: string };
    if (retry) {
      result = await onExtract({ uploadId: retry, ...(title.trim() ? { title: title.trim() } : {}) });
    } else {
      const fd = new FormData();
      pages.forEach((p) => fd.append('images', p.file, p.file.name));
      if (title.trim()) fd.append('title', title.trim());
      result = await onExtract(fd);
    }
    if (result.error) {
      setError(result.error);
      setRetryId(result.uploadId ?? null);
      setBusy(false);
    }
  }

  const settingsError = error ? SETTINGS_ERROR_CODES.has(error.code) : false;

  return (
    <div style={{ display: 'grid', gap: 'var(--fr-space-5, 1.25rem)', maxWidth: 720 }}>
      {provider && (
        <p data-testid="import-provider" className="fr-muted" style={{ margin: 0 }}>
          Reading with: <strong>{provider.label}</strong>{' '}
          <Link href="/settings">Change in Settings</Link>
        </p>
      )}
      {provider?.configured === false && (
        <div role="note" data-testid="unconfigured-banner" style={{ padding: '0.75rem 1rem', borderRadius: 8, background: 'var(--fr-warning-soft)', color: 'var(--fr-warning)' }}>
          No AI provider is set up yet, so recipes cannot be read from photos.{' '}
          <Link href="/settings">Open Settings &gt; AI provider</Link>
        </div>
      )}
      {provider?.isMock && (
        <div role="note" data-testid="mock-banner" style={{ padding: '0.75rem 1rem', borderRadius: 8, background: 'var(--fr-warning-soft)', color: 'var(--fr-warning)' }}>
          No AI provider is set up, so this will return a sample recipe, not what is in your photo.{' '}
          <Link href="/settings">Add an OpenAI key in Settings</Link> to read real recipe cards.
        </div>
      )}

      <Card>
        <CardBody>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
            <label className="fr-btn fr-btn--secondary fr-btn--md" style={{ cursor: 'pointer' }}>
              Choose photos
              <input
                type="file"
                accept="image/*"
                multiple
                data-testid="photo-input"
                className="fr-visually-hidden"
                onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }}
              />
            </label>
            <label className="fr-btn fr-btn--secondary fr-btn--md" style={{ cursor: 'pointer' }}>
              Take a photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                data-testid="camera-input"
                className="fr-visually-hidden"
                onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }}
              />
            </label>
            <Badge>{pages.length} of {MAX_PAGES} pages</Badge>
          </div>
          <p className="fr-muted" style={{ margin: '0.5rem 0 0' }}>
            Add every side of the card (front and back, in any order). If a photo is sideways, turn it with Rotate.
          </p>
          {preparing && <p role="status">Preparing photos...</p>}
          {notice && <p role="status">{notice}</p>}
        </CardBody>
      </Card>

      {pages.length > 0 && (
        <ol aria-label="Pages in order" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem' }}>
          {pages.map((p, i) => (
            <li key={p.id} data-testid="page-item" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <img src={p.url} alt={`Preview of page ${i + 1}`} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }} />
              <div style={{ flex: 1, minWidth: '8rem' }}>
                <strong>Page {i + 1}</strong>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.file.name}</div>
              </div>
              <Button variant="ghost" size="sm" disabled={busy || rotating !== null} aria-label={`Rotate page ${i + 1} clockwise`} onClick={() => void rotate(i)}>Rotate</Button>
              <Button variant="ghost" size="sm" disabled={busy || i === 0} aria-label={`Move page ${i + 1} earlier`} onClick={() => move(i, -1)}>Up</Button>
              <Button variant="ghost" size="sm" disabled={busy || i === pages.length - 1} aria-label={`Move page ${i + 1} later`} onClick={() => move(i, 1)}>Down</Button>
              <Button variant="ghost" size="sm" disabled={busy} aria-label={`Remove page ${i + 1}`} onClick={() => remove(i)}>Remove</Button>
            </li>
          ))}
        </ol>
      )}

      <Input
        label="Recipe name (optional)"
        hint="Leave blank to let the AI suggest one, which you can change on the next screen."
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
      />

      {error && (
        <div role="alert" data-testid="import-error" style={{ padding: '0.75rem 1rem', borderRadius: 8, background: 'var(--fr-danger-soft)', color: 'var(--fr-danger)' }}>
          <p style={{ margin: 0 }}>{error.message}</p>
          {settingsError && (
            <p style={{ margin: '0.5rem 0 0' }}>
              <Link href="/settings" data-testid="import-error-settings-link">Open Settings &gt; AI provider</Link>
            </p>
          )}
          {retryId && (error.retryable || settingsError) && (
            <p style={{ margin: '0.5rem 0 0' }}>
              <Button variant="secondary" size="sm" onClick={() => void submit(retryId)} disabled={busy}>Try again</Button>{' '}
              <span>Your photos are kept, so you will not need to upload them again.</span>
            </p>
          )}
        </div>
      )}

      {busy && (
        <div role="status" data-testid="import-progress" style={{ padding: '0.75rem 1rem', borderRadius: 8, background: 'var(--fr-surface-2)' }}>
          <strong>Reading your recipe&hellip;</strong>
          <p className="fr-muted" style={{ margin: '0.25rem 0 0' }}>
            {provider && !provider.isMock ? `Asking ${provider.label}. ` : ''}This can take up to a minute for a recipe with several pages. Please keep this page open.
          </p>
        </div>
      )}

      <div>
        <Button onClick={() => void submit()} disabled={busy || preparing || pages.length === 0} loading={busy}>
          Extract recipe
        </Button>
      </div>
    </div>
  );
}
