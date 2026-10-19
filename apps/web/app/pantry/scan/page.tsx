import { describeActiveProvider } from '../../../lib/server/ai/provider';
import { ScanFlow } from './scan-flow';
import s from './scan.module.css';

export const metadata = { title: 'Scan groceries' };
export const dynamic = 'force-dynamic';

export default async function ScanPage() {
  const info = await describeActiveProvider();
  return (
    <div className={s.page}>
      <header className={s.stack}>
        <h1>Scan groceries</h1>
        <p className={s.lead}>
          Photograph or film what you have bought or what is in the fridge and cupboard. You review everything before
          anything is added to your pantry.
        </p>
      </header>
      <ScanFlow provider={{ label: info.label, isMock: info.isMock, configured: info.configured }} />
    </div>
  );
}
