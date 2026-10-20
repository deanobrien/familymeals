import React from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import ReceiptDetailScreen from '@/screens/receipts/ReceiptDetailScreen';

export default function ReceiptRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ title: 'Receipt' }} />
      <ReceiptDetailScreen id={String(id)} />
    </>
  );
}
