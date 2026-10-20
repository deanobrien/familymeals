import React from 'react';
import { Stack } from 'expo-router';
import ListScanScreen from '@/screens/listScan/ListScanScreen';

export default function ShoppingScanRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Scan a list' }} />
      <ListScanScreen />
    </>
  );
}
