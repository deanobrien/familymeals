import Link from 'next/link';
import { ErrorState } from '@fr/ui';
import { getAppContext } from '../../lib/server/context';
import { webKidsCaller } from '../../lib/server/kids/callers';
import { loadKids, roundSeeds } from '../../lib/server/kids/service';
import { loadPlanServices } from '../../lib/server/plan/services';
import { KidsManager } from './kids-manager';
import s from '../pantry/pantry.module.css';

export const metadata = { title: "Kids' mode" };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const [caller, app] = await Promise.all([webKidsCaller(), getAppContext()]);
  const r = await loadKids(caller);
  if (!r.ok) return <ErrorState title="Could not load kids' mode" description={r.message} />;
  const svc = await loadPlanServices(caller.householdId);
  const seeds = await roundSeeds(caller, svc.plans);
  return (
    <div className={s.page}>
      <p><Link href="/plan">Back to the planner</Link></p>
      <h1>Kids&apos; mode: help pick dinner</h1>
      <p className={s.lead}>
        Open a vote with 3 to 6 meals. Everyone taps a thumbs up or a heart, and the kids can do it on this phone or tablet with big pictures and no typing. When you close
        the vote, the liked meals get a nudge in the planner. It is only ever a nudge: allergies, budget and variety still win.
      </p>
      <KidsManager
        kids={r.kids.kids}
        rounds={r.kids.rounds}
        planned={seeds.planned}
        recipes={seeds.recipes.map((x) => ({ id: x.recipeId, title: x.title }))}
        householdId={app.householdId}
        userId={app.userId}
        readOnly={caller.readOnly}
      />
    </div>
  );
}
