import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { cookedLabel } from '@fr/engine/cooking';
import { formatMinutes, formatPence } from '@/lib/calcFormat';
import {
  COLLECTIONS,
  DIET_CATEGORIES,
  EMPTY_QUERY,
  MEAL_TYPES,
  PREP_LIMITS,
  PRICE_BANDS,
  type PriceBand,
  type RecipeCollection,
  type RecipeListItem,
  type RecipeListResponse,
  type RecipeQueryState,
  type RecipeSort,
} from '@/lib/recipesApi';
import { Button, EmptyState, ErrorState, ErrorText, Loading, Muted, Text, useStyles, useTheme } from './ui';
import { Chip, ChipWrap, OptionRow, RecipeImage } from './widgets';

const COLLECTION_LABEL: Record<RecipeCollection, string> = {
  favourites: 'Favourites',
  quick: 'Quick meals',
  budget: 'Budget meals',
  vegetarian: 'Vegetarian',
};
const PRICE_LABEL: Record<PriceBand, string> = { low: 'Low cost', mid: 'Mid', high: 'High', unknown: 'Cost unknown' };
const SORT_OPTIONS: Array<{ value: RecipeSort; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'recent', label: 'Recently added' },
  { value: 'cost', label: 'Cost per serving' },
  { value: 'rating', label: 'Rating' },
  { value: 'prep', label: 'Prep time' },
];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function summary(r: RecipeListItem): string {
  const total = (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0);
  const parts = [`Serves ${r.servings}`];
  if (r.prepMinutes != null || r.cookMinutes != null) parts.push(formatMinutes(total));
  if (r.costPerServingPence != null) parts.push(`${r.cost.partial ? 'from ' : ''}${formatPence(r.costPerServingPence)} each`);
  if (r.rating != null) parts.push(`★ ${Math.round(r.rating * 10) / 10}`);
  if (r.cooked) parts.push(cookedLabel(r.cooked, Date.now()));
  return parts.join(' · ');
}

export default function RecipeListScreen() {
  const { recipes, householdId } = useApp();
  const router = useRouter();
  const styles = useStyles();
  const t = useTheme();
  const [query, setQuery] = useState<RecipeQueryState>(EMPTY_QUERY);
  const [searchText, setSearchText] = useState('');
  const [facets, setFacets] = useState<Pick<RecipeListResponse, 'cuisines' | 'tags' | 'hasAny'> | null>(null);
  const [items, setItems] = useState<RecipeListItem[] | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const seq = useRef(0);

  // Debounced search box -> query.q (page back to 1).
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery((q) => (q.q === searchText.trim() ? q : { ...q, q: searchText.trim(), page: 1 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  // Re-read when the screen regains focus (after creating, editing or deleting a recipe elsewhere).
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false; // the mount load below already covers the first focus
        return;
      }
      setQuery((q) => (q.page === 1 ? q : { ...q, page: 1 }));
      setReload((n) => n + 1);
    }, []),
  );

  useEffect(() => {
    if (!householdId) return;
    const mine = ++seq.current;
    setError(null);
    if (query.page > 1) setLoadingMore(true);
    recipes.list(householdId, query).then(
      (res) => {
        if (mine !== seq.current) return;
        setItems((cur) => (query.page > 1 && cur ? [...cur, ...res.items.filter((n) => !cur.some((c) => c.id === n.id))] : res.items));
        setFacets({ cuisines: res.cuisines, tags: res.tags, hasAny: res.hasAny });
        setPageCount(res.pageCount);
        setTotal(res.total);
        setLoadingMore(false);
      },
      (e: unknown) => {
        if (mine !== seq.current) return;
        setLoadingMore(false);
        setError(e instanceof Error ? e.message : 'Could not load recipes');
      },
    );
  }, [recipes, householdId, query, reload]);

  const patch = (p: Partial<RecipeQueryState>) => setQuery((q) => ({ ...q, ...p, page: 1 }));
  const activeFilters = [query.cuisine, query.mealType, query.maxPrepMinutes, query.diet, query.priceBand].filter(Boolean).length + query.tags.length;

  async function toggleFavourite(r: RecipeListItem) {
    if (!householdId) return;
    setActionError(null);
    const flip = (fav: boolean) => setItems((cur) => cur?.map((x) => (x.id === r.id ? { ...x, favourite: fav } : x)) ?? cur);
    flip(!r.favourite);
    try {
      flip(await recipes.toggleFavourite(householdId, r.id));
    } catch (e) {
      flip(r.favourite);
      setActionError(e instanceof Error ? e.message : 'Could not update favourite');
    }
  }

  if (!householdId) return <EmptyState title="Pick a household first." />;
  if (error && !items) return <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />;
  if (!items || !facets) return <Loading label="Loading recipes" />;

  const header = (
    <View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button title="New recipe" variant="secondary" onPress={() => router.push('/recipe/new')} testID="new-recipe" />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Discover" variant="secondary" onPress={() => router.push('/discover')} testID="open-discover" />
        </View>
      </View>
      <TextInput
        accessibilityLabel="Search recipes"
        placeholder="Search titles, ingredients, tags"
        placeholderTextColor={t.muted}
        value={searchText}
        onChangeText={setSearchText}
        returnKeyType="search"
        autoCorrect={false}
        style={styles.input}
        testID="recipe-search"
      />
      <ChipWrap>
        <Chip label="All recipes" selected={!query.collection} onPress={() => patch({ collection: undefined })} testID="collection-all" />
        {COLLECTIONS.map((c) => (
          <Chip
            key={c}
            label={COLLECTION_LABEL[c]}
            selected={query.collection === c}
            onPress={() => patch({ collection: query.collection === c ? undefined : c })}
            testID={`collection-${c}`}
          />
        ))}
      </ChipWrap>
      <Button
        title={`${filtersOpen ? 'Hide' : 'Show'} filters and sort${activeFilters ? ` (${activeFilters})` : ''}`}
        variant="secondary"
        onPress={() => setFiltersOpen((o) => !o)}
        testID="toggle-filters"
      />
      {filtersOpen && (
        <View testID="filters-panel" style={{ marginBottom: 8 }}>
          <OptionRow label="Sort by" testID="sort" value={query.sort} anyLabel={null} options={SORT_OPTIONS} onChange={(v) => patch({ sort: v ?? 'name' })} />
          {facets.cuisines.length > 0 && (
            <OptionRow label="Cuisine" testID="cuisine" value={query.cuisine} options={facets.cuisines.map((c) => ({ value: c, label: c }))} onChange={(v) => patch({ cuisine: v })} />
          )}
          <OptionRow label="Meal type" testID="meal" value={query.mealType} options={MEAL_TYPES.map((m) => ({ value: m, label: cap(m) }))} onChange={(v) => patch({ mealType: v })} />
          <OptionRow label="Prep time" testID="prep" value={query.maxPrepMinutes} options={PREP_LIMITS.map((m) => ({ value: m, label: `Up to ${m} min` }))} onChange={(v) => patch({ maxPrepMinutes: v })} />
          <OptionRow label="Diet" testID="diet" value={query.diet} options={DIET_CATEGORIES.map((d) => ({ value: d, label: cap(d) }))} onChange={(v) => patch({ diet: v })} />
          <OptionRow label="Price" testID="price" value={query.priceBand} options={PRICE_BANDS.map((p) => ({ value: p, label: PRICE_LABEL[p] }))} onChange={(v) => patch({ priceBand: v })} />
          {facets.tags.length > 0 && (
            <View>
              <Muted>Tags</Muted>
              <ChipWrap>
                {facets.tags.slice(0, 30).map((tg) => (
                  <Chip
                    key={tg.tag}
                    label={`${tg.tag} (${tg.count})`}
                    selected={query.tags.includes(tg.tag)}
                    testID={`tag-${tg.tag}`}
                    onPress={() => patch({ tags: query.tags.includes(tg.tag) ? query.tags.filter((x) => x !== tg.tag) : [...query.tags, tg.tag] })}
                  />
                ))}
              </ChipWrap>
            </View>
          )}
          {activeFilters > 0 && (
            <Button
              title="Clear filters"
              variant="secondary"
              testID="clear-filters"
              onPress={() => patch({ cuisine: undefined, mealType: undefined, maxPrepMinutes: undefined, diet: undefined, priceBand: undefined, tags: [] })}
            />
          )}
        </View>
      )}
      <Muted testID="result-count" accessibilityLiveRegion="polite">
        {total} {total === 1 ? 'recipe' : 'recipes'}
      </Muted>
      <ErrorText message={actionError ?? (error && items ? error : null)} />
    </View>
  );

  const filtered = !!(query.q || query.collection || activeFilters);

  return (
    <View style={styles.screen}>
      <FlatList
        data={items}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              setQuery((q) => ({ ...q, page: 1 }));
              setReload((n) => n + 1);
              setRefreshing(false);
            }}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (!loadingMore && query.page < pageCount) setQuery((q) => ({ ...q, page: q.page + 1 }));
        }}
        ListFooterComponent={loadingMore ? <Muted>Loading more...</Muted> : undefined}
        ListEmptyComponent={
          filtered ? (
            <EmptyState title="No recipes match." hint="Try removing a filter or the search words." />
          ) : (
            <EmptyState title="No recipes yet." hint="Capture one from the Capture tab, create one, or discover new ideas." />
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.row, { justifyContent: 'flex-start' }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${summary(item)}`}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
              testID={`recipe-${item.id}`}
              onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: item.id } })}
            >
              <RecipeImage imageUrl={item.imageUrl} size={64} label={`${item.title} photo`} />
              <View style={{ flex: 1, paddingHorizontal: 12 }}>
                <Text style={{ fontWeight: '600' }}>{item.title}</Text>
                <Muted>{summary(item)}</Muted>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.favourite ? `Remove ${item.title} from favourites` : `Add ${item.title} to favourites`}
              accessibilityState={{ selected: item.favourite }}
              testID={`fav-${item.id}`}
              onPress={() => void toggleFavourite(item)}
              style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 24, color: item.favourite ? t.danger : t.muted }}>{item.favourite ? '♥' : '♡'}</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}
