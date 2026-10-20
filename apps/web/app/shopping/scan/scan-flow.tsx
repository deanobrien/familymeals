'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@fr/ui';
import { postListScan, type ListScanFailure } from '../../../lib/shopping/list-scan-client';
import { rowFromDto, type ListRow } from '../../../lib/shopping/list-scan-rows';
import type { ScanProviderInfo } from '../../../lib/shopping/list-scan-types';
import { newUuid } from '../../../lib/shopping/controller';
import { SETTINGS_ERROR_CODES } from '../../recipes/import/upload-step';
import { CaptureStep, type ListPhoto } from './capture-step';
import { ReviewStep } from './review-step';
import s from './scan.module.css';

type Stage = 'capture' | 'scanning' | 'review' | 'done';

export function ScanFlow({ provider, current }: { provider: ScanProviderInfo; current: { name: string; itemCount: number } }) {
  const [stage, setStage] = useState<Stage>('capture');
  const [photos, setPhotos] = useState<ListPhoto[]>([]);
  const [rows, setRows] = useState<ListRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [title, setTitle] = useState<string | undefined>();
  const [error, setError] = useState<ListScanFailure | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [active, setActive] = useState<ScanProviderInfo>(provider);
  /** One id per scan: every add made from this review reuses it, so a double submit can never add twice (D266). */
  const [batchId, setBatchId] = useState(() => newUuid());
  const counter = useRef(1);
  const photosRef = useRef<ListPhoto[]>([]);
  photosRef.current = photos;
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  async function scan() {
    setStage('scanning');
    setError(null);
    const out = await postListScan(photos.map((p) => p.file));
    if (!out.ok) {
      setError(out.error);
      setStage('capture');
      return;
    }
    if (out.data.provider) setActive(out.data.provider);
    setRows(out.data.rows.map(rowFromDto));
    setWarnings(out.data.warnings);
    setTitle(out.data.title);
    setBatchId(newUuid());
    setStage('review');
  }

  function startOver() {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    setRows([]);
    setWarnings([]);
    setTitle(undefined);
    setMessage(null);
    setError(null);
    setBatchId(newUuid());
    setStage('capture');
  }

  const settingsError = error ? SETTINGS_ERROR_CODES.has(error.code) : false;

  return (
    <div className={s.stack}>
      <p data-testid="scan-provider" className={s.muted}>
        Reading with: <strong>{active.label}</strong> <Link href="/settings">Change in Settings</Link>
      </p>
      {active.configured === false && (
        <div role="note" data-testid="unconfigured-banner" className={s.note}>
          No AI provider is set up yet, so photos cannot be read.{' '}
          <Link href="/settings">Open Settings &gt; AI provider</Link>
        </div>
      )}
      {active.isMock && (
        <div role="note" data-testid="mock-banner" className={s.note}>
          No AI provider is set up, so a scan returns a fixed sample list, not what is written in your photos.{' '}
          <Link href="/settings">Add an OpenAI key in Settings</Link> to read real handwriting.
        </div>
      )}

      {error && (
        <div role="alert" data-testid="scan-error" className={s.error}>
          {error.message}{' '}
          {settingsError && <Link href="/settings">Open Settings &gt; AI provider</Link>}
          {error.retryable && !settingsError && <span> Your photos are still here: press Read my list to try again.</span>}
        </div>
      )}

      {stage === 'capture' && (
        <CaptureStep photos={photos} onChange={setPhotos} nextId={() => counter.current++} onScan={() => void scan()} />
      )}

      {stage === 'scanning' && (
        <div role="status" aria-busy="true" data-testid="scanning" className={s.info}>
          <strong>Reading your list...</strong> Reading {photos.length} {photos.length === 1 ? 'photo' : 'photos'} with {active.label}. This can
          take up to a minute.
        </div>
      )}

      {stage === 'review' && (
        <ReviewStep
          rows={rows}
          setRows={setRows}
          warnings={warnings}
          {...(title ? { title } : {})}
          current={current}
          imageCount={photos.length}
          batchId={batchId}
          onBack={() => setStage('capture')}
          onDone={(m) => { setMessage(m); setStage('done'); }}
        />
      )}

      {stage === 'done' && (
        <div className={s.stack} data-testid="scan-done">
          <p role="status" className={s.info}>{message}</p>
          <div className={s.actions}>
            <Link className="fr-btn fr-btn--primary fr-btn--md" href="/shopping">Go to my shopping list</Link>
            <Button variant="secondary" onClick={startOver}>Scan another list</Button>
          </div>
        </div>
      )}
    </div>
  );
}
