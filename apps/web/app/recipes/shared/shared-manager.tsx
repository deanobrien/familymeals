'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, Select } from '@fr/ui';
import type { ShareSummary } from '../../../lib/sharing/types';
import { CreateShareForm, ShareList } from '../_components/sharing/ShareControls';
import s from '../../pantry/pantry.module.css';

const COLLECTIONS = [
  { value: 'favourites', label: 'Our favourites' },
  { value: 'quick', label: 'Quick meals' },
  { value: 'budget', label: 'Budget meals' },
  { value: 'vegetarian', label: 'Vegetarian meals' },
] as const;

export function SharedManager({ shares }: { shares: ShareSummary[] }) {
  const router = useRouter();
  const [collection, setCollection] = useState<(typeof COLLECTIONS)[number]['value']>('favourites');
  const label = COLLECTIONS.find((c) => c.value === collection)?.label ?? 'Recipes';
  return (
    <>
      <section className={s.section} aria-labelledby="share-collection-h">
        <h2 id="share-collection-h">Share a collection</h2>
        <Card>
          <CardBody className={s.cardBody}>
            <Select
              label="Collection"
              value={collection}
              onChange={(e) => setCollection(e.target.value as typeof collection)}
              options={COLLECTIONS.map((c) => ({ value: c.value, label: c.label }))}
              hint="Shares the recipes in it right now (up to 50)."
            />
            <CreateShareForm key={collection} scope="collection" collection={collection} title={label} label={label} onCreated={() => router.refresh()} />
          </CardBody>
        </Card>
      </section>
      <section className={s.section} aria-labelledby="share-links-h">
        <h2 id="share-links-h">Your links</h2>
        <ShareList shares={shares} onChanged={() => router.refresh()} />
      </section>
    </>
  );
}
