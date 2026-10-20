// Input validation for the store/aisle/placement server actions (shared by the actions and the repositories' tests).
// Client input is never trusted: ids must be uuids, text is trimmed and length-limited (matching the SQL checks).
import { z } from 'zod';

export const StoreFields = z.object({
  name: z.string().trim().min(1, 'Give the store a name.').max(80),
  chain: z.string().trim().max(60).nullish().transform((v) => (v ? v : null)),
  notes: z.string().trim().max(500).nullish().transform((v) => (v ? v : null)),
});
export type StoreFieldsInput = z.input<typeof StoreFields>;

export const StorePatch = z.object({
  name: z.string().trim().min(1, 'Give the store a name.').max(80).optional(),
  chain: z.string().trim().max(60).nullish().transform((v) => (v ? v : null)).optional(),
  notes: z.string().trim().max(500).nullish().transform((v) => (v ? v : null)).optional(),
});

export const AisleLabel = z.string().trim().min(1, 'Give the aisle a name.').max(60);
export const Id = z.string().uuid();
export const PlacementTarget = z.object({
  targetType: z.enum(['ingredient', 'item', 'category']),
  targetKey: z.string().trim().min(1).max(120),
});
export const TemplateId = z.enum(['generic', 'discounter', 'frozen_first']);

/** Sort order gap between aisles: leaves room to insert without renumbering. */
export const AISLE_STEP = 10;
