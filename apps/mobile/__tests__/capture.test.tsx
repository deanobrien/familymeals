import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import CaptureScreen from '@/screens/CaptureScreen';
import { summariseDraft, type ExtractionOutcome, type ImportClient } from '@/lib/importApi';

import { resetRouter, router } from './helpers/router';
import { makeDraft } from './helpers/draft';

jest.mock('expo-router', () => require('./helpers/router').routerModule());
jest.mock('expo-camera', () => ({ CameraView: () => null, useCameraPermissions: () => [{ granted: true }, jest.fn()] }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));

function SetHousehold({ children }: { children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId('hh-1'), [setHouseholdId]);
  return householdId ? <>{children}</> : null;
}

/** blocking = the milk line has no usable quantity (a blocking issue); otherwise it is a clean 100 ml. */
const draftWith = (blocking: boolean) => {
  const d = makeDraft();
  if (!blocking) {
    d.ingredients[1]!.quantity = { value: { kind: 'exact', value: 100, unit: 'ml', originalText: '100ml' } as never, status: 'ok', warnings: [] };
    d.issues = [];
  }
  return d;
};

function fakeClient(blocking: boolean) {
  const outcome = (): ExtractionOutcome => ({
    uploadId: 'up-1',
    draft: draftWith(blocking),
    summary: summariseDraft(draftWith(blocking)),
    existing: [{ id: 'r9', title: 'Pancakes', ingredientNames: ['flour', 'milk'] }],
  });
  const client: ImportClient & { extract: jest.Mock; save: jest.Mock } = {
    configured: true,
    extract: jest.fn(async () => outcome()),
    importFromUrl: jest.fn(async () => outcome()),
    save: jest.fn(async () => ({ id: 'rec-1' })),
    webUrl: (p: string) => `http://web.test${p}`,
  };
  return client;
}

async function mount(client: ImportClient) {
  const rotator = jest.fn(async (i: { uri: string; width: number; height: number }) => ({ uri: `${i.uri}.r`, width: i.height, height: i.width }));
  const resizer = jest.fn(async (i: { uri: string; width: number; height: number }) => i);
  await render(
    <AppProvider dataSource={new MockDataSource()}>
      <SetHousehold>
        <CaptureScreen importClient={client} rotator={rotator} resizer={resizer} />
      </SetHousehold>
    </AppProvider>,
  );
  return { rotator, resizer };
}

beforeEach(() => {
  resetRouter();
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [
      { uri: 'file:///a.jpg', width: 3000, height: 2000 },
      { uri: 'file:///b.jpg', width: 3000, height: 2000 },
      { uri: 'file:///c.jpg', width: 3000, height: 2000 },
    ],
  });
});

describe('CaptureScreen import flow', () => {
  it('picks pages, rotates, removes, uploads in order and shows the review summary', async () => {
    const client = fakeClient(false);
    const { rotator, resizer } = await mount(client);
    await fireEvent.press(await screen.findByTestId('pick-image'));
    expect(await screen.findByTestId('image-count')).toHaveTextContent('3 image(s) ready');

    await fireEvent.press(screen.getByTestId('rotate-1'));
    await waitFor(() => expect(rotator).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByTestId('remove-3'));
    expect(screen.getByTestId('image-count')).toHaveTextContent('2 image(s) ready');

    await fireEvent.press(screen.getByTestId('send-extraction'));
    expect(await screen.findByDisplayValue('Pancakes')).toBeTruthy();
    expect(client.extract).toHaveBeenCalledTimes(1);
    const [household, uploaded] = client.extract.mock.calls[0] as [string, Array<{ uri: string; name: string }>];
    expect(household).toBe('hh-1');
    expect(uploaded.map((u) => [u.name, u.uri])).toEqual([
      ['page-1.jpg', 'file:///a.jpg.r'], // rotated copy
      ['page-2.jpg', 'file:///b.jpg'],
    ]);
    expect(resizer).toHaveBeenCalledTimes(2);

    expect(screen.getByTestId('duplicate-warning')).toHaveTextContent(/Pancakes/);
    expect(screen.getByText(/from photo: .*200g flour/)).toBeTruthy();
    expect(screen.getByLabelText('Ingredient 1 quantity: Low confidence')).toBeTruthy(); // low-confidence quantity flagged
    expect(screen.getByTestId('cover-picker')).toBeTruthy(); // two captured pages -> cover choice

    await fireEvent.press(screen.getByTestId('save-recipe'));
    expect(await screen.findByTestId('saved-title')).toHaveTextContent('Pancakes');
    expect(client.save).toHaveBeenCalledWith(expect.objectContaining({ uploadId: 'up-1' }));

    await fireEvent.press(screen.getByTestId('open-recipe'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/recipe/[id]', params: { id: 'rec-1' } });

    await fireEvent.press(screen.getByTestId('capture-another'));
    expect(await screen.findByTestId('image-count')).toHaveTextContent('0 image(s) ready');
  });

  it('blocks saving while the draft has blocking issues and lets the cook fix them on the phone', async () => {
    const client = fakeClient(true);
    await mount(client);
    await fireEvent.press(await screen.findByTestId('pick-image'));
    await fireEvent.press(await screen.findByTestId('send-extraction'));
    expect(await screen.findByTestId('blocking-issues')).toHaveTextContent(/no usable quantity/);
    expect(screen.getByTestId('save-recipe')).toBeDisabled();
    // Fix it here instead of on the web: make the milk line "To taste".
    await fireEvent.press(screen.getByTestId('ing-kind-2-to_taste'));
    await waitFor(() => expect(screen.getByTestId('save-recipe')).not.toBeDisabled());
    expect(screen.queryByTestId('blocking-issues')).toBeNull();
    await fireEvent.press(screen.getByTestId('save-recipe'));
    await screen.findByTestId('saved-title');
    const saved = client.save.mock.calls[0]![0] as { draft: { ingredients: Array<{ quantity: { value: { kind: string } } }> } };
    expect(saved.draft.ingredients[1]!.quantity.value.kind).toBe('to_taste');
  });

  it('shows the upload error and keeps the photos so the user can retry', async () => {
    const client = fakeClient(false);
    client.extract.mockRejectedValueOnce(new Error('Could not reach the server.'));
    await mount(client);
    await fireEvent.press(await screen.findByTestId('pick-image'));
    await fireEvent.press(await screen.findByTestId('send-extraction'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.');
    expect(screen.getByTestId('image-count')).toHaveTextContent('3 image(s) ready');
  });

  it('caps the batch at 6 pages', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: Array.from({ length: 8 }, (_, i) => ({ uri: `file:///${i}.jpg`, width: 10, height: 10 })),
    });
    await mount(fakeClient(false));
    await fireEvent.press(await screen.findByTestId('pick-image'));
    expect(await screen.findByTestId('image-count')).toHaveTextContent('6 image(s) ready');
  });
});
