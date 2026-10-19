export const PACKAGE_NAME = '@fr/domain' as const;

/** Placeholder product name; the real name is an owner decision (see PARALLEL-DELIVERY-PLAN). */
export const APP_NAME = 'Family Recipes';

export interface NavLink {
  label: string;
  href: string;
}

/**
 * Placeholder nav. @fr/ui owns the real shell nav (DEFAULT_NAV); apps/web only imports APP_NAME and its
 * smoke test still references this, so it is kept until the web lane drops it.
 */
export const PLACEHOLDER_NAV: readonly NavLink[] = [
  { label: 'Home', href: '/' },
  { label: 'Recipes', href: '/recipes' },
  { label: 'Meal planner', href: '/plan' },
  { label: 'Shopping list', href: '/shopping' },
  { label: 'Household', href: '/household' },
  { label: 'Settings', href: '/settings' },
];
