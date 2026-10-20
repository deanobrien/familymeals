import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ServerScreen } from '@/data/ServerApiContext';
import {
  getActivity,
  getCentre,
  linkToRoute,
  markRead,
  relativeTime,
  type ActivityEvent,
  type NotificationItem,
} from '@/lib/notificationsApi';
import type { ServerApi } from '@/lib/serverApi';
import { Badge, Chip, ChipWrap, Section } from '../widgets';
import { Button, EmptyState, ErrorState, Loading, MIN_TAP, Muted, Text, useStyles } from '../ui';

type Tab = 'mine' | 'household';

/** In-app notification centre + household activity (the always-available channel, D380). Same API as the web. */
export function NotificationsBody({ api, householdId, initialTab = 'mine' }: { api: ServerApi; householdId: string; initialTab?: Tab }) {
  const router = useRouter();
  const styles = useStyles();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, a] = await Promise.all([getCentre(api, householdId), getActivity(api, householdId, 30)]);
      setItems(c.items);
      setUnread(c.unread);
      setEvents(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Notifications could not be loaded.');
    }
  }, [api, householdId]);
  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };
  const markAll = async () => {
    try {
      setUnread(await markRead(api, householdId));
      setItems((xs) => xs?.map((x) => ({ ...x, read: true })) ?? xs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not mark as read.');
    }
  };
  const open = async (n: NotificationItem) => {
    if (!n.read) {
      setItems((xs) => xs?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? xs);
      setUnread((u) => Math.max(0, u - 1));
      void markRead(api, householdId, [n.id]).catch(() => undefined);
    }
    router.push(linkToRoute(n.link) as never);
  };

  if (error && !items) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!items || !events) return <Loading label="Loading notifications" />;

  return (
    <ScrollView contentContainerStyle={styles.screen} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
      <Text style={styles.title} accessibilityRole="header">
        Notifications
      </Text>
      <ChipWrap>
        <Chip label={unread ? `For you (${unread} new)` : 'For you'} selected={tab === 'mine'} onPress={() => setTab('mine')} testID="tab-mine" />
        <Chip label="Household activity" selected={tab === 'household'} onPress={() => setTab('household')} testID="tab-household" />
      </ChipWrap>
      {error ? <Muted accessibilityRole="alert">{error}</Muted> : null}

      {tab === 'mine' && (
        <View testID="notification-centre">
          {unread > 0 && <Button title="Mark all as read" variant="secondary" onPress={() => void markAll()} testID="mark-all-read" />}
          {items.length === 0 ? (
            <EmptyState title="Nothing yet" hint="Reminders about food to use soon and the household updates you choose appear here." />
          ) : (
            items.map((n) => (
              <Pressable
                key={n.id}
                accessibilityRole="button"
                accessibilityLabel={`${n.read ? '' : 'New: '}${n.title}`}
                testID={`notification-${n.id}`}
                onPress={() => void open(n)}
                style={{ minHeight: MIN_TAP, paddingVertical: 10 }}
              >
                <Section>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Text style={{ fontWeight: n.read ? '400' : '700', flexShrink: 1 }}>{n.title}</Text>
                    {!n.read && <Badge label="New" tone="good" />}
                  </View>
                  {n.body ? <Muted>{n.body}</Muted> : null}
                  <Muted>{relativeTime(n.createdAt)}</Muted>
                </Section>
              </Pressable>
            ))
          )}
          <Button title="Notification settings" variant="secondary" onPress={() => router.push('/notification-settings' as never)} testID="open-notification-settings" />
        </View>
      )}

      {tab === 'household' && (
        <View testID="activity-feed">
          {events.length === 0 ? (
            <EmptyState title="No household activity in the last two weeks." />
          ) : (
            events.map((e) => (
              <Pressable
                key={e.id}
                accessibilityRole="link"
                accessibilityLabel={`${e.actor} ${e.text}`}
                onPress={() => router.push(linkToRoute(e.link) as never)}
                style={{ minHeight: MIN_TAP, justifyContent: 'center', paddingVertical: 6 }}
              >
                <Text>
                  <Text style={{ fontWeight: '700' }}>{e.actor}</Text> {e.text}
                </Text>
                <Muted>{relativeTime(e.at)}</Muted>
              </Pressable>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

export default function NotificationsScreen({ initialTab }: { initialTab?: Tab }) {
  return <ServerScreen>{(api, householdId) => <NotificationsBody api={api} householdId={householdId} {...(initialTab ? { initialTab } : {})} />}</ServerScreen>;
}
