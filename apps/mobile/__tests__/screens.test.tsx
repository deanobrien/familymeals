import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import SignInScreen from '@/screens/SignInScreen';
import RecipeDetailScreen from '@/screens/RecipeDetailScreen';
import ShoppingListScreen from '@/screens/ShoppingListScreen';

import { params, resetRouter, router } from './helpers/router';

jest.mock('expo-router', () => require('./helpers/router').routerModule());

function SetHousehold({ id, children }: { id: string; children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId(id), [id, setHouseholdId]);
  return householdId ? <>{children}</> : null;
}

function renderWith(ds: MockDataSource, ui: React.ReactElement, household = 'hh-1') {
  return render(
    <AppProvider dataSource={ds}>
      <SetHousehold id={household}>{ui}</SetHousehold>
    </AppProvider>,
  );
}

beforeEach(() => resetRouter());

describe('SignInScreen', () => {
  it('shows an error for bad credentials and navigates on success', async () => {
    const ds = new MockDataSource();
    await render(
      <AppProvider dataSource={ds}>
        <SignInScreen />
      </AppProvider>,
    );
    await fireEvent.changeText(screen.getByPlaceholderText('Email'), 'bad');
    await fireEvent.changeText(screen.getByPlaceholderText('Password'), 'x');
    await fireEvent.press(screen.getByTestId('sign-in'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');

    await fireEvent.changeText(screen.getByPlaceholderText('Email'), 'a@b.co');
    await fireEvent.changeText(screen.getByPlaceholderText('Password'), 'secret1');
    await fireEvent.press(screen.getByTestId('sign-in'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/households'));
  });
});

describe('RecipeDetailScreen', () => {
  it('shows Unknown for unknown/unavailable/missing nutrition, not 0', async () => {
    params.current = { id: 'r-1' };
    await renderWith(new MockDataSource(), <RecipeDetailScreen />);
    expect(await screen.findByText('Spaghetti Bolognese')).toBeTruthy();
    expect(screen.getByTestId('nutrition-energy_kcal')).toHaveTextContent('520 kcal');
    expect(screen.getByTestId('nutrition-fibre')).toHaveTextContent('Unknown'); // unknown
    expect(screen.getByTestId('nutrition-salt')).toHaveTextContent('Unknown'); // unavailable
    expect(screen.getByTestId('nutrition-fat')).toHaveTextContent('Unknown'); // missing
  });
});

describe('ShoppingListScreen', () => {
  it('ticks with one tap and shows pending while offline, then syncs', async () => {
    const ds = new MockDataSource({ online: false });
    await renderWith(ds, <ShoppingListScreen />);
    await fireEvent.press(await screen.findByLabelText(/Minced beef/));
    expect(await screen.findByTestId('pending-s-1')).toBeTruthy();
    expect(screen.getByTestId('pending-banner')).toHaveTextContent('1 change waiting to sync');

    ds.setOnline(true);
    await fireEvent.press(screen.getByTestId('sync-now'));
    await waitFor(() => expect(screen.queryByTestId('pending-s-1')).toBeNull());
    expect(ds.deliveredCount()).toBe(1);
  });
});
