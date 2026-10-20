import { NextResponse } from 'next/server';
import { apiError, badRequest, householdFromBody, householdFromUrl, readJsonBody, withApi } from '../../../../lib/server/api/handle';
import {
  archiveListOp, createListOp, renameListOp, switchListOp, type ListOpResult,
} from '../../../../lib/server/shopping/lists-ops';
import { getShoppingStore } from '../../../../lib/server/shopping/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The household's shopping lists (D263): one active, the rest archived. Same data the web lists sheet shows. */
export async function GET(req: Request) {
  return withApi(req, { householdId: householdFromUrl(req) }, async (ctx) => {
    const lists = await getShoppingStore().listLists(ctx.householdId);
    return NextResponse.json({
      householdId: ctx.householdId,
      lists: lists.map((l) => ({ id: l.id, name: l.name, status: l.status, active: l.status === 'active', archived: l.status === 'archived', updatedAt: l.updatedAt })),
    });
  });
}

/** POST JSON { action: 'create'|'switch'|'rename'|'archive', name?, listId?, householdId? }. */
export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body) return badRequest('That request could not be read.');
  const action = body.action;
  if (action !== 'create' && action !== 'switch' && action !== 'rename' && action !== 'archive') return badRequest('Unknown action.');
  return withApi(req, { householdId: householdFromBody(body), write: true }, async (ctx) => {
    const repo = getShoppingStore();
    let res: ListOpResult;
    if (action === 'create') res = await createListOp(repo, ctx.householdId, body.name);
    else if (action === 'switch') res = await switchListOp(repo, ctx.householdId, body.listId);
    else if (action === 'rename') res = await renameListOp(repo, ctx.householdId, body.listId, body.name);
    else res = await archiveListOp(repo, ctx.householdId);
    if (!res.ok) return apiError(400, 'BAD_REQUEST', res.error);
    const lists = await repo.listLists(ctx.householdId);
    return NextResponse.json({ ok: true, lists: lists.map((l) => ({ id: l.id, name: l.name, status: l.status, active: l.status === 'active', archived: l.status === 'archived', updatedAt: l.updatedAt })) });
  });
}
