import React from 'react';
import { View } from 'react-native';
import RecipeListScreen from '@/screens/RecipeListScreen';
import { MakeNowHome } from '@/screens/MakeNow';

/** The landing tab: "What can I make now?" (only when the server has suggestions) above the recipe library. */
export default function RecipesTab() {
  return (
    <View style={{ flex: 1 }}>
      <MakeNowHome />
      <RecipeListScreen />
    </View>
  );
}
