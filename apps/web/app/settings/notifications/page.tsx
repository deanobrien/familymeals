import { NotificationSettingsView } from './notification-settings';

export const metadata = { title: 'Notification settings' };
export const dynamic = 'force-dynamic';

export default function Page() {
  return <NotificationSettingsView />;
}
