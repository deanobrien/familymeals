import React, { useState } from 'react';
import { View } from 'react-native';
import { describeError, type IdeaExtra, type PlanClient, type PlanFailure } from '@/lib/planApi';
import { slotKey } from '@/lib/plan/ops';
import { MEAL_TYPES, type BusyDay, type ParsedRequest, type PlanDoc, type PlanEntry, type PlanRequest, type Proposal, type RecipeLite } from '@/lib/plan/types';
import { Button, Muted, Text } from '../ui';
import ChipsEditor from './ChipsEditor';
import IdeasList from './IdeasList';
import { BusyChips } from './LeftoverParts';
import { Field, Notice, Section } from './parts';
import ProposalReview from './ProposalReview';

/** What "Accept into week" does to the grid: the proposal replaces the entries and stays an unsaved draft (as on the web). */
export function proposalToDoc(p: Proposal, doc: PlanDoc): PlanDoc {
  const entries: Record<string, PlanEntry> = {};
  for (const s of p.slots) {
    if (s.recipeId) entries[slotKey({ date: s.date, mealType: s.mealType })] = { kind: 'recipe', recipeId: s.recipeId, servings: s.servings, ...(s.note ? { note: s.note } : {}) };
  }
  const mealTypes = MEAL_TYPES.filter((m) => p.mealTypes.includes(m));
  return {
    ...doc, entries, mealTypes: mealTypes.length ? mealTypes : doc.mealTypes,
    ...(p.budgetPence !== undefined ? { budgetPence: p.budgetPence } : {}),
    prompt: p.prompt, ...(p.id ? { proposalId: p.id } : {}), status: 'draft',
  };
}

/** Only what the user's own request adds; the household's hard exclusions are re-applied on the server. */
const ideaExtra = (r: PlanRequest | null): IdeaExtra => ({ terms: r?.excludeTerms ?? [], allergens: r?.excludeAllergens ?? [], excludeDiets: r?.excludeDietCategories ?? [] });

interface Props {
  client: PlanClient;
  weekStart: string;
  recipes: ReadonlyMap<string, RecipeLite>;
  examplePrompt: string;
  exclusions: string[];
  dislikes?: { memberName: string; terms: string[] }[];
  memberNames: string[];
  /** This week's busy evenings, shown before the request is read (P2-C). */
  busy?: readonly BusyDay[];
  onAccept: (next: (doc: PlanDoc) => PlanDoc) => void;
}

/** Prompt -> "Understand my request" (the one AI call) -> editable chips -> "Propose plan" (no AI) -> review -> accept. */
export default function PromptPlanner({ client, weekStart, recipes, examplePrompt, exclusions, memberNames, dislikes, busy: weekBusy, onAccept }: Props) {
  const [prompt, setPrompt] = useState(examplePrompt);
  const [parsed, setParsed] = useState<ParsedRequest | null>(null);
  const [request, setRequest] = useState<PlanRequest | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [failure, setFailure] = useState<(PlanFailure & { where: 'parse' | 'solve' }) | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState<'parse' | 'solve' | null>(null);

  async function understand() {
    setBusy('parse');
    setAccepted(false);
    setProposal(null);
    setFailure(null);
    try {
      const r = await client.parse(prompt, weekStart);
      setParsed(r);
      setRequest(r.request);
    } catch (e) {
      setParsed(null);
      setRequest(null);
      setFailure({ ...describeError(e), where: 'parse' });
    } finally {
      setBusy(null);
    }
  }

  async function propose() {
    if (!request) return;
    setBusy('solve');
    setAccepted(false);
    setFailure(null);
    try {
      setProposal(await client.solve(prompt, weekStart, request));
    } catch (e) {
      setProposal(null);
      setFailure({ ...describeError(e), where: 'solve' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="Plan from a prompt" testID="prompt-planner">
      <Field label="Describe the week you want" value={prompt} onChangeText={setPrompt} multiline maxLength={1500} testID="prompt-input" />
      <Muted>Allergies and strict exclusions in your household profile are always applied, whatever you type.</Muted>
      {!parsed && weekBusy && weekBusy.length > 0 ? <BusyChips busy={weekBusy.map((d) => ({ date: d.date, skip: d.skip, minutesAvailable: d.minutesAvailable, sources: d.sources }))} /> : null}
      {examplePrompt ? <Button title="Use the example prompt" variant="secondary" onPress={() => setPrompt(examplePrompt)} testID="example-prompt" /> : null}
      <Button
        title={busy === 'parse' ? 'Reading your request...' : request ? 'Read my request again' : 'Understand my request'}
        variant={request ? 'secondary' : 'primary'}
        disabled={!prompt.trim() || busy !== null}
        onPress={() => void understand()}
        testID="understand"
      />

      {failure?.where === 'parse' ? <Notice tone="error" testID="parse-error" text={failure.message} /> : null}

      {request && parsed ? (
        <View>
          <BusyChips busy={parsed.busy} />
          <ChipsEditor request={request} onChange={setRequest} locked={parsed.householdExclusions} memberNames={memberNames} notes={parsed.notes} {...(dislikes ? { dislikes } : {})} />
          <Button
            title={busy === 'solve' ? 'Planning...' : proposal ? 'Re-plan with these settings' : 'Propose a plan'}
            disabled={busy !== null}
            onPress={() => void propose()}
            testID="propose"
          />
        </View>
      ) : null}

      {failure?.where === 'solve' ? (
        <Notice tone="error" testID="proposal-error" text={failure.message} items={[...failure.unmet, ...failure.violations]}>
          {failure.gapCount > 0 ? <Text>{`${failure.gapCount} slot${failure.gapCount === 1 ? '' : 's'} would need a new recipe.`}</Text> : null}
          <IdeasList client={client} needs={failure.gapNeeds} extra={ideaExtra(request)} />
        </Notice>
      ) : null}

      {proposal ? (
        <ProposalReview
          proposal={proposal}
          recipes={recipes}
          client={client}
          extra={ideaExtra(request)}
          accepted={accepted}
          onAccept={() => { onAccept((d) => proposalToDoc(proposal, d)); setAccepted(true); }}
          onDiscard={() => { setProposal(null); setAccepted(false); }}
        />
      ) : null}
      {exclusions.length > 0 ? <Muted>{`Always excluded for your household: ${exclusions.join(', ')}.`}</Muted> : null}
    </Section>
  );
}
