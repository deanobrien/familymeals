import type { DashboardData } from './types';

// TODO(Supabase): replace with a DashboardSource backed by the database.
// Seeded from e2e/fixtures/households/household-a.json (kept in sync by dashboard.test.ts).
// Prices are generic estimates in pence; "bin bags" has no price so the basket is partial.
export const SEED_PRICES_PENCE: Record<string, number> = {
  chicken: 650,
  potatoes: 180,
  'lasagne sheets': 120,
  'frozen peas': 150,
};

export const SEED_ITEMS = [
  { name: 'chicken', done: true },
  { name: 'potatoes', done: true },
  { name: 'lasagne sheets', done: false },
  { name: 'frozen peas', done: false },
  { name: 'bin bags', done: false },
];

const priced = SEED_ITEMS.filter((i) => i.name in SEED_PRICES_PENCE);

export const SEED_DASHBOARD: DashboardData = {
  householdName: 'The Smiths (A)',
  weekStart: '2026-10-19',
  plannedMeals: 3,
  plannedSlots: 7,
  basket: {
    pence: priced.reduce((sum, i) => sum + (SEED_PRICES_PENCE[i.name] ?? 0), 0),
    kind: 'partial',
    pricedItems: priced.length,
    totalItems: SEED_ITEMS.length,
  },
  shopping: { done: SEED_ITEMS.filter((i) => i.done).length, total: SEED_ITEMS.length },
  tasks: [
    { id: 't1', label: 'Plan dinners for Thursday to Sunday', href: '/plan' },
    { id: 't2', label: 'Add a price for bin bags to complete the basket estimate', href: '/shopping' },
  ],
  activity: [
    { id: 'a1', actor: 'Bob Smith', text: 'checked off potatoes', at: '2026-10-19T17:40:00Z' },
    { id: 'a2', actor: 'Alice Smith', text: 'approved this week’s plan', at: '2026-10-19T09:15:00Z' },
    { id: 'a3', actor: 'Alice Smith', text: 'added Smith Pea Soup to Wednesday', at: '2026-10-18T20:02:00Z' },
  ],
};
