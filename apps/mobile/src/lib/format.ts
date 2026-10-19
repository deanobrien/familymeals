import type { NutrientKey, NutrientValue, Quantity } from '@fr/domain';

export const NUTRIENT_LABELS: Record<NutrientKey, string> = {
  energy_kcal: 'Energy',
  energy_kj: 'Energy (kJ)',
  protein: 'Protein',
  carbohydrate: 'Carbohydrate',
  sugars: 'Sugars',
  fat: 'Fat',
  saturates: 'Saturates',
  fibre: 'Fibre',
  salt: 'Salt',
  sodium: 'Sodium',
};

/** Unknown/unavailable/missing is NEVER shown as 0: it shows "Unknown". */
export function formatNutrient(v: NutrientValue | undefined): string {
  if (!v) return 'Unknown';
  if (v.status === 'zero') return `0 ${v.unit}`;
  if (v.status === 'known' && typeof v.value === 'number') {
    return `${v.estimate ? '~' : ''}${Math.round(v.value * 10) / 10} ${v.unit}`;
  }
  return 'Unknown';
}

export function formatQuantity(q: Quantity): string {
  switch (q.kind) {
    case 'exact':
      return `${q.value ?? ''}${q.unit ? ` ${q.unit}` : ''}`.trim() || q.originalText;
    case 'range':
      return `${q.min}-${q.max}${q.unit ? ` ${q.unit}` : ''}`;
    case 'approximate':
      return q.approxLabel ?? q.originalText;
    case 'to_taste':
      return 'to taste';
    default:
      return q.originalText;
  }
}

/** Client-generated UUID-shaped id (idempotency key for offline PurchaseEvents). */
export function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}
