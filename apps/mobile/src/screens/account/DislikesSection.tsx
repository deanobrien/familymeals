import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useApp } from '@/data/AppContext';
import type { AccountSettings, HouseholdSummary, MemberDislikes } from '@/data/accountSource';
import { messageOf } from '@/lib/accountErrors';
import { MAX_DISLIKES, parseDislikeTag } from '@/lib/accountForms';
import { Button, ErrorText, Muted, Text } from '../ui';
import { Chip, ChipWrap } from '../widgets';
import { Field, Notice, SectionTitle, useAction } from './parts';

/**
 * Foods each person does not like (P1-B, D378; web: Settings > Foods people don't like). A SOFT preference: meal plans avoid
 * them where they can and Discover shows them lower, but nothing is ever left out because of them. Not an allergy and not
 * health data, so there is no consent step and it is separate from "Allergies and foods to avoid". Everyone edits their own
 * list; a household owner can edit anyone's.
 */
export default function DislikesSection({ household }: { household: HouseholdSummary }) {
  const { ds } = useApp();
  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const readOnly = household.status === 'pending_deletion';

  const load = useCallback(async () => {
    try {
      setSettings(await ds.account.getSettings(household.id));
      setLoadError(null);
    } catch (e) {
      setLoadError(messageOf(e));
    }
  }, [ds, household.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View testID="dislikes-section">
      <SectionTitle>Foods people don&rsquo;t like</SectionTitle>
      <Muted style={{ marginBottom: 8 }}>
        Just a preference, not an allergy. Meal plans avoid these where they can, and recipe ideas with them are shown lower. Nothing is ever left out because of them. For allergies, use the section above.
      </Muted>
      {loadError ? <ErrorText message={loadError} /> : null}
      {settings && settings.members.length === 0 ? <Muted>No household members were found.</Muted> : null}
      {settings?.members.map((m) => (
        <MemberRow
          key={m.memberId}
          householdId={household.id}
          member={m}
          editable={!readOnly && (m.isSelf || settings.canEditAllDislikes)}
          onSaved={load}
        />
      ))}
    </View>
  );
}

function MemberRow({ householdId, member, editable, onSaved }: { householdId: string; member: MemberDislikes; editable: boolean; onSaved: () => Promise<void> }) {
  const { ds } = useApp();
  const [terms, setTerms] = useState<string[]>(member.terms);
  const [text, setText] = useState('');
  const [fieldError, setFieldError] = useState<string>('');
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const dirty = terms.join('|') !== member.terms.join('|');

  useEffect(() => setTerms(member.terms), [member.terms]);

  function add(): string[] | null {
    if (!text.trim()) return terms;
    const r = parseDislikeTag(text);
    if (!r.ok) {
      setFieldError(r.error);
      return null;
    }
    if (!terms.includes(r.value) && terms.length >= MAX_DISLIKES) {
      setFieldError(`Too many foods (${MAX_DISLIKES} at most)`);
      return null;
    }
    const next = terms.includes(r.value) ? terms : [...terms, r.value];
    setFieldError('');
    setTerms(next);
    setText('');
    return next;
  }

  async function save() {
    setNotice(null);
    const next = add(); // a word typed but not yet added still counts
    if (!next) return;
    const ok = await run(async () => {
      await ds.account.saveDislikes(householdId, member.memberId, next);
      return true;
    });
    if (ok) {
      setNotice(`Saved what ${member.isSelf ? 'you don’t' : `${member.displayName} doesn’t`} like`);
      await onSaved();
    }
  }

  return (
    <View style={{ marginBottom: 12 }} testID={`dislikes-${member.memberId}`}>
      <Text style={{ fontWeight: '600' }}>
        {member.displayName}
        {member.isSelf ? ' (you)' : ''}
      </Text>
      <ChipWrap>
        {terms.length === 0 ? <Muted>Nothing added.</Muted> : null}
        {terms.map((t) => (
          <Chip
            key={t}
            label={editable ? `${t}  ×` : t}
            accessibilityLabel={editable ? `Remove ${t} for ${member.displayName}` : t}
            onPress={() => editable && setTerms((p) => p.filter((x) => x !== t))}
            testID={`dislike-${member.memberId}-${t}`}
          />
        ))}
      </ChipWrap>
      {editable ? (
        <>
          <Field
            label={`Add a food ${member.displayName} doesn't like`}
            value={text}
            onChangeText={setText}
            error={fieldError}
            onSubmitEditing={() => void add()}
            testID={`dislike-input-${member.memberId}`}
          />
          <Button title="Add" variant="secondary" onPress={() => void add()} testID={`dislike-add-${member.memberId}`} />
          <ErrorText message={error} />
          <Notice message={notice} testID={`dislike-notice-${member.memberId}`} />
          <Button
            title={busy ? 'Saving...' : `Save for ${member.isSelf ? 'me' : member.displayName}`}
            onPress={() => void save()}
            disabled={busy || (!dirty && !text.trim())}
            testID={`dislike-save-${member.memberId}`}
          />
        </>
      ) : (
        <Muted>Only {member.displayName} or a household owner can change this list.</Muted>
      )}
    </View>
  );
}
