/**
 * What a data export contains (DX1, DATA-EXPORT-DELETION.md section 1). One spec per table: which archive file and
 * key it lands in, and how rows are selected for each scope:
 *  - 'household' scope (owners only): every row of the household
 *  - 'member' scope (any member): only the requester's own data (rows they created / their own profile, consents,
 *    favourites, ratings) and the children of those rows
 * All reads run as the signed-in user, so RLS is still the authority; these filters only narrow further.
 *
 * Deliberately NOT exported (EXCLUDED_TABLES): AI provider settings (encrypted keys), invitations (other people's
 * email addresses and token hashes), internal logs/queues/ledgers, and the export audit itself.
 */
export type ExportScope = 'member' | 'household';

export type RowSource =
  /** households: the row whose id is the household */
  | { kind: 'household-row' }
  /** every row with household_id = household */
  | { kind: 'household' }
  /** rows of the household whose `col` is the requester */
  | { kind: 'self'; col: string }
  /** rows of the household whose `col` is one of `parent` rows' `field` (default id) */
  | { kind: 'child'; col: string; parent: string; field?: string };

export interface TableSpec {
  table: string;
  file: string;
  key: string;
  /** Stable ordering for paging (columns). */
  order: string[];
  household: RowSource | null;
  member: RowSource | null;
  /** Table has no SELECT grant: read through this member-checked RPC `(p_household_id) -> jsonb array` instead. */
  rpc?: string;
}

const H = { kind: 'household' } as const;
const self = (col: string): RowSource => ({ kind: 'self', col });
const child = (col: string, parent: string, field?: string): RowSource =>
  field ? { kind: 'child', col, parent, field } : { kind: 'child', col, parent };
const ID = ['id'];

/** Order matters: parents before children. */
export const EXPORT_TABLES: readonly TableSpec[] = [
  { table: 'households', file: 'household.json', key: 'household', order: ID, household: { kind: 'household-row' }, member: { kind: 'household-row' } },
  { table: 'household_members', file: 'household.json', key: 'members', order: ID, household: H, member: self('user_id') },
  { table: 'person_profiles', file: 'dietary.json', key: 'person_profiles', order: ID, household: H, member: self('user_id') },
  { table: 'household_exclusions', file: 'dietary.json', key: 'exclusions', order: ID, household: H, member: self('created_by') },
  { table: 'member_dislikes', file: 'dietary.json', key: 'member_dislikes', order: ID, household: H, member: self('member_user_id') },
  { table: 'consent_records', file: 'consents.json', key: 'consent_records', order: ID, household: self('user_id'), member: self('user_id') },

  { table: 'recipes', file: 'recipes.json', key: 'recipes', order: ID, household: H, member: self('created_by') },
  { table: 'recipe_versions', file: 'recipes.json', key: 'versions', order: ID, household: H, member: child('recipe_id', 'recipes') },
  { table: 'recipe_steps', file: 'recipes.json', key: 'steps', order: ID, household: H, member: child('recipe_id', 'recipes') },
  { table: 'recipe_ingredients', file: 'recipes.json', key: 'ingredients', order: ID, household: H, member: child('recipe_id', 'recipes') },
  { table: 'recipe_images', file: 'recipes.json', key: 'images', order: ID, household: H, member: child('recipe_id', 'recipes') },
  { table: 'recipe_tag_links', file: 'recipes.json', key: 'tag_links', order: ['recipe_id', 'tag_id'], household: H, member: child('recipe_id', 'recipes') },
  { table: 'recipe_tags', file: 'recipes.json', key: 'tags', order: ID, household: H, member: child('id', 'recipe_tag_links', 'tag_id') },
  { table: 'recipe_favourites', file: 'recipes.json', key: 'favourites', order: ['recipe_id'], household: self('user_id'), member: self('user_id') },
  { table: 'recipe_ratings', file: 'recipes.json', key: 'ratings', order: ['recipe_id', 'user_id'], household: H, member: self('user_id') },
  { table: 'recipe_cooked', file: 'recipes.json', key: 'cooked', order: ID, household: H, member: self('user_id') },
  { table: 'recipe_cook_notes', file: 'recipes.json', key: 'cook_notes', order: ['cooked_id'], household: H, member: self('user_id') },
  { table: 'recipe_dont_suggest', file: 'recipes.json', key: 'dont_suggest', order: ['recipe_id', 'user_id'], household: H, member: self('user_id') },
  { table: 'nutrition_profiles', file: 'recipes.json', key: 'nutrition_profiles', order: ID, household: H, member: child('recipe_id', 'recipes') },
  { table: 'nutrition_profile_values', file: 'recipes.json', key: 'nutrition_values', order: ID, household: H, member: child('nutrition_profile_id', 'nutrition_profiles') },

  { table: 'meal_plans', file: 'meal_plans.json', key: 'meal_plans', order: ID, household: H, member: self('created_by') },
  { table: 'planned_meals', file: 'meal_plans.json', key: 'planned_meals', order: ID, household: H, member: child('meal_plan_id', 'meal_plans') },

  { table: 'shopping_lists', file: 'shopping_lists.json', key: 'lists', order: ID, household: H, member: self('created_by') },
  { table: 'shopping_list_items', file: 'shopping_lists.json', key: 'items', order: ID, household: H, member: child('shopping_list_id', 'shopping_lists') },
  { table: 'shopping_list_item_sources', file: 'shopping_lists.json', key: 'item_sources', order: ID, household: H, member: child('shopping_list_item_id', 'shopping_list_items') },

  { table: 'purchase_events', file: 'purchases.json', key: 'purchase_events', order: ID, household: H, member: self('created_by') },
  { table: 'receipts', file: 'purchases.json', key: 'receipts', order: ID, household: H, member: self('created_by') },
  { table: 'receipt_lines', file: 'purchases.json', key: 'receipt_lines', order: ID, household: H, member: child('receipt_id', 'receipts') },

  { table: 'pantry_items', file: 'pantry.json', key: 'pantry_items', order: ID, household: H, member: self('created_by') },
  { table: 'pantry_settings', file: 'pantry.json', key: 'pantry_settings', order: ['household_id'], household: H, member: null },

  { table: 'ingredient_prices', file: 'prices.json', key: 'ingredient_prices', order: ID, household: H, member: self('created_by') },
  { table: 'product_packs', file: 'prices.json', key: 'product_packs', order: ID, household: H, member: self('created_by') },
  // RPC-only table (X2, D187): a shared product cache of the household, not personal data -> household scope only.
  { table: 'household_product_snapshots', file: 'prices.json', key: 'product_snapshots', order: ['barcode'], household: H, member: null, rpc: 'household_product_snapshots' },

  // AS1 / P2-A (D290, D392): the household's stores, their aisles and placements, and the location a member SAVED for a store
  // (a point + radius). A live position is never stored, so there is nothing of that kind to export.
  { table: 'stores', file: 'stores.json', key: 'stores', order: ID, household: H, member: self('created_by') },
  { table: 'store_aisles', file: 'stores.json', key: 'aisles', order: ID, household: H, member: child('store_id', 'stores') },
  { table: 'store_placements', file: 'stores.json', key: 'placements', order: ID, household: H, member: child('store_id', 'stores') },
  { table: 'store_locations', file: 'stores.json', key: 'locations', order: ['store_id'], household: H, member: child('store_id', 'stores') },

  { table: 'ai_usage', file: 'ai_usage.json', key: 'ai_usage', order: ID, household: H, member: self('user_id') },

  // P1-C (D380): a member's own notification choices and their notification centre. RLS only shows each member their own
  // rows, so the household scope is "the requester's own" too. Push device tokens are NOT exported (EXCLUDED_TABLES).
  { table: 'notification_settings', file: 'notifications.json', key: 'settings', order: ['household_id', 'user_id'], household: self('user_id'), member: self('user_id') },
  { table: 'notification_preferences', file: 'notifications.json', key: 'preferences', order: ['type'], household: self('user_id'), member: self('user_id') },
  { table: 'notifications', file: 'notifications.json', key: 'notifications', order: ID, household: self('user_id'), member: self('user_id') },
];

export const EXCLUDED_TABLES: readonly string[] = [
  'household_ai_settings',
  'invitations',
  'shopping_command_log',
  'shopping_list_log_heads',
  'pantry_handled_events',
  'storage_cleanup_queue',
  'deletion_ledger',
  'data_export_requests',
  // P1-C: push endpoints are credentials for a device, delivery attempts and the job cursor are internal.
  'notification_devices',
  'notification_delivery_attempts',
  'notification_job_state',
];

/** Derived/search columns that carry no information of their own. */
export const DROPPED_COLUMNS: ReadonlySet<string> = new Set(['search_tsv', 'search_ingredients', 'search_tags']);

/** Belt and braces: any column whose name looks like a credential is never exported, whatever table it is in. */
export const SECRET_COLUMN_RE = /(token|secret|cipher|password|passwd|api_?key|private_?key|^keys$|^config$)/i;

/** Columns holding a user id: replaced by "you" / "another member" so other members' account ids never leave. */
export function isUserRefColumn(col: string): boolean {
  return col === 'user_id' || col.endsWith('_by');
}

export const SCHEMA_VERSION = 1;
