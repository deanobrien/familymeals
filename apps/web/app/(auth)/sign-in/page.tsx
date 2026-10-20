import Link from 'next/link';
import { Button, Input } from '@fr/ui';
import { safeNextPath } from '../../../lib/server/auth/next-path';
import { signInAction } from '../actions';
import { LinkErrorAndResend } from './link-error';
import { AuthCard, AuthModeBanner, ErrorNote, formStyle } from '../auth-bits';

export const metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === 'string' ? sp.next : undefined);
  return (
    <AuthCard title="Sign in">
      <AuthModeBanner />
      <ErrorNote code={sp.error} />
      {sp.resent === '1' ? (
        <p role="status" data-testid="auth-resent">
          If that address has an unconfirmed account, a new confirmation email is on its way.
        </p>
      ) : null}
      {sp.deleted === '1' ? (
        <p role="status" data-testid="account-deletion-notice">
          Your account is scheduled for deletion. It is removed at the next scheduled clean-up, normally within 24 hours.
        </p>
      ) : null}
      <LinkErrorAndResend serverCode={typeof sp.error === 'string' ? sp.error : undefined} next={next} />
      <form action={signInAction} style={formStyle}>
        <input type="hidden" name="next" value={next} />
        <Input label="Email" name="email" type="email" autoComplete="email" required />
        <Input label="Password" name="password" type="password" autoComplete="current-password" required />
        <Button type="submit">Sign in</Button>
      </form>
      <p>
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
      <p>
        New here? <Link href={next === '/' ? '/sign-up' : `/sign-up?next=${encodeURIComponent(next)}`}>Create an account</Link>
      </p>
    </AuthCard>
  );
}
