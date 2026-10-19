import { EmptyState } from '@fr/ui';

export const metadata = { title: 'Shopping list' };

export default function Page() {
  return (
    <>
      <h1>Shopping list</h1>
      <EmptyState icon="cart" title="Your list is empty" description="A combined shopping list will be built from your plan." />
    </>
  );
}
