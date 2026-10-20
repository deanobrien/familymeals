import React from 'react';
import { Stack } from 'expo-router';
import NotificationSettingsScreen from '@/screens/notifications/NotificationSettingsScreen';

export default function NotificationSettingsRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Notification settings' }} />
      <NotificationSettingsScreen />
    </>
  );
}
