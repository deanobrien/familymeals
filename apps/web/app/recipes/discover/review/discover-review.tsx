'use client';

import { useRouter } from 'next/navigation';
import type { RecipeDraft, RecipeSummary } from '@fr/recipe-import';
import { ReviewStep } from '../../import/review-step';
import type { ApiError } from '../../import/import-flow';

/** The photo-import review screen, fed a draft built from a discovered recipe (no AI, no photos). */
export function DiscoverReview({ uploadId, draft, existing }: { uploadId: string; draft: RecipeDraft; existing: RecipeSummary[] }) {
  const router = useRouter();
  async function save(d: RecipeDraft): Promise<{ error?: ApiError }> {
    try {
      const res = await fetch('/api/extract/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uploadId, draft: d }) });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: ApiError };
      if (!res.ok || !json.id) return { error: json.error ?? { code: 'NETWORK', message: 'We could not reach the server. Check your connection and try again.', retryable: true } };
      router.push(`/recipes/${json.id}`);
      return {};
    } catch {
      return { error: { code: 'NETWORK', message: 'We could not reach the server. Check your connection and try again.', retryable: true } };
    }
  }
  return (
    <ReviewStep
      initial={draft}
      existing={existing}
      uploadId={uploadId}
      intro="Check the recipe below. The source and the original text are kept with it. The dietary label is worked out from the ingredients and is not verified, so please check it. Anything marked needs a look before you save."
      onSave={save}
      onStartOver={() => router.push('/recipes/discover')}
    />
  );
}
