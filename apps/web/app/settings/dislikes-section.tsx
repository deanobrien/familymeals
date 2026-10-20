'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, Input, useToast } from '@fr/ui';
import s from '../../lib/dashboard/dashboard.module.css';
import type { HouseholdSettings, MemberDislikes } from '../../lib/server/settings/types';
import { saveDislikesAction } from './settings-actions';
import { dislikeTag } from './schema';

/**
 * Foods each person does not like (P1-B, D378). A SOFT preference: the planner avoids them where it can and Discover sorts
 * them lower, but nothing is ever hidden because of them. Not an allergy and not health data: it needs no consent and is
 * separate from "Allergies and foods to avoid" above.
 */
export function DislikesSection({ initial, readOnly }: { initial: HouseholdSettings | null; readOnly: boolean }) {
  const members = initial?.members ?? [];
  return (
    <Card>
      <section className={s.card} aria-labelledby="h-dislikes" data-testid="dislikes-section" id="h-dislikes-section">
        <h2 id="h-dislikes">Foods people don&rsquo;t like</h2>
        <p className={s.muted}>
          Just a preference, not an allergy. Meal plans avoid these where they can, and recipe ideas with them are shown lower.
          Nothing is ever left out because of them. For allergies, use &ldquo;Allergies and foods to avoid&rdquo; above.
        </p>
        {members.length === 0 && <p className={s.muted}>No household members were found.</p>}
        <div style={{ display: 'grid', gap: '1rem' }}>
          {members.map((m) => (
            <MemberDislikesRow key={m.memberId} member={m} editable={!readOnly && (m.isSelf || (initial?.canEditAllDislikes ?? false))} />
          ))}
        </div>
      </section>
    </Card>
  );
}

function MemberDislikesRow({ member, editable }: { member: MemberDislikes; editable: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [terms, setTerms] = useState<string[]>(member.terms);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();
  const dirty = terms.join('|') !== member.terms.join('|');

  function add() {
    const r = dislikeTag.safeParse(text);
    if (!r.success) {
      if (text.trim()) setError(r.error.issues[0]?.message ?? 'Invalid');
      return;
    }
    setError(undefined);
    setTerms((p) => (p.includes(r.data) ? p : [...p, r.data]));
    setText('');
  }

  function save() {
    // A word typed but not yet added still counts.
    const pendingTag = dislikeTag.safeParse(text);
    const all = pendingTag.success && !terms.includes(pendingTag.data) ? [...terms, pendingTag.data] : terms;
    start(async () => {
      const res = await saveDislikesAction({ memberId: member.memberId, terms: all });
      if (res.ok) {
        const mine = res.settings.members.find((x) => x.memberId === member.memberId);
        setTerms(mine?.terms ?? all);
        setText('');
        setError(undefined);
        toast.toast({ message: `Saved what ${member.isSelf ? 'you don’t' : `${member.displayName} doesn’t`} like` });
        router.refresh();
      } else {
        setError(res.fieldErrors ? Object.values(res.fieldErrors)[0] : res.error === 'forbidden' ? 'You can only change your own list.' : 'Something went wrong. Please try again.');
      }
    });
  }

  return (
    <div data-testid="dislikes-member" style={{ display: 'grid', gap: '0.5rem' }}>
      <h3 style={{ margin: 0 }}>{member.displayName}{member.isSelf && <> <Badge>you</Badge></>}</h3>
      <ul aria-label={`${member.displayName} doesn't like`} style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {terms.length === 0 && <li className={s.muted}>Nothing added.</li>}
        {terms.map((t) => (
          <li key={t} data-testid="dislike-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', border: '1px solid var(--fr-border)', borderRadius: 999, padding: '0.125rem 0.625rem' }}>
            {t}
            {editable && (
              <button type="button" aria-label={`Remove ${t} for ${member.displayName}`} onClick={() => setTerms((p) => p.filter((x) => x !== t))}
                style={{ border: 0, background: 'none', cursor: 'pointer', minWidth: 28, minHeight: 28 }}>×</button>
            )}
          </li>
        ))}
      </ul>
      {editable ? (
        <>
          <div className={s.row}>
            <Input
              label={`Add a food ${member.displayName} doesn't like`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
              error={error}
              wrapperClassName=""
            />
            <Button variant="secondary" onClick={add} disabled={pending}>Add</Button>
          </div>
          <div className={s.row}>
            <Button onClick={save} disabled={pending || (!dirty && !text.trim())} loading={pending}>Save for {member.isSelf ? 'me' : member.displayName}</Button>
          </div>
        </>
      ) : (
        <p className={s.muted}>Only {member.displayName} or a household owner can change this list.</p>
      )}
    </div>
  );
}
