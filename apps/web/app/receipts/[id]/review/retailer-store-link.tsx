'use client';

// Receipt retailer -> the household's Store (P2-B, D403). A suggestion is only ever applied when the user confirms it.
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, Select, useToast } from '@fr/ui';
import type { StoreRef } from '../../../../lib/money/types';
import { linkRetailerAction } from '../../../spending/actions';

export function RetailerStoreLink({ retailer, linked, suggestion, stores, readOnly }: { retailer: string; linked: StoreRef | null; suggestion: StoreRef | null; stores: StoreRef[]; readOnly: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [pick, setPick] = useState('');
  const link = (id: string | null, name: string) =>
    start(async () => {
      const r = await linkRetailerAction(retailer, id);
      if (r.ok) { toast(id ? `Linked to ${name}.` : 'Link removed.'); router.refresh(); } else toast({ message: r.error, tone: 'error' });
    });
  if (linked) {
    return (
      <p data-testid="retailer-linked" style={{ margin: '0.25rem 0' }}>
        Counted as your store <strong>{linked.name}</strong> for prices and spending.
        {!readOnly && <> <Button size="sm" variant="ghost" loading={pending} onClick={() => link(null, linked.name)}>Unlink</Button></>}
      </p>
    );
  }
  if (readOnly || stores.length === 0) return null;
  return (
    <div data-testid="retailer-unlinked" style={{ margin: '0.25rem 0', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
      {suggestion ? (
        <>
          <span>Is <strong>{retailer}</strong> your store <strong>{suggestion.name}</strong>?</span>
          <Button size="sm" loading={pending} onClick={() => link(suggestion.id, suggestion.name)}>Yes, link it</Button>
        </>
      ) : (
        <>
          <span>Which of your stores is <strong>{retailer}</strong>?</span>
          <Select label="Store" hideLabel value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Choose a store…" options={stores.map((x) => ({ value: x.id, label: x.name }))} />
          <Button size="sm" disabled={!pick} loading={pending} onClick={() => link(pick, stores.find((x) => x.id === pick)?.name ?? 'store')}>Link</Button>
        </>
      )}
    </div>
  );
}
