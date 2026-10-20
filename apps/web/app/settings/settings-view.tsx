'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { Badge, Button, Card, Checkbox, ConfirmDialog, Input, Select, useToast } from '@fr/ui';
import s from '../../lib/dashboard/dashboard.module.css';
import { AiProviderSection } from './ai-provider-section';
import { DataSection } from './data-section';
import type { DataSettingsView } from './data-view';
import type { AiSettingsView } from './ai-actions';
import type { HouseholdSettings } from '../../lib/server/settings/types';
import { removeAllDietaryAction, saveDietaryAction, savePreferencesAction, withdrawConsentAction } from './settings-actions';
import { DEFAULT_DISPLAY_PREFS, type DisplayPrefs } from './display-prefs';
import { SCAN_SOUND_KEY } from '../../lib/products/scan-feedback';
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

/** What the page loaded on the server: the household's saved settings (null = could not be read) and this browser's display choices. */
export interface SettingsInitial { settings: HouseholdSettings | null; display: DisplayPrefs }

const ERROR_TEXT: Record<string, string> = {
  forbidden: 'Only a household owner can change this.',
  read_only: 'This household is read-only while it is waiting to be deleted.',
  invalid_input: 'Some values were not accepted. Please check and try again.',
  unknown: 'Something went wrong. Please try again.',
};

export function SettingsView({ initial, ai, recipeSource, data }: { initial?: SettingsInitial; ai?: AiSettingsView; recipeSource?: RecipeSourceView; data?: DataSettingsView }) {
  return (
    <div className={s.page}>
      <h1>Settings</h1>
      <PreferencesSection initial={initial} isOwner={data?.isOwner ?? true} />
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
      <ExclusionsSection initial={initial?.settings ?? null} readOnly={data?.readOnly ?? false} />
      <PantrySection />
      <DataSection {...(data ? { data } : {})} />
    </div>
  );
}

function PreferencesSection({ initial, isOwner }: { initial: SettingsInitial | undefined; isOwner: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const saved = initial?.settings;
  const display = initial?.display ?? DEFAULT_DISPLAY_PREFS;
  const [values, setValues] = useState<PreferencesInput>({
    ...DEFAULT_PREFERENCES,
    defaultServings: String(saved?.defaultServings ?? 4),
    weeklyBudget: saved?.weeklyBudgetPence == null ? '' : (saved.weeklyBudgetPence / 100).toFixed(2).replace(/\.00$/, ''),
    units: display.units,
    locale: display.locale,
  });
  const [errors, setErrors] = useState<Errors>({});
  const [pending, startTransition] = useTransition();
  // Scan sound is a per-browser setting (like the Android app's): read after mount, applied immediately.
  const [scanSound, setScanSound] = useState(true);
  useEffect(() => {
    try {
      setScanSound(window.localStorage.getItem(SCAN_SOUND_KEY) !== 'off');
    } catch {
      /* default on */
    }
  }, []);
  const changeScanSound = (on: boolean) => {
    setScanSound(on);
    try {
      window.localStorage.setItem(SCAN_SOUND_KEY, on ? 'on' : 'off');
    } catch {
      /* not persisted */
    }
  };

  const set = (k: keyof PreferencesInput) => (v: string) => setValues((p) => ({ ...p, [k]: v }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const r = preferencesSchema.safeParse(values);
    if (!r.success) {
      setErrors(collectErrors(r.error.issues));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await savePreferencesAction(values);
      if (res.ok) {
        toast.toast({ message: 'Preferences saved' });
        router.refresh();
      } else if (res.fieldErrors && Object.keys(res.fieldErrors).length > 0) {
        setErrors(res.fieldErrors);
      } else {
        setErrors({ form: ERROR_TEXT[res.error] ?? ERROR_TEXT.unknown! });
      }
    });
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
        <Checkbox label="Beep when a barcode is scanned" checked={scanSound} onChange={(e) => changeScanSound(e.target.checked)} />
        {!isOwner && <p className={s.muted}>Only a household owner can change the servings and budget.</p>}
        {errors.form && (
          <p role="alert" style={{ margin: 0, color: 'var(--fr-danger)' }}>
            {errors.form}
          </p>
        )}
        <div>
          <Button type="submit" disabled={pending}>
            Save preferences
          </Button>
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

function ExclusionsSection({ initial, readOnly }: { initial: HouseholdSettings | null; readOnly: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(initial?.exclusions ?? []);
  const [custom, setCustom] = useState('');
  const [consent, setConsent] = useState(initial?.consentActive ?? false);
  const [onFile, setOnFile] = useState(initial?.consentActive ?? false);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, startTransition] = useTransition();

  function apply(res: Awaited<ReturnType<typeof saveDietaryAction>>, message: string) {
    if (res.ok) {
      setSelected(res.settings.exclusions);
      setConsent(res.settings.consentActive);
      setOnFile(res.settings.consentActive);
      setErrors({});
      toast.toast({ message });
      router.refresh(); // the consent notice above is rendered on the server
    } else if (res.fieldErrors && Object.keys(res.fieldErrors).length > 0) {
      setErrors(res.fieldErrors);
    } else {
      setErrors({ form: ERROR_TEXT[res.error] ?? ERROR_TEXT.unknown! });
    }
  }

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

  function submit(e: FormEvent) {
    e.preventDefault();
    const r = exclusionsSchema.safeParse({ tags: selected, consent });
    if (!r.success) {
      setErrors(collectErrors(r.error.issues));
      return;
    }
    setErrors({});
    startTransition(async () => apply(await saveDietaryAction({ tags: r.data.tags, consent }), 'Dietary information saved'));
  }

  function removeAll() {
    setConfirmRemove(false);
    startTransition(async () => apply(await removeAllDietaryAction(), 'All dietary information removed'));
  }

  function withdraw() {
    startTransition(async () => apply(await withdrawConsentAction(), 'Consent withdrawn. Your list is kept but is not applied.'));
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
        {errors.form && (
          <p role="alert" style={{ margin: 0, color: 'var(--fr-danger)' }}>
            {errors.form}
          </p>
        )}
        <div className={s.row}>
          <Button type="submit" disabled={pending || readOnly}>
            Save dietary information
          </Button>
          {onFile && selected.length > 0 && (
            <Button variant="secondary" onClick={withdraw} disabled={pending || readOnly}>
              Withdraw consent
            </Button>
          )}
          <Button variant="secondary" onClick={() => setConfirmRemove(true)} disabled={pending || readOnly}>
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
