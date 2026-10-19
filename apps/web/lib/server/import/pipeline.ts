import { AiError, prepareImages, rotateJpeg, type AiProvider, type PreparedImage } from '@fr/ai';
import {
  DraftNotReadyError, QuantitySchema, buildDraft, computeIssues, finaliseDraft,
  type RecipeDraft, type RecipeSummary,
} from '@fr/recipe-import';
import { describeActiveProvider, getAiProvider } from '../ai/provider';
import { coverUrl, getUploadFiles, type UploadFiles } from '../uploads/dev-store';
import { ingredientMatcher, ingredientParser } from './engine-adapter';
import { getRecipeSink, type RecipeSink } from './sink';
import { deleteUpload, getUpload, putUpload, type UploadOwner } from './upload-store';

export interface PipelineDeps {
  provider?: AiProvider;
  sink?: RecipeSink;
  /** Where page photos / the cover image are written (default: local dev store under .data/uploads). */
  uploads?: UploadFiles;
}

export interface PipelineError {
  code: string;
  /** Safe to show to end users. */
  message: string;
  retryable: boolean;
}

export type ExtractOutcome =
  | { ok: true; uploadId: string; draft: RecipeDraft; existing: RecipeSummary[]; provider?: { label: string; isMock: boolean; configured: boolean } }
  | { ok: false; status: number; error: PipelineError; /** Present when the images are kept for retry. */ uploadId?: string };

export interface ExtractInput {
  images?: Uint8Array[];
  /** Retry an earlier upload without re-sending the images. */
  uploadId?: string;
  title?: string;
  /** The authenticated uploader (D102). A retry / save by anyone else is treated as an expired upload. */
  owner?: UploadOwner;
}

const MAX_TITLE = 200;

/** An upload belongs to whoever created it: same user AND household (both undefined = unauthenticated unit-test use). */
export function sameOwner(a: UploadOwner | undefined, b: UploadOwner | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.userId === b.userId && a.householdId === b.householdId;
}

/**
 * The provider for THIS request, from Settings > AI provider, else env, else the dev mock (DECISIONS D6, D41).
 * The mock refuses to run in production unless explicitly allowed.
 */
function defaultProvider(): Promise<AiProvider> {
  return getAiProvider();
}

export function toError(e: unknown): { status: number; error: PipelineError } {
  if (e instanceof AiError) {
    // A mock in production means "no provider set up": send the owner to Settings rather than a dead end.
    const code = e.code === 'MOCK_FORBIDDEN' ? 'PROVIDER_NOT_CONFIGURED' : e.code;
    const message = e.code === 'MOCK_FORBIDDEN' ? new AiError('PROVIDER_NOT_CONFIGURED').userMessage : e.userMessage;
    const status =
      code === 'RATE_LIMITED' || code === 'LIMIT_EXCEEDED' ? 429
      : code === 'PROVIDER_UNAVAILABLE' || code === 'PROVIDER_UNREACHABLE' ? 503
      : code === 'PROVIDER_NOT_CONFIGURED' ? 412
      : code === 'PROVIDER_AUTH' || code === 'MODEL_NOT_FOUND' ? 502
      : code === 'INVALID_OUTPUT' ? 502
      : code === 'IMAGE_TOO_LARGE' ? 413
      : 400;
    return { status, error: { code, message, retryable: e.retryable || status === 429 || status === 503 || status === 502 } };
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
    if (!rec || !sameOwner(rec.owner, input.owner)) {
      return { ok: false, status: 410, error: { code: 'UPLOAD_EXPIRED', message: 'Your uploaded photos have expired. Please upload them again.', retryable: false } };
    }
    images = rec.images;
    title ??= rec.title;
  }
  if (!images || images.length === 0) {
    return { ok: false, status: 400, error: { code: 'NO_IMAGES', message: 'Add at least one photo of the recipe.', retryable: false } };
  }

  let prepared: PreparedImage[];
  try {
    // Validates count, type (magic bytes) and size before anything is stored or sent to a provider.
    // Also applies EXIF auto-rotate, so the stored page photos are upright when the phone said so.
    prepared = await prepareImages(images);
  } catch (e) {
    return { ok: false, ...toError(e) };
  }

  const rec = uploadId ? getUpload(uploadId)! : putUpload(images, title, input.owner);
  uploadId = rec.id;
  if (title !== undefined) rec.title = title;

  try {
    const provider = deps.provider ?? (await defaultProvider());
    const info = deps.provider ? undefined : await describeActiveProvider();
    const extraction = await provider.extractRecipe(images, title);
    const refs = images.map((_, i) => `import-uploads/${rec.id}/page-${i + 1}`);
    const draft = buildDraft(
      extraction,
      { parser: ingredientParser, matcher: ingredientMatcher },
      { ...(title ? { userTitle: title } : {}), sourceImageRefs: refs },
    );
    // Cover = the card's front (the AI says which page and how it is turned); default to page 1.
    draft.coverPage ??= 1;
    rec.draft = draft;
    // Keep the (EXIF-rotated) page photos on disk: the review screen previews them and the cover comes from them.
    const uploads = deps.uploads ?? getUploadFiles();
    try {
      uploads.sweep();
      uploads.writePages(rec.id, prepared.map((p) => p.data));
    } catch (err) {
      console.error('[import] could not store page photos', err instanceof Error ? err.message : err);
    }
    return { ok: true, uploadId, draft, existing: await sink.list(), ...(info ? { provider: { label: info.label, isMock: info.isMock, configured: info.configured } } : {}) };
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
export async function saveImport(input: { uploadId: string; draft: RecipeDraft; owner?: UploadOwner }, deps: PipelineDeps = {}): Promise<SaveOutcome> {
  const sink = deps.sink ?? getRecipeSink();
  const rec = getUpload(input.uploadId);
  if (!rec?.draft || !sameOwner(rec.owner, input.owner)) return fail(410, 'UPLOAD_EXPIRED', 'This import has expired. Please upload the photos again.');

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
  // Source attribution is a provenance fact set by the server (photo cards: the printed publisher; discovery: the provider).
  delete draft.sourcePublisher;
  delete draft.sourceReference;
  if (server.sourcePublisher !== undefined) draft.sourcePublisher = server.sourcePublisher;
  if (server.sourceReference !== undefined) draft.sourceReference = server.sourceReference;
  // Printed nutrition / allergens are source-provided facts from the card, not user-editable here.
  delete draft.printedNutrition;
  delete draft.printedAllergens;
  if (server.printedNutrition) draft.printedNutrition = server.printedNutrition;
  if (server.printedAllergens) draft.printedAllergens = server.printedAllergens;
  draft.issues = computeIssues(draft);

  // Cover image: the chosen page (the AI's front-of-card pick unless the user changed it), turned upright.
  const uploads = deps.uploads ?? getUploadFiles();
  const pageCount = rec.images.length;
  const requested = Number.isInteger(d.coverPage) && d.coverPage! >= 1 && d.coverPage! <= pageCount ? d.coverPage! : (server.coverPage ?? 1);
  const rotation = requested === server.coverPage ? (server.coverRotation ?? 0) : 0;
  draft.coverPage = requested;
  delete draft.coverRotation;
  delete draft.coverImageRef;
  if (pageCount === 0) {
    // Discovered recipe (D173): no photos. The cover is the publisher's image URL set by the server at draft time.
    delete draft.coverPage;
    if (server.coverImageRef) draft.coverImageRef = server.coverImageRef;
  } else {
    try {
      const page = uploads.read(rec.id, `page-${requested}.jpg`)
        ?? (await prepareImages([rec.images[requested - 1]!]))[0]!.data;
      uploads.writeCover(rec.id, await rotateJpeg(page, rotation));
      draft.coverImageRef = coverUrl(rec.id);
    } catch (err) {
      console.error('[import] could not write cover image', err instanceof Error ? err.message : err);
    }
  }

  try {
    const finalised = finaliseDraft(draft);
    const { id } = await sink.save(finalised);
    try { uploads.markSaved(rec.id); } catch { /* cover stays; sweep skips only marked folders */ }
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
