import React from 'react';
import { Stack } from 'expo-router';
import PantryScreen from '@/screens/pantry/PantryScreen';

export default function PantryRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Pantry' }} />
      <PantryScreen />
    </>
  );
}
