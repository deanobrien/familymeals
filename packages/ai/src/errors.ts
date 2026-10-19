export type AiErrorCode =
  | 'UNSUPPORTED_IMAGE_TYPE' | 'IMAGE_TOO_LARGE' | 'IMAGE_INVALID' | 'TOO_MANY_IMAGES'
  | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_AUTH' | 'INVALID_OUTPUT'
  | 'LIMIT_EXCEEDED' | 'MOCK_FORBIDDEN' | 'BAD_REQUEST';

const USER_MESSAGES: Record<AiErrorCode, string> = {
  UNSUPPORTED_IMAGE_TYPE: 'That image type is not supported. Please use a JPEG, PNG or WebP photo. HEIC photos need converting first (on iPhone: Settings > Camera > Formats > Most Compatible).',
  IMAGE_TOO_LARGE: 'That image is too large. Please use a smaller photo.',
  IMAGE_INVALID: 'We could not read that image. Please try another photo.',
  TOO_MANY_IMAGES: 'Too many images. Please upload fewer pages at once.',
  RATE_LIMITED: 'The AI service is busy right now. Please try again in a minute.',
  PROVIDER_UNAVAILABLE: 'The AI service is temporarily unavailable. Your data is safe; please try again shortly.',
  PROVIDER_AUTH: 'The AI service is not configured correctly. Please contact support.',
  INVALID_OUTPUT: 'We could not understand the AI response. Please try again, or enter the details manually.',
  LIMIT_EXCEEDED: 'You have reached your AI usage limit. Please try again later.',
  MOCK_FORBIDDEN: 'AI is not available in this environment.',
  BAD_REQUEST: 'The AI request was not valid.',
};

/** Typed error whose `userMessage` is safe to show to end users. `message` is for logs only. */
export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly userMessage: string;
  readonly retryable: boolean;
  constructor(code: AiErrorCode, detail?: string, opts: { retryable?: boolean; cause?: unknown } = {}) {
    super(detail ? `${code}: ${detail}` : code, { cause: opts.cause });
    this.name = 'AiError';
    this.code = code;
    this.userMessage = USER_MESSAGES[code];
    this.retryable = opts.retryable ?? false;
  }
}
