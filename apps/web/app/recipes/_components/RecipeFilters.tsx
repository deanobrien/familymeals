'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Select, SearchField, ViewToggle, type RecipeView as ViewMode } from '@fr/ui';
import {
  COLLECTIONS,
  PREP_LIMITS,
  recipeQueryToParams,
  type RecipeCollection,
  type RecipeQuery,
} from '../../../lib/recipes/schema';
import { DIET_CATEGORIES, MEAL_TYPES } from '../../../lib/recipes/types';
import type { TagCount } from '../../../lib/recipes/repository';
import styles from '../recipes.module.css';

const COLLECTION_LABEL: Record<RecipeCollection, string> = {
  favourites: 'Favourites',
  quick: 'Quick meals',
  budget: 'Budget meals',
  vegetarian: 'Vegetarian',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Props {
  query: RecipeQuery;
  view: ViewMode;
  cuisines: string[];
  tags: TagCount[];
}

export function RecipeFilters({ query, view, cuisines, tags }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(query.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the box in sync with back/forward navigation and "clear filters".
  useEffect(() => setSearch(query.q), [query.q]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const push = (patch: Partial<RecipeQuery> & { view?: ViewMode }, keepPage = false) => {
    const next = { ...query, view, ...patch };
    if (!keepPage && !('page' in patch)) next.page = 1;
    const qs = recipeQueryToParams(next).toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const onSearch = (value: string) => {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push({ q: value.trim() }), 300);
  };

  const toggleTag = (tag: string) =>
    push({ tags: query.tags.includes(tag) ? query.tags.filter((t) => t !== tag) : [...query.tags, tag] });

  const activeFilters =
    [query.cuisine, query.mealType, query.maxPrepMinutes, query.diet, query.priceBand].filter(Boolean).length +
    query.tags.length;

  return (
    <section aria-label="Find recipes" className={pending ? styles.pending : undefined}>
      <div className={styles.toolbar}>
        <SearchField
          label="Search recipes"
          placeholder="Search titles, ingredients, tags"
          value={search}
          onValueChange={onSearch}
          onSearch={(v) => push({ q: v.trim() })}
        />
        <Select
          label="Sort by"
          value={query.sort}
          onChange={(e) => push({ sort: e.target.value as RecipeQuery['sort'] })}
          options={[
            { value: 'name', label: 'Name' },
            { value: 'recent', label: 'Recently added' },
            { value: 'cost', label: 'Cost per serving' },
            { value: 'rating', label: 'Rating' },
            { value: 'prep', label: 'Prep time' },
          ]}
        />
        <ViewToggle view={view} onChange={(v) => push({ view: v }, true)} />
      </div>

      <ul className={styles.chips} aria-label="Collections">
        <li>
          <button type="button" className={styles.chip} aria-pressed={!query.collection} onClick={() => push({ collection: undefined })}>
            All recipes
          </button>
        </li>
        {COLLECTIONS.map((c) => (
          <li key={c}>
            <button
              type="button"
              className={styles.chip}
              aria-pressed={query.collection === c}
              onClick={() => push({ collection: query.collection === c ? undefined : c })}
            >
              {COLLECTION_LABEL[c]}
            </button>
          </li>
        ))}
      </ul>

      <details className={styles.filters} open={activeFilters > 0 || undefined}>
        <summary>Filters{activeFilters > 0 ? ` (${activeFilters})` : ''}</summary>
        <div className={styles.filterGrid}>
          <Select
            label="Cuisine"
            placeholder="Any cuisine"
            value={query.cuisine ?? ''}
            onChange={(e) => push({ cuisine: e.target.value || undefined })}
            options={cuisines.map((c) => ({ value: c, label: c }))}
          />
          <Select
            label="Meal type"
            placeholder="Any meal"
            value={query.mealType ?? ''}
            onChange={(e) => push({ mealType: (e.target.value || undefined) as RecipeQuery['mealType'] })}
            options={MEAL_TYPES.map((m) => ({ value: m, label: cap(m) }))}
          />
          <Select
            label="Prep time"
            placeholder="Any prep time"
            value={query.maxPrepMinutes ? String(query.maxPrepMinutes) : ''}
            onChange={(e) => push({ maxPrepMinutes: e.target.value ? Number(e.target.value) : undefined })}
            options={PREP_LIMITS.map((m) => ({ value: String(m), label: `Up to ${m} min` }))}
          />
          <Select
            label="Diet"
            placeholder="Any diet"
            value={query.diet ?? ''}
            onChange={(e) => push({ diet: (e.target.value || undefined) as RecipeQuery['diet'] })}
            options={DIET_CATEGORIES.map((d) => ({ value: d, label: cap(d) }))}
          />
          <Select
            label="Price"
            placeholder="Any price"
            value={query.priceBand ?? ''}
            onChange={(e) => push({ priceBand: (e.target.value || undefined) as RecipeQuery['priceBand'] })}
            options={[
              { value: 'low', label: 'Under £1.50 per serving' },
              { value: 'mid', label: '£1.50 to £3.00 per serving' },
              { value: 'high', label: 'Over £3.00 per serving' },
              { value: 'unknown', label: 'Cost unknown' },
            ]}
          />
        </div>
        {tags.length > 0 && (
          <>
            <p className={styles.filterLabel} id="tag-filter-label">Tags</p>
            <ul className={styles.chips} aria-labelledby="tag-filter-label">
              {tags.map(({ tag, count }) => (
                <li key={tag}>
                  <button type="button" className={styles.chip} aria-pressed={query.tags.includes(tag)} onClick={() => toggleTag(tag)}>
                    {tag} ({count})
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </section>
  );
}
