import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, Text as RNText, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { useServerApi } from '@/data/ServerApiContext';
import { getUnread } from '@/lib/notificationsApi';
import { MIN_TAP, useTheme } from '../ui';

const POLL_MS = 60_000;

/** Bell with the unread count in the tab headers; opens the notification list. Hidden in mock mode (no server). */
export default function HeaderBell() {
  const api = useServerApi();
  const { householdId } = useApp();
  const router = useRouter();
  const t = useTheme();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(() => {
    if (!api.configured || !householdId) return;
    getUnread(api, householdId).then(setUnread, () => undefined);
  }, [api, householdId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [refresh]);
  useFocusEffect(refresh);

  if (!api.configured || !householdId) return null;
  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="header-bell"
      onPress={() => router.push('/notifications' as never)}
      style={{ minWidth: MIN_TAP, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center', marginRight: 4 }}
    >
      <RNText style={{ fontSize: 22, color: t.text }} importantForAccessibility="no">
        {'\u{1F514}'}
      </RNText>
      {unread > 0 && (
        <View
          testID="header-bell-count"
          style={{ position: 'absolute', top: 6, right: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#B3261E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}
        >
          <RNText style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{unread > 99 ? '99+' : String(unread)}</RNText>
        </View>
      )}
    </Pressable>
  );
}
