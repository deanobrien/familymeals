import React from 'react';
import { render } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { createMockRecipesApi } from '@/lib/mockRecipesApi';
import type { RecipesApi } from '@/lib/recipesApi';

function SetHousehold({ id, children }: { id: string; children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId(id), [id, setHouseholdId]);
  return householdId ? <>{children}</> : null;
}

/** Render a screen inside the app providers with a demo data source and a (possibly spied) RecipesApi. */
export async function mountScreen(ui: React.ReactElement, opts: { api?: RecipesApi; household?: string; ds?: MockDataSource } = {}) {
  const api = opts.api ?? createMockRecipesApi();
  const ds = opts.ds ?? new MockDataSource();
  const view = await render(
    <AppProvider dataSource={ds} recipesApi={api}>
      <SetHousehold id={opts.household ?? 'hh-1'}>{ui}</SetHousehold>
    </AppProvider>,
  );
  return { api, ds, view };
}

/** Wrap every method of an api in a jest spy that still calls through. */
export function spyOnApi<T extends object>(api: T): T & { [K in keyof T]: T[K] } {
  for (const key of Object.keys(api) as Array<keyof T>) {
    if (typeof api[key] === 'function') jest.spyOn(api as never, key as never);
  }
  return api;
}
