import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import CaptureScreen from '@/screens/CaptureScreen';
import { summariseDraft, type ExtractionOutcome, type ImportClient } from '@/lib/importApi';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('expo-camera', () => ({ CameraView: () => null, useCameraPermissions: () => [{ granted: true }, jest.fn()] }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));

function SetHousehold({ children }: { children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId('hh-1'), [setHouseholdId]);
  return householdId ? <>{children}</> : null;
}

const draftWith = (blocking: boolean) => ({
  title: { value: 'Pancakes', status: 'ok' },
  servings: { value: 4, status: 'ok' },
  ingredients: [{ originalText: '200g flour', name: { value: 'flour', status: 'ok' }, quantity: { status: 'low_confidence' } }],
  steps: [{ text: 'Whisk and fry.' }],
  issues: blocking ? [{ message: 'Servings missing', blocking: true }] : [],
  warnings: [],
});

function fakeClient(blocking: boolean) {
  const outcome = (): ExtractionOutcome => ({
    uploadId: 'up-1',
    draft: draftWith(blocking),
    summary: summariseDraft(draftWith(blocking)),
    existing: [{ id: 'r9', title: 'Old pancakes' }],
  });
  const client: ImportClient & { extract: jest.Mock; save: jest.Mock } = {
    configured: true,
    extract: jest.fn(async () => outcome()),
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
    expect(await screen.findByTestId('review-title')).toHaveTextContent('Pancakes');
    expect(client.extract).toHaveBeenCalledTimes(1);
    const [household, uploaded] = client.extract.mock.calls[0] as [string, Array<{ uri: string; name: string }>];
    expect(household).toBe('hh-1');
    expect(uploaded.map((u) => [u.name, u.uri])).toEqual([
      ['page-1.jpg', 'file:///a.jpg.r'], // rotated copy
      ['page-2.jpg', 'file:///b.jpg'],
    ]);
    expect(resizer).toHaveBeenCalledTimes(2);

    expect(screen.getByTestId('duplicate-warning')).toHaveTextContent(/Old pancakes/);
    expect(screen.getByText('200g flour')).toBeTruthy();
    expect(screen.getByText('Check')).toBeTruthy(); // low-confidence quantity flagged

    await fireEvent.press(screen.getByTestId('save-recipe'));
    expect(await screen.findByTestId('saved-title')).toHaveTextContent('Pancakes');
    expect(client.save).toHaveBeenCalledWith(expect.objectContaining({ uploadId: 'up-1' }));

    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await fireEvent.press(screen.getByTestId('open-web'));
    expect(open).toHaveBeenCalledWith('http://web.test/recipes/rec-1');

    await fireEvent.press(screen.getByTestId('capture-another'));
    expect(await screen.findByTestId('image-count')).toHaveTextContent('0 image(s) ready');
  });

  it('blocks saving when the draft has blocking issues and offers "finish on web"', async () => {
    await mount(fakeClient(true));
    await fireEvent.press(await screen.findByTestId('pick-image'));
    await fireEvent.press(await screen.findByTestId('send-extraction'));
    expect(await screen.findByTestId('blocking-issues')).toHaveTextContent(/Servings missing/);
    expect(screen.getByTestId('save-recipe')).toBeDisabled();
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await fireEvent.press(screen.getByTestId('finish-on-web'));
    expect(open).toHaveBeenCalledWith('http://web.test/recipes/import');
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
