// Which serving count a recipe detail page opens at: a per-member override if valid, else the household default
// (fallback 4), never the recipe's own servings. Pure so the server render and the client override agree.
export const FALLBACK_HOUSEHOLD_SERVINGS = 4;
export const MAX_SERVINGS = 100;

export function validServings(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_SERVINGS;
}

export function resolveInitialServings(householdDefault: unknown, override?: unknown): number {
  if (validServings(override)) return override;
  return validServings(householdDefault) ? householdDefault : FALLBACK_HOUSEHOLD_SERVINGS;
}

export function servingsOverrideKey(householdId: string, userId: string, recipeId: string): string {
  return `fr:servings:v1:${householdId}:${userId}:${recipeId}`;
}

export function parseStoredServings(raw: string | null): number | undefined {
  if (raw == null || !/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return validServings(n) ? n : undefined;
}
