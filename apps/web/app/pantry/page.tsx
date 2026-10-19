import Link from 'next/link';
import { getCurrentHouseholdId, getPantryService } from '../../lib/server/pantry/deps';
import { AddItem } from './add-item';
import { LeftoversPanel, PendingPurchases, UseWhatIHave } from './insights';
import { ExpiringPanel, SettingsPanel, StalePrompts, StockList } from './stock';
import s from './pantry.module.css';

export const metadata = { title: 'Pantry' };
export const dynamic = 'force-dynamic';

export default async function PantryPage() {
  const view = await getPantryService().getView(getCurrentHouseholdId());
  return (
    <div className={s.page}>
      <header className={s.section}>
        <h1>Pantry</h1>
        <p className={s.lead}>What you have in, what needs using up, and what you could cook with it.</p>
        <div>
          <Link className="fr-btn fr-btn--secondary fr-btn--md" href="/pantry/scan">Scan groceries</Link>
        </div>
      </header>
      <StalePrompts items={view.staleItems} />
      <PendingPurchases pending={view.pending} mode={view.settings.purchaseMode} />
      <ExpiringPanel items={view.expiring} />
      <UseWhatIHave suggestions={view.suggestions} />
      <AddItem />
      <StockList view={view} />
      <LeftoversPanel leftovers={view.leftovers} />
      <SettingsPanel settings={view.settings} />
    </div>
  );
}
