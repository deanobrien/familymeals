import React from 'react';
import { Stack } from 'expo-router';
import { useURL } from 'expo-linking';
import ScanForComputerScreen from '@/screens/ScanForComputerScreen';

/**
 * The https link inside the desktop's QR code (/scan/phone?s=...#t=...), opened in this app (Android App Link) when the phone's own
 * camera app or browser follows it. The token is in the fragment, so it is read from the full URL, not from route params.
 */
export default function ScanPhoneLinkRoute() {
  const url = useURL();
  return (
    <>
      <Stack.Screen options={{ title: 'Scan for a computer' }} />
      <ScanForComputerScreen initialUrl={url} />
    </>
  );
}
