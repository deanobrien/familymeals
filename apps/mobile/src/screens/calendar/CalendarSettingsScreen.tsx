import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { ServerScreen } from '@/data/ServerApiContext';
import { createCalendarClient, type CalendarClient, type CalendarStatus } from '@/lib/calendarApi';
import {
  deviceTimeZone, disableDeviceCalendar, enableDeviceCalendar, loadDeviceCalendarPrefs, permissionState, syncDeviceCalendar, type PermissionState,
} from '@/lib/calendarDevice';
import type { ServerApi } from '@/lib/serverApi';
import { Field, Section } from '../widgets';
import { Button, ErrorState, Loading, Muted, Text, useStyles } from '../ui';

/**
 * Calendar and busy evenings (P2-C, D414-D415). Opt-in, explained, revocable. Two sources:
 *  - this phone's own calendar: read on the phone, only busy / free for 5 pm to 8 pm is sent (never titles);
 *  - a calendar link (ICS "secret address"), read by the server and stored encrypted; the address is never shown again.
 */
export function CalendarSettingsBody({ api, householdId, client: injected }: { api: ServerApi; householdId: string; client?: CalendarClient }) {
  const styles = useStyles();
  const client = React.useMemo(() => injected ?? createCalendarClient(api, householdId), [injected, api, householdId]);
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [perm, setPerm] = useState<PermissionState>('undetermined');
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, prefs, p] = await Promise.all([client.status(), loadDeviceCalendarPrefs(), permissionState()]);
      setStatus(s);
      setEnabled(prefs.enabled && p === 'granted');
      setPerm(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Calendar settings could not be loaded.');
    }
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error && !status) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!status) return <Loading label="Loading calendar settings" />;

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ tone: 'info', text });
      await load();
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Something went wrong. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const toggleDevice = (on: boolean) =>
    run(async () => {
      if (!on) {
        await disableDeviceCalendar(api, householdId, { client });
        return 'Phone calendar turned off. The busy evenings it added have been deleted.';
      }
      const r = await enableDeviceCalendar(api, householdId);
      if (r.state !== 'granted') return 'Calendar access was not allowed, so nothing is read. You can allow it in Android settings and try again.';
      return `Phone calendar is on. ${r.busyDays ?? 0} busy evening${r.busyDays === 1 ? '' : 's'} found in the next four weeks.`;
    });

  const syncNow = () =>
    run(async () => {
      const r = await syncDeviceCalendar(api, householdId, { client });
      return r.ok ? `Updated: ${r.busyDays} busy evening${r.busyDays === 1 ? '' : 's'} in the next four weeks.` : 'The phone calendar could not be read just now.';
    });

  const saveIcs = () =>
    run(async () => {
      const n = await client.saveIcs(url, deviceTimeZone());
      setUrl('');
      return `Calendar linked. ${n} busy evening${n === 1 ? '' : 's'} found in the next four weeks.`;
    });

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled" testID="calendar-settings">
      <Text style={styles.title} accessibilityRole="header">Calendar and busy evenings</Text>
      <Muted>
        The planner can pick quick meals (or skip dinner) on evenings you are busy. You can mark days Busy by hand in the planner at any time. These
        optional switches let a calendar do it for you. We only work out whether you are free between 5 pm and 8 pm and keep that single yes / no
        plus roughly how many minutes are free. Event titles, places and people are never read, stored or sent.
      </Muted>

      <Section testID="device-section">
        <Text style={{ fontWeight: '700' }}>This phone's calendar</Text>
        <Muted>
          Read only. The busy / free answer is worked out on this phone and only that answer is sent. Turn it off and everything it added is deleted.
        </Muted>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
          <Muted style={{ flexShrink: 1, marginRight: 8 }}>Use my phone's calendar</Muted>
          <Switch accessibilityLabel="Use my phone's calendar" accessibilityState={{ checked: enabled, disabled: busy }} value={enabled} onValueChange={(v) => void toggleDevice(v)} disabled={busy} testID="device-calendar-switch" />
        </View>
        {perm === 'denied' && !enabled ? <Muted testID="device-denied">Calendar access is blocked for Family Recipes. Allow it in Android settings, then switch this on.</Muted> : null}
        {enabled ? (
          <>
            <Muted testID="device-count">{`${status.deviceFlagCount} busy evening${status.deviceFlagCount === 1 ? '' : 's'} from this phone.`}</Muted>
            <Button title="Update from my calendar now" variant="secondary" onPress={() => void syncNow()} disabled={busy} testID="device-sync" />
          </>
        ) : null}
      </Section>

      <Section testID="ics-section">
        <Text style={{ fontWeight: '700' }}>A calendar link</Text>
        {status.icsConfigured ? (
          <>
            <Muted testID="ics-linked">{`Linked: ${status.icsHost ?? 'calendar'}${status.lastStatus ? ` · ${status.lastStatus}` : ''}`}</Muted>
            <Muted>The address is stored encrypted and never shown again.</Muted>
            <Button title="Read it again" variant="secondary" onPress={() => void run(async () => { await client.refreshIcs(deviceTimeZone()); return 'Calendar read again.'; })} disabled={busy} testID="ics-refresh" />
            <Button title="Remove calendar link" variant="secondary" onPress={() => void run(async () => { await client.removeIcs(); return 'Calendar link removed, along with the busy evenings it added.'; })} disabled={busy} testID="ics-remove" />
          </>
        ) : (
          <>
            <Muted>
              Paste the "secret address in iCal format" from Google Calendar (or the ICS link from Outlook). Anyone with that address can read the
              calendar, so it is stored encrypted on our server and never shown again.
            </Muted>
            <Field label="Calendar address" value={url} onChangeText={setUrl} testID="ics-url" />
            <Button title="Link calendar" onPress={() => void saveIcs()} disabled={busy || !url.trim()} testID="ics-save" />
          </>
        )}
      </Section>

      {message ? <Muted testID="calendar-message" accessibilityRole={message.tone === 'error' ? 'alert' : undefined}>{message.text}</Muted> : null}
    </ScrollView>
  );
}

export default function CalendarSettingsScreen() {
  return <ServerScreen>{(api, householdId) => <CalendarSettingsBody api={api} householdId={householdId} />}</ServerScreen>;
}
