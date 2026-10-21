import { getAppContext } from '../../../lib/server/context';
import { webKidsCaller } from '../../../lib/server/kids/callers';
import { loadKids } from '../../../lib/server/kids/service';
import { KidPlay } from './kid-play';

export const metadata = { title: 'Pick dinner', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** Kids' screen: picture-based, no typing, no links out. The shell hides navigation for this path (app/shell.tsx). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const roundId = typeof sp.round === 'string' ? sp.round : '';
  const [caller, app] = await Promise.all([webKidsCaller(), getAppContext()]);
  const r = await loadKids(caller);
  const round = r.ok ? (r.kids.rounds.find((x) => x.id === roundId) ?? null) : null;
  return <KidPlay round={round} kids={r.ok ? r.kids.kids : []} householdId={app.householdId} userId={app.userId} />;
}
