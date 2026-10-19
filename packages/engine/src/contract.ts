// PRJ-018 shared contract: the CONTRACT-SEED shapes now live in @fr/domain (L1, zod-inferred types).
// Type-only re-export keeps the engine pure (no zod schemas or runtime code from @fr/domain are pulled in).
// Internal engine modules keep importing from './contract' (or '../contract'); do not fork these shapes here.
export type {
  Uuid,
  IsoDate,
  IsoDateTime,
  MassUnit,
  VolumeUnit,
  CountUnit,
  Unit,
  Dimension,
  QuantityKind,
  Quantity,
  CanonicalIngredient,
  RecipeIngredientLine,
  Contribution,
  Requirement,
  ValueStatus,
  NutrientValue,
  NutrientKey,
  PriceKind,
  PriceObservation,
  ProductPack,
  MealType,
  DietCategory,
  Pence,
  PurchaseEvent,
} from '@fr/domain';
