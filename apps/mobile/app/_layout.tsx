import { Stack } from 'expo-router';
import { ShareIntentProvider } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import { AppProvider } from '@/data/AppContext';
import ShareIntentHandler from '@/screens/ShareIntentHandler';
import { useTheme } from '@/screens/ui';
import NotificationTaps from '@/screens/notifications/NotificationTaps';
import { defineGeofenceTask } from '@/lib/geofence';

// Android runs the geofence task when the app is not in the foreground, so it must be defined at module load (P2-A, D393).
defineGeofenceTask();

function Navigator() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.text,
        contentStyle: { backgroundColor: t.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ title: 'Sign in', headerShown: false }} />
      <Stack.Screen name="auth/callback" options={{ title: 'Signing in', headerShown: false }} />
      <Stack.Screen name="sign-up" options={{ title: 'Create account' }} />
      <Stack.Screen name="forgot-password" options={{ title: 'Reset password' }} />
      <Stack.Screen name="reset-password" options={{ title: 'New password' }} />
      <Stack.Screen name="invite/[token]" options={{ title: 'Invitation' }} />
      <Stack.Screen name="household/index" options={{ title: 'Household' }} />
      <Stack.Screen name="household/new" options={{ title: 'New household' }} />
      <Stack.Screen name="your-data" options={{ title: 'Your data' }} />
      <Stack.Screen name="delete-account" options={{ title: 'Delete account' }} />
      <Stack.Screen name="households" options={{ title: 'Households' }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="recipe/[id]" options={{ title: 'Recipe' }} />
      <Stack.Screen name="recipe/cook/[id]" options={{ title: 'Cook mode' }} />
      <Stack.Screen name="recipe/new" options={{ title: 'New recipe' }} />
      <Stack.Screen name="recipe/edit/[id]" options={{ title: 'Edit recipe' }} />
      <Stack.Screen name="discover" options={{ title: 'Discover recipes' }} />
      <Stack.Screen name="import-link" options={{ title: 'Recipe from a link' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="notification-settings" options={{ title: 'Notification settings' }} />
      <Stack.Screen name="calendar-settings" options={{ title: "Calendar" }} />
      <Stack.Screen name="location-settings" options={{ title: 'Location' }} />
      <Stack.Screen name="s/[token]" options={{ title: 'Shared recipe' }} />
      <Stack.Screen name="shared" options={{ title: 'Shared recipes' }} />
      <Stack.Screen name="kids" options={{ title: "Kids' mode" }} />
      <Stack.Screen name="kids-play" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="health-goals" options={{ title: 'Health goals' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ShareIntentProvider options={{ resetOnBackground: true }}>
      <AppProvider>
        <StatusBar style="auto" />
        <NotificationTaps />
        <Navigator />
        <ShareIntentHandler />
      </AppProvider>
    </ShareIntentProvider>
  );
}
