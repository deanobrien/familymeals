import { APP_NAME } from '@fr/domain';
import { EmptyState } from '@fr/ui';

export default function HomePage() {
  return (
    <>
      <h1>{APP_NAME}</h1>
      <EmptyState
        icon="home"
        title="Welcome"
        description="Your recipes, meal plan and shopping list will appear here."
      />
    </>
  );
}
