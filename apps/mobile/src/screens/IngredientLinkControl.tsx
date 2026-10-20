import React, { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useApp } from '@/data/AppContext';
import { linkSummary, type LinkState } from '@/lib/recipeForm';
import type { Candidate } from '@/lib/recipesApi';
import { Button, Muted, useStyles, useTheme } from './ui';

/**
 * "Matched to: X" control of one ingredient line (web: IngredientLinkControl, D222). Shows the match, suggestions, a catalogue
 * search, "Not in list" and "Match automatically". The matching and the catalogue stay on the server.
 */
export default function IngredientLinkControl({
  n,
  hasName,
  state,
  onChoose,
  onAuto,
}: {
  n: number;
  hasName: boolean;
  state: LinkState;
  /** A catalogue ingredient, or null for "not in list". */
  onChoose: (choice: Candidate | null) => void;
  /** Go back to automatic matching of the typed name. */
  onAuto: () => void;
}) {
  const { recipes, householdId } = useApp();
  const styles = useStyles();
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const [searchError, setSearchError] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const search = (q: string) => {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    const mine = ++seq.current;
    if (q.trim().length < 2 || !householdId) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(() => {
      recipes.searchCatalogue(householdId, q.trim()).then(
        (found) => {
          if (mine === seq.current) {
            setResults(found);
            setSearchError(false);
          }
        },
        () => mine === seq.current && setSearchError(true),
      );
    }, 250);
  };

  const pick = (c: Candidate | null) => {
    onChoose(c);
    setOpen(false);
    setQuery('');
    setResults([]);
  };

  const options = state.candidates.filter((c) => c.id !== state.ingredientId);
  const label = linkSummary(state, hasName);

  return (
    <View>
      <Button
        title={`${label} ${open ? '▴' : '▾'}`}
        accessibilityLabel={`Ingredient ${n} match: ${label}`}
        variant="secondary"
        disabled={!hasName}
        onPress={() => setOpen((o) => !o)}
        testID={`ing-link-${n}`}
      />
      {open && (
        <View style={styles.banner} testID={`ing-link-panel-${n}`}>
          {options.length > 0 && (
            <View>
              <Muted>{state.ambiguous ? 'Several ingredients fit' : 'Did you mean'}</Muted>
              {options.map((c) => (
                <Button key={c.id} title={c.name} variant="secondary" onPress={() => pick(c)} testID="ing-link-option" />
              ))}
            </View>
          )}
          <Muted>Search the ingredient list</Muted>
          <TextInput
            accessibilityLabel="Search the ingredient list"
            placeholder="e.g. coriander"
            placeholderTextColor={t.muted}
            value={query}
            onChangeText={search}
            autoCorrect={false}
            style={styles.input}
            testID="ing-link-search"
          />
          {results.map((c) => (
            <Button key={c.id} title={c.name} variant="secondary" onPress={() => pick(c)} testID="ing-link-result" />
          ))}
          {searchError && <Muted>Could not search just now. Check your connection.</Muted>}
          {!searchError && query.trim().length >= 2 && results.length === 0 && <Muted>No ingredient found.</Muted>}
          <Button title="Not in list" variant="secondary" onPress={() => pick(null)} testID="ing-link-none" />
          <Button
            title="Match automatically"
            variant="secondary"
            onPress={() => {
              onAuto();
              setOpen(false);
            }}
            testID="ing-link-auto"
          />
          <Muted>Unlinked ingredients are left out of cost and nutrition and are treated as unknown when planning around allergies.</Muted>
        </View>
      )}
    </View>
  );
}
