import { ImportApiError, createImportClient, summariseDraft } from '@/lib/importApi';
import type { UploadImage } from '@/lib/extraction';

jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));

const images: UploadImage[] = [
  { uri: 'file:///1.jpg', width: 10, height: 10, name: 'page-1.jpg', mimeType: 'image/jpeg' },
  { uri: 'file:///2.jpg', width: 10, height: 10, name: 'page-2.jpg', mimeType: 'image/jpeg' },
];

const draft = {
  title: { value: 'Pancakes', status: 'ok' },
  servings: { value: 4, status: 'ok' },
  ingredients: [
    { originalText: '200g flour', name: { value: 'flour', status: 'ok' }, quantity: { status: 'ok' } },
    { originalText: 'some milk', name: { value: 'milk', status: 'ok' }, quantity: { status: 'unparsed' } },
  ],
  steps: [{ text: 'Whisk.' }, { text: 'Fry.' }],
  issues: [{ message: 'Servings missing', blocking: true }, { message: 'Check milk', blocking: false }],
  warnings: ['Page 2 was blurry'],
};

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

describe('summariseDraft', () => {
  it('summarises a draft read-only and flags lines to check', () => {
    expect(summariseDraft(draft)).toEqual({
      title: 'Pancakes',
      servings: 4,
      ingredients: [
        { text: '200g flour', needsCheck: false },
        { text: 'some milk', needsCheck: true },
      ],
      steps: ['Whisk.', 'Fry.'],
      issues: [
        { message: 'Servings missing', blocking: true },
        { message: 'Check milk', blocking: false },
      ],
      warnings: ['Page 2 was blurry'],
    });
  });
  it('tolerates a malformed draft', () => {
    expect(summariseDraft(null)).toMatchObject({ title: 'Untitled recipe', ingredients: [], steps: [] });
    expect(summariseDraft({ ingredients: [{}] }).ingredients[0]?.text).toBe('(unreadable line)');
  });
});

describe('import client', () => {
  it('posts multipart images with the bearer token and returns the draft', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({ uploadId: 'up-1', draft, existing: [{ id: 'r1', title: 'Pancakes (old)' }] }));
    const client = createImportClient({ baseUrl: 'http://web.test/', getToken: async () => 'tok', fetchImpl });
    const out = await client.extract('hh-1', images);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('http://web.test/api/extract');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Content-Type']).toBeUndefined(); // RN sets the multipart boundary
    expect(init.body).toBeInstanceOf(FormData);
    expect(out).toMatchObject({ uploadId: 'up-1', existing: [{ id: 'r1' }], summary: { title: 'Pancakes' } });
    expect(client.webUrl('/recipes/import')).toBe('http://web.test/recipes/import');
  });

  it('saves the opaque draft back unchanged', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({ id: 'rec-9' }));
    const client = createImportClient({ baseUrl: 'http://web.test', getToken: async () => 'tok', fetchImpl });
    await expect(client.save({ uploadId: 'up-1', draft, summary: summariseDraft(draft), existing: [] })).resolves.toEqual({ id: 'rec-9' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://web.test/api/extract/save');
    expect(JSON.parse(init.body as string)).toEqual({ uploadId: 'up-1', draft });
  });

  it('maps server and network failures to friendly errors', async () => {
    const mk = (fetchImpl: typeof fetch) => createImportClient({ baseUrl: 'http://web.test', getToken: async () => null, fetchImpl });
    await expect(mk(jest.fn().mockResolvedValue(json({ error: { message: 'Add at least one photo.', retryable: false } }, 400))).extract('h', images))
      .rejects.toMatchObject({ message: 'Add at least one photo.', status: 400, retryable: false });
    await expect(mk(jest.fn().mockResolvedValue(json({}, 401))).extract('h', images)).rejects.toThrow(/Finish this recipe on the web/);
    await expect(mk(jest.fn().mockRejectedValue(new Error('boom'))).extract('h', images)).rejects.toMatchObject({ status: 0, retryable: true });
    await expect(mk(jest.fn().mockResolvedValue(json({ nope: 1 }))).extract('h', images)).rejects.toBeInstanceOf(ImportApiError);
  });

  it('reports when no API base URL is configured', async () => {
    const client = createImportClient({ baseUrl: '', getToken: async () => null });
    expect(client.configured).toBe(false);
    expect(client.webUrl('/x')).toBeNull();
    await expect(client.extract('h', images)).rejects.toThrow(/not set up/);
  });
});
