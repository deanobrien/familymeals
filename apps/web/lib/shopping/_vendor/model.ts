// TODO(merge batch 2): TEMPORARY VENDORED COPY of L17a (C:\TFS\FamilyRecipes-lanes\L17a-shopping-state\src).
// Replace with @fr/engine/shopping after merge batch 2 (one-line import change in ../engine.ts). Do not edit.
import type { IsoDateTime, PurchaseEvent, Quantity, Requirement, Uuid } from './contract';

export interface ShoppingItem {
  id: Uuid;
  /** Merge key used by regenerate: `ing:<ingredientId>` or `name:<normalised displayName>`. */
  key: string;
  displayName: string;
  ingredientId?: Uuid;
  category: string;
  aisle?: string;
  notes?: string;
  /** Plan-derived requirement; undefined when not (or no longer) in the plan. */
  requirement?: Requirement;
  /** User-added quantity on top of (or instead of) the requirement. */
  manualQuantity?: Quantity;
  /** True once the plan has created/claimed this item; regenerate matches on these first. */
  planLinked: boolean;
  /** Soft removal. Items are never deleted (purchase history must survive). */
  removed?: { by: Uuid; at: IsoDateTime; reason: 'user' | 'plan' };
  createdBy: Uuid;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Append-only undo record. Undo never deletes a PurchaseEvent; it sets voidedBy via this record. */
export interface VoidRecord { id: Uuid; eventId: Uuid; by: Uuid; at: IsoDateTime }

interface CommandBase { commandId: Uuid; actor: Uuid; at: IsoDateTime }

/** Buy the full outstanding quantity. commandId becomes the PurchaseEvent id. */
export interface TickCommand extends CommandBase { type: 'tick'; itemId: Uuid }
/** Record an explicit purchased quantity (partial, or over-purchase e.g. from a receipt). commandId = event id. */
export interface PurchaseCommand extends CommandBase {
  type: 'purchase'; itemId: Uuid; quantity: Quantity; actualPricePence?: number; receiptLineId?: Uuid;
}
/** Void a purchase event. commandId = void record id. */
export interface UndoCommand extends CommandBase { type: 'undo'; eventId: Uuid }
export interface AddItemCommand extends CommandBase {
  type: 'add_item'; itemId: Uuid; displayName: string; ingredientId?: Uuid;
  quantity?: Quantity; category: string; aisle?: string; notes?: string;
}
export interface EditItemCommand extends CommandBase {
  type: 'edit_item'; itemId: Uuid;
  patch: {
    displayName?: string; category?: string;
    aisle?: string | null; notes?: string | null; manualQuantity?: Quantity | null;
  };
}
export interface RemoveItemCommand extends CommandBase { type: 'remove_item'; itemId: Uuid }
export interface RegenerateLine { itemId: Uuid; requirement: Requirement; category: string; aisle?: string }
/** Replace plan requirements. `itemId` on a line is used only if no existing item matches the key. */
export interface RegenerateCommand extends CommandBase { type: 'regenerate'; lines: RegenerateLine[] }

export type Command =
  | TickCommand | PurchaseCommand | UndoCommand
  | AddItemCommand | EditItemCommand | RemoveItemCommand | RegenerateCommand;

export type RejectReason =
  | 'already_complete'   // tick on an item with nothing outstanding (e.g. concurrent tick won)
  | 'already_voided'
  | 'item_not_found'
  | 'item_removed'
  | 'event_not_found'
  | 'invalid_quantity'
  | 'incompatible_unit'
  | 'id_collision';

export interface CommandResult {
  commandId: Uuid;
  type: Command['type'];
  status: 'applied' | 'rejected';
  reason?: RejectReason;
  itemId?: Uuid;
  eventId?: Uuid;
  /** For already_complete: who holds the active purchases, so the UI can say "Sam already got this". */
  completedBy?: Uuid[];
}

export interface ApplyOutcome {
  state: ShoppingState;
  /** 'duplicate' = commandId already seen; state is returned unchanged. */
  result: CommandResult & { duplicate?: boolean };
}

export interface ShoppingState {
  items: Record<Uuid, ShoppingItem>;
  itemOrder: Uuid[];
  events: Record<Uuid, PurchaseEvent>;
  eventOrder: Uuid[];
  voids: Record<Uuid, VoidRecord>;
  /** Outcome of every command ever seen (applied or rejected): the idempotency table. */
  outcomes: Record<Uuid, CommandResult>;
}

export const emptyState = (): ShoppingState => ({
  items: {}, itemOrder: [], events: {}, eventOrder: [], voids: {}, outcomes: {},
});

export function itemKey(ingredientId: Uuid | undefined, displayName: string): string {
  return ingredientId ? `ing:${ingredientId}` : `name:${displayName.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}
