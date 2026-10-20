import { getAppContext } from '../../../lib/server/context';
import { getIngredientCatalogue } from '../../../lib/server/refdata/catalogue';
import { getStoreBook } from '../../../lib/server/stores/store';
import { StoresManager } from './stores-manager';

export const metadata = { title: 'Stores and aisles' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = await getAppContext();
  const book = await getStoreBook().book(ctx.householdId);
  const cat = getIngredientCatalogue();
  const names: Record<string, string> = {};
  for (const p of book.placements) {
    if (p.targetType === 'ingredient' && !(p.targetKey in names)) names[p.targetKey] = cat.get(p.targetKey)?.name ?? 'Unknown ingredient';
  }
  return <StoresManager initial={book} ingredientNames={names} readOnly={ctx.readOnly} />;
}
