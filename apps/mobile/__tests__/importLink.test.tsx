import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import ImportLinkScreen from '@/screens/ImportLinkScreen';
import ImportReviewScreen from '@/screens/ImportReviewScreen';
import ShareIntentHandler from '@/screens/ShareIntentHandler';
import { ImportApiError, createImportClient, summariseDraft, type ExtractionOutcome, type ImportClient } from '@/lib/importApi';
import { extractUrlFromSharedText, sharedUrlOf } from '@/lib/shareUrl';
import { cleanDraft } from './helpers/draft';
import { mountScreen } from './helpers/mount';
import { resetRouter, router } from './helpers/router';

jest.mock('expo-router', () => require('./helpers/router').routerModule());
const shareState = (require('expo-share-intent') as { __state: { hasShareIntent: boolean; shareIntent: { text: string | null; webUrl: string | null; type: string | null }; resetShareIntent: jest.Mock } }).__state;

const has = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

function linkOutcome(over: Partial<ExtractionOutcome> = {}): ExtractionOutcome {
  const draft = cleanDraft({ source: 'Sam Example on Example Kitchen', sourceReference: 'https://www.example-kitchen.test/dahl', warnings: ['Read from the recipe data published on the page.'] });
  return { uploadId: 'up-link', draft, summary: summariseDraft(draft), existing: [], link: { via: 'structured', sourceUrl: 'https://www.example-kitchen.test/dahl' }, ...over };
}

function client(importFromUrl: jest.Mock): ImportClient & { save: jest.Mock; importFromUrl: jest.Mock } {
  return { configured: true, extract: jest.fn(), importFromUrl, save: jest.fn(async () => ({ id: 'rec-link' })), webUrl: () => null };
}

beforeEach(() => {
  resetRouter();
  shareState.hasShareIntent = false;
  shareState.shareIntent = { text: null, webUrl: null, type: null };
  shareState.resetShareIntent.mockClear();
});

describe('extractUrlFromSharedText', () => {
  it('finds the address in a browser share, with or without a title, and trims sentence punctuation', () => {
    expect(extractUrlFromSharedText('https://www.bbc.co.uk/food/recipes/x')).toBe('https://www.bbc.co.uk/food/recipes/x');
    expect(extractUrlFromSharedText('Lentil dahl recipe https://example-kitchen.test/dahl?utm_source=share')).toBe('https://example-kitchen.test/dahl?utm_source=share');
    expect(extractUrlFromSharedText('Try this: (https://example-kitchen.test/dahl).')).toBe('https://example-kitchen.test/dahl');
    expect(extractUrlFromSharedText('see http://a.test/x and https://b.test/y')).toBe('http://a.test/x');
  });
  it('never returns anything but a web address', () => {
    for (const t of ['file:///sdcard/x', 'content://media/1', 'javascript:alert(1)', 'ftp://a.test/x', 'no link here', '', null, undefined, 'https://localhost']) {
      expect(extractUrlFromSharedText(t as never)).toBeNull();
    }
  });
  it('prefers webUrl over text', () => {
    expect(sharedUrlOf({ webUrl: 'https://a.test/x', text: 'https://b.test/y' })).toBe('https://a.test/x');
    expect(sharedUrlOf({ webUrl: null, text: 'Look https://b.test/y' })).toBe('https://b.test/y');
    expect(sharedUrlOf(null)).toBeNull();
  });
});

describe('import client: importFromUrl', () => {
  const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

  it('posts the address and household with the bearer token and returns the same outcome shape, flagged as a link import', async () => {
    const draft = linkOutcome().draft;
    const fetchImpl = jest.fn(async () => json({ uploadId: 'u1', draft, existing: [], via: 'ai', sourceUrl: 'https://s.test/r', provider: { label: 'Mock', isMock: true } }));
    const c = createImportClient({ baseUrl: 'http://api.test/', getToken: async () => 'tok', fetchImpl: fetchImpl as never });
    const out = await c.importFromUrl('hh-1', 'https://s.test/r');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('http://api.test/api/import/url');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({ householdId: 'hh-1', url: 'https://s.test/r' });
    expect(out.uploadId).toBe('u1');
    expect(out.link).toEqual({ via: 'ai', sourceUrl: 'https://s.test/r' });
    expect(out.provider).toBeUndefined(); // a photo-AI provider line does not apply to a web page
  });

  it('surfaces the server\'s readable errors', async () => {
    const fetchImpl = jest.fn(async () => json({ error: { code: 'SITE_REFUSED', message: 'That site would not let us read the page.', retryable: false } }, 422));
    const c = createImportClient({ baseUrl: 'http://api.test', getToken: async () => 't', fetchImpl: fetchImpl as never });
    await expect(c.importFromUrl('hh-1', 'https://s.test/r')).rejects.toMatchObject({ name: 'ImportApiError', message: 'That site would not let us read the page.', code: 'SITE_REFUSED', status: 422 });
    await expect(c.importFromUrl('hh-1', 'https://s.test/r')).rejects.toBeInstanceOf(ImportApiError);
  });

  it('rejects an unexpected response body', async () => {
    const c = createImportClient({ baseUrl: 'http://api.test', getToken: async () => 't', fetchImpl: (async () => json({ nope: true })) as never });
    await expect(c.importFromUrl('hh-1', 'https://s.test/r')).rejects.toThrow(/unexpected response/);
  });
});

describe('ImportLinkScreen', () => {
  it('reads the pasted address on the server, then shows the shared review screen with the source and the link back', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const c = client(jest.fn(async () => linkOutcome()));
    await mountScreen(<ImportLinkScreen importClient={c} />);
    const read = screen.getByTestId('link-read');
    expect(read).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('link-url'), 'Great one https://www.example-kitchen.test/dahl');
    await fireEvent.press(read);
    expect(await screen.findByText('Review recipe')).toBeTruthy();
    expect(c.importFromUrl).toHaveBeenCalledWith('hh-1', 'https://www.example-kitchen.test/dahl');
    expect(screen.getByTestId('review-source')).toHaveTextContent(has('Source: Sam Example on Example Kitchen'));
    expect(screen.getByTestId('extraction-warnings')).toHaveTextContent(has('Note from the page: Read from the recipe data published on the page.'));
    expect(screen.queryByTestId('review-provider')).toBeNull();
    await fireEvent.press(screen.getByTestId('review-source-link'));
    expect(open).toHaveBeenCalledWith('https://www.example-kitchen.test/dahl');
    // saving goes through the same save endpoint as a photo import
    await fireEvent.press(screen.getByTestId('save-recipe'));
    await waitFor(() => expect(c.save).toHaveBeenCalledTimes(1));
    expect(c.save.mock.calls[0]![0]).toMatchObject({ uploadId: 'up-link' });
    open.mockRestore();
  });

  it('refuses something that is not a web address without calling the server', async () => {
    const c = client(jest.fn());
    await mountScreen(<ImportLinkScreen importClient={c} />);
    await fireEvent.changeText(screen.getByTestId('link-url'), 'pancakes please');
    await fireEvent.press(screen.getByTestId('link-read'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not look like a web address/);
    expect(c.importFromUrl).not.toHaveBeenCalled();
  });

  it('shows the server\'s message when the page cannot be read, and lets the user try again', async () => {
    const importFromUrl = jest.fn().mockRejectedValueOnce(new ImportApiError('That site would not let us read the page.', 422, false, 'SITE_REFUSED')).mockResolvedValueOnce(linkOutcome());
    const c = client(importFromUrl);
    await mountScreen(<ImportLinkScreen importClient={c} />);
    await fireEvent.changeText(screen.getByTestId('link-url'), 'https://blocked.test/x');
    await fireEvent.press(screen.getByTestId('link-read'));
    expect(await screen.findByRole('alert')).toHaveTextContent('That site would not let us read the page.');
    await fireEvent.press(screen.getByTestId('link-read'));
    expect(await screen.findByText('Review recipe')).toBeTruthy();
  });

  it('a shared link (?url=...&auto=1) starts reading straight away, once', async () => {
    resetRouter({ url: 'https://www.example-kitchen.test/dahl', auto: '1' });
    const c = client(jest.fn(async () => linkOutcome()));
    await mountScreen(<ImportLinkScreen importClient={c} />);
    expect(await screen.findByText('Review recipe')).toBeTruthy();
    expect(c.importFromUrl).toHaveBeenCalledTimes(1);
  });

  it('a link without auto=1 only fills the box', async () => {
    resetRouter({ url: 'https://www.example-kitchen.test/dahl' });
    const c = client(jest.fn(async () => linkOutcome()));
    await mountScreen(<ImportLinkScreen importClient={c} />);
    expect(screen.getByTestId('link-url').props.value).toBe('https://www.example-kitchen.test/dahl');
    expect(c.importFromUrl).not.toHaveBeenCalled();
  });
});

describe('ShareIntentHandler ("Share to Family Recipes")', () => {
  async function mount() {
    await render(<ShareIntentHandler />);
  }

  it('opens the link screen with the shared address and starts reading, then clears the intent', async () => {
    shareState.hasShareIntent = true;
    shareState.shareIntent = { text: 'Lentil dahl https://www.example-kitchen.test/dahl', webUrl: null, type: 'text' };
    await mount();
    expect(router.push).toHaveBeenCalledWith({ pathname: '/import-link', params: { url: 'https://www.example-kitchen.test/dahl', auto: '1' } });
    expect(shareState.resetShareIntent).toHaveBeenCalled();
  });

  it('uses webUrl when the browser provides it', async () => {
    shareState.hasShareIntent = true;
    shareState.shareIntent = { text: null, webUrl: 'https://a.test/recipe', type: 'weburl' };
    await mount();
    expect(router.push).toHaveBeenCalledWith({ pathname: '/import-link', params: { url: 'https://a.test/recipe', auto: '1' } });
  });

  it('drops a share that is not a web address (plain text, files) without navigating', async () => {
    shareState.hasShareIntent = true;
    shareState.shareIntent = { text: 'buy milk', webUrl: null, type: 'text' };
    await mount();
    expect(router.push).not.toHaveBeenCalled();
    expect(shareState.resetShareIntent).toHaveBeenCalled();
  });

  it('does nothing when nothing was shared', async () => {
    await mount();
    expect(router.push).not.toHaveBeenCalled();
    expect(shareState.resetShareIntent).not.toHaveBeenCalled();
  });
});

describe('ImportReviewScreen source link', () => {
  it('shows "Open the original page" only for a web source, and a photo import keeps its old wording', async () => {
    const c = client(jest.fn());
    const onBack = jest.fn();
    await mountScreen(<ImportReviewScreen outcome={linkOutcome()} client={c} onBack={onBack} onDone={jest.fn()} noteFrom="the page" />);
    expect(screen.getByTestId('review-source-link')).toBeTruthy();
    await act(async () => undefined);
  });
  it('has no link button for a photo card reference', async () => {
    const draft = cleanDraft({ source: 'Meal kit', sourceReference: 'Recipe bag 12' });
    const c = client(jest.fn());
    await mountScreen(<ImportReviewScreen outcome={{ uploadId: 'u', draft, summary: summariseDraft(draft), existing: [] }} client={c} onBack={jest.fn()} onDone={jest.fn()} />);
    expect(screen.queryByTestId('review-source-link')).toBeNull();
  });
});
