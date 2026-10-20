import React, { useMemo, useState } from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import type { HouseholdSummary } from '@/data/accountSource';
import { daysLeft, formatDate, formatTime } from '@/lib/accountForms';
import { ExportError, createExportClient, type ExportClient, type ExportScope } from '@/lib/exportApi';
import { downloadAndShare, realExportDeps, type ExportDeps } from '@/lib/exportDownload';
import { Button, ErrorText, Loading, Muted, Text, useStyles } from './ui';
import { Card, Field, NoHousehold, Notice, ReadOnlyBanner, SectionTitle, useActiveHousehold, useAction } from './account/parts';
import { useLifecycle } from './account/useLifecycle';

type ExportState =
  | { kind: 'idle' }
  | { kind: 'busy'; scope: ExportScope }
  | { kind: 'done'; scope: ExportScope }
  | { kind: 'error'; message: string };

/**
 * Settings > Your data (web: the "Your data" card, DX1): export my data / the whole household (owner), household deletion with
 * the 14-day grace countdown and cancel, and account deletion (which has its own screen, two taps from Settings).
 */
export default function YourDataScreen({ exportClient, exportDeps }: { exportClient?: ExportClient; exportDeps?: ExportDeps } = {}) {
  const { ds, householdId } = useApp();
  const styles = useStyles();
  const { household, error: loadError, reload } = useActiveHousehold();
  const { lifecycle, reload: reloadLifecycle } = useLifecycle(householdId);
  const [notice, setNotice] = useState<string | null>(null);
  const cancelAct = useAction();

  const client = useMemo(
    () => exportClient ?? createExportClient({ baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL, getToken: () => ds.getAccessToken() }),
    [exportClient, ds],
  );

  if (!householdId) return <NoHousehold />;
  if (!household) return loadError ? <ErrorText message={loadError} /> : <Loading label="Loading" />;

  const cancelDeletion = () =>
    void cancelAct.run(async () => {
      await ds.account.cancelHouseholdDeletion(household.id);
      setNotice('Household deletion cancelled. The household is active again.');
      await Promise.all([reload(), reloadLifecycle()]);
    });

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} style={styles.screen} keyboardShouldPersistTaps="handled">
      <ReadOnlyBanner household={household} onCancel={cancelDeletion} busy={cancelAct.busy} />
      <ErrorText message={cancelAct.error} />
      <Notice message={notice} testID="data-notice" />

      <ExportBlock household={household} client={client} deps={exportDeps ?? realExportDeps} />

      <HouseholdDeletionBlock
        household={household}
        onChanged={async (msg) => {
          setNotice(msg);
          await Promise.all([reload(), reloadLifecycle()]);
        }}
      />

      <AccountDeletionBlock
        household={household}
        lifecycle={lifecycle}
        onCancelled={async () => {
          setNotice('Account deletion cancelled.');
          await reloadLifecycle();
        }}
      />
    </ScrollView>
  );
}

function ExportBlock({ household, client, deps }: { household: HouseholdSummary; client: ExportClient; deps: ExportDeps }) {
  const { ds } = useApp();
  const [state, setState] = useState<ExportState>({ kind: 'idle' });
  const busy = state.kind === 'busy';

  async function start(scope: ExportScope) {
    setState({ kind: 'busy', scope });
    try {
      const ticket = await client.start(scope, household.id);
      const token = await ds.getAccessToken();
      if (!token) throw new ExportError('unauthenticated', 'Please sign in again to export your data.');
      await downloadAndShare(ticket.downloadUrl, token, deps);
      setState({ kind: 'done', scope });
    } catch (e) {
      if (e instanceof ExportError && e.code === 'rate_limited' && e.retryAfter) {
        setState({ kind: 'error', message: `You can request one export every 24 hours. Try again after ${formatDate(e.retryAfter)}, ${formatTime(e.retryAfter)}.` });
      } else {
        setState({ kind: 'error', message: e instanceof ExportError ? e.message : 'The export could not be completed. Please try again.' });
      }
    }
  }

  return (
    <Card testID="export-block">
      <SectionTitle>Export your data</SectionTitle>
      <Muted style={{ marginBottom: 8 }}>
        Download a zip of your recipes, plans, shopping lists, purchase history, receipts, pantry, prices and consents, with photos. “My data” is what you created
        or recorded yourself; owners can also export the whole household. Other members’ email addresses and account details are never included. One export of
        each kind every 24 hours.
      </Muted>
      <Button
        title={busy && state.scope === 'member' ? 'Preparing...' : 'Export my data'}
        variant="secondary"
        onPress={() => void start('member')}
        disabled={busy || !client.configured}
        testID="export-member"
      />
      {household.role === 'owner' ? (
        <Button
          title={busy && state.scope === 'household' ? 'Preparing...' : 'Export whole household'}
          variant="secondary"
          onPress={() => void start('household')}
          disabled={busy || !client.configured}
          testID="export-household"
        />
      ) : null}
      {!client.configured ? <Muted>Export needs the website address, which this build does not have.</Muted> : null}
      {state.kind === 'done' ? <Notice message="Your export is ready: choose where to save or send it from the share sheet." testID="export-done" /> : null}
      {state.kind === 'error' ? <ErrorText message={state.message} /> : null}
    </Card>
  );
}

function HouseholdDeletionBlock({ household, onChanged }: { household: HouseholdSummary; onChanged: (notice: string) => Promise<void> }) {
  const { ds } = useApp();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  const isOwner = household.role === 'owner';

  if (household.status === 'pending_deletion') {
    const when = household.purgeAfter;
    return (
      <Card testID="household-deletion-pending">
        <SectionTitle>Household deletion scheduled</SectionTitle>
        <Text>
          {when
            ? `${household.name} will be permanently deleted on ${formatDate(when)} (${daysLeft(when)} ${daysLeft(when) === 1 ? 'day' : 'days'} left).`
            : 'This household is pending deletion.'}{' '}
          Until then everyone can still view and export, but nothing can be changed.
        </Text>
        {when ? (
          <Text testID="grace-days" accessibilityLabel={`${daysLeft(when)} days left`}>
            {daysLeft(when)}
          </Text>
        ) : null}
        <Muted>{isOwner ? 'Use “Cancel deletion” at the top of this screen to restore it.' : 'Only an owner can cancel the deletion.'}</Muted>
      </Card>
    );
  }

  async function submit() {
    const res = await run(() => ds.account.requestHouseholdDeletion(household.id, confirmName, password));
    if (res) {
      setOpen(false);
      setConfirmName('');
      setPassword('');
      await onChanged('Household deletion scheduled. You have 14 days to cancel.');
    }
  }

  return (
    <Card testID="household-deletion">
      <SectionTitle>Delete household</SectionTitle>
      <Muted style={{ marginBottom: 8 }}>
        Deleting the household removes all recipes, plans, lists, receipts and photos for every member. The household becomes read-only and you then have 14 days
        to change your mind; only an owner can cancel. After that everything is permanently deleted, and it disappears from our backups within a further 14 days.
      </Muted>
      {!isOwner ? (
        <Muted>Only an owner can delete the household. You can leave it from the Household screen.</Muted>
      ) : !open ? (
        <Button title="Delete household" variant="secondary" onPress={() => setOpen(true)} testID="delete-household-open" />
      ) : (
        <>
          <Text style={{ fontWeight: '600' }}>Delete this household?</Text>
          <Muted style={{ marginBottom: 8 }}>
            This deletes all recipes, plans and lists for every member after a 14-day grace period. During those 14 days the household is read-only and an owner can
            cancel.
          </Muted>
          <Field
            label={`Type the household name (${household.name}) to confirm`}
            value={confirmName}
            onChangeText={setConfirmName}
            autoCapitalize="none"
            autoCorrect={false}
            testID="delete-household-name"
          />
          <Field label="Your password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" testID="delete-household-password" />
          <ErrorText message={error} />
          <Button title={busy ? 'Deleting...' : 'Delete household'} onPress={submit} disabled={busy} testID="delete-household-submit" />
          <Button title="Keep household" variant="secondary" onPress={() => setOpen(false)} disabled={busy} testID="delete-household-keep" />
        </>
      )}
    </Card>
  );
}

function AccountDeletionBlock({
  household,
  lifecycle,
  onCancelled,
}: {
  household: HouseholdSummary;
  lifecycle: { accountDeletionAt: string | null; activeMembers: number; otherOwners: number } | null;
  onCancelled: () => Promise<void>;
}) {
  const { ds } = useApp();
  const router = useRouter();
  const { busy, error, run } = useAction();
  if (!lifecycle) return null;

  if (lifecycle.accountDeletionAt) {
    return (
      <Card testID="account-deletion-pending">
        <SectionTitle>Account deletion scheduled</SectionTitle>
        <Text>
          Your account will be deleted on {formatDate(lifecycle.accountDeletionAt)}, after your household deletion completes. Households you shared with others have
          already been left.
        </Text>
        <ErrorText message={error} />
        <Button
          title="Cancel account deletion"
          variant="secondary"
          onPress={() => void run(async () => { await ds.account.cancelAccountDeletion(); await onCancelled(); })}
          disabled={busy}
          testID="cancel-account-deletion"
        />
      </Card>
    );
  }

  const soleOwnerWithOthers = household.role === 'owner' && lifecycle.otherOwners === 0 && lifecycle.activeMembers > 1;
  return (
    <Card testID="account-deletion">
      <SectionTitle>Delete my account</SectionTitle>
      <Muted style={{ marginBottom: 8 }}>
        You leave every household you share with others straight away (what you added stays with them; purchases keep the name they were recorded under). A
        household where you are the only member is deleted after the 14-day grace period, and then your account, profile and consents are removed.
      </Muted>
      {soleOwnerWithOthers ? (
        <Muted testID="account-deletion-blocked">
          You are the only owner of {household.name}. Make someone else an owner on the Household screen first.
        </Muted>
      ) : (
        <Button title="Delete my account" variant="secondary" onPress={() => router.push('/delete-account')} testID="go-delete-account" />
      )}
    </Card>
  );
}
