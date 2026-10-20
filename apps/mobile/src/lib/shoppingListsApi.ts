/** Client for the household's shopping lists (apps/web `/api/shopping/lists`, D263, D346). One list is active; others are archived. */
import type { ServerApi } from './serverApi';

export interface ListInfo {
  id: string;
  name: string;
  active: boolean;
  archived: boolean;
  updatedAt: string;
}

export type ListAction =
  | { action: 'create'; name: string }
  | { action: 'switch'; listId: string }
  | { action: 'rename'; listId: string; name: string }
  | { action: 'archive' };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function parseLists(raw: unknown): ListInfo[] {
  if (!isObj(raw) || !Array.isArray(raw.lists)) return [];
  return raw.lists.filter(isObj).filter((l) => typeof l.id === 'string' && typeof l.name === 'string').map((l) => ({
    id: l.id as string,
    name: l.name as string,
    active: l.active === true || l.status === 'active',
    archived: l.archived === true || l.status === 'archived',
    updatedAt: typeof l.updatedAt === 'string' ? l.updatedAt : '',
  }));
}

export async function fetchLists(api: ServerApi, householdId: string): Promise<ListInfo[]> {
  return parseLists(await api.get<unknown>('/api/shopping/lists', { householdId }));
}

/** Runs one change and returns the lists as they are afterwards. Throws ServerApiError (with the server's message). */
export async function changeLists(api: ServerApi, householdId: string, change: ListAction): Promise<ListInfo[]> {
  return parseLists(await api.post<unknown>('/api/shopping/lists', { householdId, ...change }));
}
