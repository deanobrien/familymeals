import React from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import PriceHistoryScreen from '@/screens/money/PriceHistoryScreen';

export default function PriceHistoryRoute() {
  const { ingredientId } = useLocalSearchParams<{ ingredientId: string }>();
  return (
    <>
      <Stack.Screen options={{ title: 'Prices by shop' }} />
      <PriceHistoryScreen ingredientId={String(ingredientId ?? '')} />
    </>
  );
}
