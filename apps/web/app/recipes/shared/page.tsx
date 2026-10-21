import Link from 'next/link';
import { ErrorState } from '@fr/ui';
import { webShareCaller } from '../../../lib/server/sharing/callers';
import { listShares } from '../../../lib/server/sharing/service';
import { SharedManager } from './shared-manager';
import s from '../../pantry/pantry.module.css';

export const metadata = { title: 'Shared recipes' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const caller = await webShareCaller();
  const r = await listShares(caller);
  if (!r.ok) return <ErrorState title="Could not load your links" description={r.message} />;
  return (
    <div className={s.page}>
      <p><Link href="/recipes">Back to recipes</Link></p>
      <h1>Shared recipes</h1>
      <p className={s.lead}>
        Give a recipe, or a whole collection, to another household with a link. They read it and save their own copy. Your notes, ratings and cooking history are never shared,
        and a link can be switched off at any time. To share one recipe, open it and use &quot;Share this recipe&quot;.
      </p>
      <SharedManager shares={r.shares} />
    </div>
  );
}
