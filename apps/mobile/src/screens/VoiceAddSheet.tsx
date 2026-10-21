import React, { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { addVoiceRows, chipLabel, newBatchId, parseTranscript, type VoiceRow } from '@/lib/locationApi';
import type { ServerApi } from '@/lib/serverApi';
import { Field } from './widgets';
import { Button, ErrorText, MIN_TAP, Muted, Text, useStyles } from './ui';

/**
 * Add by voice (P2-A, D395): the phone's speech recogniser (expo-speech-recognition, Android SpeechRecognizer) turns speech
 * into text; the text is read by the SAME server parser as the web ("milk, two tins of tomatoes and eggs"), shown as chips to
 * check, and added through the idempotent list-scan confirm. When no recogniser is available, typing works the same way.
 */
export default function VoiceAddSheet({ api, householdId, open, onClose, onAdded }: {
  api: ServerApi; householdId: string; open: boolean; onClose: () => void; onAdded: (message: string) => void;
}) {
  const styles = useStyles();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<VoiceRow[] | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const batch = useRef(newBatchId());
  let available = false;
  try {
    available = ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    available = false;
  }

  useSpeechRecognitionEvent('result', (e) => {
    const t = e.results?.[0]?.transcript;
    if (typeof t === 'string') setText(t.trim());
  });
  useSpeechRecognitionEvent('error', (e) => {
    setListening(false);
    setError(e.error === 'not-allowed' ? 'The microphone is blocked for Family Recipes. Allow it in Android settings, or type instead.' : e.error === 'no-speech' ? 'Nothing was heard. Try again, or type instead.' : 'Speech recognition did not work. Type instead.');
  });
  useSpeechRecognitionEvent('end', () => setListening(false));

  async function mic() {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    setError(null);
    setRows(null);
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      setError('The microphone is blocked for Family Recipes. Allow it in Android settings, or type instead.');
      return;
    }
    setListening(true);
    ExpoSpeechRecognitionModule.start({ lang: 'en-GB', interimResults: true, continuous: false });
  }

  async function read() {
    setBusy(true);
    setError(null);
    try {
      setRows(await parseTranscript(api, householdId, text));
      setOff(new Set());
      batch.current = newBatchId();
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
      const r = await addVoiceRows(api, householdId, chosen, batch.current);
      onAdded(r.message || `Added ${chosen.length} item${chosen.length === 1 ? '' : 's'}.`);
      setText('');
      setRows(null);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add those.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled" testID="voice-sheet">
        <Text style={styles.title} accessibilityRole="header">Add by voice</Text>
        <Muted>Say or type, for example "milk, two tins of tomatoes and eggs".</Muted>
        {available ? (
          <Button title={listening ? 'Stop listening' : 'Start talking'} onPress={() => void mic()} testID="voice-mic" />
        ) : (
          <Muted testID="voice-unsupported">This phone has no speech recogniser available, so type your list instead.</Muted>
        )}
        <Field label="What to add" value={text} onChangeText={(v) => { setText(v); setRows(null); }} multiline testID="voice-text" />
        <ErrorText message={error} />
        {!rows && <Button title="Read my list" onPress={() => void read()} disabled={busy || listening || !text.trim()} testID="voice-read" />}
        {rows && (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityLabel="Items to add">
              {rows.map((r) => {
                const on = !off.has(r.key);
                return (
                  <Pressable
                    key={r.key}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={chipLabel(r)}
                    testID={`voice-chip-${r.key}`}
                    onPress={() => setOff((cur) => { const n = new Set(cur); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })}
                    style={{ minHeight: MIN_TAP, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 24, borderWidth: 2, borderColor: on ? '#2e7d32' : '#9e9e9e' }}
                  >
                    <Text style={{ fontWeight: on ? '700' : '400', textDecorationLine: on ? 'none' : 'line-through' }}>{chipLabel(r)}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Muted>Tap a chip to leave it out.</Muted>
            <Button title="Edit text" variant="secondary" onPress={() => setRows(null)} />
            <Button title={chosen.length === 0 ? 'Nothing to add' : `Add ${chosen.length} item${chosen.length === 1 ? '' : 's'}`} onPress={() => void add()} disabled={busy || chosen.length === 0} testID="voice-add" />
          </>
        )}
        <Button title="Close" variant="secondary" onPress={() => { if (listening) ExpoSpeechRecognitionModule.stop(); onClose(); }} testID="voice-close" />
      </ScrollView>
    </Modal>
  );
}
