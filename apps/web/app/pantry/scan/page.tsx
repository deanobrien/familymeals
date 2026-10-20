import { parseSeedParam } from '@fr/engine/pantry';
import { describeActiveProvider } from '../../../lib/server/ai/provider';
import { ScanFlow } from './scan-flow';
import s from './scan.module.css';

export const metadata = { title: 'Scan groceries' };
export const dynamic = 'force-dynamic';

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ mode?: string | string[]; codes?: string | string[] }> }) {
  const info = await describeActiveProvider();
  const { mode, codes } = await searchParams;
  return (
    <div className={s.page}>
      <header className={s.stack}>
        <h1>Scan groceries</h1>
        <p className={s.lead}>
          Scan barcodes one after another, or photograph or film what you have bought or what is in the fridge and
          cupboard. You review everything before anything is added to your pantry.
        </p>
      </header>
      {/* ?mode=rapid opens the continuous barcode scanner directly (a link target for the pantry and shopping pages); ?codes= seeds the tally from the Android app (D274). */}
      <ScanFlow
        provider={{ label: info.label, isMock: info.isMock, configured: info.configured }}
        seed={parseSeedParam(Array.isArray(codes) ? codes[0] : codes)}
        startRapid={(Array.isArray(mode) ? mode[0] : mode) === 'rapid'}
      />
    </div>
  );
}
