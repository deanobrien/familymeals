import React from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import PantryScanScreen from '@/screens/pantryScan/PantryScanScreen';

export default function PantryScanRoute() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: 'Scan groceries' }} />
      <PantryScanScreen initialMode={mode === 'barcodes' ? 'barcodes' : 'photos'} />
    </>
  );
}
