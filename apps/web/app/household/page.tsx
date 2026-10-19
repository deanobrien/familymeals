import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge, Button, Card, CardBody, EmptyState } from '@fr/ui';
import { signOutAction } from '../(auth)/actions';
import { resolveAuthMode } from '../../lib/supabase/env';
import { messageFor } from '../../lib/server/auth/errors';
import { getHouseholdContext, getSessionUser } from '../../lib/server/auth/household-context';
import { listMembers, listPendingInvitations } from '../../lib/server/auth/household-service';
import {
  cancelDeletionAction,
  leaveHouseholdAction,
  revokeInvitationAction,
  revokeMemberAction,
  switchHouseholdAction,
  transferOwnershipAction,
} from './actions';
import { InviteForm } from './invite-form';

export const metadata = { title: 'Household' };

const NOTICES: Record<string, string> = {
  invitation_revoked: 'Invitation revoked.',
  member_removed: 'Member removed.',
  ownership_transferred: 'Ownership transferred. You are now a member.',
  deletion_cancelled: 'Household deletion cancelled.',
};

export default async function HouseholdPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const mode = resolveAuthMode();

  if (mode === 'mock') {
    return (
      <>
        <h1>Household</h1>
        <EmptyState icon="users" title="Local mock auth" description="Supabase is not configured, so household management is unavailable. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY." />
      </>
    );
  }

  const ctx = await getHouseholdContext();
  if (!ctx) redirect((await getSessionUser()) ? '/household/new' : '/sign-in?next=%2Fhousehold');

  const membersRes = await listMembers(ctx.supabase, ctx.household.id, ctx.user.id);
  const members = membersRes.ok ? membersRes.data : [];
  const invitesRes = ctx.isOwner ? await listPendingInvitations(ctx.supabase, ctx.household.id) : null;
  const invites = invitesRes?.ok ? invitesRes.data : [];
  const error = messageFor(typeof sp.error === 'string' ? sp.error : undefined);
  const notice = typeof sp.notice === 'string' ? NOTICES[sp.notice] : undefined;
  const otherOwners = members.filter((m) => m.role === 'owner' && !m.isYou).length;
  const onlyMember = members.length <= 1;

  return (
    <div style={{ display: 'grid', gap: '1.5rem', maxWidth: 720 }}>
      <h1>Household</h1>

      {ctx.readOnly && (
        <div role="alert" data-testid="read-only-banner" style={{ border: '1px solid currentColor', padding: '0.75rem', borderRadius: 8 }}>
          This household is pending deletion and is read-only. You can still view and export your data.
          {ctx.isOwner && (
            <form action={cancelDeletionAction} style={{ marginTop: '0.5rem' }}>
              <Button type="submit" variant="secondary">
                Cancel deletion
              </Button>
            </form>
          )}
        </div>
      )}
      {error &&<p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <section aria-labelledby="active-h">
        <h2 id="active-h">{ctx.household.name}</h2>
        <p>
          Your role: <Badge>{ctx.role}</Badge> &middot; Default servings: {ctx.household.defaultServings}
          {ctx.household.weeklyBudgetPence !== null && <> &middot; Weekly budget: £{(ctx.household.weeklyBudgetPence / 100).toFixed(2)}</>}
        </p>
        {ctx.memberships.length > 1 && (
          <form action={switchHouseholdAction} style={{ display: 'flex', gap: '0.5rem', alignItems: 'end' }}>
            <label>
              Switch household{' '}
              <select name="householdId" defaultValue={ctx.household.id}>
                {ctx.memberships.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="secondary">
              Switch
            </Button>
          </form>
        )}
        <p>
          <Link href="/household/new">Create another household</Link>
        </p>
      </section>

      <section aria-labelledby="members-h">
        <h2 id="members-h">Members</h2>
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.5rem' }}>
          {members.map((m) => (
            <li key={m.id}>
              <Card>
                <CardBody>
                  <strong>{m.displayName}</strong> {m.isYou && '(you)'} <Badge>{m.role}</Badge>
                  {ctx.isOwner && !ctx.readOnly && !m.isYou && (
                    <span style={{ display: 'inline-flex', gap: '0.5rem', marginLeft: '0.75rem' }}>
                      <form action={transferOwnershipAction}>
                        <input type="hidden" name="memberId" value={m.id} />
                        <Button type="submit" size="sm" variant="secondary">
                          Make owner and step down
                        </Button>
                      </form>
                      {m.role === 'member' && (
                        <form action={revokeMemberAction}>
                          <input type="hidden" name="memberId" value={m.id} />
                          <Button type="submit" size="sm" variant="danger">
                            Remove
                          </Button>
                        </form>
                      )}
                    </span>
                  )}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {ctx.isOwner && !ctx.readOnly && <InviteForm />}

      {ctx.isOwner && (
        <section aria-labelledby="pending-h">
          <h2 id="pending-h">Pending invitations</h2>
          {invites.length === 0 ? (
            <p>No pending invitations.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.5rem' }}>
              {invites.map((i) => (
                <li key={i.id}>
                  <Card>
                    <CardBody>
                      {i.email ?? 'Anyone with the link'} <Badge>{i.role}</Badge>{' '}
                      {i.expired ? 'Expired' : `Expires ${new Date(i.expiresAt).toLocaleDateString('en-GB')}`}
                      {!ctx.readOnly && (
                        <form action={revokeInvitationAction} style={{ display: 'inline', marginLeft: '0.75rem' }}>
                          <input type="hidden" name="invitationId" value={i.id} />
                          <Button type="submit" size="sm" variant="danger">
                            Revoke
                          </Button>
                        </form>
                      )}
                    </CardBody>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="leave-h">
        <h2 id="leave-h">Leave household</h2>
        {onlyMember ? (
          <p>You are the only member. To remove the household and its data, request deletion from Settings.</p>
        ) : ctx.isOwner && otherOwners === 0 ? (
          <p>You are the only owner. Make another member an owner before leaving.</p>
        ) : (
          <form action={leaveHouseholdAction}>
            <p>Leaving removes your access and deletes your personal data in this household. Shared recipes and lists stay.</p>
            <Button type="submit" variant="danger">
              Leave {ctx.household.name}
            </Button>
          </form>
        )}
      </section>

      <form action={signOutAction}>
        <Button type="submit" variant="ghost">
          Sign out
        </Button>
      </form>
    </div>
  );
}
