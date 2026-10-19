import sharp from 'sharp';
import fx from '../fixtures/recipe-extraction.json' with { type: 'json' };

export async function jpeg(w = 400, h = 300): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: '#88aa44' } }).jpeg().toBuffer());
}

export function toolUse(name: string, input: unknown, usage = { input_tokens: 100, output_tokens: 50 }) {
  return { content: [{ type: 'tool_use', id: 'tu_1', name, input }], usage, stop_reason: 'tool_use' };
}

export const goodRecipe = () => structuredClone(fx);

/** Fake client: each queued item is a response or an Error to throw. */
export function fakeClient(queue: Array<unknown>) {
  const calls: any[] = [];
  return {
    calls,
    messages: {
      async create(params: any) {
        calls.push(structuredClone(params));
        const next = queue.shift();
        if (next === undefined) throw new Error('fake client queue empty');
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

export const httpErr = (status: number) => Object.assign(new Error(`http ${status}`), { status });
