import React from 'react';
import { Stack } from 'expo-router';
import LocationSettingsScreen from '@/screens/location/LocationSettingsScreen';

export default function LocationSettingsRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Location' }} />
      <LocationSettingsScreen />
    </>
  );
}
