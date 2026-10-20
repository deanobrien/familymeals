import { loadAiSettingsAction } from './ai-actions';
import { recipeSourceStatus } from '../../lib/server/discover/source';
import { requireHouseholdContext } from '../../lib/server/auth/household-context';
import { loadLifecycle } from '../../lib/server/privacy/lifecycle';
import { getWithheldExclusionCount } from '../../lib/server/plan/withheld';
import { ConsentNotice } from '../consent-notice';
import { SettingsView } from './settings-view';
import type { DataSettingsView } from './data-view';

export const metadata = { title: 'Settings' };
// AI provider settings come from a server-side file, so never prerender this page.
export const dynamic = 'force-dynamic';

async function loadDataView(notice: string | null): Promise<DataSettingsView> {
  const ctx = await requireHouseholdContext();
  const base = {
    mode: ctx.mode,
    isOwner: ctx.isOwner,
    householdName: ctx.household.name,
    readOnly: ctx.readOnly,
    notice,
  };
  if (ctx.mode !== 'supabase') {
    return { ...base, purgeAfter: null, accountDeletionAt: null, soleMember: true, soleOwnerWithOthers: false };
  }
  const l = await loadLifecycle(ctx.supabase, ctx.household.id, ctx.user.id);
  return {
    ...base,
    purgeAfter: l.purgeAfter,
    accountDeletionAt: l.accountDeletionAt,
    soleMember: l.activeMembers <= 1,
    soleOwnerWithOthers: ctx.isOwner && l.otherOwners === 0 && l.activeMembers > 1,
  };
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const notice = typeof sp.notice === 'string' && /^[a-z_]{1,40}$/.test(sp.notice) ? sp.notice : null;
  const [ai, data] = await Promise.all([loadAiSettingsAction(), loadDataView(notice)]);
  const withheld = await getWithheldExclusionCount();
  return (
    <>
      <ConsentNotice withheld={withheld} />
      <SettingsView ai={ai} recipeSource={recipeSourceStatus()} data={data} />
    </>
  );
}
