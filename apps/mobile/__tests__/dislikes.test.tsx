import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { parseDislikeTag } from '@/lib/accountForms';
import SettingsScreen from '@/screens/SettingsScreen';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }), useLocalSearchParams: () => ({}) }));

function SetHousehold({ id, children }: { id: string; children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId(id), [id, setHouseholdId]);
  return householdId ? <>{children}</> : null;
}
async function mount(ds: MockDataSource, household = 'hh-1') {
  await render(
    <AppProvider dataSource={ds}>
      <SetHousehold id={household}>
        <SettingsScreen />
      </SetHousehold>
    </AppProvider>,
  );
}

describe('parseDislikeTag', () => {
  it('uses the same rules as the web form', () => {
    expect(parseDislikeTag('  Blue Cheese ')).toEqual({ ok: true, value: 'blue cheese' });
    expect(parseDislikeTag('')).toMatchObject({ ok: false, error: 'Enter a food' });
    expect(parseDislikeTag('x'.repeat(61))).toMatchObject({ ok: false });
    expect(parseDislikeTag('kiwi2')).toMatchObject({ ok: false, error: 'Use letters only' });
  });
});

describe('Settings: foods people don\'t like (soft, per person)', () => {
  it('lists every household member; an owner edits anyone\'s list, saves, and it sticks', async () => {
    const ds = new MockDataSource();
    await mount(ds);
    expect(await screen.findByText('Foods people don’t like')).toBeTruthy();
    expect(screen.getByText('Dean (you)')).toBeTruthy();
    const sam = (await ds.account.getSettings('hh-1')).members.find((m) => m.displayName === 'Sam')!;
    await fireEvent.changeText(screen.getByTestId(`dislike-input-${sam.memberId}`), 'Mushrooms');
    await fireEvent.press(screen.getByTestId(`dislike-add-${sam.memberId}`));
    expect(await screen.findByTestId(`dislike-${sam.memberId}-mushrooms`)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId(`dislike-input-${sam.memberId}`), 'olives'); // typed, not yet added: save still counts it
    await fireEvent.press(screen.getByTestId(`dislike-save-${sam.memberId}`));
    expect(await screen.findByTestId(`dislike-notice-${sam.memberId}`)).toHaveTextContent(/Saved what Sam doesn’t like/);
    expect((await ds.account.getSettings('hh-1')).members.find((m) => m.memberId === sam.memberId)?.terms).toEqual(['mushrooms', 'olives']);
  });

  it('removes a food by tapping its chip, and rejects bad input without calling the server', async () => {
    const ds = new MockDataSource();
    const me = (await ds.account.getSettings('hh-1')).members.find((m) => m.isSelf)!;
    await ds.account.saveDislikes('hh-1', me.memberId, ['liver', 'fish']);
    await mount(ds);
    await fireEvent.press(await screen.findByTestId(`dislike-${me.memberId}-liver`));
    expect(screen.queryByTestId(`dislike-${me.memberId}-liver`)).toBeNull();
    await fireEvent.changeText(screen.getByTestId(`dislike-input-${me.memberId}`), 'kiwi2');
    await fireEvent.press(screen.getByTestId(`dislike-add-${me.memberId}`));
    expect(await screen.findByText('Use letters only')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId(`dislike-input-${me.memberId}`), '');
    await fireEvent.press(screen.getByTestId(`dislike-save-${me.memberId}`));
    await waitFor(async () => expect((await ds.account.getSettings('hh-1')).members.find((m) => m.isSelf)?.terms).toEqual(['fish']));
  });

  it('a plain member edits only their own list; others are read-only', async () => {
    const ds = new MockDataSource();
    await mount(ds, 'hh-2');
    expect(await screen.findByText('Dean (you)')).toBeTruthy();
    const members = (await ds.account.getSettings('hh-2')).members;
    const me = members.find((m) => m.isSelf)!;
    const other = members.find((m) => !m.isSelf)!;
    expect(screen.getByTestId(`dislike-input-${me.memberId}`)).toBeTruthy();
    expect(screen.queryByTestId(`dislike-input-${other.memberId}`)).toBeNull();
    expect(screen.getByText(/Only .* or a household owner can change this list\./)).toBeTruthy();
    await expect(ds.account.saveDislikes('hh-2', other.memberId, ['x'])).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('is separate from allergies: saving dislikes needs no consent and creates no exclusions', async () => {
    const ds = new MockDataSource();
    const me = (await ds.account.getSettings('hh-1')).members.find((m) => m.isSelf)!;
    await ds.account.saveDislikes('hh-1', me.memberId, ['coriander']);
    expect(await ds.account.getSettings('hh-1')).toMatchObject({ exclusions: [], consentActive: false, withheldExclusions: 0 });
  });
});
