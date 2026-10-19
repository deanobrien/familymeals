/** Home dashboard contract. Money is integer pence. */
export interface BasketEstimate {
  pence: number;
  /** Always an estimate until prices are confirmed; 'partial' when some items have no price. */
  kind: 'estimate' | 'partial';
  pricedItems: number;
  totalItems: number;
}

export interface DashboardTask {
  id: string;
  label: string;
  href: string;
}

export interface ActivityEntry {
  id: string;
  actor: string;
  text: string;
  /** ISO-8601 UTC. */
  at: string;
}

export interface DashboardData {
  householdName: string;
  weekStart: string;
  plannedMeals: number;
  /** Slots in a week (7 days x dinner for now). */
  plannedSlots: number;
  basket: BasketEstimate | null;
  shopping: { done: number; total: number };
  tasks: DashboardTask[];
  activity: ActivityEntry[];
}

export interface DashboardSource {
  load(): Promise<DashboardData>;
}
