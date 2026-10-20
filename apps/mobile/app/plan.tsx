import React from 'react';
import { Stack } from 'expo-router';
import PlanScreen from '@/screens/plan/PlanScreen';

export default function PlanRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Meal planner' }} />
      <PlanScreen />
    </>
  );
}
