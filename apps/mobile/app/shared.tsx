import React from 'react';
import { Stack } from 'expo-router';
import SharedLinksScreen from '@/screens/sharing/SharedLinksScreen';

export default function SharedRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Shared recipes' }} />
      <SharedLinksScreen />
    </>
  );
}
