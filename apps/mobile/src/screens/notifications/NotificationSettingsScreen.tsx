import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { ServerScreen } from '@/data/ServerApiContext';
import {
  CONFIGURABLE_TYPES,
  TEST_TEXT,
  TYPE_LABELS,
  getSettings,
  saveSettings,
  sendTestNotification,
  type ConfigurableType,
  type DeviceCounts,
  type NotificationSettings,
} from '@/lib/notificationsApi';
import { disablePush, enablePush, pushState, type PushState } from '@/lib/push';
import { ServerApiError, type ServerApi } from '@/lib/serverApi';
import { setNearStoreWanted } from '@/lib/geofence';
import { Field, OptionRow, Section } from '../widgets';
import { Button, ErrorState, Loading, Muted, Text, useStyles } from '../ui';

const HOURS = [5, 6, 7, 8, 9, 10, 11, 12].map((h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` }));
const LEAD = [
  { value: 0, label: 'On the day' },
  { value: 1, label: '1 day before' },
  { value: 2, label: '2 days' },
  { value: 3, label: '3 days' },
];
const ZONES = ['Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Madrid'];

export interface PushControls {
  state: () => Promise<PushState>;
  enable: typeof enablePush;
  disable: typeof disablePush;
}
const realPush: PushControls = { state: pushState, enable: enablePush, disable: disablePush };

function Toggle({ label, value, onChange, disabled, testID }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; testID: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
      <Muted style={{ flexShrink: 1, marginRight: 8 }}>{label}</Muted>
      <Switch accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, checked: value }} value={value} onValueChange={onChange} disabled={!!disabled} testID={testID} />
    </View>
  );
}

/** Notification settings (same settings, defaults and validation as the web page, D380). */
export function NotificationSettingsBody({ api, householdId, push = realPush }: { api: ServerApi; householdId: string; push?: PushControls }) {
  const styles = useStyles();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [devices, setDevices] = useState<DeviceCounts>({ web: 0, android: 0 });
  const [state, setState] = useState<PushState | 'checking'>('checking');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await getSettings(api, householdId);
      setSettings(r.settings);
      setDevices(r.devices);
      setState(await push.state());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Notification settings could not be loaded.');
    }
  }, [api, householdId, push]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error && !settings) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!settings) return <Loading label="Loading notification settings" />;

  const set = (patch: Partial<NotificationSettings>) => setSettings({ ...settings, ...patch });
  const setType = (t: ConfigurableType, inApp: boolean, p: boolean) => setSettings({ ...settings, types: { ...settings.types, [t]: { inApp, push: inApp && p } } });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ServerApiError && e.details && typeof e.details.error === 'object' && e.details.error) {
        const fe = (e.details.error as { fieldErrors?: Record<string, string> }).fieldErrors;
        if (fe) setFieldErrors(fe);
      }
      setMessage(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      setFieldErrors({});
      const r = await saveSettings(api, householdId, settings);
      setSettings(r.settings);
      void setNearStoreWanted(r.settings.types.near_store.inApp);
      setMessage('Notification settings saved.');
    });
  const turnOn = () =>
    run(async () => {
      const r = await push.enable(api, householdId);
      setState(r.state);
      if (r.devices) setDevices(r.devices);
      setMessage(r.state === 'on' ? 'Notifications are on for this phone.' : r.message ?? null);
    });
  const turnOff = () =>
    run(async () => {
      const d = await push.disable(api, householdId);
      if (d) setDevices(d);
      setState('off');
      setMessage('Notifications are off for this phone.');
    });
  const test = () =>
    run(async () => {
      setMessage(TEST_TEXT[await sendTestNotification(api, householdId)]);
    });

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">
        Notification settings
      </Text>
      <Muted>Your own choices for this household. The notification list in the app always works; push to this phone is optional.</Muted>

      <Section testID="push-section">
        <Text style={{ fontWeight: '700' }}>This phone</Text>
        <Muted testID="push-state">
          {state === 'checking' && 'Checking…'}
          {state === 'on' && 'Push notifications are on for this phone.'}
          {state === 'off' && 'Push notifications are off. Android will ask for permission when you turn them on.'}
          {state === 'denied' && 'Notifications are blocked for Family Recipes in Android settings. Allow them there, then come back.'}
          {state === 'unavailable' && 'This phone or build cannot receive push notifications. Everything still appears in the app.'}
        </Muted>
        {(state === 'off' || state === 'unavailable') && <Button title="Turn on notifications on this phone" onPress={() => void turnOn()} disabled={busy} testID="push-enable" />}
        {state === 'on' && <Button title="Turn off on this phone" variant="secondary" onPress={() => void turnOff()} disabled={busy} testID="push-disable" />}
        <Button title="Send a test notification" variant="secondary" onPress={() => void test()} disabled={busy} testID="send-test" />
        <Muted>
          Registered: {devices.android} Android phone{devices.android === 1 ? '' : 's'}, {devices.web} browser{devices.web === 1 ? '' : 's'}.
        </Muted>
        <Muted>Push messages never include allergy details, receipt contents or item names; they say what kind of update it is and open the app.</Muted>
      </Section>
      {message ? (
        <Text accessibilityRole="alert" testID="settings-message">
          {message}
        </Text>
      ) : null}

      <Section testID="types-section">
        <Text style={{ fontWeight: '700' }}>What to tell me about</Text>
        {CONFIGURABLE_TYPES.map((t) => {
          const p = settings.types[t];
          return (
            <View key={t} style={{ marginBottom: 8 }}>
              <Text style={{ fontWeight: '600' }}>{TYPE_LABELS[t].label}</Text>
              <Muted>{TYPE_LABELS[t].hint}</Muted>
              <Toggle label={`${TYPE_LABELS[t].label}: in the app`} value={p.inApp} onChange={(v) => setType(t, v, p.push)} testID={`type-${t}-inapp`} />
              <Toggle label={`${TYPE_LABELS[t].label}: push`} value={p.push} onChange={(v) => setType(t, p.inApp, v)} disabled={!p.inApp} testID={`type-${t}-push`} />
            </View>
          );
        })}
      </Section>

      <Section testID="quiet-section">
        <Text style={{ fontWeight: '700' }}>Quiet hours and timing</Text>
        <Toggle label="Hold push notifications during quiet hours" value={settings.quietEnabled} onChange={(v) => set({ quietEnabled: v })} testID="quiet-enabled" />
        <Field label="Quiet from (HH:MM)" value={settings.quietStart} onChangeText={(v) => set({ quietStart: v })} error={fieldErrors.quietStart} testID="quiet-start" />
        <Field label="Until (HH:MM)" value={settings.quietEnd} onChangeText={(v) => set({ quietEnd: v })} error={fieldErrors.quietEnd} testID="quiet-end" />
        <OptionRow
          label="Time zone"
          anyLabel={null}
          options={(ZONES.includes(settings.timeZone) ? ZONES : [settings.timeZone, ...ZONES]).map((z) => ({ value: z, label: z }))}
          value={settings.timeZone}
          onChange={(v) => v && set({ timeZone: v })}
        />
        <OptionRow label="Food reminders from" anyLabel={null} options={HOURS} value={settings.morningHour} onChange={(v) => v !== undefined && set({ morningHour: v })} testID="morning-hour" />
        <OptionRow label="Remind me" anyLabel={null} options={LEAD} value={settings.expiryLeadDays} onChange={(v) => v !== undefined && set({ expiryLeadDays: v })} testID="lead-days" />
      </Section>

      <Button title="Save notification settings" onPress={() => void save()} disabled={busy} testID="save-notification-settings" />
    </ScrollView>
  );
}

export default function NotificationSettingsScreen() {
  return <ServerScreen>{(api, householdId) => <NotificationSettingsBody api={api} householdId={householdId} />}</ServerScreen>;
}
