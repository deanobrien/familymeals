import type { CommandResult, LogEntry, Requirement, ShoppingState } from './engine';

/** Display-only data the engine does not hold. */
export interface ListMeta {
  /** recipeId -> title, for the "from plan" provenance popover. Merged on every generate. */
  recipeTitles: Record<string, string>;
  /** The active list this data belongs to (D263). A client that knows its list id sends it back with every sync. */
  listId?: string;
  listName?: string;
}

/** One of the household's shopping lists. Exactly one is active (the list you shop from); the rest are archived. */
export interface ShoppingListInfo {
  id: string;
  name: string;
  status: 'active' | 'archived';
  updatedAt: string;
}

export interface SnapshotDto {
  cursor: number;
  state: ShoppingState;
  meta: ListMeta;
}

/** Returned by the `syncShopping` server action. */
export interface SyncResponse {
  /** Server log head. */
  cursor: number;
  /** Log entries after the cursor the client sent. */
  entries: LogEntry[];
  /** Present only when the client cursor is ahead of the server (server restarted): resync from it. */
  snapshot?: SnapshotDto;
  results: CommandResult[];
  /** commandIds the server refused to parse (malformed): the client must drop them from its queue. */
  dropped: string[];
  meta: ListMeta;
}

export interface PlanRequirements {
  planId: string;
  planName: string;
  requirements: Requirement[];
  recipeTitles: Record<string, string>;
  /** ingredientId -> aisle (from the refdata category); missing ids fall back to categoryFor(). */
  categories?: Record<string, string>;
}

/** Aisle order for grouping (walk-around-the-shop order). Categories double as aisles. */
export const AISLES = [
  'Fruit & veg',
  'Meat & fish',
  'Dairy & eggs',
  'Bakery',
  'Tins & jars',
  'Dry goods',
  'Herbs & spices',
  'Frozen',
  'Drinks',
  'Household',
  'Other',
] as const;
export type Aisle = (typeof AISLES)[number];

