import { AiError, createAiProvider, prepareImages, type AiProvider } from '@fr/ai';
import {
  DraftNotReadyError, QuantitySchema, buildDraft, computeIssues, finaliseDraft,
  type RecipeDraft, type RecipeSummary,
} from '@fr/recipe-import';
import { ingredientMatcher, ingredientParser } from './engine-adapter';
import { getRecipeSink, type RecipeSink } from './sink';
import { deleteUpload, getUpload, putUpload } from './upload-store';

export interface PipelineDeps {
  provider?: AiProvider;
  sink?: RecipeSink;
}

export interface PipelineError {
  code: string;
  /** Safe to show to end users. */
  message: string;
  retryable: boolean;
}

export type ExtractOutcome =
  | { ok: true; uploadId: string; draft: RecipeDraft; existing: RecipeSummary[] }
  | { ok: false; status: number; error: PipelineError; /** Present when the images are kept for retry. */ uploadId?: string };

export interface ExtractInput {
  images?: Uint8Array[];
  /** Retry an earlier upload without re-sending the images. */
  uploadId?: string;
  title?: string;
}

const MAX_TITLE = 200;

/** AI_PROVIDER defaults to mock (DECISIONS D6); the mock refuses to run in production unless explicitly allowed. */
function defaultProvider(): AiProvider {
  return createAiProvider({ AI_PROVIDER: 'mock', ...process.env });
}

function toError(e: unknown): { status: number; error: PipelineError } {
  if (e instanceof AiError) {
    const status =
      e.code === 'RATE_LIMITED' || e.code === 'LIMIT_EXCEEDED' ? 429
      : e.code === 'PROVIDER_UNAVAILABLE' ? 503
      : e.code === 'PROVIDER_AUTH' || e.code === 'MOCK_FORBIDDEN' ? 500
      : e.code === 'INVALID_OUTPUT' ? 502
      : e.code === 'IMAGE_TOO_LARGE' ? 413
      : 400;
    return { status, error: { code: e.code, message: e.userMessage, retryable: e.retryable || status === 429 || status === 503 || status === 502 } };
  }
  console.error('[import] unexpected error', e);
  return { status: 500, error: { code: 'UNEXPECTED', message: 'Something went wrong reading that recipe. Your photos are kept; please try again.', retryable: true } };
}

export async function runExtraction(input: ExtractInput, deps: PipelineDeps = {}): Promise<ExtractOutcome> {
  const sink = deps.sink ?? getRecipeSink();
  let title = input.title?.trim().slice(0, MAX_TITLE) || undefined;
  let uploadId = input.uploadId;
  let images = input.images;

  if (uploadId) {
    const rec = getUpload(uploadId);
    if (!rec) {
      return { ok: false, status: 410, error: { code: 'UPLOAD_EXPIRED', message: 'Your uploaded photos have expired. Please upload them again.', retryable: false } };
    }
    images = rec.images;
    title ??= rec.title;
  }
  if (!images || images.length === 0) {
    return { ok: false, status: 400, error: { code: 'NO_IMAGES', message: 'Add at least one photo of the recipe.', retryable: false } };
  }

  try {
    // Validates count, type (magic bytes) and size before anything is stored or sent to a provider.
    await prepareImages(images);
  } catch (e) {
    return { ok: false, ...toError(e) };
  }

  const rec = uploadId ? getUpload(uploadId)! : putUpload(images, title);
  uploadId = rec.id;
  if (title !== undefined) rec.title = title;

  try {
    const provider = deps.provider ?? defaultProvider();
    const extraction = await provider.extractRecipe(images, title);
    const refs = images.map((_, i) => `import-uploads/${rec.id}/page-${i + 1}`);
    const draft = buildDraft(
      extraction,
      { parser: ingredientParser, matcher: ingredientMatcher },
      { ...(title ? { userTitle: title } : {}), sourceImageRefs: refs },
    );
    rec.draft = draft;
    return { ok: true, uploadId, draft, existing: await sink.list() };
  } catch (e) {
    // Images stay in the temp store so the user can retry without re-uploading.
    return { ok: false, ...toError(e), uploadId };
  }
}

export type SaveOutcome =
  | { ok: true; id: string }
  | { ok: false; status: number; error: PipelineError; blocking?: RecipeDraft['issues'] };

const fail = (status: number, code: string, message: string): SaveOutcome => ({ ok: false, status, error: { code, message, retryable: false } });

/**
 * Finalise a reviewed draft and write it through the sink. The client-supplied draft is only trusted for
 * user-editable fields: provenance (original extraction, image refs, timestamp) comes from the server copy,
 * and blocking issues are recomputed here.
 */
export async function saveImport(input: { uploadId: string; draft: RecipeDraft }, deps: PipelineDeps = {}): Promise<SaveOutcome> {
  const sink = deps.sink ?? getRecipeSink();
  const rec = getUpload(input.uploadId);
  if (!rec?.draft) return fail(410, 'UPLOAD_EXPIRED', 'This import has expired. Please upload the photos again.');

  const d = input.draft;
  if (!d || typeof d !== 'object' || !Array.isArray(d.ingredients) || !Array.isArray(d.steps) || typeof d.title?.value !== 'string') {
    return fail(400, 'BAD_DRAFT', 'The recipe could not be read. Please reload and try again.');
  }
  for (const i of d.ingredients) {
    if (!QuantitySchema.safeParse(i.quantity?.value).success || typeof i.name?.value !== 'string') {
      return fail(400, 'BAD_DRAFT', 'One of the ingredients is invalid. Please check the quantities.');
    }
  }
  const server = rec.draft;
  const draft: RecipeDraft = {
    ...d,
    original: server.original,
    sourceImageRefs: server.sourceImageRefs,
    extractedAt: server.extractedAt,
  };
  draft.issues = computeIssues(draft);

  try {
    const finalised = finaliseDraft(draft);
    const { id } = await sink.save(finalised);
    deleteUpload(input.uploadId);
    return { ok: true, id };
  } catch (e) {
    if (e instanceof DraftNotReadyError) {
      return { ok: false, status: 422, error: { code: 'BLOCKING_ISSUES', message: 'Fix the highlighted problems before saving.', retryable: false }, blocking: e.blockingIssues };
    }
    console.error('[import] save failed', e);
    return { ok: false, status: 500, error: { code: 'SAVE_FAILED', message: 'The recipe could not be saved. Your edits are still here; please try again.', retryable: true } };
  }
}
