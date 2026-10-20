// PRJ-018 AS1 (D292): optional starting aisles per chain. These are GENERIC GUESSES of a typical shop layout, not real
// store data (nothing is scraped and no chain publishes a machine-readable plan). The household copies one and edits it
// to match the shop they actually use. Categories are the shopping list's own category labels.

export const KNOWN_CHAINS = ['ALDI', 'LIDL', 'Tesco', "Sainsbury's", 'Asda', 'Morrisons', 'Co-op', 'M&S', 'Waitrose', 'Iceland'] as const;

export interface StoreTemplateAisle {
  label: string;
  /** List categories this aisle is the default home for (becomes category placements). */
  categories: string[];
}
export interface StoreTemplate {
  id: 'generic' | 'discounter' | 'frozen_first';
  title: string;
  aisles: StoreTemplateAisle[];
}

const FV: StoreTemplateAisle = { label: 'Fruit & veg', categories: ['Fruit & veg'] };
const BAKERY: StoreTemplateAisle = { label: 'Bakery', categories: ['Bakery'] };
const MEAT: StoreTemplateAisle = { label: 'Meat & fish', categories: ['Meat & fish'] };
const DAIRY: StoreTemplateAisle = { label: 'Dairy & eggs', categories: ['Dairy & eggs'] };
const TINS: StoreTemplateAisle = { label: 'Tins & jars', categories: ['Tins & jars'] };
const DRY: StoreTemplateAisle = { label: 'Dry goods & spices', categories: ['Dry goods', 'Herbs & spices'] };
const DRINKS: StoreTemplateAisle = { label: 'Drinks', categories: ['Drinks'] };
const HOUSE: StoreTemplateAisle = { label: 'Household', categories: ['Household'] };
const FROZEN: StoreTemplateAisle = { label: 'Frozen', categories: ['Frozen'] };

export const STORE_TEMPLATES: Record<StoreTemplate['id'], StoreTemplate> = {
  generic: { id: 'generic', title: 'Typical UK supermarket (a starting guess)', aisles: [FV, BAKERY, MEAT, DAIRY, TINS, DRY, DRINKS, HOUSE, FROZEN] },
  discounter: { id: 'discounter', title: 'Typical UK discount store (a starting guess)', aisles: [FV, BAKERY, TINS, DRY, DRINKS, HOUSE, DAIRY, MEAT, FROZEN] },
  frozen_first: { id: 'frozen_first', title: 'Typical UK frozen-food store (a starting guess)', aisles: [FROZEN, DAIRY, MEAT, FV, BAKERY, TINS, DRY, DRINKS, HOUSE] },
};

/** Which starting template to offer for a chain (matching ignores case, punctuation and spacing). */
export function templateForChain(chain: string | null | undefined): StoreTemplate {
  const c = (chain ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (c === 'aldi' || c === 'lidl') return STORE_TEMPLATES.discounter;
  if (c === 'iceland') return STORE_TEMPLATES.frozen_first;
  return STORE_TEMPLATES.generic;
}
