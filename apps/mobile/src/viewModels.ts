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
  /** True once a PurchaseEvent has been recorded (locally or on the server). */
  ticked: boolean;
}

export interface UserSession {
  userId: Uuid;
  email: string;
}
