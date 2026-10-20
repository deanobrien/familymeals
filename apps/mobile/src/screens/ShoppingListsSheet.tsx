import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { changeLists, fetchLists, type ListAction, type ListInfo } from '@/lib/shoppingListsApi';
import type { ServerApi } from '@/lib/serverApi';
import { Button, ErrorText, MIN_TAP, Muted, Text, useStyles, useTheme } from './ui';

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/**
 * Header of the Shopping screen when the server is configured: the current list's name (opens the lists sheet) and the
 * handwritten-list scan entry. The name is read from the server; until it arrives the control says "Shopping lists".
 */
export function ShoppingListsBar({
  api, householdId, version, beforeChange, onChanged,
}: {
  api: ServerApi;
  householdId: string;
  /** Bump to re-read the list name (e.g. after a sync). */
  version: number;
  /** Called before a list change: flush queued ticks so they land in the list they were made on. */
  beforeChange: () => Promise<void>;
  /** Called after a change: the screen re-reads the list through the data source. */
  onChanged: () => Promise<void> | void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchLists(api, householdId)
      .then((ls) => live && setName(ls.find((l) => l.active)?.name ?? null))
      .catch(() => undefined); // the name is decoration; the list itself still works
    return () => {
      live = false;
    };
  }, [api, householdId, version]);

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 8 }}>
      <Button
        title={name ? `List: ${name}` : 'Shopping lists'}
        accessibilityLabel={name ? `Shopping lists, current list ${name}` : 'Shopping lists'}
        accessibilityHint="Switch, start, rename or put away a list"
        variant="secondary"
        testID="lists-open"
        onPress={() => setOpen(true)}
      />
      <Button
        title="Scan a handwritten list"
        variant="secondary"
        testID="list-scan-open"
        onPress={() => router.push('/shopping-scan' as never)}
      />
      <ShoppingListsSheet
        api={api}
        householdId={householdId}
        visible={open}
        onClose={() => setOpen(false)}
        beforeChange={beforeChange}
        onChanged={async (ls) => {
          setName(ls.find((l) => l.active)?.name ?? null);
          await onChanged();
        }}
      />
    </View>
  );
}

export default function ShoppingListsSheet({
  api, householdId, visible, onClose, beforeChange, onChanged,
}: {
  api: ServerApi;
  householdId: string;
  visible: boolean;
  onClose: () => void;
  beforeChange: () => Promise<void>;
  onChanged: (lists: ListInfo[]) => Promise<void> | void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const [lists, setLists] = useState<ListInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rename, setRename] = useState('');
  const [fresh, setFresh] = useState('');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const active = lists?.find((l) => l.active) ?? null;
  const archived = (lists ?? []).filter((l) => l.archived);

  useEffect(() => {
    if (!visible) return undefined;
    let live = true;
    setError(null);
    setConfirmArchive(false);
    setFresh('');
    fetchLists(api, householdId)
      .then((ls) => {
        if (!live) return;
        setLists(ls);
        setRename(ls.find((l) => l.active)?.name ?? '');
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load your lists.'));
    return () => {
      live = false;
    };
  }, [visible, api, householdId]);

  const run = useCallback(
    async (change: ListAction, close: boolean) => {
      if (busy) return; // a double tap sends one request
      setBusy(true);
      setError(null);
      try {
        await beforeChange();
        const next = await changeLists(api, householdId, change);
        setLists(next);
        setRename(next.find((l) => l.active)?.name ?? '');
        setFresh('');
        setConfirmArchive(false);
        await onChanged(next);
        if (close) onClose();
      } catch (e) {
        // The server's own message (validation, read-only household, network) is shown as it is.
        setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
      } finally {
        setBusy(false);
      }
    },
    [api, householdId, busy, beforeChange, onChanged, onClose],
  );

  const input = {
    minHeight: MIN_TAP, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 12, color: theme.text,
  } as const;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <View
          testID="lists-sheet"
          accessibilityViewIsModal
          style={{ maxHeight: '85%', backgroundColor: theme.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 }}
        >
          <Text accessibilityRole="header" style={styles.title}>Your shopping lists</Text>
          <Muted>You shop from one list at a time. Other lists are kept, not deleted.</Muted>
          <ErrorText message={error} />
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text accessibilityRole="header" style={styles.heading}>Current list</Text>
            {!lists && !error ? <Muted>Loading your lists</Muted> : null}
            {lists && active ? (
              <View>
                <TextInput
                  accessibilityLabel="List name"
                  testID="lists-rename-input"
                  value={rename}
                  maxLength={120}
                  onChangeText={setRename}
                  style={input}
                />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  <Button
                    title="Rename"
                    variant="secondary"
                    testID="lists-rename"
                    disabled={busy || !rename.trim() || rename.trim() === active.name}
                    onPress={() => void run({ action: 'rename', listId: active.id, name: rename }, false)}
                  />
                  {!confirmArchive ? (
                    <Button title="Put this list away" variant="secondary" testID="lists-archive" disabled={busy} onPress={() => setConfirmArchive(true)} />
                  ) : (
                    <>
                      <Muted>It is kept, and your next item starts a fresh list.</Muted>
                      <Button title="Keep it" variant="secondary" testID="lists-archive-cancel" onPress={() => setConfirmArchive(false)} />
                      <Button title="Put it away" testID="lists-archive-confirm" disabled={busy} onPress={() => void run({ action: 'archive' }, true)} />
                    </>
                  )}
                </View>
              </View>
            ) : null}
            {lists && !active ? <Muted>You have no current list. Your next item starts one.</Muted> : null}

            <Text accessibilityRole="header" style={styles.heading}>Start a new list</Text>
            <TextInput
              accessibilityLabel="New list name"
              testID="lists-new-input"
              value={fresh}
              maxLength={120}
              placeholder="For example: Weekend shop"
              placeholderTextColor={theme.muted}
              onChangeText={setFresh}
              style={input}
            />
            <View style={{ marginTop: 8 }}>
              <Button title="Create new list" testID="lists-create" disabled={busy || !fresh.trim()} onPress={() => void run({ action: 'create', name: fresh }, true)} />
            </View>

            {archived.length > 0 ? (
              <View testID="lists-archived">
                <Text accessibilityRole="header" style={styles.heading}>Earlier lists</Text>
                {archived.map((l) => (
                  <View key={l.id} style={[styles.row, { minHeight: MIN_TAP }]}>
                    <View style={{ flex: 1 }}>
                      <Text>{l.name}</Text>
                      <Muted>Last changed {fmtDate(l.updatedAt)}</Muted>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Switch to ${l.name}`}
                      testID={`lists-switch-${l.id}`}
                      disabled={busy}
                      onPress={() => void run({ action: 'switch', listId: l.id }, true)}
                      style={{ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: 'center', paddingHorizontal: 8 }}
                    >
                      <Text style={styles.pending}>Switch</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
          <View style={{ marginTop: 8 }}>
            <Button title="Close" variant="secondary" testID="lists-close" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
