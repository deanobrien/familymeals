'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RecipeDraft, RecipeSummary } from '@fr/recipe-import';
import { LinkStep } from './link-step';
import { UploadStep } from './upload-step';
import { ReviewStep } from './review-step';

export interface ApiError { code: string; message: string; retryable: boolean }

/** Which AI is reading the photos (never includes a key). */
export interface ProviderInfo { label: string; isMock: boolean; /** false = a real provider is selected but unusable (missing key etc). */ configured?: boolean }

export interface Extracted {
  uploadId: string;
  draft: RecipeDraft;
  existing: RecipeSummary[];
  provider?: ProviderInfo;
  /** Set for a recipe read from a web link: 'ai' = no recipe data on the page, read from its text by AI. */
  link?: 'structured' | 'ai';
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const NETWORK_ERROR: ApiError = { code: 'NETWORK', message: 'We could not reach the server. Check your connection and try again.', retryable: true };

const LINK_INTRO = 'Check the recipe below. It was read from the web page, and the link to the original page is kept with it. Anything marked needs a look before you save, and the dietary label is worked out from the ingredients and is not verified.';

export function ImportFlow({ provider, initialUrl }: { provider?: ProviderInfo; initialUrl?: string }) {
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
      setExtracted({
        uploadId: json.uploadId as string,
        draft: json.draft as RecipeDraft,
        existing: (json.existing as RecipeSummary[]) ?? [],
        ...(json.provider ? { provider: json.provider as ProviderInfo } : {}),
      });
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
    const fromLink = extracted.link !== undefined;
    return (
      <ReviewStep
        initial={extracted.draft}
        existing={extracted.existing}
        uploadId={extracted.uploadId}
        provider={fromLink ? undefined : (extracted.provider ?? provider)}
        {...(fromLink ? { intro: LINK_INTRO, noteFrom: 'the page' } : {})}
        onSave={save}
        onStartOver={() => setExtracted(null)}
      />
    );
  }
  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      <section aria-labelledby="link-h" style={{ display: 'grid', gap: '0.75rem', maxWidth: 720 }}>
        <h2 id="link-h">From a web link</h2>
        <LinkStep initialUrl={initialUrl} onRead={(e, via) => setExtracted({ ...e, link: via })} />
      </section>
      <section aria-labelledby="photo-h" style={{ display: 'grid', gap: '0.75rem' }}>
        <h2 id="photo-h">From photos</h2>
        <p>Photograph or upload up to 6 pages of a recipe card or book page. You will review everything before it is saved.</p>
        <UploadStep onExtract={extract} provider={provider} />
      </section>
    </div>
  );
}
