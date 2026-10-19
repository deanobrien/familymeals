// View models and shared constants for the pantry UI. Client-safe: plain serialisable data only.

export type PurchaseMode = 'off' | 'suggest' | 'auto';

export interface PantrySettings {
  purchaseMode: PurchaseMode;
  staleAfterDays: number;
}

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export interface BadgeView {
  tone: 'neutral' | 'warning' | 'danger' | 'success';
  label: string;
}

export interface ItemView {
  id: string;
  name: string;
  ingredientId?: string;
  quantityLabel: string;
  /** Exact quantity parts for the edit form (absent for approximate quantities). */
  value?: number;
  unit?: string;
  expiry?: string;
  expiryBadge?: BadgeView;
  status: 'confident' | 'stale' | 'expired' | 'approximate';
  confidenceMessage: string;
  stale: boolean;
}

export interface CategoryView {
  category: string;
  label: string;
  items: ItemView[];
}

export interface ExpiringView {
  id: string;
  name: string;
  quantityLabel: string;
  expiry: string;
  daysLeft: number;
  expired: boolean;
  badge: BadgeView;
}

export interface SuggestionView {
  recipeId: string;
  title: string;
  href: string;
  coveragePct: number;
  urgencyPct: number;
  covered: string[];
  missing: string[];
  explanations: string[];
  /** Short reason line, e.g. "80% covered - uses stock expiring soon". */
  headline: string;
}

export interface PendingAdjustmentView {
  eventId: string;
  name: string;
  ingredientId?: string;
  quantityLabel: string;
  reason: string;
  requiresConfirmation: boolean;
}

export interface LeftoverView {
  key: string;
  title: string;
  portionsRemaining: number;
  useBy: string;
  suggestions: string[];
  advice: string[];
  summary: string;
}

export interface PantryView {
  householdId: string;
  settings: PantrySettings;
  totalItems: number;
  categories: CategoryView[];
  staleItems: ItemView[];
  expiring: ExpiringView[];
  suggestions: SuggestionView[];
  pending: PendingAdjustmentView[];
  leftovers: LeftoverView[];
}

export interface IngredientHit {
  id: string;
  name: string;
  category: string;
}

export const UNIT_OPTIONS = [
  'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'item', 'clove', 'can', 'pack', 'bunch', 'slice', 'sprig', 'stick',
] as const;
export type PantryUnit = (typeof UNIT_OPTIONS)[number];

export const CATEGORY_LABELS: Record<string, string> = {
  fruit_veg: 'Fruit and veg',
  meat_poultry: 'Meat and poultry',
  fish_seafood: 'Fish and seafood',
  dairy_eggs: 'Dairy and eggs',
  dairy_alternatives: 'Dairy alternatives',
  bakery: 'Bakery',
  baking: 'Baking',
  pasta_rice_grains: 'Pasta, rice and grains',
  tinned_jarred: 'Tinned and jarred',
  frozen: 'Frozen',
  herbs_spices: 'Herbs and spices',
  oils_vinegars: 'Oils and vinegars',
  sauces_condiments: 'Sauces and condiments',
  sweeteners_spreads: 'Sweeteners and spreads',
  snacks: 'Snacks',
  nuts_seeds: 'Nuts and seeds',
  meat_alternatives: 'Meat alternatives',
  cereals: 'Cereals',
  drinks: 'Drinks',
  world_foods: 'World foods',
  other: 'Other',
};

export const categoryLabel = (c: string): string => CATEGORY_LABELS[c] ?? c;
