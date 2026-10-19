import Link from 'next/link';
import { Button, Input } from '@fr/ui';
import { safeNextPath } from '../../../lib/server/auth/next-path';
import { signUpAction } from '../actions';
import { AuthCard, AuthModeBanner, ErrorNote, formStyle } from '../auth-bits';

export const metadata = { title: 'Create account' };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === 'string' ? sp.next : undefined);
  const withNext = (path: string) => (next === '/' ? path : `${path}?next=${encodeURIComponent(next)}`);
  if (sp.sent === '1') {
    return (
      <AuthCard title="Check your email">
        <p role="status">If the address can be used, we have sent a confirmation link. Open it to finish creating your account.</p>
        <Link href={withNext('/sign-in')}>Back to sign in</Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Create your account">
      <AuthModeBanner />
      <ErrorNote code={sp.error} />
      <form action={signUpAction} style={formStyle}>
        <input type="hidden" name="next" value={next} />
        <Input label="Email" name="email" type="email" autoComplete="email" required />
        <Input label="Password" name="password" type="password" autoComplete="new-password" minLength={10} hint="At least 10 characters." required />
        <Button type="submit">Create account</Button>
      </form>
      <p>
        Already have an account? <Link href={withNext('/sign-in')}>Sign in</Link>
      </p>
      <p>
        By creating an account you agree to how we handle your data in our <Link href="/privacy">privacy notice</Link>.
      </p>
    </AuthCard>
  );
}
