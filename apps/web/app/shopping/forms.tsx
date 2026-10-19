'use client';

import { useState, type FormEvent } from 'react';
import { Button, Input, Select, Sheet } from '@fr/ui';
import type { ItemView, Quantity, Unit } from '../../lib/shopping/engine';
import { ALL_UNITS, UNIT_LABELS, compatibleUnits } from '../../lib/shopping/engine';
import { formatAmount } from '../../lib/shopping/format';
import { AISLES } from '../../lib/shopping/types';
import styles from './shopping.module.css';

const unitOptions = (units: Unit[]) =>
  units.map((u) => ({ value: u, label: UNIT_LABELS[u] || 'whole item(s)' }));

export function buildQuantity(value: string, unit: Unit): Quantity | null {
  const n = Number(value);
  if (!value.trim() || !Number.isFinite(n) || n <= 0) return null;
  return { kind: 'exact', value: n, unit, originalText: `${n} ${UNIT_LABELS[unit]}`.trim() };
}

/* ---------- partial purchase ---------- */
export function PartialSheet({
  view, open, onOpenChange, onSubmit,
}: {
  view: ItemView | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (item: ItemView, quantity: Quantity, pricePence?: number) => void;
}) {
  if (!view) return null;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Bought some ${view.item.displayName}`}
      description={`Still to get: ${view.quantified ? formatAmount(view.outstanding, view.unit) : 'one'}`}
    >
      <PartialForm key={view.item.id} view={view} onCancel={() => onOpenChange(false)} onSubmit={onSubmit} />
    </Sheet>
  );
}

function PartialForm({
  view, onCancel, onSubmit,
}: {
  view: ItemView;
  onCancel: () => void;
  onSubmit: (item: ItemView, quantity: Quantity, pricePence?: number) => void;
}) {
  const unit0: Unit = view.unit ?? 'item';
  const [qty, setQty] = useState(String(view.outstanding > 0 ? view.outstanding : 1));
  const [unit, setUnit] = useState<Unit>(unit0);
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | undefined>();

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = buildQuantity(qty, unit);
    if (!q) return setError('Enter a quantity greater than zero.');
    let pence: number | undefined;
    if (price.trim()) {
      const p = Number(price);
      if (!Number.isFinite(p) || p < 0) return setError('Enter a valid price, or leave it blank.');
      pence = Math.round(p * 100);
    }
    onSubmit(view, q, pence);
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.formRow}>
        <Input label="Quantity bought" type="number" inputMode="decimal" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} {...(error ? { error } : {})} />
        <Select label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)} options={unitOptions(compatibleUnits(unit0))} />
      </div>
      <Input label="Price paid in pounds (optional)" type="number" inputMode="decimal" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
      <div className={styles.formActions}>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit">Record purchase</Button>
      </div>
    </form>
  );
}

/* ---------- add / edit item ---------- */
export interface ItemFormValues {
  displayName: string;
  category: string;
  notes: string;
  quantity: Quantity | null;
}

export function ItemFormSheet({
  open, onOpenChange, editing, onAdd, onEdit, onRemove,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** null = add mode. */
  editing: ItemView | null;
  onAdd: (v: ItemFormValues) => void;
  onEdit: (item: ItemView, v: ItemFormValues) => void;
  onRemove: (item: ItemView) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={editing ? `Edit ${editing.item.displayName}` : 'Add an item'}>
      <ItemForm
        key={editing?.item.id ?? 'new'}
        editing={editing}
        onCancel={() => onOpenChange(false)}
        onAdd={onAdd}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    </Sheet>
  );
}

function ItemForm({
  editing, onCancel, onAdd, onEdit, onRemove,
}: {
  editing: ItemView | null;
  onCancel: () => void;
  onAdd: (v: ItemFormValues) => void;
  onEdit: (item: ItemView, v: ItemFormValues) => void;
  onRemove: (item: ItemView) => void;
}) {
  const mq = editing?.item.manualQuantity;
  const [name, setName] = useState(editing?.item.displayName ?? '');
  const [qty, setQty] = useState(mq && mq.kind === 'exact' && typeof mq.value === 'number' ? String(mq.value) : '');
  const [unit, setUnit] = useState<Unit>(mq?.unit ?? 'item');
  const [category, setCategory] = useState(editing?.item.category ?? 'Other');
  const [notes, setNotes] = useState(editing?.item.notes ?? '');
  const [error, setError] = useState<string | undefined>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const planLinked = !!editing?.item.requirement;
  const hasUnparsedManual = !!mq && mq.kind !== 'exact';

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Give the item a name.');
    let quantity: Quantity | null = null;
    if (qty.trim()) {
      quantity = buildQuantity(qty, unit);
      if (!quantity) return setError('Quantity must be a number greater than zero.');
    }
    const v: ItemFormValues = { displayName: name.trim(), category, notes: notes.trim(), quantity };
    if (editing) onEdit(editing, v);
    else onAdd(v);
  }

  if (editing && confirmRemove) {
    return (
      <div className={styles.form}>
        <p>Remove {editing.item.displayName} from the list? Anything already bought stays in the purchase history.</p>
        <div className={styles.formActions}>
          <Button variant="secondary" onClick={() => setConfirmRemove(false)}>Keep it</Button>
          <Button variant="danger" onClick={() => onRemove(editing)}>Remove item</Button>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <Input label="Item name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required {...(error && !name.trim() ? { error } : {})} />
      <div className={styles.formRow}>
        <Input
          label={planLinked ? 'Extra quantity (on top of the plan)' : 'Quantity'}
          type="number" inputMode="decimal" min="0" step="any" value={qty}
          onChange={(e) => setQty(e.target.value)}
          {...(error && name.trim() ? { error } : {})}
          {...(hasUnparsedManual && !qty ? { hint: 'No exact quantity set' } : {})}
        />
        <Select label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)} options={unitOptions(ALL_UNITS)} />
      </div>
      <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} options={AISLES.map((a) => ({ value: a, label: a }))} />
      <Input label="Note" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} hint="For example: the unsmoked kind" />
      <div className={styles.formActions}>
        {editing && <Button variant="danger" onClick={() => setConfirmRemove(true)}>Remove</Button>}
        <span className={styles.toolbarSpacer} />
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit">{editing ? 'Save changes' : 'Add to list'}</Button>
      </div>
    </form>
  );
}
