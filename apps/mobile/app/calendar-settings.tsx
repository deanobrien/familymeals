import React from 'react';
import { Stack } from 'expo-router';
import CalendarSettingsScreen from '@/screens/calendar/CalendarSettingsScreen';

export default function CalendarSettingsRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Calendar' }} />
      <CalendarSettingsScreen />
    </>
  );
}
