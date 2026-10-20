import Link from 'next/link';
import { getCurrentHouseholdId, getPantryService } from '../../lib/server/pantry/deps';
import { AddItem } from './add-item';
import { LeftoversPanel, PendingPurchases, UseWhatIHave } from './insights';
import { ExpiringPanel, SettingsPanel, StalePrompts, StockList } from './stock';
import s from './pantry.module.css';

export const metadata = { title: 'Pantry' };
export const dynamic = 'force-dynamic';

export default async function PantryPage() {
  const hh = await getCurrentHouseholdId();
  const view = await getPantryService(hh).getView(hh);
  return (
    <div className={`${s.page} fr-has-fab`}>
      <header className={s.section}>
        <h1>Pantry</h1>
        <p className={s.lead}>What you have in, what needs using up, and what you could cook with it.</p>
        <div>
          <Link className="fr-btn fr-btn--primary fr-btn--md" href="/pantry/scan" data-testid="scan-groceries">
            <span aria-hidden="true">📷</span> Scan groceries (photo, video or barcode)
          </Link>
        </div>
      </header>
      {view.totalItems === 0 && (
        <section className="fr-cta" aria-labelledby="pantry-cta-h" data-testid="pantry-empty-cta">
          <h2 id="pantry-cta-h">Snap your shopping to fill your pantry</h2>
          <p>Photograph your receipt or groceries, film the shelf, or scan a barcode and we will add everything for you.</p>
          <div className="fr-cta__actions">
            <Link className="fr-btn fr-btn--primary fr-btn--lg" href="/pantry/scan" data-testid="empty-scan-groceries">
              <span aria-hidden="true">📷</span> Scan groceries
            </Link>
          </div>
        </section>
      )}
      <StalePrompts items={view.staleItems} />
      <PendingPurchases pending={view.pending} mode={view.settings.purchaseMode} />
      <ExpiringPanel items={view.expiring} />
      <UseWhatIHave suggestions={view.suggestions} />
      <AddItem />
      <StockList view={view} />
      <LeftoversPanel leftovers={view.leftovers} />
      <SettingsPanel settings={view.settings} />
      <Link className="fr-btn fr-btn--primary fr-fab" href="/pantry/scan" data-testid="scan-groceries-fab">
        <span aria-hidden="true">📷</span> Scan groceries
      </Link>
    </div>
  );
}
