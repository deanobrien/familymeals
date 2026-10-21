import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import type { AccountSettings, HouseholdSummary } from '@/data/accountSource';
import { messageOf } from '@/lib/accountErrors';
import { MAX_EXCLUSIONS, parseExclusionTag, parsePreferences } from '@/lib/accountForms';
import { DEFAULT_DEVICE_PREFS, loadDevicePrefs, saveDevicePrefs, type DevicePrefs } from '@/lib/devicePrefs';
import {
  COMMON_EXCLUSIONS,
  CONSENT_CHECKBOX_LABEL,
  CONSENT_WORDING_V1,
  DIETARY_HELP,
  PRIVACY_PATH,
  SOURCES_PATH,
  WEB_SETTINGS_PATH,
  consentNoticeText,
} from '@/lib/privacyText';
import { openWeb, webUrl } from '@/lib/webLinks';
import { Button, ErrorText, Loading, Muted, Text, useStyles } from './ui';
import DislikesSection from './account/DislikesSection';
import { Card, Checkbox, Field, NoHousehold, Notice, ReadOnlyBanner, Row, SectionTitle, Segmented, confirm, useActiveHousehold, useAction } from './account/parts';

/**
 * Settings tab (web: /settings). Account + sign out, household shortcuts, preferences, allergies with special-category
 * consent (the web wording, verbatim), AI provider (web only: a note, D310), privacy and sources (web pages), and "Your data"
 * with account deletion reachable in two taps (Settings tab, then "Delete my account"; Google Play requires it in the app).
 */
export default function SettingsScreen() {
  const { ds, householdId, setHouseholdId } = useApp();
  const router = useRouter();
  const styles = useStyles();
  const { household, error: loadError, reload } = useActiveHousehold();
  const [email, setEmail] = useState<string | null>(null);
  const cancel = useAction();

  useEffect(() => {
    let alive = true;
    ds.getSession().then(
      (s) => alive && setEmail(s?.email ?? null),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [ds]);

  async function signOut() {
    await ds.signOut();
    setHouseholdId(null);
    router.replace('/sign-in');
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} style={styles.screen} keyboardShouldPersistTaps="handled">
      <SectionTitle>Account</SectionTitle>
      <Card testID="account-card">
        <Text testID="account-email">{email ?? 'Signed in'}</Text>
        <Button title="Sign out" variant="secondary" onPress={() => void signOut()} testID="sign-out" />
      </Card>

      {!householdId ? (
        <NoHousehold />
      ) : !household ? (
        loadError ? <ErrorText message={loadError} /> : <Loading label="Loading settings" />
      ) : (
        <>
          <ReadOnlyBanner
            household={household}
            busy={cancel.busy}
            onCancel={() =>
              void cancel.run(async () => {
                await ds.account.cancelHouseholdDeletion(household.id);
                await reload();
              })
            }
          />
          <ErrorText message={cancel.error} />
          <SectionTitle>Household</SectionTitle>
          <Row title={household.name} subtitle={`Your role: ${household.role}. Members, invitations, leave.`} onPress={() => router.push('/household')} testID="open-household" />
          <Row title="Switch household" onPress={() => router.replace('/households')} testID="switch-household" />
          <Row title="Notifications" subtitle="Food to use soon, household updates, quiet hours, push on this phone." onPress={() => router.push('/notification-settings' as never)} testID="open-notification-settings" />
          <Row title="Calendar and busy evenings" subtitle="Optional: let your phone calendar or a calendar link mark busy evenings so the planner picks quick meals." onPress={() => router.push('/calendar-settings' as never)} testID="open-calendar-settings" />
          <PreferencesSection household={household} onSaved={reload} />
          <DietarySection household={household} />
          <DislikesSection household={household} />
        </>
      )}

      <SectionTitle>AI provider</SectionTitle>
      <Card testID="ai-note">
        <Text>Manage AI provider on the website.</Text>
        <Muted>The key stays on the server and is never shown or stored in this app.</Muted>
        {webUrl(WEB_SETTINGS_PATH) ? <Button title="Open website settings" variant="secondary" onPress={() => void openWeb(WEB_SETTINGS_PATH)} testID="open-web-settings" /> : null}
      </Card>

      <SectionTitle>About your data</SectionTitle>
      <Row title="Privacy notice" onPress={() => void openWeb(PRIVACY_PATH)} testID="open-privacy" />
      <Row title="Data sources and licences" onPress={() => void openWeb(SOURCES_PATH)} testID="open-sources" />
      {webUrl(PRIVACY_PATH) ? null : <Muted>Privacy and source pages open on the website; this build has no website address set.</Muted>}

      <SectionTitle>Your data</SectionTitle>
      <Row title="Export or delete your data" subtitle="Download a copy, delete the household, or delete your account." onPress={() => router.push('/your-data')} testID="open-your-data" />
      <Row title="Delete my account" subtitle="Leaves your households and removes your account." onPress={() => router.push('/delete-account')} testID="open-delete-account" danger />
    </ScrollView>
  );
}

function PreferencesSection({ household, onSaved }: { household: HouseholdSummary; onSaved: () => Promise<void> }) {
  const { ds } = useApp();
  const [servings, setServings] = useState(String(household.defaultServings));
  const [budget, setBudget] = useState(household.weeklyBudgetPence === null ? '' : (household.weeklyBudgetPence / 100).toFixed(2).replace(/\.00$/, ''));
  const [device, setDevice] = useState<DevicePrefs>(DEFAULT_DEVICE_PREFS);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const isOwner = household.role === 'owner';
  const readOnly = household.status === 'pending_deletion';

  useEffect(() => {
    void loadDevicePrefs().then(setDevice);
  }, []);

  async function save() {
    setSaved(false);
    const parsed = parsePreferences({ defaultServings: servings, weeklyBudgetPounds: budget });
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    const ok = await run(async () => {
      await saveDevicePrefs(device);
      if (isOwner) await ds.account.savePreferences(household.id, parsed.value);
      return true;
    });
    if (ok) {
      setSaved(true);
      if (isOwner) await onSaved();
    }
  }

  const locked = !isOwner || readOnly;
  return (
    <View>
      <SectionTitle>Household preferences</SectionTitle>
      <Field
        label="Default servings"
        value={servings}
        onChangeText={setServings}
        error={errors.defaultServings}
        keyboardType="number-pad"
        editable={!locked}
        hint={locked ? 'Only an owner can change household preferences.' : undefined}
        testID="pref-servings"
      />
      <Field
        label="Weekly food budget (£)"
        value={budget}
        onChangeText={setBudget}
        error={errors.weeklyBudgetPounds}
        keyboardType="decimal-pad"
        editable={!locked}
        hint="Optional."
        testID="pref-budget"
      />
      <Muted style={{ marginBottom: 12 }}>Currency: pounds sterling (GBP). Only pounds are supported for now.</Muted>
      <Segmented
        label="Locale"
        value={device.locale}
        onChange={(locale) => setDevice((d) => ({ ...d, locale }))}
        options={[
          { value: 'en-GB', label: 'United Kingdom' },
          { value: 'en-IE', label: 'Ireland' },
        ]}
        testID="pref-locale"
      />
      <Segmented
        label="Show units as"
        value={device.units}
        onChange={(units) => setDevice((d) => ({ ...d, units }))}
        options={[
          { value: 'metric', label: 'Metric (g, ml)' },
          { value: 'imperial', label: 'Imperial (oz, fl oz)' },
        ]}
        testID="pref-units"
      />
      <Muted style={{ marginBottom: 8 }}>Display only, on this phone. Your recipes keep their original quantities.</Muted>
      <Segmented
        label="Scan sound"
        value={device.scanSound ? 'on' : 'off'}
        onChange={(v) => setDevice((d) => ({ ...d, scanSound: v === 'on' }))}
        options={[
          { value: 'on', label: 'Beep on each scan' },
          { value: 'off', label: 'Silent' },
        ]}
        testID="pref-scan-sound"
      />
      <ErrorText message={error} />
      <Notice message={saved ? 'Preferences saved' : null} testID="prefs-saved" />
      <Button title={busy ? 'Saving...' : 'Save preferences'} onPress={save} disabled={busy} testID="pref-save" />
    </View>
  );
}

function DietarySection({ household }: { household: HouseholdSummary }) {
  const { ds } = useApp();
  const [loaded, setLoaded] = useState<AccountSettings | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const readOnly = household.status === 'pending_deletion';

  const load = useCallback(async () => {
    try {
      const s = await ds.account.getSettings(household.id);
      setLoaded(s);
      setSelected(s.exclusions.map((e) => e.term));
      setConsent(s.consentActive);
    } catch (e) {
      setErrors({ load: messageOf(e) });
    }
  }, [ds, household.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (tag: string) => setSelected((p) => (p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag]));

  function addCustom() {
    if (!custom.trim()) return;
    const r = parseExclusionTag(custom);
    if (!r.ok) {
      setErrors((e) => ({ ...e, custom: r.error }));
      return;
    }
    if (selected.length >= MAX_EXCLUSIONS) {
      setErrors((e) => ({ ...e, custom: 'Too many exclusions' }));
      return;
    }
    setErrors((e) => ({ ...e, custom: '' }));
    setSelected((p) => (p.includes(r.value) ? p : [...p, r.value]));
    setCustom('');
  }

  async function save() {
    setNotice(null);
    if (selected.length > 0 && !consent) {
      setErrors({ consent: 'Please tick the box to agree before saving dietary information' });
      return;
    }
    setErrors({});
    const ok = await run(async () => {
      await ds.account.saveExclusions(household.id, selected, consent);
      return true;
    });
    if (ok) {
      setNotice('Dietary information saved');
      await load();
    }
  }

  async function withdraw() {
    setNotice(null);
    const ok = await run(async () => {
      await ds.account.withdrawConsent(household.id);
      return true;
    });
    if (ok) {
      setNotice('Consent withdrawn. Your list is kept but is not applied.');
      await load();
    }
  }

  async function removeAll() {
    if (!(await confirm('Remove all dietary information?', 'This deletes every allergy and exclusion we hold for your household and withdraws your consent. You can add them again at any time.', 'Remove everything'))) return;
    setNotice(null);
    const ok = await run(async () => {
      await ds.account.removeAllDietary(household.id);
      return true;
    });
    if (ok) {
      setNotice('All dietary information removed');
      await load();
    }
  }

  const extras = selected.filter((t) => !(COMMON_EXCLUSIONS as readonly string[]).includes(t));
  const withheldText = loaded ? consentNoticeText(loaded.withheldExclusions) : null;

  return (
    <View>
      <SectionTitle>Allergies and foods to avoid</SectionTitle>
      {withheldText ? <Notice message={`${withheldText}. Review your consent below.`} testID="consent-notice" /> : null}
      <Muted style={{ marginBottom: 8 }}>{DIETARY_HELP}</Muted>
      {errors.load ? <ErrorText message={errors.load} /> : null}
      <Text style={{ fontWeight: '600' }}>Exclude from meal suggestions</Text>
      {COMMON_EXCLUSIONS.map((tag) => (
        <Checkbox key={tag} label={tag} checked={selected.includes(tag)} onChange={() => toggle(tag)} testID={`excl-${tag}`} />
      ))}
      {extras.map((tag) => (
        <Checkbox key={tag} label={tag} checked onChange={() => toggle(tag)} testID={`excl-${tag}`} />
      ))}
      <Field
        label="Something else"
        value={custom}
        onChangeText={setCustom}
        error={errors.custom}
        onSubmitEditing={addCustom}
        autoCapitalize="none"
        testID="excl-custom"
      />
      <Button title="Add" variant="secondary" onPress={addCustom} testID="excl-add" />

      <Text style={{ fontWeight: '600', marginTop: 12 }}>Consent</Text>
      <Text testID="consent-wording">{CONSENT_WORDING_V1}</Text>
      <Checkbox label={CONSENT_CHECKBOX_LABEL} checked={consent} onChange={setConsent} testID="consent-checkbox" />
      {errors.consent ? <ErrorText message={errors.consent} /> : null}
      <Muted style={{ marginBottom: 8 }}>See the privacy notice below for how we handle this.</Muted>
      <ErrorText message={error} />
      <Notice message={notice} testID="dietary-notice" />
      <Button title={busy ? 'Saving...' : 'Save dietary information'} onPress={save} disabled={busy || readOnly} testID="dietary-save" />
      {loaded?.consentActive && selected.length > 0 ? (
        <Button title="Withdraw consent" variant="secondary" onPress={() => void withdraw()} disabled={busy || readOnly} testID="dietary-withdraw" />
      ) : null}
      <Button title="Remove all dietary information" variant="secondary" onPress={() => void removeAll()} disabled={busy || readOnly} testID="dietary-remove" />
    </View>
  );
}
