import { Skeleton } from '@fr/ui';

export default function Loading() {
  return (
    <div aria-busy="true">
      <h1>Recipes</h1>
      <Skeleton height={44} label="Loading recipes" />
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', marginTop: 16 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i}><Skeleton height={220} /></li>
        ))}
      </ul>
    </div>
  );
}
