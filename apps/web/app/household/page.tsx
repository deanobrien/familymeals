import { EmptyState } from '@fr/ui';

export const metadata = { title: 'Household' };

export default function Page() {
  return (
    <>
      <h1>Household</h1>
      <EmptyState icon="users" title="Just you for now" description="Invite family members to share recipes and lists." />
    </>
  );
}
