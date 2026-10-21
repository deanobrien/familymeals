import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import type { CreatedInvitation, HouseholdRole, MemberSummary, PendingInvitation } from '@/data/accountSource';
import { messageOf } from '@/lib/accountErrors';
import { isEmail } from '@/lib/accountForms';
import { clearShoppingWidget } from '@/widget/widgetBridge';
import { Button, ErrorText, Loading, Muted, Text, useStyles } from './ui';
import { Card, Field, NoHousehold, Notice, ReadOnlyBanner, Row, Segmented, SectionTitle, confirm, useActiveHousehold, useAction } from './account/parts';

const TTL_OPTIONS = [
  { value: '24', label: '1 day' },
  { value: '168', label: '7 days' },
  { value: '720', label: '30 days' },
] as const;

const NOTICES = {
  invitation_revoked: 'Invitation revoked.',
  member_removed: 'Member removed.',
  ownership_transferred: 'Ownership transferred. You are now a member.',
  deletion_cancelled: 'Household deletion cancelled.',
} as const;

/**
 * Household management (web: /household): switcher, members and roles, invite (share sheet with the one-time link), revoke
 * invite, remove member, transfer ownership, leave household, and the read-only banner during the 14-day deletion grace.
 */
export default function HouseholdScreen() {
  const { ds, householdId, setHouseholdId } = useApp();
  const router = useRouter();
  const styles = useStyles();
  const { household, memberships, error: loadError, reload } = useActiveHousehold();
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [invites, setInvites] = useState<PendingInvitation[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const act = useAction();

  const loadPeople = useCallback(async () => {
    if (!householdId) return;
    try {
      setMembers(await ds.account.listMembers(householdId));
      setInvites(await ds.account.listInvitations(householdId));
    } catch (e) {
      act.setError(messageOf(e));
    }
  }, [ds, householdId]);

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

  const refresh = useCallback(async () => {
    await Promise.all([reload(), loadPeople()]);
  }, [reload, loadPeople]);

  if (!householdId) return <NoHousehold />;
  if (!household) return loadError ? <ErrorText message={loadError} /> : <Loading label="Loading household" />;

  const isOwner = household.role === 'owner';
  const readOnly = household.status === 'pending_deletion';
  const otherOwners = members.filter((m) => m.role === 'owner' && !m.isYou).length;
  const onlyMember = members.length <= 1;

  async function doAction(fn: () => Promise<unknown>, note: keyof typeof NOTICES) {
    setNotice(null);
    const ok = await act.run(async () => {
      await fn();
      return true;
    });
    if (ok) {
      setNotice(NOTICES[note]);
      await refresh();
    }
  }

  async function removeMember(m: MemberSummary) {
    if (await confirm(`Remove ${m.displayName}?`, 'They lose access to this household straight away.', 'Remove')) {
      await doAction(() => ds.account.removeMember(household!.id, m.id), 'member_removed');
    }
  }

  async function makeOwner(m: MemberSummary) {
    if (await confirm(`Make ${m.displayName} the owner?`, 'They become an owner and you step down to a member.', 'Make owner')) {
      await doAction(() => ds.account.transferOwnership(household!.id, m.id), 'ownership_transferred');
    }
  }

  async function leave() {
    if (!(await confirm(`Leave ${household!.name}?`, 'Leaving removes your access and deletes your personal data in this household. Shared recipes and lists stay.', 'Leave'))) return;
    const ok = await act.run(async () => {
      await ds.account.leaveHousehold(household!.id);
      return true;
    });
    if (ok) {
      void clearShoppingWidget(); // the widget was showing the household just left
      setHouseholdId(null);
      router.replace('/households');
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} style={styles.screen} keyboardShouldPersistTaps="handled">
      <ReadOnlyBanner household={household} busy={act.busy} onCancel={() => void doAction(() => ds.account.cancelHouseholdDeletion(household.id), 'deletion_cancelled')} />
      <ErrorText message={act.error ?? loadError} />
      <Notice message={notice} testID="household-notice" />

      <Text style={styles.title} accessibilityRole="header">
        {household.name}
      </Text>
      <Muted>
        Your role: {household.role} · Default servings: {household.defaultServings}
        {household.weeklyBudgetPence !== null ? ` · Weekly budget: £${(household.weeklyBudgetPence / 100).toFixed(2)}` : ''}
      </Muted>

      {(memberships?.length ?? 0) > 1 ? (
        <>
          <SectionTitle>Switch household</SectionTitle>
          {memberships!
            .filter((m) => m.id !== household.id)
            .map((m) => (
              <Row
                key={m.id}
                title={m.name}
                subtitle={m.role}
                testID={`switch-${m.id}`}
                onPress={() => {
                  setHouseholdId(m.id);
                  router.replace('/recipes');
                }}
              />
            ))}
        </>
      ) : null}
      <Row title="Create another household" onPress={() => router.push('/household/new')} testID="create-another" />

      <SectionTitle>Members</SectionTitle>
      {members.map((m) => (
        <Card key={m.id} testID={`member-${m.id}`}>
          <Text style={{ fontWeight: '600' }}>
            {m.displayName}
            {m.isYou ? ' (you)' : ''} · {m.role}
          </Text>
          {isOwner && !readOnly && !m.isYou ? (
            <View>
              <Button title="Make owner and step down" variant="secondary" onPress={() => void makeOwner(m)} disabled={act.busy} testID={`make-owner-${m.id}`} />
              {m.role === 'member' ? (
                <Button title="Remove" variant="secondary" onPress={() => void removeMember(m)} disabled={act.busy} testID={`remove-${m.id}`} />
              ) : null}
            </View>
          ) : null}
        </Card>
      ))}

      {isOwner && !readOnly ? (
        <InviteSection householdId={household.id} onCreated={loadPeople} />
      ) : null}

      {isOwner ? (
        <>
          <SectionTitle>Pending invitations</SectionTitle>
          {invites.length === 0 ? (
            <Muted testID="no-invites">No pending invitations.</Muted>
          ) : (
            invites.map((i) => (
              <Card key={i.id} testID={`invite-${i.id}`}>
                <Text>
                  {i.email ?? 'Anyone with the link'} · {i.role}
                </Text>
                <Muted>{i.expired ? 'Expired' : `Expires ${new Date(i.expiresAt).toLocaleDateString('en-GB')}`}</Muted>
                {!readOnly ? (
                  <Button title="Revoke" variant="secondary" onPress={() => void doAction(() => ds.account.revokeInvitation(household.id, i.id), 'invitation_revoked')} disabled={act.busy} testID={`revoke-${i.id}`} />
                ) : null}
              </Card>
            ))
          )}
        </>
      ) : null}

      <SectionTitle>Leave household</SectionTitle>
      {onlyMember ? (
        <Muted>You are the only member. To remove the household and its data, request deletion under Settings, Your data.</Muted>
      ) : isOwner && otherOwners === 0 ? (
        <Muted>You are the only owner. Make another member an owner before leaving.</Muted>
      ) : (
        <>
          <Muted>Leaving removes your access and deletes your personal data in this household. Shared recipes and lists stay.</Muted>
          <Button title={`Leave ${household.name}`} variant="secondary" onPress={() => void leave()} disabled={act.busy} testID="leave-household" />
        </>
      )}
    </ScrollView>
  );
}

/** Owner invite form. The link carries the one-time token: it is shown once, handed to the share sheet, never logged or stored. */
function InviteSection({ householdId, onCreated }: { householdId: string; onCreated: () => void | Promise<void> }) {
  const { ds } = useApp();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<HouseholdRole>('member');
  const [ttl, setTtl] = useState<string>('168');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  async function create() {
    if (email.trim() && !isEmail(email)) {
      setEmailError('Enter a valid email address, or leave it blank');
      return;
    }
    setEmailError(null);
    setCreated(null);
    const res = await run(() => ds.account.createInvitation({ householdId, email: email.trim() || undefined, role, ttlHours: Number(ttl) }));
    if (res) {
      setCreated(res);
      setEmail('');
      await onCreated();
    }
  }

  async function share(link: string) {
    setShareError(null);
    try {
      await Share.share({ message: `Join our household on Family Recipes: ${link}` });
    } catch {
      setShareError('The share sheet could not be opened. Press and hold the link to copy it.');
    }
  }

  return (
    <View>
      <SectionTitle>Invite someone</SectionTitle>
      <Field
        label="Email (optional, locks the invite to this address)"
        value={email}
        onChangeText={setEmail}
        error={emailError}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="off"
        testID="invite-email"
      />
      <Segmented
        label="Role"
        value={role}
        onChange={setRole}
        options={[
          { value: 'member', label: 'Member' },
          { value: 'owner', label: 'Owner' },
        ]}
        testID="invite-role"
      />
      <Segmented label="Expires after" value={ttl} onChange={setTtl} options={TTL_OPTIONS} testID="invite-ttl" />
      <ErrorText message={error} />
      <Button title={busy ? 'Creating...' : 'Create invite link'} onPress={create} disabled={busy} testID="invite-create" />
      {created ? (
        <Card testID="invite-created">
          <Text accessibilityRole="alert">Share this link with the person you are inviting. It is shown only once and works for one person.</Text>
          <Text selectable testID="invite-link" style={{ marginVertical: 8 }}>
            {created.link}
          </Text>
          <Button title="Share link" onPress={() => void share(created.link)} testID="invite-share" />
          <ErrorText message={shareError} />
        </Card>
      ) : null}
    </View>
  );
}
