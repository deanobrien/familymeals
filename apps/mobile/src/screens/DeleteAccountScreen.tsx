import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { formatDate } from '@/lib/accountForms';
import { clearShoppingWidget } from '@/widget/widgetBridge';
import { Button, ErrorText, Loading, Muted, Text, useStyles } from './ui';
import { Field, Notice, useAction, useActiveHousehold } from './account/parts';
import { useLifecycle } from './account/useLifecycle';

/**
 * Delete my account (Google Play requires in-app deletion: Settings tab, then "Delete my account"). Same safeguards as the web:
 * type DELETE and re-enter the current password (D258). You leave every shared household now; a household where you are the
 * only member goes into the 14-day grace period and the account is removed when that completes (D253). Cancel is one tap.
 */
export default function DeleteAccountScreen() {
  const { ds, householdId, setHouseholdId } = useApp();
  const router = useRouter();
  const styles = useStyles();
  const { household } = useActiveHousehold();
  const { lifecycle, error: loadError, reload } = useLifecycle(householdId);
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  if (!lifecycle) return loadError ? <ErrorText message={loadError} /> : <Loading label="Loading" />;

  async function submit() {
    const res = await run(() => ds.account.requestAccountDeletion(confirmText, password));
    if (!res) return;
    setPassword('');
    if (res.signedOut) {
      // Nothing left to wait for: the session is ended; the next clean-up run deletes the account.
      void clearShoppingWidget();
      setHouseholdId(null);
      router.replace('/sign-in?deleted=1');
      return;
    }
    setNotice('Account deletion scheduled. It happens when your household deletion completes.');
    await reload();
  }

  if (lifecycle.accountDeletionAt) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }} style={styles.screen}>
        <Text style={styles.title} accessibilityRole="header">
          Account deletion scheduled
        </Text>
        <Notice message={notice} testID="account-deletion-notice" />
        <Text testID="account-deletion-pending">
          Your account will be deleted on {formatDate(lifecycle.accountDeletionAt)}, after your household deletion completes. Households you shared with others have already
          been left.
        </Text>
        <ErrorText message={error} />
        <Button
          title="Cancel account deletion"
          onPress={() => void run(async () => { await ds.account.cancelAccountDeletion(); setNotice('Account deletion cancelled.'); await reload(); })}
          disabled={busy}
          testID="cancel-account-deletion"
        />
      </ScrollView>
    );
  }

  const soleMember = lifecycle.activeMembers <= 1;
  const blocked = !!household && household.role === 'owner' && lifecycle.otherOwners === 0 && lifecycle.activeMembers > 1;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} style={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">
        Delete my account
      </Text>
      <Notice message={notice} testID="account-deletion-notice" />
      <Text>
        {soleMember
          ? `You are the only member of ${household?.name ?? 'your household'}, so it will be deleted too (after 14 days). Your account is deleted when that completes.`
          : 'You will leave your shared households now. Your account is deleted at the next scheduled clean-up, normally within 24 hours.'}
      </Text>
      <Muted style={{ marginVertical: 8 }}>
        What you added stays with the households you leave; purchases keep the name they were recorded under. Your profile, consents and account are removed.
      </Muted>
      {blocked ? (
        <Text testID="account-deletion-blocked">
          You are the only owner of {household?.name}. Make someone else an owner on the Household screen first.
        </Text>
      ) : (
        <>
          <Field label="Type DELETE to confirm" value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" autoCorrect={false} testID="delete-account-confirm" />
          <Field label="Your password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" testID="delete-account-password" />
          <ErrorText message={error} />
          <Button title={busy ? 'Deleting...' : 'Delete my account'} onPress={submit} disabled={busy} testID="delete-account-submit" />
        </>
      )}
      <Button title="Keep my account" variant="secondary" onPress={() => router.back()} disabled={busy} testID="keep-account" />
    </ScrollView>
  );
}
