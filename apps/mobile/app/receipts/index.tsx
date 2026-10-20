import React from 'react';
import { Stack } from 'expo-router';
import ReceiptsScreen from '@/screens/receipts/ReceiptsScreen';

export default function ReceiptsRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Receipts' }} />
      <ReceiptsScreen />
    </>
  );
}
