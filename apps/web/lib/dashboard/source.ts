import { SEED_DASHBOARD } from './seed';
import type { DashboardData, DashboardSource } from './types';

export interface InMemoryOptions {
  data?: DashboardData;
  delayMs?: number;
  /** Reject load() (for error-state testing). */
  fail?: boolean;
}

export class InMemoryDashboardSource implements DashboardSource {
  constructor(private readonly opts: InMemoryOptions = {}) {}

  async load(): Promise<DashboardData> {
    if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
    if (this.opts.fail) throw new Error('Dashboard unavailable');
    // Deep copy so callers cannot mutate the seed.
    return structuredClone(this.opts.data ?? SEED_DASHBOARD);
  }
}

// TODO(Supabase): swap for a real source once the data layer lands.
export const defaultDashboardSource: DashboardSource = new InMemoryDashboardSource({ delayMs: 150 });

export function basketLabel(b: NonNullable<DashboardData['basket']>): string {
  return b.kind === 'partial'
    ? `Estimate, partial: ${b.pricedItems} of ${b.totalItems} items priced`
    : 'Estimate based on generic prices';
}

export function relativeDay(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
