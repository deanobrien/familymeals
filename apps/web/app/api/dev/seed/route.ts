import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import type { Quantity } from '@fr/domain';
import { getAppContext } from '../../../../lib/server/context';
import { devToolsAllowed } from '../../../../lib/server/dev/reset';
import { getPlanStore } from '../../../../lib/server/plan/repository';
import { getIngredientCatalogue } from '../../../../lib/server/refdata/catalogue';
import { getShoppingRepository } from '../../../../lib/server/shopping/repository';
import type { PlanDoc } from '../../../../lib/plan/types';

export const dynamic = 'force-dynamic';

/** Seed recipes 01 (tomato pasta) and 05 (curry) - both in the library seed. */
const DEFAULT_ENTRIES = [
  { recipeId: '00000000-0000-4000-8000-000000000001', servings: 4 },
  { recipeId: '00000000-0000-4000-8000-000000000005', servings: 4 },
];
const WEEK = '2026-11-02';
const DAYS = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];

/**
 * POST /api/dev/seed - e2e fixtures for the CURRENT (cookie-selected) household. 404 in production.
 *  { kind: 'approved-plan', entries?: [{ recipeId, servings }] } -> { planId }
 *  { kind: 'shopping-item', name, value?, unit? } -> { itemId }
 */
export async function POST(req: NextRequest) {
  if (!devToolsAllowed()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ctx = await getAppContext();

  if (body.kind === 'approved-plan') {
    const entries = Array.isArray(body.entries) ? (body.entries as typeof DEFAULT_ENTRIES).slice(0, 7) : DEFAULT_ENTRIES;
    const doc: PlanDoc = {
      id: randomUUID(), householdId: ctx.householdId, weekStart: WEEK, mealTypes: ['dinner'], status: 'approved',
      updatedAt: new Date().toISOString(),
      entries: Object.fromEntries(entries.map((e, i) => [`${DAYS[i]}|dinner`, { kind: 'recipe' as const, recipeId: String(e.recipeId), servings: Number(e.servings) || 4 }])),
    };
    await getPlanStore().save(doc);
    return NextResponse.json({ ok: true, planId: doc.id });
  }

  if (body.kind === 'shopping-item' && typeof body.name === 'string' && body.name.length <= 120) {
    const m = getIngredientCatalogue().matcher.match(body.name);
    const itemId = randomUUID();
    const quantity: Quantity | undefined = typeof body.value === 'number'
      ? { kind: 'exact', value: body.value, originalText: `${body.value}${typeof body.unit === 'string' ? ` ${body.unit}` : ''}`, ...(typeof body.unit === 'string' ? { unit: body.unit as Quantity['unit'] } : {}) }
      : undefined;
    const r = await getShoppingRepository().submit(ctx.householdId, {
      type: 'add_item', commandId: randomUUID(), actor: ctx.userId, at: new Date().toISOString(), itemId,
      displayName: body.name, category: 'Other',
      ...(m.status === 'matched' && m.ingredientId ? { ingredientId: m.ingredientId } : {}),
      ...(quantity ? { quantity } : {}),
    });
    return NextResponse.json({ ok: r.result.status === 'applied', itemId });
  }

  return NextResponse.json({ error: 'bad_request' }, { status: 400 });
}
