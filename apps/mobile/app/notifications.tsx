import React from 'react';
import { Stack } from 'expo-router';
import NotificationsScreen from '@/screens/notifications/NotificationsScreen';

export default function NotificationsRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Notifications' }} />
      <NotificationsScreen />
    </>
  );
}
