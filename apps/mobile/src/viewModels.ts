// Mobile-local view models. Shared contract types come from @fr/domain.
import type { DietCategory, NutrientValue, Quantity, RecipeIngredientLine, Uuid } from '@fr/domain';

export interface Household {
  id: Uuid;
  name: string;
  memberCount: number;
}

export interface Recipe {
  id: Uuid;
  householdId: Uuid;
  title: string;
  servings: number;
  dietCategory?: DietCategory;
  ingredients: Array<
    Pick<RecipeIngredientLine, 'id' | 'quantity' | 'preparation' | 'optional' | 'order'> & { name: string }
  >;
  steps: string[];
  /** Per-serving nutrition. Missing/unknown/unavailable entries must render as "Unknown". */
  nutrition: NutrientValue[];
}

export interface ShoppingListItem {
  id: Uuid;
  householdId: Uuid;
  displayName: string;
  quantity: Quantity;
  aisle: string;
  /** Canonical ingredient link and list category, when known (store aisle ordering, AS1). */
  ingredientId?: Uuid;
  category?: string;
  /** True once a PurchaseEvent has been recorded (locally or on the server). */
  ticked: boolean;
  /** True when a ticked item has a purchase that can be undone. */
  canUndo?: boolean;
}

export interface UserSession {
  userId: Uuid;
  email: string;
  /** Set by `completeAuthLink` for a password-recovery link: go on to choose a new password. */
  recovery?: boolean;
}

/** A shopping command the server rejected (or could not apply). Surfaced to the user as a toast. */
export interface ShoppingConflict {
  commandId: Uuid;
  itemId?: Uuid;
  itemName: string;
  message: string;
}
