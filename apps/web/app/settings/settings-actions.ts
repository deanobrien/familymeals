'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireHouseholdContext } from '../../lib/server/auth/household-context';
import * as settings from '../../lib/server/settings/service';
import type { SettingsCaller, SettingsResult } from '../../lib/server/settings/service';
import { DISPLAY_PREFS_COOKIE, parseDisplayPrefs, serializeDisplayPrefs, type DisplayPrefs } from './display-prefs';
import type { DislikesInput, ExclusionsInput, PreferencesInput } from './schema';

/**
 * Settings > preferences and allergies (P0-D, D350). Thin wrappers over lib/server/settings/service, the same module the
 * Android app reaches through POST /api/settings. The household and user always come from the server-resolved session,
 * never the form; Supabase mode runs as the signed-in user under RLS, mock mode uses the in-memory store.
 */

async function caller(): Promise<SettingsCaller> {
  const ctx = await requireHouseholdContext();
  return { householdId: ctx.household.id, userId: ctx.user.id, client: ctx.mode === 'supabase' ? ctx.supabase : null, readOnly: ctx.readOnly };
}

function done(r: SettingsResult): SettingsResult {
  if (r.ok) {
    // The planner, discover and settings pages show the consent notice from the same data.
    for (const p of ['/settings', '/plan', '/recipes/discover']) revalidatePath(p);
  }
  return r;
}

export async function loadSettingsAction(): Promise<{ settings: SettingsResult; display: DisplayPrefs }> {
  const store = await cookies();
  return { settings: await settings.loadSettings(await caller()), display: parseDisplayPrefs(store.get(DISPLAY_PREFS_COOKIE)?.value) };
}

export async function savePreferencesAction(values: PreferencesInput): Promise<SettingsResult> {
  const c = await caller();
  const r = await settings.savePreferences(c, values);
  if (r.ok) {
    // Display-only choices: validated by the same schema (savePreferences accepted them), kept in a cookie.
    const store = await cookies();
    store.set(DISPLAY_PREFS_COOKIE, serializeDisplayPrefs(parseDisplayPrefs(`${values.units}|${values.locale}`)), {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      httpOnly: false,
    });
  }
  return done(r);
}

export async function saveDietaryAction(values: ExclusionsInput): Promise<SettingsResult> {
  return done(await settings.saveDietary(await caller(), values));
}

/** Soft dislikes for one member (P1-B, D378): the planner chips and Discover read them, so refresh those pages too. */
export async function saveDislikesAction(values: DislikesInput): Promise<SettingsResult> {
  return done(await settings.saveDislikes(await caller(), values));
}

export async function withdrawConsentAction(): Promise<SettingsResult> {
  return done(await settings.withdrawConsent(await caller()));
}

export async function removeAllDietaryAction(): Promise<SettingsResult> {
  return done(await settings.removeAllDietary(await caller()));
}
