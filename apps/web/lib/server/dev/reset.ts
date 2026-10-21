import 'server-only';
import { effectiveNodeEnv } from '../../e2e-mode';
import { resetRecipeRepository } from '../../recipes/factory';
import { resetPantryServices } from '../pantry/deps';
import { resetPlanServices } from '../plan/services';
import { resetRecipeCalculators } from '../calc';
import { getPriceStore } from '../prices/store';
import { getProductSnapshotStore } from '../products/store';
import { resetMemoryServices } from '../receipts/memory';
import { getShoppingRepository } from '../shopping/repository';
import { getMemoryStoreBook } from '../stores/repository';
import { resetMemoryExportAudit } from '../export/audit';
import { resetMemorySettings } from '../settings/memory-store';
import { resetMemoryCooking } from '../cooking/memory-store';
import { resetMemoryCalendar } from '../calendar/store';
import { resetMemoryLeftovers } from '../leftovers/store';
import { resetMemoryNotifications } from '../notifications/store';
import { resetMoneyRepository } from '../money/store';

/**
 * Dev/e2e-only reset of every in-memory store (DECISIONS D36). Never available in production: the route
 * handlers call devToolsAllowed() first and answer 404 otherwise.
 */
export function devToolsAllowed(env: Parameters<typeof effectiveNodeEnv>[0] = process.env): boolean {
  return effectiveNodeEnv(env) !== 'production';
}

export function resetInMemoryStores(): string[] {
  getShoppingRepository().reset();
  getMemoryStoreBook().reset();
  resetMemorySettings();
  resetMemoryCooking();
  resetMemoryCalendar();
  resetMemoryLeftovers();
  resetPlanServices();
  resetPantryServices();
  resetMemoryServices();
  getPriceStore().reset();
  resetRecipeCalculators();
  getProductSnapshotStore().reset();
  resetRecipeRepository();
  resetMemoryExportAudit();
  resetMemoryNotifications();
  resetMoneyRepository();
  return ['shopping', 'stores', 'plans', 'pantry', 'receipts', 'prices', 'products', 'recipes', 'exports', 'notifications', 'money'];
}
