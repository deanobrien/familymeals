import { EmptyState } from '@fr/ui';

export const metadata = { title: 'Meal planner' };

export default function Page() {
  return (
    <>
      <h1>Meal planner</h1>
      <EmptyState icon="calendar" title="Nothing planned" description="Plan your week's meals here." />
    </>
  );
}
