import React from 'react';
import { Alert, Linking } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { loadDevicePrefs } from '@/lib/devicePrefs';
import { ExportError, type ExportClient } from '@/lib/exportApi';
import type { ExportDeps } from '@/lib/exportDownload';
import { CONSENT_WORDING_V1 } from '@/lib/privacyText';
import DeleteAccountScreen from '@/screens/DeleteAccountScreen';
import SettingsScreen from '@/screens/SettingsScreen';
import YourDataScreen from '@/screens/YourDataScreen';

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: mockBack }),
  useLocalSearchParams: () => ({}),
}));
jest.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: 'cache' } }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

let activeHousehold: string | null = null;
function SetHousehold({ id, children }: { id: string | null; children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  activeHousehold = householdId;
  React.useEffect(() => setHouseholdId(id), [id, setHouseholdId]);
  return id === null || householdId ? <>{children}</> : null;
}

async function mount(ds: MockDataSource, ui: React.ReactElement, household: string | null = 'hh-1') {
  return render(
    <AppProvider dataSource={ds}>
      <SetHousehold id={household}>{ui}</SetHousehold>
    </AppProvider>,
  );
}

const confirmAlert = () =>
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.style === 'destructive')?.onPress?.();
  });

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  mockBack.mockClear();
  activeHousehold = null;
  jest.restoreAllMocks();
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://web.test';
});
afterAll(() => {
  delete process.env.EXPO_PUBLIC_API_BASE_URL;
});

describe('SettingsScreen', () => {
  it('shows account, household, preferences, allergies with the web consent wording, the AI note and the data rows', async () => {
    const ds = new MockDataSource();
    await ds.signIn('dean@example.com', 'secret1');
    await mount(ds, <SettingsScreen />);
    expect(await screen.findByTestId('account-email')).toHaveTextContent(/dean@example.com/);
    expect(await screen.findByTestId('open-household')).toBeTruthy();
    expect(screen.getByTestId('consent-wording')).toHaveTextContent(CONSENT_WORDING_V1);
    expect(screen.getByTestId('ai-note')).toHaveTextContent(/Manage AI provider on the website\./);
    expect(screen.getByTestId('open-your-data')).toBeTruthy();
    expect(screen.getByTestId('open-delete-account')).toBeTruthy();
  });

  it('account deletion is two taps from anywhere: the Settings tab, then "Delete my account"', async () => {
    await mount(new MockDataSource(), <SettingsScreen />);
    await fireEvent.press(await screen.findByTestId('open-delete-account'));
    expect(mockPush).toHaveBeenCalledWith('/delete-account');
    await fireEvent.press(screen.getByTestId('open-your-data'));
    expect(mockPush).toHaveBeenCalledWith('/your-data');
    await fireEvent.press(screen.getByTestId('open-household'));
    expect(mockPush).toHaveBeenCalledWith('/household');
  });

  it('privacy and sources open the web pages; AI provider stays on the website', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    await mount(new MockDataSource(), <SettingsScreen />);
    await fireEvent.press(await screen.findByTestId('open-privacy'));
    expect(open).toHaveBeenLastCalledWith('https://web.test/privacy');
    await fireEvent.press(screen.getByTestId('open-sources'));
    expect(open).toHaveBeenLastCalledWith('https://web.test/about/sources');
    await fireEvent.press(screen.getByTestId('open-web-settings'));
    expect(open).toHaveBeenLastCalledWith('https://web.test/settings');
  });

  it('signs out and returns to the sign-in screen', async () => {
    const ds = new MockDataSource();
    await ds.signIn('dean@example.com', 'secret1');
    await mount(ds, <SettingsScreen />);
    await fireEvent.press(await screen.findByTestId('sign-out'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/sign-in'));
    expect(await ds.getSession()).toBeNull();
    await waitFor(() => expect(activeHousehold).toBeNull());
  });

  it('an owner saves household preferences; bad values are caught first; units stay on the device', async () => {
    const ds = new MockDataSource();
    await mount(ds, <SettingsScreen />);
    await fireEvent.changeText(await screen.findByTestId('pref-servings'), '30');
    await fireEvent.press(screen.getByTestId('pref-save'));
    expect(await screen.findByText('Servings must be between 1 and 24')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('pref-servings'), '5');
    await fireEvent.changeText(screen.getByTestId('pref-budget'), '99.5');
    await fireEvent.press(screen.getByTestId('pref-units-imperial'));
    await fireEvent.press(screen.getByTestId('pref-save'));
    expect(await screen.findByTestId('prefs-saved')).toHaveTextContent(/Preferences saved/);
    expect(await ds.account.getSettings('hh-1')).toMatchObject({ defaultServings: 5, weeklyBudgetPence: 9950 });
    expect((await loadDevicePrefs()).units).toBe('imperial');
  });

  it('a plain member cannot change household preferences (locked, with the reason)', async () => {
    await mount(new MockDataSource(), <SettingsScreen />, 'hh-2');
    expect(await screen.findByText('Only an owner can change household preferences.')).toBeTruthy();
    expect(screen.getByTestId('pref-servings').props.editable).toBe(false);
  });

  describe('allergies and consent', () => {
    it('will not save an exclusion until the consent box is ticked, then saves and keeps consent', async () => {
      const ds = new MockDataSource();
      await mount(ds, <SettingsScreen />);
      await fireEvent.press(await screen.findByTestId('excl-peanuts'));
      await fireEvent.press(screen.getByTestId('dietary-save'));
      expect(await screen.findByText('Please tick the box to agree before saving dietary information')).toBeTruthy();
      expect((await ds.account.getSettings('hh-1')).exclusions).toEqual([]);
      await fireEvent.press(screen.getByTestId('consent-checkbox'));
      await fireEvent.press(screen.getByTestId('dietary-save'));
      expect(await screen.findByTestId('dietary-notice')).toHaveTextContent(/Dietary information saved/);
      expect(await ds.account.getSettings('hh-1')).toMatchObject({ exclusions: [{ term: 'peanuts' }], consentActive: true });
    });

    it('adds a free-text exclusion (validated) and shows it ticked', async () => {
      await mount(new MockDataSource(), <SettingsScreen />);
      await fireEvent.changeText(await screen.findByTestId('excl-custom'), 'kiwi2');
      await fireEvent.press(screen.getByTestId('excl-add'));
      expect(await screen.findByText('Use letters only')).toBeTruthy();
      await fireEvent.changeText(screen.getByTestId('excl-custom'), 'Kiwi');
      await fireEvent.press(screen.getByTestId('excl-add'));
      expect(await screen.findByTestId('excl-kiwi')).toBeTruthy();
    });

    it('removing everything asks first, deletes the exclusions and withdraws consent', async () => {
      const ds = new MockDataSource();
      await ds.account.saveExclusions('hh-1', ['milk', 'fish'], true);
      await mount(ds, <SettingsScreen />);
      await waitFor(() => expect(screen.getByTestId('excl-milk').props.accessibilityState.checked).toBe(true));
      expect(screen.getByTestId('consent-checkbox').props.accessibilityState.checked).toBe(true);
      const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        buttons?.find((b) => b.style === 'cancel')?.onPress?.();
      });
      await fireEvent.press(screen.getByTestId('dietary-remove'));
      expect(alert).toHaveBeenCalled();
      expect((await ds.account.getSettings('hh-1')).exclusions).toHaveLength(2);
      confirmAlert();
      await fireEvent.press(screen.getByTestId('dietary-remove'));
      expect(await screen.findByTestId('dietary-notice')).toHaveTextContent(/All dietary information removed/);
      expect(await ds.account.getSettings('hh-1')).toMatchObject({ exclusions: [], consentActive: false });
    });

    it('says how many allergy exclusions are not applied for lack of consent (a count, never names)', async () => {
      const ds = new MockDataSource();
      const real = await ds.account.getSettings('hh-1');
      jest.spyOn(ds.account, 'getSettings').mockResolvedValue({ ...real, withheldExclusions: 2 });
      await mount(ds, <SettingsScreen />);
      expect(await screen.findByTestId('consent-notice')).toHaveTextContent(/2 allergy exclusions aren't being applied because consent hasn't been given/);
    });
  });
});

describe('YourDataScreen: export', () => {
  function exportKit(over: Partial<ExportClient> = {}) {
    const client: ExportClient & { start: jest.Mock } = {
      configured: true,
      start: jest.fn(async () => ({ id: 'e1', downloadUrl: 'https://web.test/api/export/e1', expiresAt: '2026-10-20T13:00:00Z' })),
      ...over,
    } as never;
    const deps: ExportDeps & { del: jest.Mock; download: jest.Mock } = {
      isShareAvailable: jest.fn(async () => true),
      download: jest.fn(async () => ({ uri: 'file:///c/x.zip', delete: deps.del })),
      share: jest.fn(async () => undefined),
      del: jest.fn(),
    };
    return { client, deps };
  }
  async function signedIn() {
    const ds = new MockDataSource();
    await ds.signIn('dean@example.com', 'secret1');
    return ds;
  }

  it('exports my data: asks the server, downloads with the Bearer token, opens the share sheet, removes the cached copy', async () => {
    const { client, deps } = exportKit();
    await mount(await signedIn(), <YourDataScreen exportClient={client} exportDeps={deps} />);
    await fireEvent.press(await screen.findByTestId('export-member'));
    expect(await screen.findByTestId('export-done')).toBeTruthy();
    expect(client.start).toHaveBeenCalledWith('member', 'hh-1');
    expect(deps.download).toHaveBeenCalledWith('https://web.test/api/export/e1', expect.stringMatching(/^family-recipes-export-\d{8}\.zip$/), { Authorization: 'Bearer mock-access-token' });
    expect(deps.share).toHaveBeenCalledWith('file:///c/x.zip');
    expect(deps.del).toHaveBeenCalled();
  });

  it('only owners get the whole-household export', async () => {
    const { client, deps } = exportKit();
    const view = await mount(await signedIn(), <YourDataScreen exportClient={client} exportDeps={deps} />);
    await fireEvent.press(await screen.findByTestId('export-household'));
    await waitFor(() => expect(client.start).toHaveBeenCalledWith('household', 'hh-1'));
    view.unmount();
    await mount(await signedIn(), <YourDataScreen exportClient={client} exportDeps={deps} />, 'hh-2');
    await screen.findByTestId('export-member');
    expect(screen.queryByTestId('export-household')).toBeNull();
  });

  it('explains the 24-hour limit with the retry time', async () => {
    const { client, deps } = exportKit({ start: jest.fn(async () => { throw new ExportError('rate_limited', 'x', '2026-10-21T10:00:00Z'); }) });
    await mount(await signedIn(), <YourDataScreen exportClient={client} exportDeps={deps} />);
    await fireEvent.press(await screen.findByTestId('export-member'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/one export every 24 hours.*21 October 2026/);
    expect(deps.download).not.toHaveBeenCalled();
  });

  it('a failed download is reported and nothing is shared', async () => {
    const { client, deps } = exportKit();
    deps.download.mockRejectedValue(new Error('boom'));
    await mount(await signedIn(), <YourDataScreen exportClient={client} exportDeps={deps} />);
    await fireEvent.press(await screen.findByTestId('export-member'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/download did not finish/);
    expect(deps.share).not.toHaveBeenCalled();
  });

  it('a build without a website address cannot export and says why', async () => {
    const { client, deps } = exportKit({ configured: false });
    await mount(await signedIn(), <YourDataScreen exportClient={client} exportDeps={deps} />);
    expect(await screen.findByText(/Export needs the website address/)).toBeTruthy();
    expect(screen.getByTestId('export-member').props.accessibilityState.disabled).toBe(true);
  });
});

describe('YourDataScreen: household and account deletion', () => {
  const kit = () => ({ exportClient: { configured: true, start: jest.fn() } as ExportClient });

  it('household deletion needs the typed name and the password, then shows the 14-day countdown and read-only banner', async () => {
    const ds = new MockDataSource();
    await mount(ds, <YourDataScreen {...kit()} />);
    await fireEvent.press(await screen.findByTestId('delete-household-open'));
    await fireEvent.changeText(screen.getByTestId('delete-household-name'), 'The Smith');
    await fireEvent.changeText(screen.getByTestId('delete-household-password'), 'secret1');
    await fireEvent.press(screen.getByTestId('delete-household-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/The confirmation text did not match\. Nothing was deleted\./);
    await fireEvent.changeText(screen.getByTestId('delete-household-name'), 'The Smiths');
    await fireEvent.changeText(screen.getByTestId('delete-household-password'), 'wrong-password');
    await fireEvent.press(screen.getByTestId('delete-household-submit'));
    expect(await screen.findByText('That password was not correct. Nothing was deleted.')).toBeTruthy();
    expect((await ds.account.listMemberships())[0]!.status).toBe('active');
    await fireEvent.changeText(screen.getByTestId('delete-household-password'), 'secret1');
    await fireEvent.press(screen.getByTestId('delete-household-submit'));
    expect(await screen.findByTestId('data-notice')).toHaveTextContent(/Household deletion scheduled\. You have 14 days to cancel\./);
    expect(await screen.findByTestId('household-deletion-pending')).toBeTruthy();
    expect(screen.getByTestId('grace-days')).toHaveTextContent('14');
    expect(screen.getByTestId('read-only-banner')).toBeTruthy();
  });

  it('the owner cancels the deletion with one tap and no password', async () => {
    const ds = new MockDataSource();
    await ds.account.requestHouseholdDeletion('hh-1', 'The Smiths', 'secret1');
    await mount(ds, <YourDataScreen {...kit()} />);
    await fireEvent.press(await screen.findByTestId('cancel-household-deletion'));
    expect(await screen.findByTestId('data-notice')).toHaveTextContent(/Household deletion cancelled\. The household is active again\./);
    expect((await ds.account.listMemberships())[0]).toMatchObject({ status: 'active', purgeAfter: null });
  });

  it('a plain member cannot delete the household', async () => {
    await mount(new MockDataSource(), <YourDataScreen {...kit()} />, 'hh-2');
    expect(await screen.findByText(/Only an owner can delete the household/)).toBeTruthy();
    expect(screen.queryByTestId('delete-household-open')).toBeNull();
  });

  it('the only owner of a shared household must hand over before deleting the account', async () => {
    await mount(new MockDataSource(), <YourDataScreen {...kit()} />);
    expect(await screen.findByTestId('account-deletion-blocked')).toHaveTextContent(/only owner of The Smiths/);
    expect(screen.queryByTestId('go-delete-account')).toBeNull();
  });

  it('otherwise "Delete my account" leads to the confirmation screen', async () => {
    await mount(new MockDataSource(), <YourDataScreen {...kit()} />, 'hh-2');
    await fireEvent.press(await screen.findByTestId('go-delete-account'));
    expect(mockPush).toHaveBeenCalledWith('/delete-account');
  });

  it('shows a pending account deletion with a cancel button', async () => {
    const ds = new MockDataSource();
    await ds.account.createHousehold({ name: 'Solo', defaultServings: 2, weeklyBudgetPence: null });
    await ds.account.requestAccountDeletion('DELETE', 'secret1');
    await mount(ds, <YourDataScreen {...kit()} />, 'hh-2');
    expect(await screen.findByTestId('account-deletion-pending')).toHaveTextContent(/Your account will be deleted on/);
    await fireEvent.press(screen.getByTestId('cancel-account-deletion'));
    expect(await screen.findByTestId('data-notice')).toHaveTextContent(/Account deletion cancelled\./);
    expect((await ds.account.getLifecycle('hh-2')).accountDeletionAt).toBeNull();
  });
});

describe('DeleteAccountScreen', () => {
  async function fill(confirm: string, password: string) {
    await fireEvent.changeText(await screen.findByTestId('delete-account-confirm'), confirm);
    await fireEvent.changeText(screen.getByTestId('delete-account-password'), password);
    await fireEvent.press(screen.getByTestId('delete-account-submit'));
  }

  it('needs DELETE typed and the current password; nothing is scheduled by a failed attempt', async () => {
    const ds = new MockDataSource();
    await mount(ds, <DeleteAccountScreen />, 'hh-2');
    await fill('delete me', 'secret1');
    expect(await screen.findByRole('alert')).toHaveTextContent(/The confirmation text did not match/);
    await fill('DELETE', 'nope');
    expect(await screen.findByText('That password was not correct. Nothing was deleted.')).toBeTruthy();
    expect((await ds.account.getLifecycle('hh-2')).accountDeletionAt).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('with nothing left to wait for, signs out and goes to sign-in with the deleted notice', async () => {
    const ds = new MockDataSource();
    await ds.signIn('dean@example.com', 'secret1');
    await mount(ds, <DeleteAccountScreen />, 'hh-2');
    await fill('delete', 'secret1');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/sign-in?deleted=1'));
    await waitFor(() => expect(activeHousehold).toBeNull());
  });

  it('with a sole-member household, stays signed in with the 14-day notice and can cancel', async () => {
    const ds = new MockDataSource();
    await ds.account.createHousehold({ name: 'Solo', defaultServings: 2, weeklyBudgetPence: null });
    await mount(ds, <DeleteAccountScreen />, 'hh-2');
    await fill('DELETE', 'secret1');
    expect(await screen.findByTestId('account-deletion-notice')).toHaveTextContent(/Account deletion scheduled\. It happens when your household deletion completes\./);
    expect(mockReplace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('cancel-account-deletion'));
    await waitFor(() => expect(screen.getByTestId('delete-account-submit')).toBeTruthy());
    expect((await ds.account.getLifecycle('hh-2')).accountDeletionAt).toBeNull();
  });

  it('blocks the only owner of a shared household and says what to do', async () => {
    await mount(new MockDataSource(), <DeleteAccountScreen />, 'hh-1');
    expect(await screen.findByTestId('account-deletion-blocked')).toHaveTextContent(/Make someone else an owner/);
    expect(screen.queryByTestId('delete-account-submit')).toBeNull();
  });

  it('works with no active household too (account only)', async () => {
    await mount(new MockDataSource(), <DeleteAccountScreen />, null);
    expect(await screen.findByTestId('delete-account-submit')).toBeTruthy();
  });

  it('Keep my account goes back', async () => {
    await mount(new MockDataSource(), <DeleteAccountScreen />, 'hh-2');
    await fireEvent.press(await screen.findByTestId('keep-account'));
    expect(mockBack).toHaveBeenCalled();
  });
});
