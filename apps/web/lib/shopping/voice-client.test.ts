import { describe, expect, it } from 'vitest';
import { addRows, chipLabel, listen, newBatchId, parseTranscript, speechCtor, type RecognitionCtor } from './voice-client';

class FakeRec {
  static last: FakeRec;
  lang = ''; interimResults = false; continuous = false;
  onresult: ((e: never) => void) | null = null; onerror: ((e: { error?: string }) => void) | null = null; onend: (() => void) | null = null;
  constructor() { FakeRec.last = this; }
  start() { /* noop */ }
  stop() { this.onend?.(); }
  abort() { /* noop */ }
}

describe('speech', () => {
  it('finds the standard or the webkit constructor, else null (typed fallback)', () => {
    expect(speechCtor({})).toBeNull();
    expect(speechCtor({ webkitSpeechRecognition: FakeRec })).toBe(FakeRec);
    expect(speechCtor({ SpeechRecognition: FakeRec })).toBe(FakeRec);
  });
  it('streams the transcript and reports a friendly error', () => {
    const texts: string[] = [];
    const done: Array<string | undefined> = [];
    listen(FakeRec as unknown as RecognitionCtor, (t) => texts.push(t), (e) => done.push(e));
    FakeRec.last.onresult?.({ results: [[{ transcript: 'add milk ' }], [{ transcript: 'and eggs' }]] } as never);
    FakeRec.last.onerror?.({ error: 'not-allowed' });
    FakeRec.last.onend?.();
    expect(FakeRec.last.lang).toBe('en-GB');
    expect(texts).toEqual(['add milk and eggs']);
    expect(done[0]).toMatch(/microphone is blocked/);
  });
});

describe('chips and calls', () => {
  it('labels quantity + unit + name', () => {
    expect(chipLabel({ key: 'v1', text: 'milk', name: 'Milk', aisle: 'Dairy & eggs' })).toBe('Milk');
    expect(chipLabel({ key: 'v2', text: 'x', name: 'Tomato', value: 2, unit: 'can', aisle: 'Other' })).toMatch(/^2 .*Tomato$/);
    expect(chipLabel({ key: 'v3', text: 'x', name: 'Egg', value: 12, unit: 'item', aisle: 'Other' })).toBe('12 Egg');
  });
  it('batch ids are valid for the server (8-64 word chars) and unique', () => {
    const a = newBatchId();
    expect(a).toMatch(/^[\w-]{8,64}$/);
    expect(newBatchId()).not.toBe(a);
  });
  it('parse + add post the right bodies', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify(url.includes('parse') ? { rows: [], truncated: false } : { message: 'Added 1 item.', added: 1, merged: 0 }));
    }) as unknown as typeof fetch;
    await parseTranscript('milk', f);
    const r = await addRows([{ key: 'v1', text: 'milk', name: 'Milk', aisle: 'Dairy & eggs', value: 1, unit: 'pint' }], 'voice-abcdef12', f);
    expect(r.added).toBe(1);
    expect(calls[1]!.url).toBe('/api/shopping/scan/confirm');
    expect(calls[1]!.body).toMatchObject({ batchId: 'voice-abcdef12', destination: { kind: 'current' }, rows: [{ key: 'v1', name: 'Milk', value: 1, unit: 'pint' }] });
  });
});
