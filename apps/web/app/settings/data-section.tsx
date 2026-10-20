'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Badge, Button, Card, Dialog, Input } from '@fr/ui';
import s from '../../lib/dashboard/dashboard.module.css';
import { AUTH_ERROR_MESSAGES, isAuthErrorCode } from '../../lib/server/auth/errors';
import {
  cancelAccountDeletionAction,
  cancelHouseholdDeletionAction,
  requestAccountDeletionAction,
  requestHouseholdDeletionAction,
  type DataActionState,
} from './data-actions';
import { DATA_ERRORS, DATA_NOTICES, DEFAULT_DATA_VIEW, daysLeft, formatDate, formatTime, type DataSettingsView } from './data-view';

function messageOf(code: string | undefined | null): string | null {
  if (!code) return null;
  if (code in DATA_ERRORS) return DATA_ERRORS[code]!;
  return isAuthErrorCode(code) ? AUTH_ERROR_MESSAGES[code] : null;
}

const h3 = { margin: 0, fontSize: '1rem' } as const;

/** Settings > Your data (DX1): export, household deletion (grace countdown + cancel), account deletion. */
export function DataSection({ data = DEFAULT_DATA_VIEW }: { data?: DataSettingsView }) {
  const notice = data.notice ? (DATA_NOTICES[data.notice] ?? messageOf(data.notice)) : null;
  return (
    <Card>
      <section className={s.card} aria-labelledby="h-data" id="your-data" data-testid="your-data">
        <h2 id="h-data">Your data</h2>
        {notice && (
          <p role="status" data-testid="data-notice">
            {notice}
          </p>
        )}
        <ExportBlock data={data} />
        <HouseholdDeletionBlock data={data} />
        <AccountDeletionBlock data={data} />
        <p className={s.muted}>
          How we handle your data: <Link className={s.link} href="/privacy">privacy notice</Link>.
        </p>
      </section>
    </Card>
  );
}

type ExportState =
  | { kind: 'idle' }
  | { kind: 'busy'; scope: 'member' | 'household' }
  | { kind: 'ready'; scope: 'member' | 'household'; url: string; expiresAt: string }
  | { kind: 'error'; message: string };

function ExportBlock({ data }: { data: DataSettingsView }) {
  const [state, setState] = useState<ExportState>({ kind: 'idle' });

  async function start(scope: 'member' | 'household') {
    setState({ kind: 'busy', scope });
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      const body = (await res.json().catch(() => ({}))) as { downloadUrl?: string; expiresAt?: string; retryAfter?: string };
      if (res.status === 201 && body.downloadUrl && body.expiresAt) {
        setState({ kind: 'ready', scope, url: body.downloadUrl, expiresAt: body.expiresAt });
      } else if (res.status === 429 && body.retryAfter) {
        setState({ kind: 'error', message: `You can request one export every 24 hours. Try again after ${formatDate(body.retryAfter)}, ${formatTime(body.retryAfter)}.` });
      } else if (res.status === 403) {
        setState({ kind: 'error', message: 'Only an owner can export the whole household.' });
      } else {
        setState({ kind: 'error', message: 'The export could not be started. Please try again.' });
      }
    } catch {
      setState({ kind: 'error', message: 'The export could not be started. Please try again.' });
    }
  }

  const busy = state.kind === 'busy';
  return (
    <div>
      <h3 style={h3}>Export your data</h3>
      <p className={s.muted}>
        Download a zip of your recipes, plans, shopping lists, purchase history, receipts, pantry, prices and consents,
        with photos. &ldquo;My data&rdquo; is what you created or recorded yourself; owners can also export the whole
        household. Other members&apos; email addresses and account details are never included. One export of each kind
        every 24 hours; the download link works for 1 hour.
      </p>
      <div className={s.row}>
        <Button variant="secondary" onClick={() => start('member')} loading={busy && state.scope === 'member'} disabled={busy}>
          Export my data
        </Button>
        {data.isOwner && (
          <Button variant="secondary" onClick={() => start('household')} loading={busy && state.scope === 'household'} disabled={busy}>
            Export whole household
          </Button>
        )}
      </div>
      {state.kind === 'ready' && (
        <p role="status" data-testid="export-ready">
          Your export is ready:{' '}
          <a className={s.link} href={state.url} download data-testid="export-download">
            download the zip
          </a>{' '}
          (link works until {formatTime(state.expiresAt)}).
        </p>
      )}
      {state.kind === 'error' && (
        <p role="alert" data-testid="export-error">
          {state.message}
        </p>
      )}
    </div>
  );
}

function ErrorLine({ code }: { code: string | undefined }) {
  const m = messageOf(code);
  return m ? (
    <p role="alert" style={{ margin: 0, color: 'var(--fr-danger)' }}>
      {m}
    </p>
  ) : null;
}

function HouseholdDeletionBlock({ data }: { data: DataSettingsView }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<DataActionState, FormData>(requestHouseholdDeletionAction, {});

  if (data.readOnly) {
    const when = data.purgeAfter;
    return (
      <div data-testid="household-deletion-pending">
        <h3 style={h3}>
          Household deletion scheduled <Badge tone="danger">Read-only</Badge>
        </h3>
        <p>
          {when ? (
            <>
              <strong>{data.householdName}</strong> will be permanently deleted on <strong>{formatDate(when)}</strong>{' '}
              (<span data-testid="grace-days">{daysLeft(when)}</span> {daysLeft(when) === 1 ? 'day' : 'days'} left).
            </>
          ) : (
            <>This household is pending deletion.</>
          )}{' '}
          Until then everyone can still view and export, but nothing can be changed.
        </p>
        {data.isOwner ? (
          <form action={cancelHouseholdDeletionAction}>
            <Button type="submit" variant="secondary">
              Cancel deletion
            </Button>
          </form>
        ) : (
          <p className={s.muted}>Only an owner can cancel the deletion.</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <h3 style={h3}>Delete household</h3>
      <p className={s.muted}>
        Deleting the household removes all recipes, plans, lists, receipts and photos for every member. The household
        becomes read-only and you then have 14 days to change your mind; only an owner can cancel. After that everything
        is permanently deleted, and it disappears from our backups within a further 14 days.
      </p>
      {data.isOwner ? (
        <div className={s.row}>
          <Button variant="danger" onClick={() => setOpen(true)}>
            Delete household
          </Button>
        </div>
      ) : (
        <p className={s.muted}>
          Only an owner can delete the household. You can leave it on the <Link className={s.link} href="/household">Household page</Link>.
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this household?"
        description="This deletes all recipes, plans and lists for every member after a 14-day grace period. During those 14 days the household is read-only and an owner can cancel."
      >
        <form action={action} className={s.form} data-testid="delete-household-form">
          <Input label={`Type the household name (${data.householdName}) to confirm`} name="confirmName" autoComplete="off" required />
          <Input label="Your password" name="password" type="password" autoComplete="current-password" required />
          <ErrorLine code={state.error} />
          <div className="fr-dialog__actions">
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
              Keep household
            </Button>
            <Button variant="danger" type="submit" loading={pending}>
              Delete household
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function AccountDeletionBlock({ data }: { data: DataSettingsView }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<DataActionState, FormData>(requestAccountDeletionAction, {});

  if (data.accountDeletionAt) {
    return (
      <div data-testid="account-deletion-pending">
        <h3 style={h3}>Account deletion scheduled</h3>
        <p>
          Your account will be deleted on <strong>{formatDate(data.accountDeletionAt)}</strong>, after your household
          deletion completes. Households you shared with others have already been left.
        </p>
        <form action={cancelAccountDeletionAction}>
          <Button type="submit" variant="secondary">
            Cancel account deletion
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <h3 style={h3}>Delete my account</h3>
      <p className={s.muted}>
        You leave every household you share with others straight away (what you added stays with them; purchases keep
        the name they were recorded under). A household where you are the only member is deleted after the 14-day
        grace period, and then your account, profile and consents are removed.
      </p>
      {data.soleOwnerWithOthers ? (
        <p role="note" data-testid="account-deletion-blocked">
          You are the only owner of <strong>{data.householdName}</strong>. Make someone else an owner on the{' '}
          <Link className={s.link} href="/household">Household page</Link> first.
        </p>
      ) : (
        <div className={s.row}>
          <Button variant="danger" onClick={() => setOpen(true)}>
            Delete my account
          </Button>
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Delete your account?"
        description={
          data.soleMember
            ? `You are the only member of ${data.householdName}, so it will be deleted too (after 14 days). Your account is deleted when that completes.`
            : 'You will leave your shared households now. Your account is deleted at the next scheduled clean-up, normally within 24 hours.'
        }
      >
        <form action={action} className={s.form} data-testid="delete-account-form">
          <Input label="Type DELETE to confirm" name="confirmText" autoComplete="off" required />
          <Input label="Your password" name="password" type="password" autoComplete="current-password" required />
          <ErrorLine code={state.error} />
          <div className="fr-dialog__actions">
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
              Keep my account
            </Button>
            <Button variant="danger" type="submit" loading={pending}>
              Delete my account
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
