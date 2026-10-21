// Kids' mode on Android (P3-A, D425-D429): the client for the web app's /api/kids route plus defensive parsers. A kid profile is a
// name, an emoji and a colour; kids vote through the parent's signed-in app (no login of their own).
import type { ServerApi } from './serverApi';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export type VoteValue = 'up' | 'heart';

export interface Kid {
  id: string;
  displayName: string;
  avatar: string;
  colour: string;
}

export interface Candidate {
  recipeId: string;
  title: string;
  imagePath: string | null;
  up: number;
  heart: number;
  score: number;
  winner: boolean;
}

export interface Vote {
  recipeId: string;
  voter: { kind: 'member' | 'kid'; id: string };
  value: VoteValue;
}

export interface Round {
  id: string;
  title: string | null;
  forDate: string;
  days: number;
  open: boolean;
  closesAt: string | null;
  candidates: Candidate[];
  votes: Vote[];
}

export interface KidsData {
  kids: Kid[];
  rounds: Round[];
  me: string;
  planned: Array<{ recipeId: string; title: string }>;
  recipes: Array<{ recipeId: string; title: string }>;
}

export function parseKidsData(v: unknown): KidsData {
  const root = isObj(v) ? v : {};
  const k = isObj(root.kids) ? root.kids : {};
  const seeds = isObj(root.seeds) ? root.seeds : {};
  return {
    kids: arr(k.kids).filter(isObj).flatMap((x) => (typeof x.id === 'string' ? [{ id: x.id, displayName: str(x.displayName), avatar: str(x.avatar, '🙂'), colour: str(x.colour, 'blue') }] : [])),
    rounds: arr(k.rounds).filter(isObj).flatMap((r) => {
      if (typeof r.id !== 'string') return [];
      return [{
        id: r.id, title: typeof r.title === 'string' ? r.title : null, forDate: str(r.forDate), days: num(r.days) || 1, open: r.open === true, closesAt: typeof r.closesAt === 'string' ? r.closesAt : null,
        candidates: arr(r.candidates).filter(isObj).flatMap((c) => (typeof c.recipeId === 'string'
          ? [{ recipeId: c.recipeId, title: str(c.title), imagePath: typeof c.imagePath === 'string' ? c.imagePath : null, up: num(c.up), heart: num(c.heart), score: num(c.score), winner: c.winner === true }]
          : [])),
        votes: arr(r.votes).filter(isObj).flatMap((x) => {
          const voter = isObj(x.voter) ? x.voter : {};
          if (typeof x.recipeId !== 'string' || typeof voter.id !== 'string' || (x.value !== 'up' && x.value !== 'heart')) return [];
          return [{ recipeId: x.recipeId, voter: { kind: voter.kind === 'kid' ? ('kid' as const) : ('member' as const), id: voter.id }, value: x.value }];
        }),
      }];
    }),
    me: str(k.me),
    planned: arr(seeds.planned).filter(isObj).flatMap((p) => (typeof p.recipeId === 'string' ? [{ recipeId: p.recipeId, title: str(p.title) }] : [])),
    recipes: arr(seeds.recipes).filter(isObj).flatMap((p) => (typeof p.recipeId === 'string' ? [{ recipeId: p.recipeId, title: str(p.title) }] : [])),
  };
}

export const KID_AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🦄', '🐢', '🐝', '🐧', '🦖', '🚀', '🌈'] as const;
export const KID_COLOURS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
export const COLOUR_HEX: Record<string, string> = { red: '#e5484d', orange: '#f76808', yellow: '#c99a00', green: '#46a758', teal: '#2a9d8f', blue: '#3e63dd', purple: '#8e4ec6', pink: '#e93d82' };

export interface KidsClient {
  load(week?: string): Promise<KidsData>;
  addKid(input: { displayName: string; avatar: string; colour: string }): Promise<Kid>;
  removeKid(kidId: string): Promise<void>;
  openRound(input: { recipeIds: string[]; forDate?: string; days?: number; title?: string; closesAt?: string | null }): Promise<string>;
  closeRound(roundId: string): Promise<void>;
  /** `kidId` null = the signed-in parent voting as themselves; `value` null takes the vote back. */
  vote(input: { roundId: string; recipeId: string; kidId: string | null; value: VoteValue | null }): Promise<void>;
}

export function createKidsClient(api: ServerApi, householdId: string): KidsClient {
  return {
    load: async (week) => parseKidsData(await api.get<unknown>('/api/kids', { householdId, ...(week ? { week } : {}) })),
    addKid: async (input) => {
      const body = await api.post<unknown>('/api/kids', { householdId, action: 'addKid', ...input });
      const k = isObj(body) && isObj(body.kid) ? body.kid : {};
      return { id: str(k.id), displayName: str(k.displayName, input.displayName), avatar: str(k.avatar, input.avatar), colour: str(k.colour, input.colour) };
    },
    removeKid: async (kidId) => {
      await api.post('/api/kids', { householdId, action: 'removeKid', kidId });
    },
    openRound: async (input) => {
      const body = await api.post<unknown>('/api/kids', { householdId, action: 'openRound', ...input });
      const id = isObj(body) ? body.roundId : undefined;
      if (typeof id !== 'string') throw new Error('The vote could not be started.');
      return id;
    },
    closeRound: async (roundId) => {
      await api.post('/api/kids', { householdId, action: 'closeRound', roundId });
    },
    vote: async (input) => {
      await api.post('/api/kids', { householdId, action: 'vote', ...input });
    },
  };
}
