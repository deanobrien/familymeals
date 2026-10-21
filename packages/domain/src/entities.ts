/**
 * Row schemas for every table/view in migrations/ (camelCase; nullable DB columns are `.nullable()`).
 * Flattened quantity columns (quantity_kind/value/min/max, unit, approx_label, original_text) are exposed as
 * a single `quantity: Quantity` — use fromDbRow()/toDbRow() in ./db-mapping.ts to convert.
 * Server-maintained columns (search_*, timestamps) are included so reads validate; insert DTOs pick from these.
 */
import { z } from 'zod';
import {
  AiOperation, AiStatus, AllergenGroup, ConsentType, DeletionSubject, DietCategory, ExclusionKind, HouseholdRole,
  HouseholdStatus, ImageMimeType, IngredientForm, IsoDate, IsoDateTime, MealPlanStatus, MealType, MembershipStatus,
  NutrientKey, NutrientUnit, NutritionBasis, PantrySource, Pence, PlannedMealKind, PreferredUnits, PriceKind,
  PurchaseStatus, Quantity, QuantityKind, ReceiptLineMatchStatus, ReceiptStatus, RecipeImageKind, RecipeStatus,
  ShoppingCommandType, ShoppingItemStatus, ShoppingListStatus, SignedPence, StorageBucket, Unit, Uuid, ValueStatus,
} from './primitives';

const ts = { createdAt: IsoDateTime, updatedAt: IsoDateTime };
const Currency = z.string().regex(/^[A-Z]{3}$/);
const text = (max: number) => z.string().max(max);
const nonEmpty = (max: number) => z.string().trim().min(1).max(max);

// ---------------- household & identity ----------------
export const Household = z.object({
  id: Uuid,
  name: nonEmpty(120),
  defaultServings: z.number().int().min(1).max(50),
  currency: Currency,
  locale: z.string().min(2).max(35),
  preferredUnits: PreferredUnits,
  weeklyBudgetPence: Pence.nullable(),
  pantryDeductOnPurchase: z.boolean(),
  status: HouseholdStatus,
  deletionRequestedAt: IsoDateTime.nullable(),
  purgeAfter: IsoDateTime.nullable(),
  createdBy: Uuid.nullable(),
  ...ts,
});
export type Household = z.infer<typeof Household>;

export const HouseholdMember = z.object({
  id: Uuid,
  householdId: Uuid,
  userId: Uuid,
  role: HouseholdRole,
  displayName: z.string().min(1).max(80).nullable(),
  status: MembershipStatus,
  invitationId: Uuid.nullable(),
  joinedAt: IsoDateTime,
  revokedAt: IsoDateTime.nullable(),
  ...ts,
});
export type HouseholdMember = z.infer<typeof HouseholdMember>;

/** Raw token is never stored; tokenHash = sha256 hex. */
export const Invitation = z.object({
  id: Uuid,
  householdId: Uuid,
  email: z.email().nullable(),
  role: HouseholdRole,
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  invitedBy: Uuid,
  expiresAt: IsoDateTime,
  acceptedAt: IsoDateTime.nullable(),
  acceptedBy: Uuid.nullable(),
  revokedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type Invitation = z.infer<typeof Invitation>;

export const PersonProfile = z.object({
  id: Uuid,
  householdId: Uuid,
  userId: Uuid.nullable(),
  displayName: z.string().min(1).max(80),
  dietaryPreference: DietCategory.nullable(),
  favouriteTagIds: z.array(Uuid),
  preferences: z.record(z.string(), z.unknown()),
  ...ts,
});
export type PersonProfile = z.infer<typeof PersonProfile>;

/** Hard exclusion; matchable by ingredientId, allergenGroup or free-text term (at least one). */
export const HouseholdExclusion = z
  .object({
    id: Uuid,
    householdId: Uuid,
    ingredientId: Uuid.nullable(),
    allergenGroup: AllergenGroup.nullable(),
    term: nonEmpty(120).nullable(),
    kind: ExclusionKind,
    consentRecordedAt: IsoDateTime.nullable(),
    createdBy: Uuid.nullable(),
    createdAt: IsoDateTime,
  })
  .refine((e) => e.ingredientId !== null || e.allergenGroup !== null || e.term !== null, {
    message: 'ingredientId, allergenGroup or term required',
  })
  .refine((e) => e.kind === 'avoid' || e.consentRecordedAt !== null, {
    message: 'allergy/intolerance requires recorded consent',
  });
export type HouseholdExclusion = z.infer<typeof HouseholdExclusion>;

export const ConsentRecord = z.object({
  id: Uuid,
  householdId: Uuid,
  userId: Uuid,
  consentType: ConsentType,
  wordingVersion: z.string().min(1).max(40),
  grantedAt: IsoDateTime,
  withdrawnAt: IsoDateTime.nullable(),
});
export type ConsentRecord = z.infer<typeof ConsentRecord>;

// ---------------- reference data ----------------
export const Ingredient = z.object({
  id: Uuid,
  name: nonEmpty(120),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  category: z.string().min(1).max(60),
  form: IngredientForm.nullable(),
  ...ts,
});
export type Ingredient = z.infer<typeof Ingredient>;

export const IngredientAlias = z.object({
  id: Uuid, ingredientId: Uuid, alias: nonEmpty(120), locale: z.string(), createdAt: IsoDateTime,
});
export type IngredientAlias = z.infer<typeof IngredientAlias>;

export const IngredientDensity = z.object({
  id: Uuid, ingredientId: Uuid, gPerMl: z.number().positive().lt(25), source: nonEmpty(200), createdAt: IsoDateTime,
});
export type IngredientDensity = z.infer<typeof IngredientDensity>;

export const IngredientUnitWeight = z.object({
  id: Uuid, ingredientId: Uuid, unit: Unit, grams: z.number().positive(), source: nonEmpty(200),
  estimate: z.literal(true), createdAt: IsoDateTime,
});
export type IngredientUnitWeight = z.infer<typeof IngredientUnitWeight>;

export const IngredientNutrient = z
  .object({
    id: Uuid,
    ingredientId: Uuid,
    nutrient: NutrientKey,
    valueStatus: ValueStatus,
    valuePer100g: z.number().nonnegative().nullable(),
    unit: NutrientUnit,
    source: nonEmpty(60),
    sourceVersion: z.string().nullable(),
    sourceRef: z.string().nullable(),
    estimate: z.boolean(),
    createdAt: IsoDateTime,
  })
  .refine(
    (n) =>
      n.valueStatus === 'known' ? n.valuePer100g !== null
        : n.valueStatus === 'zero' ? n.valuePer100g === 0
          : n.valuePer100g === null,
    { message: 'valuePer100g inconsistent with valueStatus' },
  );
export type IngredientNutrient = z.infer<typeof IngredientNutrient>;

export const IngredientAllergen = z.object({
  ingredientId: Uuid, allergenGroup: AllergenGroup, source: nonEmpty(200), createdAt: IsoDateTime,
});
export type IngredientAllergen = z.infer<typeof IngredientAllergen>;

/** product_packs row (householdId null = shared reference pack). Contract shape: ProductPack. */
export const ProductPackRow = z.object({
  id: Uuid,
  householdId: Uuid.nullable(),
  ingredientId: Uuid,
  name: nonEmpty(200),
  retailer: z.string().min(1).max(80).nullable(),
  quantity: Quantity,
  createdBy: Uuid.nullable(),
  ...ts,
});
export type ProductPackRow = z.infer<typeof ProductPackRow>;

/** ingredient_prices row. Contract shape: PriceObservation. */
export const IngredientPriceRow = z
  .object({
    id: Uuid,
    householdId: Uuid.nullable(),
    ingredientId: Uuid.nullable(),
    productPackId: Uuid.nullable(),
    retailer: z.string().min(1).max(80).nullable(),
    pricePence: Pence,
    currency: Currency,
    quantity: Quantity,
    kind: PriceKind,
    observedOn: IsoDate,
    source: nonEmpty(200),
    receiptLineId: Uuid.nullable(),
    createdBy: Uuid.nullable(),
    createdAt: IsoDateTime,
  })
  .refine((p) => p.ingredientId !== null || p.productPackId !== null, { message: 'ingredientId or productPackId required' })
  .refine((p) => (p.householdId === null) === (p.kind === 'generic_estimate' || p.kind === 'retailer_verified'), {
    message: 'reference rows are generic_estimate/retailer_verified; household rows are user_confirmed/receipt',
  });
export type IngredientPriceRow = z.infer<typeof IngredientPriceRow>;

// ---------------- recipes ----------------
export const Recipe = z.object({
  id: Uuid,
  householdId: Uuid,
  title: nonEmpty(200),
  description: text(4000).nullable(),
  coverImagePath: z.string().nullable(),
  sourceUrl: z.url({ protocol: /^https?$/ }).nullable(),
  sourceAttribution: text(300).nullable(),
  prepMinutes: z.number().int().min(0).max(10080).nullable(),
  cookMinutes: z.number().int().min(0).max(10080).nullable(),
  defaultServings: z.number().int().min(1).max(100),
  cuisine: text(60).nullable(),
  mealType: MealType.nullable(),
  dietCategory: DietCategory.nullable(),
  status: RecipeStatus,
  createdBy: Uuid.nullable(),
  ...ts,
});
export type Recipe = z.infer<typeof Recipe>;

/** jsonb original (raw AI extraction, null for manual entry) and corrected (user-confirmed) content. */
export const RecipeVersion = z.object({
  id: Uuid,
  recipeId: Uuid,
  householdId: Uuid,
  versionNo: z.number().int().min(1),
  original: z.record(z.string(), z.unknown()).nullable(),
  corrected: z.record(z.string(), z.unknown()),
  sourceImagePaths: z.array(z.string()),
  extractionModel: z.string().nullable(),
  extractedAt: IsoDateTime.nullable(),
  createdBy: Uuid.nullable(),
  createdAt: IsoDateTime,
});
export type RecipeVersion = z.infer<typeof RecipeVersion>;

export const RecipeImage = z.object({
  id: Uuid,
  recipeId: Uuid,
  householdId: Uuid,
  storagePath: z.string().min(1),
  kind: RecipeImageKind,
  pageOrder: z.number().int().min(1).max(50),
  mimeType: ImageMimeType,
  bytes: z.number().int().min(1).max(20_971_520).nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  createdAt: IsoDateTime,
});
export type RecipeImage = z.infer<typeof RecipeImage>;

/** recipe_ingredients row. Contract shape: RecipeIngredientLine (order = position). */
export const RecipeIngredientRow = z.object({
  id: Uuid,
  recipeId: Uuid,
  householdId: Uuid,
  ingredientId: Uuid.nullable(),
  quantity: Quantity,
  preparation: text(200).nullable(),
  groupLabel: text(80).nullable(),
  optional: z.boolean(),
  position: z.number().int().nonnegative(),
  ...ts,
});
export type RecipeIngredientRow = z.infer<typeof RecipeIngredientRow>;

export const RecipeStep = z.object({
  id: Uuid,
  recipeId: Uuid,
  householdId: Uuid,
  stepNumber: z.number().int().min(1),
  instructions: nonEmpty(4000),
  durationMinutes: z.number().int().min(0).max(10080).nullable(),
  ...ts,
});
export type RecipeStep = z.infer<typeof RecipeStep>;

export const RecipeTag = z.object({ id: Uuid, householdId: Uuid, name: nonEmpty(60), createdAt: IsoDateTime });
export type RecipeTag = z.infer<typeof RecipeTag>;
export const RecipeTagLink = z.object({ recipeId: Uuid, tagId: Uuid, householdId: Uuid, createdAt: IsoDateTime });
export type RecipeTagLink = z.infer<typeof RecipeTagLink>;
export const RecipeFavourite = z.object({ recipeId: Uuid, userId: Uuid, householdId: Uuid, createdAt: IsoDateTime });
export type RecipeFavourite = z.infer<typeof RecipeFavourite>;
export const RecipeRating = z.object({
  recipeId: Uuid, userId: Uuid, householdId: Uuid, rating: z.number().int().min(1).max(5), notes: text(1000).nullable(), ...ts,
});
export type RecipeRating = z.infer<typeof RecipeRating>;

// ---------------- nutrition ----------------
export const NutritionProfile = z.object({
  id: Uuid,
  householdId: Uuid,
  recipeId: Uuid,
  basis: NutritionBasis,
  servings: z.number().int().min(1).max(100),
  calculationMethod: nonEmpty(80),
  engineVersion: z.string().nullable(),
  coverageRatio: z.number().min(0).max(1).nullable(),
  confidence: z.enum(['high', 'medium', 'low']).nullable(),
  calculatedAt: IsoDateTime,
});
export type NutritionProfile = z.infer<typeof NutritionProfile>;

export const NutritionProfileValue = z.object({
  id: Uuid,
  nutritionProfileId: Uuid,
  householdId: Uuid,
  nutrient: NutrientKey,
  valueStatus: ValueStatus,
  value: z.number().nonnegative().nullable(),
  unit: NutrientUnit,
  source: z.string().nullable(),
  estimate: z.boolean(),
});
export type NutritionProfileValue = z.infer<typeof NutritionProfileValue>;

// ---------------- meal planning ----------------
export const MealPlan = z
  .object({
    id: Uuid,
    householdId: Uuid,
    startDate: IsoDate,
    endDate: IsoDate,
    budgetTargetPence: Pence.nullable(),
    planningPrompt: text(4000).nullable(),
    constraints: z.record(z.string(), z.unknown()).nullable(),
    status: MealPlanStatus,
    approvedAt: IsoDateTime.nullable(),
    approvedBy: Uuid.nullable(),
    createdBy: Uuid.nullable(),
    ...ts,
  })
  .refine((p) => p.endDate >= p.startDate, { message: 'endDate before startDate' })
  .refine((p) => p.status !== 'approved' || p.approvedAt !== null, { message: 'approved plan needs approvedAt' });
export type MealPlan = z.infer<typeof MealPlan>;

export const PlannedMeal = z
  .object({
    id: Uuid,
    mealPlanId: Uuid,
    householdId: Uuid,
    mealDate: IsoDate,
    mealType: MealType,
    kind: PlannedMealKind,
    recipeId: Uuid.nullable(),
    /** P2-C: a kind 'leftovers' slot may point at a leftover batch (servings = portions). */
    leftoverBatchId: Uuid.nullable().optional(),
    servings: z.number().int().min(1).max(100),
    approved: z.boolean(),
    notes: text(1000).nullable(),
    position: z.number().int(),
    ...ts,
  })
  .refine((m) => m.kind === 'leftovers' || (m.kind === 'recipe') === (m.recipeId !== null), {
    message: "recipeId required for kind 'recipe' and forbidden for eating_out/other",
  });
export type PlannedMeal = z.infer<typeof PlannedMeal>;

// ---------------- shopping ----------------
export const ShoppingList = z.object({
  id: Uuid, householdId: Uuid, name: nonEmpty(120), mealPlanId: Uuid.nullable(), status: ShoppingListStatus,
  createdBy: Uuid.nullable(), ...ts,
});
export type ShoppingList = z.infer<typeof ShoppingList>;

/** Required quantity only — purchased/outstanding are derived (ShoppingListItemProgress). */
export const ShoppingListItem = z.object({
  id: Uuid,
  shoppingListId: Uuid,
  householdId: Uuid,
  ingredientId: Uuid.nullable(),
  productPackId: Uuid.nullable(),
  displayName: nonEmpty(200),
  quantity: Quantity,
  unresolved: z.array(Quantity),
  category: text(60).nullable(),
  aisle: text(60).nullable(),
  notes: text(500).nullable(),
  isManual: z.boolean(),
  status: ShoppingItemStatus,
  estimatedPricePence: Pence.nullable(),
  estimatedPriceKind: PriceKind.nullable(),
  position: z.number().int(),
  createdBy: Uuid.nullable(),
  ...ts,
});
export type ShoppingListItem = z.infer<typeof ShoppingListItem>;

/** shopping_list_item_sources row. Contract shape: Contribution (refs nullable here: recipe edits keep history). */
export const ShoppingListItemSource = z.object({
  id: Uuid,
  shoppingListItemId: Uuid,
  householdId: Uuid,
  plannedMealId: Uuid.nullable(),
  recipeId: Uuid.nullable(),
  recipeIngredientId: Uuid.nullable(),
  recipeTitleSnapshot: z.string().nullable(),
  ingredientTextSnapshot: z.string().nullable(),
  quantity: Quantity,
  createdAt: IsoDateTime,
});
export type ShoppingListItemSource = z.infer<typeof ShoppingListItemSource>;

/**
 * purchase_events row (persistence type). Contract shape: PurchaseEvent, whose createdBy stays required for NEW
 * events. Owner decision 2026-10-19: the row's createdBy/voidedBy are nullable (ON DELETE SET NULL) so an account
 * can be deleted while purchase history survives; createdByDisplayName is a snapshot taken at insert time.
 */
export const PurchaseEventRow = z.object({
  id: Uuid,
  shoppingListItemId: Uuid,
  householdId: Uuid,
  quantity: Quantity,
  actualPricePence: Pence.nullable(),
  receiptLineId: Uuid.nullable(),
  createdBy: Uuid.nullable(),
  createdByDisplayName: z.string().min(1).max(80).nullable(),
  createdAt: IsoDateTime,
  voidedBy: Uuid.nullable(),
  voidedAt: IsoDateTime.nullable(),
});
export type PurchaseEventRow = z.infer<typeof PurchaseEventRow>;

/** View public.shopping_list_item_progress (same-unit sums only; hasUnitMismatch => ask the engine). */
export const ShoppingListItemProgress = z.object({
  shoppingListItemId: Uuid,
  shoppingListId: Uuid,
  householdId: Uuid,
  quantityKind: QuantityKind,
  unit: Unit.nullable(),
  requiredQuantity: z.number().nullable(),
  purchasedQuantity: z.number(),
  outstandingQuantity: z.number().nullable(),
  purchaseEventCount: z.number().int(),
  actualSpendPence: Pence,
  hasUnitMismatch: z.boolean().nullable(),
  purchaseStatus: PurchaseStatus,
  lastPurchasedAt: IsoDateTime.nullable(),
});
export type ShoppingListItemProgress = z.infer<typeof ShoppingListItemProgress>;

export const ShoppingCommandLogEntry = z.object({
  seq: z.number().int().positive(),
  commandId: Uuid,
  householdId: Uuid,
  shoppingListId: Uuid,
  commandType: ShoppingCommandType,
  command: z.record(z.string(), z.unknown()),
  status: z.enum(['applied', 'rejected']),
  reason: z.string().max(60).nullable(),
  result: z.record(z.string(), z.unknown()),
  createdBy: Uuid.nullable(),
  createdAt: IsoDateTime,
});
export type ShoppingCommandLogEntry = z.infer<typeof ShoppingCommandLogEntry>;

// ---------------- receipts & pantry ----------------
export const Receipt = z.object({
  id: Uuid,
  householdId: Uuid,
  imagePaths: z.array(z.string()),
  retailer: text(80).nullable(),
  purchasedOn: IsoDate.nullable(),
  totalPence: Pence.nullable(),
  currency: Currency,
  status: ReceiptStatus,
  parsedRaw: z.record(z.string(), z.unknown()).nullable(),
  reconciledAt: IsoDateTime.nullable(),
  createdBy: Uuid.nullable(),
  ...ts,
});
export type Receipt = z.infer<typeof Receipt>;

export const ReceiptLine = z
  .object({
    id: Uuid,
    receiptId: Uuid,
    householdId: Uuid,
    lineNo: z.number().int().min(1),
    description: z.string().min(1).max(300),
    quantity: Quantity,
    unitPricePence: Pence.nullable(),
    lineTotalPence: SignedPence.nullable(),
    matchStatus: ReceiptLineMatchStatus,
    matchedShoppingListItemId: Uuid.nullable(),
    matchScore: z.number().min(0).max(1).nullable(),
    addedToPantry: z.boolean(),
    ...ts,
  })
  .refine((l) => !['suggested', 'confirmed'].includes(l.matchStatus) || l.matchedShoppingListItemId !== null, {
    message: 'suggested/confirmed lines need a matched item',
  });
export type ReceiptLine = z.infer<typeof ReceiptLine>;

export const PantryItem = z.object({
  id: Uuid,
  householdId: Uuid,
  ingredientId: Uuid.nullable(),
  productPackId: Uuid.nullable(),
  displayName: nonEmpty(200),
  quantity: Quantity,
  expiresOn: IsoDate.nullable(),
  notes: text(500).nullable(),
  source: PantrySource,
  receiptLineId: Uuid.nullable(),
  createdBy: Uuid.nullable(),
  ...ts,
});
export type PantryItem = z.infer<typeof PantryItem>;

// ---------------- AI, privacy ops ----------------
/** Cost in integer millipence (1/1000 p). */
export const AiUsage = z.object({
  id: Uuid,
  householdId: Uuid,
  userId: Uuid.nullable(),
  operation: AiOperation,
  provider: z.string().min(1).max(40),
  model: z.string().min(1).max(100),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  costMillipence: z.number().int().nonnegative(),
  status: AiStatus,
  errorCode: z.string().max(80).nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  requestId: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type AiUsage = z.infer<typeof AiUsage>;

export const StorageCleanupQueueItem = z.object({
  id: Uuid,
  bucket: StorageBucket,
  objectPath: z.string().min(1).max(1024),
  householdId: Uuid.nullable(),
  reason: z.string().max(60),
  enqueuedAt: IsoDateTime,
  attempts: z.number().int().nonnegative(),
  lastError: z.string().max(1000).nullable(),
  processedAt: IsoDateTime.nullable(),
});
export type StorageCleanupQueueItem = z.infer<typeof StorageCleanupQueueItem>;

export const DeletionLedgerEntry = z.object({
  id: Uuid,
  subjectType: DeletionSubject,
  subjectId: Uuid,
  householdId: Uuid.nullable(),
  requestedBy: Uuid.nullable(),
  requestedAt: IsoDateTime,
  scheduledPurgeAt: IsoDateTime,
  cancelledAt: IsoDateTime.nullable(),
  purgedAt: IsoDateTime.nullable(),
});
export type DeletionLedgerEntry = z.infer<typeof DeletionLedgerEntry>;
