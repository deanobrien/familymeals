/**
 * Pure form validation shared by the account screens and the data source (mirrors the web zod schemas in
 * apps/web/app/(auth)/actions.ts, lib/server/auth/household-service.ts and app/settings/schema.ts).
 */
import { AccountError } from './accountErrors';

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(v: string): boolean {
  const s = v.trim();
  return s.length > 0 && s.length <= 254 && EMAIL_RE.test(s);
}

export const isNewPassword = (v: string): boolean => v.length >= MIN_PASSWORD && v.length <= MAX_PASSWORD;

/** Email, trimmed; throws invalid_input. */
export function requireEmail(v: string): string {
  const s = v.trim();
  if (!isEmail(s)) throw new AccountError('invalid_input');
  return s;
}

export function requireNewPassword(v: string): string {
  if (!isNewPassword(v)) throw new AccountError('weak_password');
  return v;
}

export interface CreateHouseholdFields {
  name: string;
  defaultServings: string;
  weeklyBudgetPounds: string;
  displayName: string;
}

/** `pounds` as typed ("85", "85.50", blank = none) -> integer pence, or `undefined` when malformed. */
export function poundsToPence(pounds: string): number | null | undefined {
  const t = pounds.trim();
  if (t === '') return null;
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(t)) return undefined;
  return Math.round(parseFloat(t) * 100);
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

export function parseCreateHousehold(f: CreateHouseholdFields): Parsed<{
  name: string;
  defaultServings: number;
  weeklyBudgetPence: number | null;
  displayName?: string;
}> {
  const errors: Record<string, string> = {};
  const name = f.name.trim();
  if (name.length < 1) errors.name = 'Give the household a name';
  else if (name.length > 120) errors.name = 'Keep the name to 120 characters or fewer';
  const servingsText = (f.defaultServings.trim() || '4');
  const servings = /^\d+$/.test(servingsText) ? Number(servingsText) : NaN;
  if (!(servings >= 1 && servings <= 50)) errors.defaultServings = 'Servings must be a whole number from 1 to 50';
  const pence = poundsToPence(f.weeklyBudgetPounds);
  if (pence === undefined) errors.weeklyBudgetPounds = 'Enter an amount in pounds, e.g. 85 or 85.50';
  const displayName = f.displayName.trim();
  if (displayName.length > 80) errors.displayName = 'Keep your name to 80 characters or fewer';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name, defaultServings: servings, weeklyBudgetPence: pence ?? null, ...(displayName ? { displayName } : {}) },
  };
}

/** Household preferences (settings): servings 1-24, optional weekly budget. */
export function parsePreferences(f: { defaultServings: string; weeklyBudgetPounds: string }): Parsed<{
  defaultServings: number;
  weeklyBudgetPence: number | null;
}> {
  const errors: Record<string, string> = {};
  const t = f.defaultServings.trim();
  const servings = /^\d+$/.test(t) ? Number(t) : NaN;
  if (!/^\d+$/.test(t)) errors.defaultServings = 'Enter a whole number of servings';
  else if (!(servings >= 1 && servings <= 24)) errors.defaultServings = 'Servings must be between 1 and 24';
  const pence = poundsToPence(f.weeklyBudgetPounds);
  if (pence === undefined) errors.weeklyBudgetPounds = 'Enter an amount in pounds, e.g. 85 or 85.50';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { defaultServings: servings, weeklyBudgetPence: pence ?? null } };
}

/** One dietary-exclusion tag (same rules as the web `exclusionTag`): lower-case letters, spaces, apostrophes, hyphens; 1-40 chars. */
export function parseExclusionTag(v: string): { ok: true; value: string } | { ok: false; error: string } {
  const t = v.trim().toLowerCase();
  if (t.length < 1) return { ok: false, error: 'Enter a food to exclude' };
  if (t.length > 40) return { ok: false, error: 'Keep it short, 40 characters at most' };
  if (!/^[a-z][a-z' -]*$/.test(t)) return { ok: false, error: 'Use letters only' };
  return { ok: true, value: t };
}

export const MAX_EXCLUSIONS = 40;

/** One soft dislike (same rules as the web `dislikeTag`, D378): lower-case letters, spaces, apostrophes, hyphens; 1-60 chars. */
export function parseDislikeTag(v: string): { ok: true; value: string } | { ok: false; error: string } {
  const t = v.trim().toLowerCase();
  if (t.length < 1) return { ok: false, error: 'Enter a food' };
  if (t.length > 60) return { ok: false, error: 'Keep it short, 60 characters at most' };
  if (!/^[a-z][a-z' -]*$/.test(t)) return { ok: false, error: 'Use letters only' };
  return { ok: true, value: t };
}

export const MAX_DISLIKES = 30;

/** Pretty "N days left" count used by the deletion countdown. */
export function daysLeft(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000));
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}
