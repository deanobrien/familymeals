import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import type { DataSource } from '@/data/DataSource';
import { MockDataSource } from '@/data/mockDataSource';
import { AccountError } from '@/lib/accountErrors';
import { clearPendingNext, setPendingNext, takePendingNext } from '@/lib/pendingNext';
import SignInScreen from '@/screens/SignInScreen';
import SignUpScreen from '@/screens/SignUpScreen';
import ForgotPasswordScreen from '@/screens/ForgotPasswordScreen';
import ResetPasswordScreen from '@/screens/ResetPasswordScreen';
import CreateHouseholdScreen from '@/screens/CreateHouseholdScreen';
import HouseholdPickerScreen from '@/screens/HouseholdPickerScreen';
import InviteAcceptScreen from '@/screens/InviteAcceptScreen';
import AuthCallback from '../app/auth/callback';

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockRedirect = jest.fn();
let mockParams: Record<string, string> = {};
let mockUrl: string | null = null;
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href);
    return null;
  },
}));
jest.mock('expo-linking', () => ({ useLinkingURL: () => mockUrl }));

const TOKEN = 'ef'.repeat(32);

function Probe({ children }: { children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  return (
    <>
      {children}
      <ProbeHousehold id={householdId} set={setHouseholdId} />
    </>
  );
}
let lastHousehold: string | null = null;
function ProbeHousehold({ id }: { id: string | null; set: (v: string | null) => void }) {
  lastHousehold = id;
  return null;
}

async function mount(ds: DataSource, ui: React.ReactElement) {
  return render(
    <AppProvider dataSource={ds}>
      <Probe>{ui}</Probe>
    </AppProvider>,
  );
}

beforeEach(async () => {
  mockReplace.mockClear();
  mockPush.mockClear();
  mockRedirect.mockClear();
  mockParams = {};
  mockUrl = null;
  lastHousehold = null;
  await clearPendingNext();
});

describe('SignInScreen: links, unconfirmed email, deletion notice', () => {
  it('offers sign-up and forgot-password', async () => {
    await mount(new MockDataSource(), <SignInScreen />);
    await fireEvent.press(screen.getByTestId('go-sign-up'));
    expect(mockPush).toHaveBeenCalledWith('/sign-up');
    await fireEvent.press(screen.getByTestId('go-forgot'));
    expect(mockPush).toHaveBeenCalledWith('/forgot-password');
  });
  it('an unconfirmed email gets the web message and a resend button that answers the same for anyone', async () => {
    const ds = new MockDataSource();
    jest.spyOn(ds, 'signIn').mockRejectedValue(new AccountError('email_not_confirmed'));
    await mount(ds, <SignInScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('Email'), 'a@b.co');
    await fireEvent.changeText(screen.getByPlaceholderText('Password'), 'whatever1');
    await fireEvent.press(screen.getByTestId('sign-in'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/has not been confirmed yet/);
    await fireEvent.press(screen.getByTestId('resend-confirmation'));
    expect(await screen.findByTestId('resent-notice')).toHaveTextContent(/If that address needs confirming/);
    expect(ds.account.sentConfirmations).toBe(1);
  });
  it('resumes a pending invitation after sign-in', async () => {
    await setPendingNext(`/invite/${TOKEN}`);
    await mount(new MockDataSource(), <SignInScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('Email'), 'a@b.co');
    await fireEvent.changeText(screen.getByPlaceholderText('Password'), 'secret1');
    await fireEvent.press(screen.getByTestId('sign-in'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(`/invite/${TOKEN}`));
  });
  it('says the account deletion is scheduled after being signed out by it', async () => {
    mockParams = { deleted: '1' };
    await mount(new MockDataSource(), <SignInScreen />);
    expect(screen.getByTestId('deleted-notice')).toHaveTextContent(/account deletion is scheduled/);
  });
});

describe('SignUpScreen', () => {
  async function fill(email: string, password: string) {
    await fireEvent.changeText(screen.getByTestId('sign-up-email'), email);
    await fireEvent.changeText(screen.getByTestId('sign-up-password'), password);
    await fireEvent.press(screen.getByTestId('sign-up-submit'));
  }
  it('validates email and the 10-character minimum before anything is sent', async () => {
    const ds = new MockDataSource();
    await mount(ds, <SignUpScreen />);
    await fill('nope', 'short');
    expect(await screen.findByText('Enter a valid email address')).toBeTruthy();
    expect(screen.getByText('Choose a password of at least 10 characters')).toBeTruthy();
    expect(ds.account.sentConfirmations).toBe(0);
  });
  it('sends the confirmation email, explains the fallback, and can resend', async () => {
    const ds = new MockDataSource();
    await mount(ds, <SignUpScreen />);
    await fill('new@b.co', 'longenough1');
    expect(await screen.findByTestId('sign-up-sent')).toHaveTextContent(/we have sent a confirmation email/);
    expect(screen.getByText(/your email is still confirmed/)).toBeTruthy();
    expect(ds.account.sentConfirmations).toBe(1);
    await fireEvent.press(screen.getByTestId('resend-confirmation'));
    expect(await screen.findByTestId('resent-notice')).toHaveTextContent(/another confirmation email/);
    expect(ds.account.sentConfirmations).toBe(2);
    await fireEvent.press(screen.getByTestId('back-to-sign-in'));
    expect(mockReplace).toHaveBeenCalledWith('/sign-in');
  });
  it('goes straight to onboarding when confirmation is off, or to a pending invitation', async () => {
    const ds = new MockDataSource();
    jest.spyOn(ds.account, 'signUp').mockResolvedValue({ signedIn: true });
    await mount(ds, <SignUpScreen />);
    await fill('new@b.co', 'longenough1');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/household/new'));
  });
  it('shows a rate limit as the fixed message', async () => {
    const ds = new MockDataSource();
    jest.spyOn(ds.account, 'signUp').mockRejectedValue(new AccountError('rate_limited'));
    await mount(ds, <SignUpScreen />);
    await fill('new@b.co', 'longenough1');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many attempts/);
  });
});

describe('forgot and reset password', () => {
  it('forgot password answers the same way and sends one reset', async () => {
    const ds = new MockDataSource();
    await mount(ds, <ForgotPasswordScreen />);
    await fireEvent.press(screen.getByTestId('forgot-submit'));
    expect(await screen.findByText('Enter a valid email address')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('forgot-email'), 'ghost@b.co');
    await fireEvent.press(screen.getByTestId('forgot-submit'));
    expect(await screen.findByTestId('reset-sent')).toHaveTextContent(/If that address has an account/);
    expect(ds.account.sentResets).toBe(1);
  });
  it('reset password checks length and match, then goes to the household picker', async () => {
    const ds = new MockDataSource();
    const spy = jest.spyOn(ds.account, 'updatePassword');
    await mount(ds, <ResetPasswordScreen />);
    await fireEvent.changeText(screen.getByTestId('reset-password'), 'short');
    await fireEvent.press(screen.getByTestId('reset-submit'));
    expect(await screen.findByText('Choose a password of at least 10 characters')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('reset-password'), 'longenough1');
    await fireEvent.changeText(screen.getByTestId('reset-confirm'), 'different123');
    await fireEvent.press(screen.getByTestId('reset-submit'));
    expect(await screen.findByText('The two passwords do not match')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('reset-confirm'), 'longenough1');
    await fireEvent.press(screen.getByTestId('reset-submit'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/households'));
    expect(spy).toHaveBeenCalledWith('longenough1');
  });
  it('an expired recovery session shows the link-expired message', async () => {
    const ds = new MockDataSource();
    jest.spyOn(ds.account, 'updatePassword').mockRejectedValue(new AccountError('link_expired'));
    await mount(ds, <ResetPasswordScreen />);
    await fireEvent.changeText(screen.getByTestId('reset-password'), 'longenough1');
    await fireEvent.changeText(screen.getByTestId('reset-confirm'), 'longenough1');
    await fireEvent.press(screen.getByTestId('reset-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired or was already used/);
  });
});

describe('AuthCallback (email link landing)', () => {
  const stub = (completeAuthLink: jest.Mock) => ({ completeAuthLink }) as unknown as DataSource;
  it('a confirmation link signs in and goes to the household picker', async () => {
    mockUrl = 'familyrecipes://auth/callback#access_token=a&refresh_token=b&type=signup';
    await mount(stub(jest.fn(async () => ({ userId: 'u', email: 'e' }))), <AuthCallback />);
    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/households'));
  });
  it('a recovery link goes to the new-password screen', async () => {
    mockUrl = 'familyrecipes://auth/callback#access_token=a&refresh_token=b&type=recovery';
    await mount(stub(jest.fn(async () => ({ userId: 'u', email: 'e', recovery: true }))), <AuthCallback />);
    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith('/reset-password'));
  });
  it('resumes a pending invitation after confirmation', async () => {
    await setPendingNext(`/invite/${TOKEN}`);
    mockUrl = 'familyrecipes://auth/callback#access_token=a&refresh_token=b';
    await mount(stub(jest.fn(async () => ({ userId: 'u', email: 'e' }))), <AuthCallback />);
    await waitFor(() => expect(mockRedirect).toHaveBeenCalledWith(`/invite/${TOKEN}`));
    expect(await takePendingNext()).toBeNull();
  });
  it('an expired or already-used link gets the friendly message and a way forward', async () => {
    mockUrl = 'familyrecipes://auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid';
    await mount(stub(jest.fn(async () => { throw new AccountError('link_expired'); })), <AuthCallback />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired or was already used/);
    await fireEvent.press(screen.getByTestId('to-sign-in'));
    expect(mockReplace).toHaveBeenCalledWith('/sign-in');
    await fireEvent.press(screen.getByTestId('to-forgot'));
    expect(mockReplace).toHaveBeenCalledWith('/forgot-password');
  });
});

describe('household picker and onboarding', () => {
  it('offers to create a household, and lists the ones you are in', async () => {
    await mount(new MockDataSource(), <HouseholdPickerScreen />);
    expect(await screen.findByText('The Smiths')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('create-household'));
    expect(mockPush).toHaveBeenCalledWith('/household/new');
  });
  it('create household validates, creates through the account source, makes it active and opens recipes', async () => {
    const ds = new MockDataSource();
    await mount(ds, <CreateHouseholdScreen />);
    await fireEvent.press(screen.getByTestId('hh-create'));
    expect(await screen.findByText('Give the household a name')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('hh-name'), 'Our Place');
    await fireEvent.changeText(screen.getByTestId('hh-servings'), '99');
    await fireEvent.press(screen.getByTestId('hh-create'));
    expect(await screen.findByText('Servings must be a whole number from 1 to 50')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('hh-servings'), '3');
    await fireEvent.changeText(screen.getByTestId('hh-budget'), '70');
    await fireEvent.press(screen.getByTestId('hh-create'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/recipes'));
    expect(lastHousehold).toMatch(/^hh-new-/);
    const made = (await ds.account.listMemberships()).find((h) => h.name === 'Our Place');
    expect(made).toMatchObject({ role: 'owner', defaultServings: 3, weeklyBudgetPence: 7000 });
  });
});

describe('InviteAcceptScreen (deep link /invite/<token>)', () => {
  it('rejects a malformed token with the generic message', async () => {
    mockParams = { token: 'short' };
    await mount(new MockDataSource(), <InviteAcceptScreen />);
    expect(screen.getByTestId('invite-invalid')).toHaveTextContent(/invalid, expired or has already been used/);
  });
  it('signed out: remembers the invitation and sends the person to sign in / sign up', async () => {
    mockParams = { token: TOKEN };
    await mount(new MockDataSource(), <InviteAcceptScreen />);
    await fireEvent.press(await screen.findByTestId('invite-sign-up'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/sign-up'));
    expect(await takePendingNext()).toBe(`/invite/${TOKEN}`);
  });
  it('signed in: accepts, makes that household active and opens recipes', async () => {
    const ds = new MockDataSource();
    await ds.signIn('a@b.co', 'secret1');
    const invite = await ds.account.createInvitation({ householdId: 'hh-1', role: 'member', ttlHours: 24 });
    const token = invite.link.replace('familyrecipes://invite/', '');
    mockParams = { token };
    await mount(ds, <InviteAcceptScreen />);
    await fireEvent.press(await screen.findByTestId('accept-invite'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/recipes'));
    expect(lastHousehold).toBe('hh-1');
  });
  it('signed in with a bad token: every rejection reads the same and nothing navigates', async () => {
    const ds = new MockDataSource();
    await ds.signIn('a@b.co', 'secret1');
    mockParams = { token: TOKEN };
    await mount(ds, <InviteAcceptScreen />);
    await fireEvent.press(await screen.findByTestId('accept-invite'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid, expired or has already been used/);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
