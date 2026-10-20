import Link from 'next/link';
import { Button } from '@fr/ui';
import { messageFor } from '../../../lib/server/auth/errors';
import { getSessionUser } from '../../../lib/server/auth/household-context';
import { INVITE_TOKEN_RE } from '../../../lib/server/auth/household-service';
import { acceptInvitationAction } from './actions';

export const metadata = { title: 'Join a household', robots: { index: false } };

/**
 * Public route. We cannot pre-check validity without a session (invitations are owner-only under RLS), so a
 * malformed token is rejected here and everything else is decided by accept_invitation() on submit;
 * expired / used / revoked / wrong tokens all show the same generic message.
 */
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const valid = INVITE_TOKEN_RE.test(token);
  const err = messageFor(typeof sp.error === 'string' ? sp.error : undefined);

  if (!valid) {
    return (
      <main style={{ maxWidth: 480, margin: '2rem auto', display: 'grid', gap: '1rem' }}>
        <h1>Invitation not valid</h1>
        <p data-testid="invite-invalid">{messageFor('invitation_invalid')}</p>
        <Link href="/sign-in">Go to sign in</Link>
      </main>
    );
  }

  const user = await getSessionUser();
  return (
    <main style={{ maxWidth: 480, margin: '2rem auto', display: 'grid', gap: '1rem' }}>
      <h1>Join a household</h1>
      {err && (
        <p role="alert" data-testid="invite-error">
          {err}
        </p>
      )}
      {user ? (
        <form action={acceptInvitationAction}>
          <input type="hidden" name="token" value={token} />
          <p>You have been invited to join a household on Family Recipes.</p>
          <Button type="submit">Accept invitation</Button>
        </form>
      ) : (
        <>
          <p>Sign in or create an account to accept this invitation.</p>
          <p>
            <Link href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`}>Sign in</Link> or{' '}
            <Link href={`/sign-up?next=${encodeURIComponent(`/invite/${token}`)}`}>create an account</Link>
          </p>
        </>
      )}
      <p>
        <a href={`familyrecipes://invite/${token}`} data-testid="open-in-app">
          Open this invitation in the Android app
        </a>
      </p>
    </main>
  );
}
