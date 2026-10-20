import React from 'react';
import { Alert, Share } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { AccountError } from '@/lib/accountErrors';
import HouseholdScreen from '@/screens/HouseholdScreen';

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

let activeHousehold: string | null = null;
function SetHousehold({ id, children }: { id: string; children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  activeHousehold = householdId;
  React.useEffect(() => setHouseholdId(id), [id, setHouseholdId]);
  return householdId ? <>{children}</> : null;
}

async function mount(ds: MockDataSource, household = 'hh-1') {
  return render(
    <AppProvider dataSource={ds}>
      <SetHousehold id={household}>
        <HouseholdScreen />
      </SetHousehold>
    </AppProvider>,
  );
}

/** Alert.alert stand-in: presses the named button straight away. */
function answerAlert(button: 'confirm' | 'cancel') {
  return jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    const b = buttons?.find((x) => (button === 'confirm' ? x.style === 'destructive' : x.style === 'cancel'));
    b?.onPress?.();
  });
}

beforeEach(() => {
  mockReplace.mockClear();
  mockPush.mockClear();
  activeHousehold = null;
  jest.restoreAllMocks();
});

describe('HouseholdScreen as an owner', () => {
  it('shows the household, members with roles, and the owner controls', async () => {
    await mount(new MockDataSource());
    expect(await screen.findByText('The Smiths')).toBeTruthy();
    expect(screen.getByText(/Your role: owner/)).toBeTruthy();
    expect(screen.getByText('Dean (you) · owner')).toBeTruthy();
    expect(screen.getByText('Sam · member')).toBeTruthy();
    expect(screen.getByTestId('invite-create')).toBeTruthy();
    expect(screen.getByTestId('no-invites')).toBeTruthy();
    expect(screen.getByTestId('make-owner-m-hh-1-1')).toBeTruthy();
    expect(screen.queryByTestId('make-owner-m-me-hh-1')).toBeNull(); // never on yourself
  });

  it('creates an invitation, hands the link to the share sheet once, lists it, and revokes it', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    const ds = new MockDataSource();
    await mount(ds);
    await fireEvent.changeText(await screen.findByTestId('invite-email'), 'new@b.co');
    await fireEvent.press(screen.getByTestId('invite-role-owner'));
    await fireEvent.press(screen.getByTestId('invite-ttl-720'));
    await fireEvent.press(screen.getByTestId('invite-create'));
    const link = (await screen.findByTestId('invite-link')).props.children as string;
    expect(link).toMatch(/^familyrecipes:\/\/invite\/[0-9a-f]{64}$/);
    expect(screen.getByText(/shown only once/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('invite-share'));
    expect(share).toHaveBeenCalledTimes(1);
    expect((share.mock.calls[0]![0] as { message: string }).message).toContain(link);
    // the pending list shows who it is for, never the token
    const pending = await screen.findByText('new@b.co · owner');
    expect(pending).toBeTruthy();
    expect(screen.queryByText(new RegExp(link.split('/').pop()!))).toBeTruthy(); // only the one-time card shows it
    const invite = (await ds.account.listInvitations('hh-1'))[0]!;
    await fireEvent.press(screen.getByTestId(`revoke-${invite.id}`));
    expect(await screen.findByText('Invitation revoked.')).toBeTruthy();
    expect(await ds.account.listInvitations('hh-1')).toHaveLength(0);
  });

  it('a bad invite email is caught before anything is created', async () => {
    const ds = new MockDataSource();
    const spy = jest.spyOn(ds.account, 'createInvitation');
    await mount(ds);
    await fireEvent.changeText(await screen.findByTestId('invite-email'), 'nope');
    await fireEvent.press(screen.getByTestId('invite-create'));
    expect(await screen.findByText('Enter a valid email address, or leave it blank')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it('removes a member only after confirming', async () => {
    const ds = new MockDataSource();
    await mount(ds);
    const alert = answerAlert('cancel');
    await fireEvent.press(await screen.findByTestId('remove-m-hh-1-2'));
    expect(alert).toHaveBeenCalled();
    expect(await ds.account.listMembers('hh-1')).toHaveLength(4);
    answerAlert('confirm');
    await fireEvent.press(screen.getByTestId('remove-m-hh-1-2'));
    expect(await screen.findByText('Member removed.')).toBeTruthy();
    expect(await ds.account.listMembers('hh-1')).toHaveLength(3);
  });

  it('transfers ownership after confirming and then drops the owner controls', async () => {
    const ds = new MockDataSource();
    await mount(ds);
    answerAlert('confirm');
    await fireEvent.press(await screen.findByTestId('make-owner-m-hh-1-1'));
    expect(await screen.findByText('Ownership transferred. You are now a member.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('invite-create')).toBeNull());
    expect(screen.getByText('Sam · owner')).toBeTruthy();
    expect(screen.getByText(/Your role: member/)).toBeTruthy();
  });

  it('leaving needs confirmation, then clears the active household and goes to the picker', async () => {
    const ds = new MockDataSource();
    await mount(ds, 'hh-2'); // owner is Sam, you are a member: leave is allowed
    const alert = answerAlert('cancel');
    await fireEvent.press(await screen.findByTestId('leave-household'));
    expect(alert).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    answerAlert('confirm');
    await fireEvent.press(screen.getByTestId('leave-household'));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/households'));
    await waitFor(() => expect(activeHousehold).toBeNull());
    expect((await ds.account.listMemberships()).map((h) => h.id)).toEqual(['hh-1']);
  });

  it('the only owner cannot leave until someone else is an owner', async () => {
    await mount(new MockDataSource());
    expect(await screen.findByText('You are the only owner. Make another member an owner before leaving.')).toBeTruthy();
    expect(screen.queryByTestId('leave-household')).toBeNull();
  });

  it('shows a fixed message when the server refuses (last owner), never raw text', async () => {
    const ds = new MockDataSource();
    jest.spyOn(ds.account, 'transferOwnership').mockRejectedValue(new AccountError('last_owner'));
    await mount(ds);
    answerAlert('confirm');
    await fireEvent.press(await screen.findByTestId('make-owner-m-hh-1-1'));
    expect(await screen.findByText('A household must keep at least one owner. Make someone else an owner first.')).toBeTruthy();
  });
});

describe('HouseholdScreen as a plain member', () => {
  it('has no owner controls and no pending-invitations section', async () => {
    await mount(new MockDataSource(), 'hh-2');
    expect(await screen.findByText('Flat 3B')).toBeTruthy();
    expect(screen.getByText(/Your role: member/)).toBeTruthy();
    expect(screen.queryByTestId('invite-create')).toBeNull();
    expect(screen.queryByText('Pending invitations')).toBeNull();
    expect(screen.queryByTestId('remove-m-hh-2-1')).toBeNull();
  });
});

describe('switcher and read-only grace period', () => {
  it('lists the other households and switches to one', async () => {
    await mount(new MockDataSource());
    await fireEvent.press(await screen.findByTestId('switch-hh-2'));
    expect(mockReplace).toHaveBeenCalledWith('/recipes');
    await waitFor(() => expect(activeHousehold).toBe('hh-2'));
  });

  it('during the 14-day grace: banner with the end date, no write controls, owner can cancel', async () => {
    const ds = new MockDataSource();
    await ds.account.requestHouseholdDeletion('hh-1', 'The Smiths', 'secret1');
    await mount(ds);
    const banner = await screen.findByTestId('read-only-banner');
    expect(banner).toHaveTextContent(/pending deletion and is read-only/);
    expect(banner).toHaveTextContent(/14 days left/);
    expect(screen.queryByTestId('invite-create')).toBeNull();
    expect(screen.queryByTestId('remove-m-hh-1-2')).toBeNull();
    expect(screen.queryByTestId('make-owner-m-hh-1-1')).toBeNull();
    await fireEvent.press(screen.getByTestId('cancel-household-deletion'));
    expect(await screen.findByText('Household deletion cancelled.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('read-only-banner')).toBeNull());
    expect(await screen.findByTestId('invite-create')).toBeTruthy();
  });

  it('a member sees the banner but no cancel button', async () => {
    const ds = new MockDataSource();
    await ds.account.requestHouseholdDeletion('hh-1', 'The Smiths', 'secret1');
    jest.spyOn(ds.account, 'listMemberships').mockResolvedValue([
      { ...(await ds.account.listMemberships())[0]!, role: 'member' },
    ]);
    await mount(ds);
    expect(await screen.findByTestId('read-only-banner')).toHaveTextContent(/Only an owner can cancel the deletion/);
    expect(screen.queryByTestId('cancel-household-deletion')).toBeNull();
  });
});
