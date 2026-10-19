import { addDays } from './engine';
import type { ScanForm } from './scan-types';

/**
 * Typical unopened / stored shelf life in days, by catalogue category (D87). A deliberately small, conservative
 * table: it is only used when the owner turns on "Suggest typical shelf life when no date" and every value it
 * produces is shown as an ESTIMATE the owner can clear. It is never applied silently and never overrides a read date.
 */
const BY_CATEGORY: Record<string, { days: number; basis: string }> = {
  fruit_veg: { days: 7, basis: 'fresh fruit and veg' },
  meat_poultry: { days: 2, basis: 'fresh meat (cook or freeze quickly)' },
  fish_seafood: { days: 2, basis: 'fresh fish (cook or freeze quickly)' },
  dairy_eggs: { days: 7, basis: 'chilled dairy and eggs' },
  dairy_alternatives: { days: 7, basis: 'chilled dairy alternatives' },
  meat_alternatives: { days: 7, basis: 'chilled meat alternatives' },
  bakery: { days: 4, basis: 'fresh bread and bakery' },
  frozen: { days: 90, basis: 'frozen food' },
  tinned_jarred: { days: 365, basis: 'tinned and jarred food' },
  pasta_rice_grains: { days: 365, basis: 'dry pasta, rice and grains' },
  baking: { days: 365, basis: 'baking ingredients' },
  herbs_spices: { days: 365, basis: 'dried herbs and spices' },
  oils_vinegars: { days: 365, basis: 'oils and vinegars' },
  sauces_condiments: { days: 180, basis: 'sauces and condiments' },
  sweeteners_spreads: { days: 365, basis: 'sweeteners and spreads' },
  nuts_seeds: { days: 180, basis: 'nuts and seeds' },
  cereals: { days: 180, basis: 'breakfast cereals' },
  snacks: { days: 120, basis: 'snacks' },
  drinks: { days: 180, basis: 'drinks' },
  world_foods: { days: 365, basis: 'store-cupboard world foods' },
};

const BY_FORM: Partial<Record<ScanForm, { days: number; basis: string }>> = {
  frozen: { days: 90, basis: 'frozen food' },
  canned: { days: 365, basis: 'tinned food' },
  dried: { days: 365, basis: 'dried food' },
};

export interface ShelfLifeEstimate {
  days: number;
  /** ISO date: today + days. */
  date: string;
  /** Shown to the owner, e.g. "typical for fresh fruit and veg (about 7 days)". */
  label: string;
}

/** Typical shelf life for an ingredient category + form, or null when there is nothing sensible to suggest. */
export function estimateShelfLife(category: string | undefined, form: ScanForm, today: string): ShelfLifeEstimate | null {
  const hit = BY_FORM[form] ?? (category ? BY_CATEGORY[category] : undefined);
  if (!hit) return null;
  return { days: hit.days, date: addDays(today, hit.days), label: `typical for ${hit.basis} (about ${hit.days} days)` };
}
