import { EmptyState } from '@fr/ui';

export const metadata = { title: 'Settings' };

export default function Page() {
  return (
    <>
      <h1>Settings</h1>
      <EmptyState icon="settings" title="Nothing to configure yet" description="Preferences will appear here." />
    </>
  );
}
