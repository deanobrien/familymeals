'use client';

import { useActionState, useState } from 'react';
import { Button, Input, Select } from '@fr/ui';
import { inviteAction, type InviteState } from './actions';
import { messageFor } from '../../lib/server/auth/errors';

const initial: InviteState = {};

/** Owner invite form. Shows the one-time link with a copy button (email delivery is a TODO hook server-side). */
export function InviteForm() {
  const [state, action, pending] = useActionState(inviteAction, initial);
  const [copied, setCopied] = useState(false);
  const err = messageFor(state.error);
  return (
    <section aria-labelledby="invite-h" style={{ display: 'grid', gap: '0.75rem' }}>
      <h2 id="invite-h">Invite someone</h2>
      <form action={action} style={{ display: 'grid', gap: '0.75rem' }}>
        <Input label="Email (optional, locks the invite to this address)" name="email" type="email" autoComplete="off" />
        <Select
          label="Role"
          name="role"
          defaultValue="member"
          options={[
            { value: 'member', label: 'Member' },
            { value: 'owner', label: 'Owner' },
          ]}
        />
        <Select
          label="Expires after"
          name="ttlHours"
          defaultValue="168"
          options={[
            { value: '24', label: '1 day' },
            { value: '168', label: '7 days' },
            { value: '720', label: '30 days' },
          ]}
        />
        <Button type="submit" loading={pending}>
          Create invite link
        </Button>
      </form>
      {err && <p role="alert">{err}</p>}
      {state.link && (
        <div role="status" style={{ display: 'grid', gap: '0.5rem' }}>
          <p>Share this link with the person you are inviting. It is shown only once and works for one person.</p>
          <input readOnly aria-label="Invite link" value={state.link} onFocus={(e) => e.currentTarget.select()} style={{ width: '100%' }} />
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(state.link ?? '');
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
      )}
    </section>
  );
}
