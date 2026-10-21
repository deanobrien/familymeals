'use client';

// "Add by voice" on the shopping list (P2-A, D395): say or type "milk, two tins of tomatoes and eggs", check the chips,
// add. Speech-to-text is the browser's (Web Speech API, where supported); typing always works.
import { useEffect, useRef, useState } from 'react';
import { Button, Sheet, Textarea, useToast } from '@fr/ui';
import {
  addRows, chipLabel, listen, newBatchId, parseTranscript, speechCtor, type VoiceRow,
} from '../../lib/shopping/voice-client';
import styles from './shopping.module.css';

export function VoiceAddButton({ disabled, onAdded }: { disabled?: boolean; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" disabled={disabled} onClick={() => setOpen(true)} data-testid="voice-add-button" aria-label="Add by voice">
        <span aria-hidden="true">🎤</span> Voice add
      </Button>
      <VoiceSheet open={open} onOpenChange={setOpen} onAdded={onAdded} />
    </>
  );
}

function VoiceSheet({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; onAdded: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<VoiceRow[] | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const batch = useRef(newBatchId());
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => setSupported(speechCtor() !== null), []);
  useEffect(() => {
    if (open) {
      setText(''); setRows(null); setOff(new Set()); setError(null); setListening(false);
      batch.current = newBatchId();
    } else stopRef.current?.();
  }, [open]);

  function mic() {
    const Ctor = speechCtor();
    if (!Ctor) return;
    if (listening) { stopRef.current?.(); return; }
    setError(null);
    setRows(null);
    setListening(true);
    const l = listen(Ctor, setText, (e) => { setListening(false); if (e) setError(e); });
    stopRef.current = l.stop;
  }

  async function read() {
    setBusy(true);
    setError(null);
    try {
      const r = await parseTranscript(text);
      setRows(r.rows);
      setOff(new Set());
      batch.current = newBatchId(); // a new reading is a new set
    } catch (e) {
      setRows(null);
      setError(e instanceof Error ? e.message : 'Could not read that.');
    } finally {
      setBusy(false);
    }
  }

  const chosen = (rows ?? []).filter((r) => !off.has(r.key));
  async function add() {
    setBusy(true);
    setError(null);
    try {
      const r = await addRows(chosen, batch.current);
      toast({ message: r.message || `Added ${chosen.length} item${chosen.length === 1 ? '' : 's'}.` });
      window.dispatchEvent(new Event('fr:shopping-changed'));
      onAdded();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add those.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Add by voice" description='Say or type, for example "milk, two tins of tomatoes and eggs".'>
      <div className={styles.pickerBody} data-testid="voice-sheet">
        {supported ? (
          <Button variant={listening ? 'danger' : 'primary'} onClick={mic} data-testid="voice-mic" aria-pressed={listening}>
            {listening ? 'Stop listening' : 'Start talking'}
          </Button>
        ) : (
          <p role="status" data-testid="voice-unsupported">This browser cannot listen for speech, so type your list instead.</p>
        )}
        <Textarea label="What to add" value={text} onChange={(e) => { setText(e.target.value); setRows(null); }} rows={3} data-testid="voice-text" maxLength={1000} />
        {supported && <p className={styles.pickerEmpty}>Your browser&apos;s speech service turns your voice into text (Chrome and Edge send the audio to their provider to do this). Nothing is recorded by us.</p>}
        {error && <p role="alert" data-testid="voice-error">{error}</p>}
        {!rows && <Button onClick={() => void read()} loading={busy} disabled={!text.trim() || listening} data-testid="voice-read">Read my list</Button>}
        {rows && (
          <>
            <ul className={styles.chips} aria-label="Items to add" data-testid="voice-chips">
              {rows.map((r) => (
                <li key={r.key}>
                  <button
                    type="button" className={styles.chip} aria-pressed={!off.has(r.key)} data-testid={`voice-chip-${r.key}`}
                    title={r.notes ? r.notes : `Heard: ${r.text}`}
                    onClick={() => setOff((cur) => { const n = new Set(cur); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })}
                  >
                    {chipLabel(r)}
                  </button>
                </li>
              ))}
            </ul>
            <p className={styles.pickerEmpty}>Tap a chip to leave it out.</p>
            <div className={styles.formActions}>
              <Button variant="secondary" onClick={() => setRows(null)}>Edit text</Button>
              <Button onClick={() => void add()} loading={busy} disabled={chosen.length === 0} data-testid="voice-add">
                {chosen.length === 0 ? 'Nothing to add' : `Add ${chosen.length} item${chosen.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
