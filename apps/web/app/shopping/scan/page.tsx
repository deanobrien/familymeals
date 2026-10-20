import { describeActiveProvider } from '../../../lib/server/ai/provider';
import { getAppContext } from '../../../lib/server/context';
import { getShoppingStore } from '../../../lib/server/shopping/store';
import { defaultEngineContext, deriveAll } from '../../../lib/shopping/engine';
import { ScanFlow } from './scan-flow';
import s from './scan.module.css';

export const metadata = { title: 'Scan a handwritten list' };
export const dynamic = 'force-dynamic';

export default async function ScanListPage() {
  const info = await describeActiveProvider();
  const ctx = await getAppContext();
  const snap = await getShoppingStore().snapshot(ctx.householdId);
  const itemCount = deriveAll(snap.state, defaultEngineContext).filter((v) => !v.item.removed && !v.noLongerNeeded).length;
  return (
    <div className={s.page}>
      <header className={s.stack}>
        <h1>Scan a handwritten list</h1>
        <p className={s.lead}>
          Photograph your paper shopping list. You check what was read, then choose to add it to your current list or start
          a new one. Nothing is added until you confirm.
        </p>
      </header>
      <ScanFlow
        provider={{ label: info.label, isMock: info.isMock, configured: info.configured }}
        current={{ name: snap.meta.listName ?? 'Shopping list', itemCount }}
      />
    </div>
  );
}
