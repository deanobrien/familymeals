import type { SupabaseClient } from '@supabase/supabase-js';
import { CONSENT_WORDING_VERSION } from '../../../app/settings/schema';
import { SettingsError, type HouseholdSettings, type SettingsStore } from './types';

type Row = Record<string, unknown>;

/** Postgres / PostgREST failures become fixed codes (never raw provider text). 42501 = RLS refusal. */
function fail(e: unknown): never {
  const code = (e as { code?: string } | null)?.code;
  if (code === '42501' || code === 'PGRST301') throw new SettingsError('forbidden');
  if (code === '23514' || code === '22P02' || code === '23503' || code === '22023') throw new SettingsError('invalid_input');
  throw new SettingsError('unknown');
}

async function run<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  const { data, error } = await p;
  if (error) fail(error);
  return data;
}

const activeConsent = (db: SupabaseClient, householdId: string, userId: string) =>
  db
    .from('consent_records')
    .select('id')
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .eq('consent_type', 'allergy_data')
    .is('withdrawn_at', null);

/**
 * households / household_exclusions / consent_records as the signed-in user. RLS is the authority (only an owner updates
 * the household row; consent rows are own-rows-only); the planner reads the same rows through planner_household_profile
 * and ignores allergy rows whose recorder has no active consent. Nothing here needs the service role.
 */
export class SupabaseSettingsStore implements SettingsStore {
  constructor(
    private readonly db: SupabaseClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(householdId: string, userId: string): Promise<HouseholdSettings> {
    const [h, ex, consent, mem, dis] = await Promise.all([
      run<Row>(this.db.from('households').select('default_servings, weekly_budget_pence').eq('id', householdId).maybeSingle()),
      run<Row[]>(this.db.from('household_exclusions').select('id, term').eq('household_id', householdId).order('created_at', { ascending: true })),
      run<Row[]>(activeConsent(this.db, householdId, userId)),
      run<Row[]>(this.db.from('household_members').select('user_id, role, display_name, joined_at').eq('household_id', householdId).eq('status', 'active').order('joined_at', { ascending: true })),
      run<Row[]>(this.db.from('member_dislikes').select('member_user_id, term').eq('household_id', householdId).order('term', { ascending: true })),
    ]);
    if (!h) throw new SettingsError('forbidden');
    let withheld = 0;
    try {
      const { data } = await this.db.rpc('planner_household_profile', { p_household_id: householdId });
      withheld = Number((data as { withheldExclusions?: number } | null)?.withheldExclusions ?? 0) || 0;
    } catch {
      /* the notice is advisory */
    }
    return {
      defaultServings: Number(h.default_servings ?? 4),
      weeklyBudgetPence: typeof h.weekly_budget_pence === 'number' ? h.weekly_budget_pence : null,
      exclusions: (ex ?? []).map((r) => (typeof r.term === 'string' ? r.term : '')).filter(Boolean),
      consentActive: (consent ?? []).length > 0,
      members: (mem ?? []).map((m) => {
        const id = String(m.user_id);
        return {
          memberId: id,
          displayName: (typeof m.display_name === 'string' && m.display_name.trim()) || 'Household member',
          isSelf: id === userId,
          terms: (dis ?? []).filter((d) => d.member_user_id === id).map((d) => String(d.term)),
        };
      }),
      canEditAllDislikes: (mem ?? []).some((m) => m.user_id === userId && m.role === 'owner'),
      withheldExclusions: withheld,
    };
  }

  /** Replaces one member's soft dislikes in a single transaction (the function runs as the caller; RLS is the authority). */
  async saveDislikes(householdId: string, _actorUserId: string, memberId: string, terms: string[]): Promise<void> {
    const { error } = await this.db.rpc('set_member_dislikes', { p_household_id: householdId, p_member_user_id: memberId, p_terms: terms });
    if (error) fail(error);
  }

  async savePreferences(householdId: string, prefs: { defaultServings: number; weeklyBudgetPence: number | null }): Promise<void> {
    const rows = await run<Row[]>(
      this.db.from('households').update({ default_servings: prefs.defaultServings, weekly_budget_pence: prefs.weeklyBudgetPence }).eq('id', householdId).select('id'),
    );
    // RLS: a member's update matches nothing.
    if ((rows ?? []).length === 0) throw new SettingsError('forbidden');
  }

  async saveExclusions(householdId: string, userId: string, tags: string[]): Promise<void> {
    const wanted = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
    if (wanted.length > 0) await this.ensureConsent(householdId, userId);
    const current = (await run<Row[]>(this.db.from('household_exclusions').select('id, term').eq('household_id', householdId))) ?? [];
    const keep = new Set(wanted);
    const have = new Set<string>();
    const drop: string[] = [];
    for (const r of current) {
      const term = typeof r.term === 'string' ? r.term.toLowerCase() : null;
      if (term && keep.has(term)) have.add(term);
      else if (term) drop.push(String(r.id));
    }
    for (const id of drop) await run(this.db.from('household_exclusions').delete().eq('id', id).eq('household_id', householdId));
    const stamp = this.now().toISOString();
    const add = wanted.filter((t) => !have.has(t)).map((term) => ({ household_id: householdId, term, kind: 'allergy', consent_recorded_at: stamp }));
    if (add.length > 0) await run(this.db.from('household_exclusions').insert(add));
  }

  private async ensureConsent(householdId: string, userId: string): Promise<void> {
    if (((await run<Row[]>(activeConsent(this.db, householdId, userId))) ?? []).length > 0) return;
    await run(this.db.from('consent_records').insert({ household_id: householdId, consent_type: 'allergy_data', wording_version: CONSENT_WORDING_VERSION }));
  }

  async withdrawConsent(householdId: string, userId: string): Promise<void> {
    await run(
      this.db.from('consent_records').update({ withdrawn_at: this.now().toISOString() }).eq('household_id', householdId).eq('user_id', userId).is('withdrawn_at', null),
    );
  }

  async removeAllDietary(householdId: string, userId: string): Promise<void> {
    await run(this.db.from('household_exclusions').delete().eq('household_id', householdId));
    await this.withdrawConsent(householdId, userId);
  }
}
