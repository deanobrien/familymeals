'use client';

// Create, copy and switch off share links (P3-A, D420-D424). Used on a recipe (one recipe) and on /recipes/shared (collections and
// the household's whole list). The link is shown once, right after it is made: only its hash is stored, so it cannot be shown again.
import { useState, useTransition } from 'react';
import { Badge, Button, Checkbox, Select } from '@fr/ui';
import { SHARE_EXPIRY_CHOICES, type ShareScope, type ShareSummary } from '../../../../lib/sharing/types';
import { createShareAction, revokeShareAction } from '../../share-actions';
import s from '../../../pantry/pantry.module.css';

interface NewLink {
  url: string;
  title: string;
  expiresAt: string | null;
  publicPreview: boolean;
}

const expiryValue = (d: number | null): string => (d === null ? 'never' : String(d));
const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'never');

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function LinkBox({ link, onDone }: { link: NewLink; onDone: () => void }) {
  const [note, setNote] = useState('');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <div className={s.stale} role="status" data-testid="new-share-link">
      <p style={{ margin: 0 }}>
        <strong>Link ready.</strong> Anyone with it can read {link.title} and save a copy; it {link.expiresAt ? `stops working on ${when(link.expiresAt)}` : 'does not expire'}. Switch it off any time below.
        This is the only time the link is shown.
      </p>
      <input readOnly value={link.url} aria-label="Share link" data-testid="share-link-input" onFocus={(e) => e.currentTarget.select()} style={{ width: '100%', marginTop: 8, minHeight: 44 }} />
      <div className={s.actions} style={{ marginTop: 8 }}>
        <Button size="sm" onClick={async () => setNote((await copyText(link.url)) ? 'Copied.' : 'Select the link and copy it.')} data-testid="copy-share-link">Copy link</Button>
        {canShare && (
          <Button size="sm" variant="secondary" onClick={() => void navigator.share({ title: link.title, url: link.url }).catch(() => undefined)}>Share...</Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDone}>Done</Button>
        <span className={s.muted} aria-live="polite">{note}</span>
      </div>
    </div>
  );
}

export interface CreateShareFormProps {
  scope: ShareScope;
  /** recipe scope: the one recipe. collection scope: the recipes chosen. */
  recipeIds?: string[];
  collection?: 'favourites' | 'quick' | 'budget' | 'vegetarian';
  title?: string;
  /** What the link is about, for the confirmation ("Chilli", "Quick meals"). */
  label: string;
  onCreated?: () => void;
}

export function CreateShareForm({ scope, recipeIds, collection, title, label, onCreated }: CreateShareFormProps) {
  const [days, setDays] = useState<number | null>(30);
  const [pub, setPub] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState<NewLink | null>(null);
  const [pending, start] = useTransition();

  const create = () =>
    start(async () => {
      setError('');
      const r = await createShareAction({ scope, ...(recipeIds ? { recipeIds } : {}), ...(collection ? { collection } : {}), ...(title ? { title } : {}), expiresInDays: days, publicPreview: pub });
      if (!r.ok) return setError(r.fieldErrors ? Object.values(r.fieldErrors).join(' ') : r.message);
      setLink({ url: `${window.location.origin}${r.share.path}`, title: label, expiresAt: r.share.expiresAt, publicPreview: pub });
      onCreated?.();
    });

  if (link) return <LinkBox link={link} onDone={() => setLink(null)} />;
  return (
    <div className={s.inlineForm} data-testid="create-share-form">
      <Select
        label="Link works for"
        value={expiryValue(days)}
        onChange={(e) => setDays(e.target.value === 'never' ? null : Number(e.target.value))}
        options={SHARE_EXPIRY_CHOICES.map((c) => ({ value: expiryValue(c.days), label: c.label }))}
      />
      <Checkbox
        label="Let people see it without signing in (text only, no photos)"
        checked={pub}
        onChange={(e) => setPub(e.target.checked)}
      />
      <Button onClick={create} loading={pending} data-testid="create-share">Create link</Button>
      {error && <p role="alert" className={s.error}>{error}</p>}
    </div>
  );
}

const STATUS_TONE = { active: 'accent', expired: 'warning', revoked: 'neutral' } as const;

export function ShareList({ shares, onChanged }: { shares: ShareSummary[]; onChanged?: () => void }) {
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<string | null>(null);

  const revoke = (id: string) =>
    start(async () => {
      setError('');
      const r = await revokeShareAction(id);
      setConfirm(null);
      if (!r.ok) return setError(r.message);
      onChanged?.();
    });

  if (shares.length === 0) return <p className={s.lead} data-testid="no-shares">No links yet.</p>;
  return (
    <>
      {error && <p role="alert" className={s.error}>{error}</p>}
      <ul className={s.list} data-testid="share-list">
        {shares.map((sh) => (
          <li key={sh.id} data-testid={`share-${sh.id}`}>
            <div className={s.row}>
              <div className={s.rowMain}>
                <span className={s.name}>{sh.scope === 'collection' ? (sh.title ?? 'Collection') : (sh.recipes[0]?.title ?? 'Recipe')}</span>
                <span className={s.muted}>
                  {sh.scope === 'collection' ? `${sh.recipes.length} recipe${sh.recipes.length === 1 ? '' : 's'} · ` : ''}
                  made {when(sh.createdAt)} · {sh.expiresAt ? `${sh.status === 'expired' ? 'expired' : 'expires'} ${when(sh.expiresAt)}` : 'no expiry'}
                  {sh.publicPreview ? ' · readable without signing in' : ''}
                </span>
                <span className={s.muted}>Opened by {sh.openedBy} {sh.openedBy === 1 ? 'person' : 'people'} · {sh.saved} saved</span>
              </div>
              <div className={s.badges}>
                <Badge tone={STATUS_TONE[sh.status]}>{sh.status === 'active' ? 'On' : sh.status === 'expired' ? 'Expired' : 'Switched off'}</Badge>
                {sh.status === 'active' &&
                  (confirm === sh.id ? (
                    <>
                      <Button size="sm" variant="danger" loading={pending} onClick={() => revoke(sh.id)} data-testid={`confirm-revoke-${sh.id}`}>Yes, switch off</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Keep it</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setConfirm(sh.id)} aria-label={`Switch off the link for ${sh.title ?? sh.recipes[0]?.title ?? 'this recipe'}`} data-testid={`revoke-${sh.id}`}>Switch off</Button>
                  ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
