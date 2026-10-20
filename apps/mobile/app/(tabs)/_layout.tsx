import { Tabs } from 'expo-router';
import { useTheme } from '@/screens/ui';
import HeaderBell from '@/screens/notifications/HeaderBell';

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.text,
        tabBarStyle: { backgroundColor: t.bg, borderTopColor: t.border },
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.muted,
        tabBarLabelStyle: { fontSize: 13 },
        headerRight: () => <HeaderBell />,
      }}
    >
      <Tabs.Screen name="recipes" options={{ title: 'Recipes', tabBarAccessibilityLabel: 'Recipes tab' }} />
      <Tabs.Screen name="shopping" options={{ title: 'Shopping', tabBarAccessibilityLabel: 'Shopping tab' }} />
      <Tabs.Screen name="capture" options={{ title: 'Capture', tabBarAccessibilityLabel: 'Capture recipe tab' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarAccessibilityLabel: 'Settings tab' }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarAccessibilityLabel: 'More: planner, pantry, receipts' }} />
    </Tabs>
  );
}
