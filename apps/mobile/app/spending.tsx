import React from 'react';
import { Stack } from 'expo-router';
import SpendingScreen from '@/screens/money/SpendingScreen';

export default function SpendingRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Spending' }} />
      <SpendingScreen />
    </>
  );
}
