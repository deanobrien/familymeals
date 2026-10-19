import { Button, Input } from '@fr/ui';
import { resetPasswordAction } from '../actions';
import { AuthCard, AuthModeBanner, ErrorNote, formStyle } from '../auth-bits';

export const metadata = { title: 'Choose a new password' };

/** Reached via the emailed recovery link -> /auth/callback (which sets the session) -> here. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return (
    <AuthCard title="Choose a new password">
      <AuthModeBanner />
      <ErrorNote code={sp.error} />
      <form action={resetPasswordAction} style={formStyle}>
        <Input label="New password" name="password" type="password" autoComplete="new-password" minLength={10} hint="At least 10 characters." required />
        <Input label="Confirm new password" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
        <Button type="submit">Update password</Button>
      </form>
    </AuthCard>
  );
}
