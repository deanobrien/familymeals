'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { Button, Input, Select } from '@fr/ui';
import { searchRecipesAction } from './actions';
import { IdeaResults, type DiscoverResultState } from './idea-results';

interface Props { categories: string[]; areas: string[]; sourceLabel: string; sourceNote: string }

export function DiscoverView({ categories, areas, sourceLabel, sourceNote }: Props) {
  const [q, setQ] = useState('');
  const [area, setArea] = useState('');
  const [category, setCategory] = useState('');
  const [ingredient, setIngredient] = useState('');
  const [result, setResult] = useState<DiscoverResultState>(null);
  const [pending, start] = useTransition();
  const [surprising, startSurprise] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    start(async () => setResult(await searchRecipesAction({ q, area, category, ingredient })));
  };

  // "Surprise me": picks a random category word search the user can still review; never saves anything by itself.
  const surprise = () =>
    startSurprise(async () => {
      const pool = categories.length ? categories : ['Chicken'];
      const pick = pool[Math.floor(Math.random() * pool.length)]!;
      setCategory(pick);
      setResult(await searchRecipesAction({ category: pick }));
    });

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <form onSubmit={submit} role="search" aria-label="Find new recipes" style={{ display: 'grid', gap: '0.75rem' }}>
        <Input label="Search recipes" placeholder="e.g. salmon, curry, pancakes" value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} />
        <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))' }}>
          <Select label="Cuisine" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Any cuisine" options={areas.map((a) => ({ value: a, label: a }))} />
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Any category" options={categories.map((c) => ({ value: c, label: c }))} />
          <Input label="Main ingredient" placeholder="e.g. chicken" value={ingredient} onChange={(e) => setIngredient(e.target.value)} maxLength={60} />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Button type="submit" loading={pending}>Search</Button>
          <Button type="button" variant="secondary" onClick={surprise} loading={surprising}>Surprise me</Button>
        </div>
      </form>
      <p className="fr-muted" style={{ margin: 0, fontSize: '0.8125rem' }} data-testid="discover-source">
        Source: {sourceLabel}. {sourceNote} Recipes that contain anything your household excludes are never shown.
      </p>
      <IdeaResults result={result} />
    </div>
  );
}
