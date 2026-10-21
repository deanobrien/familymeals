import React from 'react';
import { Stack } from 'expo-router';
import KidsScreen from '@/screens/kids/KidsScreen';

export default function KidsRoute() {
  return (
    <>
      <Stack.Screen options={{ title: "Kids' mode" }} />
      <KidsScreen />
    </>
  );
}
