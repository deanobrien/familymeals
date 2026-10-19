import { NextResponse } from 'next/server';
import { devToolsAllowed, resetInMemoryStores } from '../../../../lib/server/dev/reset';

export const dynamic = 'force-dynamic';

/** POST /api/dev/reset - wipe the in-memory stores (Playwright globalSetup). 404 in production. */
export async function POST() {
  if (!devToolsAllowed()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true, reset: resetInMemoryStores() });
}
