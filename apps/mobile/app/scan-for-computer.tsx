import React from 'react';
import { Stack } from 'expo-router';
import ScanForComputerScreen from '@/screens/ScanForComputerScreen';

/** More > "Scan for a computer": scan the QR code a desktop page shows (P3-C, D448). */
export default function ScanForComputerRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Scan for a computer' }} />
      <ScanForComputerScreen />
    </>
  );
}
