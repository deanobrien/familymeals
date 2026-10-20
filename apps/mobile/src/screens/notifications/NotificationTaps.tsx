import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { linkToRoute } from '@/lib/notificationsApi';
import { configureForegroundHandling } from '@/lib/push';

/** Opens the right screen when a push is tapped (also the one that launched the app). Renders nothing. */
export default function NotificationTaps() {
  const router = useRouter();
  useEffect(() => {
    configureForegroundHandling();
    const go = (r: Notifications.NotificationResponse | null) => {
      const link = (r?.notification.request.content.data as { link?: unknown } | undefined)?.link;
      if (r) router.push(linkToRoute(typeof link === 'string' ? link : null) as never);
    };
    Notifications.getLastNotificationResponseAsync().then(go, () => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener(go);
    return () => sub.remove();
  }, [router]);
  return null;
}
