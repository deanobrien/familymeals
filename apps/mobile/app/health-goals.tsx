import React from 'react';
import { Stack } from 'expo-router';
import HealthGoalsScreen from '@/screens/goals/HealthGoalsScreen';

export default function HealthGoalsRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Health goals' }} />
      <HealthGoalsScreen />
    </>
  );
}
