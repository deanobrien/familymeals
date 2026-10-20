'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Checkbox, ErrorState, Input, Select, useToast } from '@fr/ui';
import {
  ApiError,
  CONFIGURABLE_TYPES,
  TYPE_META,
  api,
  currentSubscription,
  disableBrowserPush,
  enableBrowserPush,
  notifyChanged,
  pushSupported,
  type NotificationSettings,
} from '../../../lib/notifications/client';
import s from '../../../lib/dashboard/dashboard.module.css';
import c from '../../notifications/notifications.module.css';

const ZONES = ['Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Madrid', 'Europe/Berlin', 'America/New_York', 'Asia/Dubai', 'Australia/Sydney'];
const HOURS = [5, 6, 7, 8, 9, 10, 11, 12].map((h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }));
const LEAD = [
  { value: '0', label: 'On the day' },
  { value: '1', label: '1 day before' },
  { value: '2', label: '2 days before' },
  { value: '3', label: '3 days before' },
];
const TEST_TEXT = {
  sent: 'Sent. It is in your notification centre, and should appear on your devices in a moment.',
  no_devices: 'Added to your notification centre. Turn on notifications in this browser or the Android app to get it as a push.',
  in_app_only: 'Added to your notification centre. Push is not set up on the server yet, so nothing was sent to your devices.',
  failed: 'Added to your notification centre, but the push could not be delivered. Try again later.',
} as const;

type BrowserPush = 'unsupported' | 'unconfigured' | 'blocked' | 'on' | 'off' | 'checking';

export function NotificationSettingsView() {
  const toast = useToast();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [devices, setDevices] = useState({ web: 0, android: 0 });
  const [loadError, setLoadError] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [browser, setBrowser] = useState<BrowserPush>('checking');

  const load = useCallback(() => {
    setLoadError(false);
    Promise.all([api.settings(), api.config()]).then(
      async ([r, cfg]) => {
        setSettings(r.settings);
        setDevices(r.devices);
        setPublicKey(cfg.webPushPublicKey);
        if (!pushSupported()) return setBrowser('unsupported');
        if (!cfg.webPushPublicKey) return setBrowser('unconfigured');
        if (Notification.permission === 'denied') return setBrowser('blocked');
        setBrowser((await currentSubscription().catch(() => null)) ? 'on' : 'off');
      },
      () => setLoadError(true),
    );
  }, []);
  useEffect(load, [load]);

  if (loadError) return <ErrorState title="Notification settings could not be loaded" onRetry={load} />;
  if (!settings) return <p className={s.muted}>Loading&hellip;</p>;

  const set = (patch: Partial<NotificationSettings>) => setSettings({ ...settings, ...patch });
  const setType = (t: (typeof CONFIGURABLE_TYPES)[number], inApp: boolean, push: boolean) =>
    setSettings({ ...settings, types: { ...settings.types, [t]: { inApp, push: inApp && push } } });

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      const r = await api.saveSettings(settings);
      setSettings(r.settings);
      toast.toast({ message: 'Notification settings saved.' });
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors) setErrors(e.fieldErrors);
      toast.toast({ message: e instanceof Error ? e.message : 'Could not save.', tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const turnOn = async () => {
    if (!publicKey) return;
    try {
      const r = await enableBrowserPush(publicKey);
      setBrowser(r === 'enabled' ? 'on' : r === 'denied' ? 'blocked' : 'unsupported');
      if (r === 'enabled') {
        const fresh = await api.settings();
        setDevices(fresh.devices);
      }
    } catch {
      toast.toast({ message: 'Notifications could not be turned on in this browser.', tone: 'error' });
    }
  };
  const turnOff = async () => {
    await disableBrowserPush();
    setBrowser('off');
    const fresh = await api.settings().catch(() => null);
    if (fresh) setDevices(fresh.devices);
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.test();
      setTestResult(TEST_TEXT[r.outcome]);
      notifyChanged();
    } catch (e) {
      setTestResult(e instanceof Error ? e.message : 'Could not send a test notification.');
    } finally {
      setTesting(false);
    }
  };

  const zones = ZONES.includes(settings.timeZone) ? ZONES : [settings.timeZone, ...ZONES];

  return (
    <div className={s.page}>
      <header>
        <h1>Notifications</h1>
        <p className={s.sub}>
          Your own choices for this household. The notification centre (the bell) always works; push to this browser or your phone is optional.{' '}
          <Link className={s.link} href="/notifications">Open the notification centre</Link>
        </p>
      </header>

      <Card>
        <section className={s.card} aria-labelledby="h-push">
          <h2 id="h-push">Push notifications</h2>
          <p className={s.muted} data-testid="push-status">
            {browser === 'checking' && 'Checking this browser…'}
            {browser === 'unsupported' && 'This browser cannot receive push notifications. You will still see everything in the notification centre.'}
            {browser === 'unconfigured' && 'Push to browsers is not set up on the server yet. You will still see everything in the notification centre.'}
            {browser === 'blocked' && 'Notifications are blocked for this site in your browser settings. Allow them there, then come back.'}
            {browser === 'on' && 'On in this browser.'}
            {browser === 'off' && 'Off in this browser. Your browser will ask for permission when you turn it on.'}
          </p>
          <div className={s.row}>
            {browser === 'off' && <Button onClick={() => void turnOn()} data-testid="push-enable">Turn on in this browser</Button>}
            {browser === 'on' && <Button variant="secondary" onClick={() => void turnOff()} data-testid="push-disable">Turn off in this browser</Button>}
            <Button variant="secondary" onClick={() => void test()} loading={testing} data-testid="send-test">Send a test notification</Button>
          </div>
          {testResult && <p role="status" data-testid="test-result">{testResult}</p>}
          <p className={s.muted}>
            Registered: {devices.web} browser{devices.web === 1 ? '' : 's'}, {devices.android} Android phone{devices.android === 1 ? '' : 's'}. On Android, turn
            notifications on in the app&rsquo;s Settings tab.
          </p>
          <p className={s.muted}>
            Push messages never include allergy details, receipt contents or item names; they say what kind of update it is and open the app.
          </p>
        </section>
      </Card>

      <Card>
        <section className={s.card} aria-labelledby="h-types">
          <h2 id="h-types">What to tell me about</h2>
          <table className={c.types} data-testid="notification-types">
            <thead>
              <tr>
                <th scope="col">Notification</th>
                <th scope="col">In the app</th>
                <th scope="col">Push</th>
              </tr>
            </thead>
            <tbody>
              {CONFIGURABLE_TYPES.map((t) => {
                const p = settings.types[t];
                return (
                  <tr key={t}>
                    <td>
                      <strong>{TYPE_META[t].label}</strong>
                      <div className={s.muted}>{TYPE_META[t].hint}</div>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${TYPE_META[t].label}: in the app`}
                        data-testid={`type-${t}-inapp`}
                        checked={p.inApp}
                        onChange={(e) => setType(t, e.target.checked, p.push)}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${TYPE_META[t].label}: push`}
                        data-testid={`type-${t}-push`}
                        checked={p.push}
                        disabled={!p.inApp}
                        onChange={(e) => setType(t, p.inApp, e.target.checked)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </Card>

      <Card>
        <section className={s.card} aria-labelledby="h-quiet">
          <h2 id="h-quiet">Quiet hours and timing</h2>
          <Checkbox
            label="Hold push notifications during quiet hours (they wait in the notification centre and are sent when quiet hours end)"
            checked={settings.quietEnabled}
            onChange={(e) => set({ quietEnabled: e.target.checked })}
            data-testid="quiet-enabled"
          />
          <div className={s.row}>
            <Input label="Quiet from" type="time" value={settings.quietStart} onChange={(e) => set({ quietStart: e.target.value })} error={errors.quietStart} data-testid="quiet-start" />
            <Input label="Until" type="time" value={settings.quietEnd} onChange={(e) => set({ quietEnd: e.target.value })} error={errors.quietEnd} data-testid="quiet-end" />
          </div>
          <Select label="Time zone" value={settings.timeZone} options={zones.map((z) => ({ value: z, label: z.replace('_', ' ') }))} onChange={(e) => set({ timeZone: e.target.value })} error={errors.timeZone} />
          <div className={s.row}>
            <Select label="Food reminders from" value={String(settings.morningHour)} options={HOURS} onChange={(e) => set({ morningHour: Number(e.target.value) })} error={errors.morningHour} />
            <Select label="Remind me" value={String(settings.expiryLeadDays)} options={LEAD} onChange={(e) => set({ expiryLeadDays: Number(e.target.value) })} error={errors.expiryLeadDays} />
          </div>
        </section>
      </Card>

      <div className={s.row}>
        <Button onClick={() => void save()} loading={saving} data-testid="save-notification-settings">Save notification settings</Button>
        <Link className={s.link} href="/settings">Back to Settings</Link>
      </div>
    </div>
  );
}
