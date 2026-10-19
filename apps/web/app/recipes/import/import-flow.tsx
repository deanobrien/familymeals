'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RecipeDraft, RecipeSummary } from '@fr/recipe-import';
import { UploadStep } from './upload-step';
import { ReviewStep } from './review-step';

export interface ApiError { code: string; message: string; retryable: boolean }

export interface Extracted {
  uploadId: string;
  draft: RecipeDraft;
  existing: RecipeSummary[];
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const NETWORK_ERROR: ApiError = { code: 'NETWORK', message: 'We could not reach the server. Check your connection and try again.', retryable: true };

export function ImportFlow() {
  const router = useRouter();
  const [extracted, setExtracted] = useState<Extracted | null>(null);

  async function extract(body: FormData | { uploadId: string; title?: string }): Promise<{ error?: ApiError; uploadId?: string }> {
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        ...(body instanceof FormData
          ? { body }
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const json = await readJson(res);
      if (!res.ok) {
        return {
          error: (json.error as ApiError | undefined) ?? NETWORK_ERROR,
          ...(typeof json.uploadId === 'string' ? { uploadId: json.uploadId } : {}),
        };
      }
      setExtracted({ uploadId: json.uploadId as string, draft: json.draft as RecipeDraft, existing: (json.existing as RecipeSummary[]) ?? [] });
      return {};
    } catch {
      return { error: NETWORK_ERROR };
    }
  }

  async function save(draft: RecipeDraft): Promise<{ error?: ApiError }> {
    if (!extracted) return {};
    try {
      const res = await fetch('/api/extract/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uploadId: extracted.uploadId, draft }),
      });
      const json = await readJson(res);
      if (!res.ok) return { error: (json.error as ApiError | undefined) ?? NETWORK_ERROR };
      router.push(`/recipes/${json.id as string}`);
      return {};
    } catch {
      return { error: NETWORK_ERROR };
    }
  }

  if (extracted) {
    return <ReviewStep initial={extracted.draft} existing={extracted.existing} onSave={save} onStartOver={() => setExtracted(null)} />;
  }
  return <UploadStep onExtract={extract} />;
}
