// Voice add, browser side (P2-A, D395). Speech-to-text is the browser's Web Speech API where it exists; typed text is the
// fallback and always works. The text goes to /api/shopping/voice/parse (reads only), the member reviews chips, and the
// add goes through /api/shopping/scan/confirm, which is idempotent on `batchId` (a double tap adds nothing twice).
import { UNIT_LABELS } from './engine';

export interface VoiceRow {
  key: string;
  text: string;
  name: string;
  ingredientId?: string;
  value?: number;
  unit?: string;
  notes?: string;
  aisle: string;
}

export class VoiceApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'VoiceApiError';
  }
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    return ((await res.json()) as { error?: { message?: string } }).error?.message || fallback;
  } catch {
    return fallback;
  }
}

export async function parseTranscript(transcript: string, f: typeof fetch = fetch): Promise<{ rows: VoiceRow[]; truncated: boolean }> {
  const res = await f('/api/shopping/voice/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcript }) });
  if (!res.ok) throw new VoiceApiError(await errorMessage(res, 'Could not read that.'), res.status);
  return (await res.json()) as { rows: VoiceRow[]; truncated: boolean };
}

/** One batch id per reviewed set: the same id on a retry makes the server drop the duplicates. */
export const newBatchId = (): string => `voice-${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^\w-]/g, '')}`.slice(0, 64);

export async function addRows(rows: readonly VoiceRow[], batchId: string, f: typeof fetch = fetch): Promise<{ message: string; added: number; merged: number }> {
  const commit = rows.map((r) => ({
    key: r.key,
    name: r.name,
    ...(r.ingredientId ? { ingredientId: r.ingredientId } : {}),
    ...(r.value !== undefined && r.unit ? { value: r.value, unit: r.unit } : {}),
    ...(r.notes ? { notes: r.notes } : {}),
    aisle: r.aisle,
  }));
  const res = await f('/api/shopping/scan/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rows: commit, destination: { kind: 'current' }, batchId }),
  });
  if (!res.ok) throw new VoiceApiError(await errorMessage(res, 'Could not add those.'), res.status);
  return (await res.json()) as { message: string; added: number; merged: number };
}

/** "2 tins Tomatoes" / "Milk": what the chip says. */
export function chipLabel(r: VoiceRow): string {
  if (r.value === undefined || !r.unit) return r.name;
  const unit = UNIT_LABELS[r.unit as keyof typeof UNIT_LABELS] ?? r.unit;
  return `${r.value}${unit ? ` ${unit}` : ''} ${r.name}`.replace(/\s+/g, ' ').trim();
}

/* ---------------------------------------------------------------- Web Speech API */

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognitionCtor = new () => RecognitionLike;

export function speechCtor(w: unknown = typeof window !== 'undefined' ? window : undefined): RecognitionCtor | null {
  const o = w as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor } | undefined;
  return o?.SpeechRecognition ?? o?.webkitSpeechRecognition ?? null;
}

export const SPEECH_ERRORS: Record<string, string> = {
  'not-allowed': 'The microphone is blocked for this site. Allow it in your browser settings, or type instead.',
  'service-not-allowed': 'Speech recognition is not allowed here. Type instead.',
  'no-speech': 'Nothing was heard. Try again, or type instead.',
  'audio-capture': 'No microphone was found. Type instead.',
  network: 'Speech recognition needs a connection. Try again, or type instead.',
};

/** Start listening; `onText` gets the transcript so far, `onDone` fires once when recognition ends (error text if any). */
export function listen(Ctor: RecognitionCtor, onText: (text: string) => void, onDone: (error?: string) => void): { stop: () => void } {
  const rec = new Ctor();
  rec.lang = 'en-GB';
  rec.interimResults = true;
  rec.continuous = false;
  let error: string | undefined;
  rec.onresult = (e) => {
    let t = '';
    for (let i = 0; i < e.results.length; i++) t += e.results[i]![0]?.transcript ?? '';
    onText(t.trim());
  };
  rec.onerror = (e) => {
    error = SPEECH_ERRORS[e.error ?? ''] ?? 'Speech recognition did not work. Type instead.';
  };
  rec.onend = () => onDone(error);
  try {
    rec.start();
  } catch {
    onDone('Speech recognition could not start. Type instead.');
  }
  return { stop: () => { try { rec.stop(); } catch { /* already stopped */ } } };
}
