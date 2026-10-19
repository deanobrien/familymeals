import Link from 'next/link';
import { EmptyState } from '@fr/ui';

export default function NotFound() {
  return (
    <EmptyState
      icon="search"
      title="Recipe not found"
      description="It may have been deleted."
      action={<Link href="/recipes" className="fr-btn fr-btn--secondary">Back to recipes</Link>}
    />
  );
}
