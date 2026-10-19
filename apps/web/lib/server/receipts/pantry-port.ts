import { UNIT_OPTIONS } from '../../pantry/types';
import type { Quantity } from '../../receipts/matcher';
import type { PantryService } from '../pantry/service';
import type { PantryEntry } from './ports';

/** Receipt quantity -> a pantry quantity. Anything not a plain amount in a pantry unit counts as one `item` (never invented). */
export function toPantryAmount(q: Quantity): { value: number; unit: string } {
  const unit = q.unit as string | undefined;
  if (q.kind === 'exact' && typeof q.value === 'number' && q.value > 0 && unit && (UNIT_OPTIONS as readonly string[]).includes(unit)) {
    return { value: q.value, unit };
  }
  return { value: 1, unit: 'item' };
}

/**
 * Receipt "add to pantry" lines go to the household's real pantry service (D103), so they show up on /pantry and in
 * pantry-aware planning, instead of sitting in the receipts in-memory ledger.
 */
export class PantryServiceReceiptPort {
  constructor(
    private readonly householdId: string,
    private readonly pantry: Pick<PantryService, 'addPurchased'>,
  ) {}

  async addToPantry(entries: PantryEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.pantry.addPurchased(
      this.householdId,
      entries.map((e) => ({ name: e.name, ...toPantryAmount(e.quantity) })),
    );
  }
}
