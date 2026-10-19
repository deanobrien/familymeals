'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Card, CardBody, Input, Select } from '@fr/ui';
import { UNIT_OPTIONS, categoryLabel, type IngredientHit } from '../../lib/pantry/types';
import { addItemAction, searchIngredientsAction } from '../../lib/server/pantry/actions';
import { usePantryAction } from './use-pantry-action';
import s from './pantry.module.css';

export const unitOptions = UNIT_OPTIONS.map((u) => ({ value: u, label: u }));

export function AddItem() {
  const { pending, run } = usePantryAction();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<IngredientHit[]>([]);
  const [chosen, setChosen] = useState<IngredientHit | null>(null);
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('g');
  const [expiry, setExpiry] = useState('');
  const seq = useRef(0);

  async function onQuery(q: string) {
    setQuery(q);
    setChosen(null);
    const mine = ++seq.current;
    if (!q.trim()) return setMatches([]);
    const hits = await searchIngredientsAction(q);
    if (mine === seq.current) setMatches(hits);
  }

  function pick(hit: IngredientHit) {
    setChosen(hit);
    setQuery(hit.name);
    setMatches([]);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    run(
      () =>
        addItemAction({
          ...(chosen ? { ingredientId: chosen.id } : {}),
          name: chosen ? chosen.name : query,
          value: Number(value),
          unit,
          ...(expiry ? { expiry } : {}),
        }),
      () => {
        setQuery('');
        setChosen(null);
        setMatches([]);
        setValue('');
        setExpiry('');
      },
    );
  }

  return (
    <Card>
      <CardBody>
        <form className={s.cardBody} onSubmit={submit} aria-label="Add pantry item">
          <h3 style={{ margin: 0 }}>Add an item</h3>
          <Input
            label="Ingredient"
            value={query}
            onChange={(e) => void onQuery(e.target.value)}
            autoComplete="off"
            placeholder="Start typing, e.g. pasta"
            hint={chosen ? undefined : 'Pick a match, or leave as typed to save it by name only.'}
          />
          {chosen && (
            <div className={s.badges}>
              <Badge tone="success">Matched: {chosen.name}</Badge>
              <span className={s.muted}>{categoryLabel(chosen.category)}</span>
            </div>
          )}
          {matches.length > 0 && (
            <ul className={s.matches} aria-label="Ingredient matches">
              {matches.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => pick(m)}>
                    {m.name} <span className={s.muted}>({categoryLabel(m.category)})</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className={s.formGrid}>
            <Input label="Quantity" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 500" />
            <Select label="Unit" options={unitOptions} value={unit} onChange={(e) => setUnit(e.target.value)} />
            <Input label="Expiry (optional)" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </div>
          <div>
            <Button type="submit" loading={pending}>Add to pantry</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
