import Link from 'next/link';
import { Button, Input } from '@fr/ui';
import { forgotPasswordAction } from '../actions';
import { AuthCard, AuthModeBanner, ErrorNote, formStyle } from '../auth-bits';

export const metadata = { title: 'Reset your password' };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return (
    <AuthCard title="Reset your password">
      <AuthModeBanner />
      <ErrorNote code={sp.error} />
      {sp.sent === '1' ? (
        <p role="status">If that address has an account, a reset link is on its way.</p>
      ) : (
        <form action={forgotPasswordAction} style={formStyle}>
          <Input label="Email" name="email" type="email" autoComplete="email" required />
          <Button type="submit">Send reset link</Button>
        </form>
      )}
      <Link href="/sign-in">Back to sign in</Link>
    </AuthCard>
  );
}
