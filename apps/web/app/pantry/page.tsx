import Link from 'next/link';
import { getCurrentHouseholdId, getPantryService } from '../../lib/server/pantry/deps';
import { autoRestockAfterPantryChange, getRestockService } from '../../lib/server/restock/deps';
import { getAppContext } from '../../lib/server/context';
import { AddItem } from './add-item';
import { MinimumsPanel, RunningLowPanel } from './restock';
import { LeftoversPanel, PendingPurchases, UseWhatIHave } from './insights';
import { ExpiringPanel, SettingsPanel, StalePrompts, StockList } from './stock';
import s from './pantry.module.css';

export const metadata = { title: 'Pantry' };
export const dynamic = 'force-dynamic';

export default async function PantryPage() {
  const hh = await getCurrentHouseholdId();
  const view = await getPantryService(hh).getView(hh);
  const ctx = await getAppContext();
  if (!ctx.readOnly) await autoRestockAfterPantryChange(hh, ctx.userId); // auto-add mode: catch up after purchase-driven stock changes
  const restock = await getRestockService(hh).getView(hh);
  return (
    <div className={s.page}>
      <header className={s.section}>
        <h1>Pantry</h1>
        <p className={s.lead}>What you have in, what needs using up, and what you could cook with it.</p>
        <div>
          <Link className="fr-btn fr-btn--secondary fr-btn--md" href="/pantry/scan">Scan groceries</Link>
        </div>
      </header>
      <RunningLowPanel view={restock} />
      <StalePrompts items={view.staleItems} />
      <PendingPurchases pending={view.pending} mode={view.settings.purchaseMode} />
      <ExpiringPanel items={view.expiring} />
      <UseWhatIHave suggestions={view.suggestions} />
      <AddItem />
      <StockList view={view} pars={restock.pars} />
      <LeftoversPanel leftovers={view.leftovers} />
      <MinimumsPanel view={restock} />
      <SettingsPanel settings={view.settings} />
    </div>
  );
}
