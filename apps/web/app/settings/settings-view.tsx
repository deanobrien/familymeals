'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, Checkbox, ConfirmDialog, Input, Select, useToast } from '@fr/ui';
import s from '../../lib/dashboard/dashboard.module.css';
import { AiProviderSection } from './ai-provider-section';
import type { AiSettingsView } from './ai-actions';
import { consentEvent, defaultConsentSink, type ConsentSink } from './consent';
import {
  COMMON_EXCLUSIONS,
  CONSENT_CHECKBOX_LABEL,
  CONSENT_WORDING_V1,
  DEFAULT_PREFERENCES,
  exclusionsSchema,
  preferencesSchema,
  type PreferencesInput,
} from './schema';

type Errors = Record<string, string>;

function collectErrors(issues: { path: PropertyKey[]; message: string }[]): Errors {
  const out: Errors = {};
  for (const i of issues) {
    const key = String(i.path[0] ?? 'form');
    if (!(key in out)) out[key] = i.message;
  }
  return out;
}

/** Recipe discovery source status (D174). Never includes the key itself. */
export interface RecipeSourceView { label: string; keyKind: 'test' | 'supporter' | 'none'; note: string }

export function SettingsView({ consentSink = defaultConsentSink, ai, recipeSource }: { consentSink?: ConsentSink; ai?: AiSettingsView; recipeSource?: RecipeSourceView }) {
  return (
    <div className={s.page}>
      <h1>Settings</h1>
      <PreferencesSection />
      <AiProviderSection initial={ai} />
      {recipeSource && (
        <Card>
          <section className={s.card} aria-labelledby="h-recipe-source" data-testid="recipe-source-status">
            <h2 id="h-recipe-source">Recipe discovery</h2>
            <p>
              Source: <strong>{recipeSource.label}</strong>{' '}
              <Badge tone={recipeSource.keyKind === 'supporter' ? 'success' : 'warning'} data-testid="recipe-source-key">
                {recipeSource.keyKind === 'supporter' ? 'Supporter key' : recipeSource.keyKind === 'test' ? 'Test key' : 'Offline samples'}
              </Badge>
            </p>
            <p className={s.muted}>{recipeSource.note} The key is kept on the server and is never shown here.</p>
          </section>
        </Card>
      )}
      <Card>
        <section className={s.card} aria-labelledby="h-stores" data-testid="stores-link-card">
          <h2 id="h-stores">Stores and aisles</h2>
          <p className={s.muted}>Set up the shops you use and where things are, so your shopping list can follow the aisles.</p>
          <p><Link href="/settings/stores">Manage stores and aisles</Link></p>
        </section>
      </Card>
      <AiUsageSection />
      <ExclusionsSection sink={consentSink} />
      <PantrySection />
      <DataSection />
    </div>
  );
}

function PreferencesSection() {
  const toast = useToast();
  const [values, setValues] = useState<PreferencesInput>(DEFAULT_PREFERENCES);
  const [errors, setErrors] = useState<Errors>({});

  const set = (k: keyof PreferencesInput) => (v: string) => setValues((p) => ({ ...p, [k]: v }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const r = preferencesSchema.safeParse(values);
    if (!r.success) {
      setErrors(collectErrors(r.error.issues));
      return;
    }
    setErrors({});
    // TODO(Supabase): persist household settings.
    toast.toast({ message: 'Preferences saved' });
  }

  return (
    <Card>
      <form className={`${s.card} ${s.form}`} onSubmit={submit} noValidate aria-labelledby="h-prefs">
        <h2 id="h-prefs">Household preferences</h2>
        <Input
          label="Default servings"
          inputMode="numeric"
          value={values.defaultServings}
          onChange={(e) => set('defaultServings')(e.target.value)}
          error={errors.defaultServings}
        />
        <Select
          label="Currency"
          value={values.currency}
          onChange={(e) => set('currency')(e.target.value)}
          options={[{ value: 'GBP', label: 'Pounds sterling (GBP)' }]}
          hint="Only pounds are supported for now."
        />
        <Select
          label="Locale"
          value={values.locale}
          onChange={(e) => set('locale')(e.target.value)}
          options={[
            { value: 'en-GB', label: 'English (United Kingdom)' },
            { value: 'en-IE', label: 'English (Ireland)' },
          ]}
          error={errors.locale}
        />
        <Select
          label="Show units as"
          value={values.units}
          onChange={(e) => set('units')(e.target.value)}
          options={[
            { value: 'metric', label: 'Metric (g, ml)' },
            { value: 'imperial', label: 'Imperial (oz, fl oz)' },
          ]}
          hint="Display only. Your recipes keep their original quantities."
          error={errors.units}
        />
        <Input
          label="Weekly food budget (£)"
          inputMode="decimal"
          value={values.weeklyBudget}
          onChange={(e) => set('weeklyBudget')(e.target.value)}
          hint="Optional."
          error={errors.weeklyBudget}
        />
        <div>
          <Button type="submit">Save preferences</Button>
        </div>
      </form>
    </Card>
  );
}

function AiUsageSection() {
  return (
    <Card>
      <section className={s.card} aria-labelledby="h-ai">
        <h2 id="h-ai">AI usage</h2>
        <p className={s.muted}>
          A summary of how much your household has used AI features this month will appear here. We
          record only the amount of use, never the content.
        </p>
        <div className={s.row}>
          <Badge>Coming soon</Badge>
        </div>
      </section>
    </Card>
  );
}

function ExclusionsSection({ sink }: { sink: ConsentSink }) {
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmRemove, setConfirmRemove] = useState(false);

  const toggle = (tag: string) =>
    setSelected((p) => (p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag]));

  function addCustom() {
    const v = custom.trim().toLowerCase();
    if (!v) return;
    const r = exclusionsSchema.safeParse({ tags: [v], consent: true });
    if (!r.success) {
      setErrors({ custom: r.error.issues[0]?.message ?? 'Invalid' });
      return;
    }
    setErrors({});
    setSelected((p) => (p.includes(v) ? p : [...p, v]));
    setCustom('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = exclusionsSchema.safeParse({ tags: selected, consent });
    if (!r.success) {
      setErrors(collectErrors(r.error.issues));
      return;
    }
    setErrors({});
    if (r.data.tags.length > 0) await sink.record(consentEvent(true));
    // TODO(Supabase): persist exclusion tags on the household.
    toast.toast({ message: 'Dietary information saved' });
  }

  async function removeAll() {
    setConfirmRemove(false);
    setSelected([]);
    setConsent(false);
    await sink.record(consentEvent(false));
    // TODO(Supabase): delete dietary values and mark consent withdrawn.
    toast.toast({ message: 'All dietary information removed' });
  }

  const extras = selected.filter((t) => !(COMMON_EXCLUSIONS as readonly string[]).includes(t));

  return (
    <Card>
      <form className={`${s.card} ${s.form}`} onSubmit={submit} noValidate aria-labelledby="h-diet">
        <h2 id="h-diet">Allergies and foods to avoid</h2>
        <p className={s.muted}>
          Optional. The app works without this. Please do not enter medical conditions or
          medication. This helps filter plans but is not an allergen safety guarantee: always check
          product labels.
        </p>
        <fieldset className={s.fieldset}>
          <legend>Exclude from meal suggestions</legend>
          <div className={s.checks}>
            {COMMON_EXCLUSIONS.map((tag) => (
              <Checkbox
                key={tag}
                label={tag}
                checked={selected.includes(tag)}
                onChange={() => toggle(tag)}
              />
            ))}
            {extras.map((tag) => (
              <Checkbox key={tag} label={tag} checked onChange={() => toggle(tag)} />
            ))}
          </div>
          <div className={s.row}>
            <Input
              label="Something else"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustom();
                }
              }}
              error={errors.custom}
              wrapperClassName=""
            />
            <Button variant="secondary" onClick={addCustom}>
              Add
            </Button>
          </div>
        </fieldset>
        <fieldset className={s.fieldset}>
          <legend>Consent</legend>
          <p id="consent-wording" style={{ margin: 0 }}>
            {CONSENT_WORDING_V1}
          </p>
          <Checkbox
            label={CONSENT_CHECKBOX_LABEL}
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            aria-describedby="consent-wording"
          />
          {errors.consent && (
            <p role="alert" style={{ margin: 0, color: 'var(--fr-danger)' }}>
              {errors.consent}
            </p>
          )}
          <p className={s.muted}>
            See our <Link className={s.link} href="/privacy">privacy notice</Link>.
          </p>
        </fieldset>
        <div className={s.row}>
          <Button type="submit">Save dietary information</Button>
          <Button variant="secondary" onClick={() => setConfirmRemove(true)}>
            Remove all dietary information
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove all dietary information?"
        description="This deletes every allergy and exclusion we hold for your household and withdraws your consent. You can add them again at any time."
        confirmLabel="Remove everything"
        destructive
        onConfirm={removeAll}
      />
    </Card>
  );
}

function PantrySection() {
  return (
    <Card>
      <section className={s.card} aria-labelledby="h-pantry">
        <h2 id="h-pantry">Pantry</h2>
        <p className={s.muted}>
          Choose what happens to your pantry when you mark shopping as bought.
        </p>
        {/* TODO: pantry route owned by another lane; confirm href. */}
        <Link className={s.link} href="/pantry">Pantry and post-purchase behaviour</Link>
      </section>
    </Card>
  );
}

function DataSection() {
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exportRequested, setExportRequested] = useState(false);
  const [deleteRequested, setDeleteRequested] = useState(false);

  function requestExport() {
    // TODO: POST /api/export (DATA-EXPORT-DELETION.md section 1).
    setExportRequested(true);
    toast.toast({ message: 'Export requested. We will let you know when it is ready.' });
  }

  function requestDelete() {
    // TODO: DELETE /api/household/:id (sets pending_deletion, purge after 14 days; re-auth required).
    setConfirmDelete(false);
    setDeleteRequested(true);
    toast.toast({ message: 'Household deletion scheduled' });
  }

  return (
    <Card>
      <section className={s.card} aria-labelledby="h-data">
        <h2 id="h-data">Your data</h2>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Export my data</h3>
          <p className={s.muted}>
            Download your recipes, plans, lists and purchase history. You can request one export
            every 24 hours; the download link works for 24 hours.
          </p>
          <div className={s.row}>
            <Button variant="secondary" onClick={requestExport} disabled={exportRequested}>
              {exportRequested ? 'Export requested' : 'Request data export'}
            </Button>
          </div>
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Delete household</h3>
          <p className={s.muted}>
            Deleting the household removes all recipes, plans and lists for every member. You then
            have 14 days to change your mind; only the owner can cancel. After that everything is
            permanently deleted, and it disappears from our backups within a further 14 days.
          </p>
          <div className={s.row}>
            <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={deleteRequested}>
              {deleteRequested ? 'Deletion scheduled' : 'Delete household'}
            </Button>
          </div>
        </div>
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this household?"
          description="This deletes all recipes, plans and lists. All members will be notified. You have 14 days to cancel before it is permanent."
          confirmLabel="Delete household"
          destructive
          onConfirm={requestDelete}
        />
      </section>
    </Card>
  );
}
