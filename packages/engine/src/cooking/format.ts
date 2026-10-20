/** Small display helpers shared by the web and Android cooking views. Pure; `now` is passed in. */

const DAY = 86_400_000;

/** "today", "yesterday", "3 days ago", "2 weeks ago", "5 months ago", "over a year ago". Empty string for an unreadable date. */
export function timeAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const days = Math.floor((now - t) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return 'over a year ago';
}

/** "Cooked 3 times, last 2 days ago" / "Cooked once, yesterday" / "Not cooked yet". */
export function cookedLabel(summary: { cookedCount: number; lastCookedAt: string | null } | null | undefined, now: number): string {
  if (!summary || summary.cookedCount <= 0) return 'Not cooked yet';
  const when = timeAgo(summary.lastCookedAt, now);
  const n = summary.cookedCount === 1 ? 'Cooked once' : `Cooked ${summary.cookedCount} times`;
  return when ? `${n}${summary.cookedCount === 1 ? ',' : ', last'} ${when}` : n;
}

/** "4.5/5" or "" for unrated. */
export function ratingLabel(rating: number | null | undefined): string {
  return rating == null ? '' : `${Math.round(rating * 10) / 10}/5`;
}
