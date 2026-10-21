'use client';

// Calendar-aware planning and leftovers UI for the planner (P2-C, D410-D419): busy chips, the calendar panel (ICS address,
// explanation of the Android device calendar), leftover suggestions and the stored-meal picker. Derived flags only: no
// event titles ever reach this code.
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Input, Sheet, Stepper } from '@fr/ui';
import { dateShort, dayShort } from '../../lib/plan/dates';
import type { BusyDayView, CalendarStatus } from '../../lib/calendar/types';
import type { BatchView, LeftoverSuggestion } from '../../lib/leftovers/types';
import { calendarStatusAction, refreshIcsAction, removeIcsAction, saveIcsAction } from './calendar-actions';

/** "Busy (about 45 min free)" without a title; from the engine-shaped flags the proposal and parse step carry. */
export function busyText(d: { skip: boolean; minutesAvailable: number | null }): string {
  const free = d.minutesAvailable === null ? '' : ` (about ${d.minutesAvailable} min free)`;
  return d.skip ? `Dinner skipped${free}` : `Busy${free}`;
}

const SOURCE_LABEL: Record<string, string> = { manual: 'you marked it', device: 'phone calendar', ics: 'calendar link' };

/** Chips for the busy evenings a plan will honour. They explain themselves and say where each came from. */
export function BusyChips({ busy }: { busy: readonly { date: string; skip: boolean; minutesAvailable: number | null; sources: readonly string[] }[] }) {
  if (busy.length === 0) return null;
  return (
    <div className="plan__chips" data-testid="busy-chips" role="group" aria-label="Busy evenings">
      <h4>Busy evenings</h4>
      <div className="plan__chip-group">
        {busy.map((d) => (
          <Badge key={d.date} tone={d.skip ? 'warning' : 'neutral'}>
            {dayShort(d.date)} {dateShort(d.date)}: {busyText(d)} ({d.sources.map((s) => SOURCE_LABEL[s] ?? s).join(', ')})
          </Badge>
        ))}
      </div>
      <p className="plan__muted">Busy evenings get a quick meal; an evening with almost no free time skips dinner. Change them with the Busy buttons on the week above, or in Calendar settings.</p>
    </div>
  );
}

const browserZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
  } catch {
    return 'Europe/London';
  }
};

/** Calendar settings: an optional ICS subscription address (the "secret address" from Google / Outlook). Never shown again once saved. */
export function CalendarPanel() {
  const router = useRouter();
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    (async () => {
      const s = await calendarStatusAction();
      if (!live || !s.ok) return;
      setStatus(s.status);
      if (s.status.icsConfigured) {
        const r = await refreshIcsAction(browserZone(), true); // only when stale (6 h) and at most every 5 min
        if (live && r.ok && r.busyDays >= 0) router.refresh();
      }
    })().catch(() => undefined);
    return () => { live = false; };
  }, [router]);

  const reload = async () => {
    const s = await calendarStatusAction();
    if (s.ok) setStatus(s.status);
  };

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await saveIcsAction(url, browserZone());
      if (!r.ok) return setMsg({ tone: 'error', text: r.message });
      setUrl('');
      setMsg({ tone: 'info', text: `Calendar linked. ${r.busyDays} busy evening${r.busyDays === 1 ? '' : 's'} found in the next four weeks.` });
      await reload();
      router.refresh();
    });

  const refresh = () =>
    start(async () => {
      setMsg(null);
      const r = await refreshIcsAction(browserZone());
      if (!r.ok) return setMsg({ tone: 'error', text: r.message });
      setMsg({ tone: 'info', text: r.busyDays < 0 ? 'Already up to date (it was read a moment ago).' : `Updated: ${r.busyDays} busy evening${r.busyDays === 1 ? '' : 's'} in the next four weeks.` });
      await reload();
      router.refresh();
    });

  const remove = () =>
    start(async () => {
      setMsg(null);
      const r = await removeIcsAction();
      if (!r.ok) return setMsg({ tone: 'error', text: r.message });
      setMsg({ tone: 'info', text: 'Calendar link removed, along with the busy evenings it added.' });
      await reload();
      router.refresh();
    });

  return (
    <details className="plan__panel" data-testid="calendar-panel">
      <summary><strong>Calendar and busy evenings</strong></summary>
      <div className="plan__panel">
        <p className="plan__muted">
          Mark a day Busy in the week above whenever you like. You can also let your calendar do it: we only look at whether you are free
          between 5 pm and 8 pm each evening and keep that single yes / no (plus roughly how many minutes are free). Event titles, places and
          people are never read, stored or sent to the AI. The Android app can do the same from the phone's own calendar (Settings, Calendar).
        </p>
        {status?.icsConfigured ? (
          <div className="plan__panel" data-testid="ics-linked">
            <p>
              <Badge tone="success">Calendar linked</Badge> {status.icsHost}
              {status.lastSyncedAt ? ` · last read ${new Date(status.lastSyncedAt).toLocaleString('en-GB')}` : ''}
              {status.lastStatus ? ` · ${status.lastStatus}` : ''}
            </p>
            <div className="plan__inline">
              <Button variant="secondary" onClick={refresh} loading={pending}>Read it again</Button>
              <Button variant="danger" onClick={remove} disabled={pending}>Remove calendar link</Button>
            </div>
            <p className="plan__muted">The address is stored encrypted and is never shown again. Removing it deletes it and the busy evenings it added.</p>
          </div>
        ) : (
          <div className="plan__panel">
            <Input
              label="Calendar address (optional)"
              hint="In Google Calendar: Settings, your calendar, 'Secret address in iCal format'. In Outlook: Publish calendar, ICS link. Anyone with this address can read the calendar, so we store it encrypted and never show it again."
              type="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <div>
              <Button onClick={save} loading={pending} disabled={!url.trim()}>Link calendar</Button>
            </div>
          </div>
        )}
        {msg && <div className={`plan__msg${msg.tone === 'error' ? ' plan__msg--error' : ''}`} role={msg.tone === 'error' ? 'alert' : 'status'} data-testid="calendar-message">{msg.text}</div>}
      </div>
    </details>
  );
}

/** Suggestions: which stored meal could go in which empty slot this week. */
export function LeftoverSuggestions({ suggestions, onPlace }: { suggestions: readonly LeftoverSuggestion[]; onPlace: (s: LeftoverSuggestion) => void }) {
  if (suggestions.length === 0) return null;
  return (
    <section className="plan__panel" aria-label="Leftover and freezer suggestions" data-testid="leftover-suggestions">
      <h2>Use what is already cooked</h2>
      <ul className="plan__list">
        {suggestions.map((s) => (
          <li key={`${s.batchId}|${s.date}|${s.mealType}`} className="plan__row">
            <span className="plan__row-main">
              <strong>{s.label}</strong>
              <span className="plan__muted">{dayShort(s.date)} {dateShort(s.date)} · {s.reason}</span>
            </span>
            <Button size="sm" variant="secondary" onClick={() => onPlace(s)} aria-label={`Add ${s.label} to ${dayShort(s.date)}`}>Add to plan</Button>
          </li>
        ))}
      </ul>
      <p className="plan__muted">No shopping is needed for these. The portions leave your fridge / freezer list when you mark the meal eaten.</p>
    </section>
  );
}

/** Pick a stored meal for a slot (any batch with portions still free). */
export function LeftoverPicker({ open, onClose, batches, slotLabel, onPick }: {
  open: boolean;
  onClose: () => void;
  batches: readonly BatchView[];
  slotLabel: string;
  onPick: (b: BatchView, portions: number) => void;
}) {
  const usable = batches.filter((b) => b.portionsFree > 0);
  const [choice, setChoice] = useState<string | null>(null);
  const [portions, setPortions] = useState(2);
  const chosen = usable.find((b) => b.id === choice) ?? null;
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) { setChoice(null); onClose(); } }} title="Leftover or freezer meal" description={slotLabel}>
      {usable.length === 0 && <p className="plan__muted">Nothing stored yet. Mark a meal cooked with "Cook x2" or add one in the Pantry.</p>}
      <ul className="plan__list" data-testid="leftover-picker">
        {usable.map((b) => (
          <li key={b.id} className="plan__row">
            <span className="plan__row-main">
              <strong>{b.storedIn === 'freezer' ? 'Freezer meal' : 'Leftovers'}: {b.title}</strong>
              <span className="plan__muted">{b.portionsFree} portion{b.portionsFree === 1 ? '' : 's'} free · {b.useByLabel}</span>
            </span>
            <Button size="sm" variant={choice === b.id ? 'primary' : 'secondary'} onClick={() => { setChoice(b.id); setPortions(Math.min(2, b.portionsFree)); }} aria-label={`Choose ${b.title}`}>Choose</Button>
          </li>
        ))}
      </ul>
      {chosen && (
        <div className="plan__sheet-section">
          <Stepper label="Portions" value={portions} min={1} max={chosen.portionsFree} onChange={setPortions} />
          <Button onClick={() => { onPick(chosen, portions); setChoice(null); }}>Put {chosen.title} in this slot</Button>
        </div>
      )}
    </Sheet>
  );
}
