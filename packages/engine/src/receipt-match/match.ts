import type { CanonicalIngredient, Quantity, Uuid } from '../contract';
import {
  DESCRIPTORS, FORM_WORDS, formOf, learnedKey, toBase, tokenise, type Form, type ReceiptItemLine,
} from './normalise';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface OutstandingItem {
  shoppingListItemId: Uuid;
  ingredientId?: Uuid;
  /** Canonical display name, e.g. "semi skimmed milk". */
  name: string;
  aliases: string[];
  form?: CanonicalIngredient['form'];
  /** What is still needed (used only for pack-size fit and quantity suggestion). */
  outstanding?: Quantity;
}

/** Learned household mappings: learnedKey(receipt description) -> ingredientId. */
export type LearnedMappings = Readonly<Record<string, Uuid>>;

export interface MatchOptions {
  /** Score at/above which a candidate may be `confident` (still only a pre-selected suggestion). */
  confidentMin: number;
  /** Score at/above which a candidate is worth showing as `uncertain`. */
  uncertainMin: number;
  /** Required lead over the runner-up (line side AND item side) for `confident`. */
  marginMin: number;
  learned: LearnedMappings;
}
export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  confidentMin: 0.85, uncertainMin: 0.5, marginMin: 0.15, learned: {},
};

export type MatchClass = 'confident' | 'uncertain' | 'none';
export type CandidateFlag = 'form_conflict' | 'form_unspecified' | 'fuzzy' | 'abbreviation' | 'learned' | 'size_differs';
/** Flags that forbid `confident` regardless of score. */
const BLOCKING: ReadonlySet<CandidateFlag> = new Set(['form_conflict', 'form_unspecified']);

export interface Candidate {
  shoppingListItemId: Uuid;
  score: number; // 0..1
  reasons: string[];
  flags: CandidateFlag[];
}

// ---------------------------------------------------------------------------
// Token matching
// ---------------------------------------------------------------------------

function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n]!;
}

function isSubsequence(small: string, big: string): boolean {
  let i = 0;
  for (const ch of big) if (ch === small[i]) i++;
  return i === small.length;
}

/** Weight of matching a phrase token against a line token. */
function tokenMatch(pt: string, lt: string): { w: number; flag?: CandidateFlag } {
  if (pt === lt) return { w: 1 };
  if (pt.length >= 5 && lt.length >= 5 && lev(pt, lt) <= 1) return { w: 0.85, flag: 'fuzzy' };
  if (lt.length >= 3 && lt.length < pt.length && lt.length >= pt.length * 0.5 && lt[0] === pt[0] && isSubsequence(lt, pt)) {
    return { w: 0.6, flag: 'abbreviation' };
  }
  return { w: 0 };
}

interface PhraseScore { score: number; coverage: number; precision: number; flags: Set<CandidateFlag>; phrase: string }

function scorePhrase(phraseTokens: readonly string[], lineTokens: readonly string[]): PhraseScore | undefined {
  if (phraseTokens.length === 0 || lineTokens.length === 0) return undefined;
  const used = new Set<number>();
  const matchedW = new Map<number, number>();
  const flags = new Set<CandidateFlag>();
  let cov = 0;
  for (const pt of phraseTokens) {
    let best = 0, bi = -1, bf: CandidateFlag | undefined;
    lineTokens.forEach((lt, i) => {
      if (used.has(i)) return;
      const r = tokenMatch(pt, lt);
      if (r.w > best) { best = r.w; bi = i; bf = r.flag; }
    });
    if (bi >= 0) { used.add(bi); matchedW.set(bi, best); if (bf) flags.add(bf); }
    cov += best;
  }
  if (cov === 0) return undefined;
  const coverage = cov / phraseTokens.length;
  let totalW = 0, hitW = 0;
  lineTokens.forEach((lt, i) => {
    const w = DESCRIPTORS.has(lt) ? 0.5 : 1;
    totalW += w;
    if (matchedW.has(i)) hitW += w * Math.min(1, matchedW.get(i)! + 0.0);
  });
  const precision = hitW / totalW;
  return { score: 0.75 * coverage + 0.25 * precision, coverage, precision, flags, phrase: phraseTokens.join(' ') };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Total quantity bought on a line in comparable base units. */
function lineQuantityBase(line: ReceiptItemLine) {
  const b = toBase(line.packQuantity);
  if (!b) return undefined;
  // Weighted lines already carry the whole weight; multi-count lines multiply the pack size.
  return line.weightG !== undefined ? b : { dim: b.dim, value: b.value * line.count };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Score one receipt line against one outstanding item. Returns undefined if there is no textual overlap. */
export function scoreCandidate(
  line: ReceiptItemLine, item: OutstandingItem, opts: Partial<MatchOptions> = {},
): Candidate | undefined {
  const o = { ...DEFAULT_MATCH_OPTIONS, ...opts };
  const reasons: string[] = [];
  const flags = new Set<CandidateFlag>();

  let best: PhraseScore | undefined;
  for (const phrase of [item.name, ...item.aliases]) {
    const ps = scorePhrase(tokenise(phrase), line.tokens);
    if (ps && (!best || ps.score > best.score)) best = ps;
  }

  // text tops out at 0.94; the final 0.06 is reserved for pack-size fit so size can break ties
  let score = (best?.score ?? 0) * 0.94;
  if (best) {
    reasons.push(`text match "${best.phrase}" (coverage ${r2(best.coverage)}, precision ${r2(best.precision)})`);
    best.flags.forEach((f) => flags.add(f));
    if (best.flags.has('fuzzy')) reasons.push('fuzzy spelling match');
    if (best.flags.has('abbreviation')) reasons.push('till abbreviation match');
  }

  const learnedId = o.learned[learnedKey(line.tokens)];
  const learnedHit = learnedId !== undefined && item.ingredientId === learnedId;
  if (learnedHit) {
    score = Math.max(score + 0.4, 0.6); // learned alone surfaces as uncertain, never confident
    flags.add('learned');
    reasons.push('household previously matched this receipt text to this ingredient');
  }
  if (score === 0) return undefined;

  // fresh vs dried vs ground vs frozen vs canned must never be silently merged
  const itemTokens = [item.name, ...item.aliases].flatMap(tokenise);
  const itemForm: Form | undefined = (item.form && FORM_WORDS.has(item.form) ? (item.form as Form) : undefined) ?? formOf(itemTokens);
  const lineForm = formOf(line.tokens);
  if (itemForm && lineForm && itemForm !== lineForm) {
    score -= 0.45; flags.add('form_conflict');
    reasons.push(`form conflict: list wants ${itemForm}, receipt says ${lineForm}`);
  } else if (!itemForm && lineForm && lineForm !== 'fresh') {
    score -= 0.25; flags.add('form_unspecified');
    reasons.push(`receipt line is ${lineForm} but the list item does not say so`);
  }

  // pack size fit (soft)
  const lq = lineQuantityBase(line);
  const oq = toBase(item.outstanding);
  if (lq && oq && lq.dim === oq.dim && lq.dim !== 'count') {
    const ratio = Math.min(lq.value, oq.value) / Math.max(lq.value, oq.value);
    score += 0.06 * ratio;
    if (ratio < 0.75) { flags.add('size_differs'); reasons.push(`pack size differs from outstanding (${r2(ratio * 100)}% fit)`); }
    else reasons.push('pack size close to outstanding');
  } else {
    score += 0.03; // neutral: size unknown or not comparable
  }

  score = Math.max(0, Math.min(1, score));
  if (score === 0) return undefined;
  return { shoppingListItemId: item.shoppingListItemId, score: r2(score), reasons, flags: [...flags] };
}

/** Ranked candidates (score desc, ties by item id for determinism). */
export function rankCandidates(
  line: ReceiptItemLine, items: readonly OutstandingItem[], opts: Partial<MatchOptions> = {},
): Candidate[] {
  const out: Candidate[] = [];
  for (const it of items) { const c = scoreCandidate(line, it, opts); if (c) out.push(c); }
  return out.sort((a, b) => b.score - a.score || a.shoppingListItemId.localeCompare(b.shoppingListItemId));
}

/**
 * Classify a top candidate. `confident` only ever means "pre-select this suggestion in the review UI";
 * nothing downstream treats it as confirmed.
 */
export function classify(
  top: Candidate | undefined, margin: number, opts: Partial<MatchOptions> = {},
): MatchClass {
  const o = { ...DEFAULT_MATCH_OPTIONS, ...opts };
  if (!top || top.score < o.uncertainMin) return 'none';
  if (top.score >= o.confidentMin && margin >= o.marginMin && !top.flags.some((f) => BLOCKING.has(f))) return 'confident';
  return 'uncertain';
}

// ---------------------------------------------------------------------------
// One-to-one assignment
// ---------------------------------------------------------------------------

/**
 * Optimal one-to-one assignment (Hungarian, O(n^3)) maximising total score; ties broken by lowest index.
 * `scores[row][col]`; cells <= 0 are treated as "not allowed". Returns col index per row (or -1).
 * Trade-off vs greedy: greedy (highest score first) is simpler/explainable but can "steal" an item from a
 * line that has no alternative; receipts are small (<100 lines) so the optimal solver is cheap and preferred.
 */
export function assignOptimal(scores: readonly (readonly number[])[]): number[] {
  const nr = scores.length;
  const nc = nr === 0 ? 0 : scores[0]!.length;
  const n = Math.max(nr, nc);
  if (n === 0) return [];
  const cost = (i: number, j: number) => -((i < nr && j < nc ? scores[i]![j]! : 0) > 0 ? scores[i]![j]! : 0);
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array<number>(n + 1).fill(0), v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0), way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(INF);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = INF, j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost(i0 - 1, j - 1) - u[i0]! - v[j]!;
        if (cur < minv[j]!) { minv[j] = cur; way[j] = j0; }
        if (minv[j]! < delta) { delta = minv[j]!; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]!] = u[p[j]!]! + delta; v[j] = v[j]! - delta; } else minv[j] = minv[j]! - delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]!; p[j0] = p[j1]!; j0 = j1; } while (j0 !== 0);
  }
  const res = new Array<number>(nr).fill(-1);
  for (let j = 1; j <= n; j++) {
    const row = p[j]! - 1;
    if (row >= 0 && row < nr && j - 1 < nc && scores[row]![j - 1]! > 0) res[row] = j - 1;
  }
  return res;
}

/** Greedy alternative (best score first, deterministic). Not used by default; kept for comparison/tests. */
export function assignGreedy(scores: readonly (readonly number[])[]): number[] {
  const nr = scores.length;
  const res = new Array<number>(nr).fill(-1);
  const takenCols = new Set<number>();
  const cells: { r: number; c: number; s: number }[] = [];
  scores.forEach((row, r) => row.forEach((s, c) => { if (s > 0) cells.push({ r, c, s }); }));
  cells.sort((a, b) => b.s - a.s || a.r - b.r || a.c - b.c);
  for (const { r, c } of cells) {
    if (res[r] !== -1 || takenCols.has(c)) continue;
    res[r] = c; takenCols.add(c);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Whole-receipt matching
// ---------------------------------------------------------------------------

export interface LineMatch {
  lineId: string;
  /** All candidates above zero, ranked (for the "pick another" UI). */
  candidates: Candidate[];
  /** One-to-one suggested assignment, if any. A SUGGESTION, never a confirmation. */
  suggestion?: Candidate;
  classification: MatchClass;
}

export function matchReceipt(
  lines: readonly ReceiptItemLine[], items: readonly OutstandingItem[], opts: Partial<MatchOptions> = {},
): LineMatch[] {
  const o = { ...DEFAULT_MATCH_OPTIONS, ...opts };
  const ranked = lines.map((l) => rankCandidates(l, items, o));
  const byItem = new Map(items.map((it, i) => [it.shoppingListItemId, i]));
  const matrix = lines.map((_, r) => {
    const row = new Array<number>(items.length).fill(0);
    for (const c of ranked[r]!) if (c.score >= o.uncertainMin) row[byItem.get(c.shoppingListItemId)!] = c.score;
    return row;
  });
  const assign = assignOptimal(matrix);

  return lines.map((line, r) => {
    const cands = ranked[r]!;
    const col = assign[r]!;
    const item = col >= 0 ? items[col] : undefined;
    const sug = item ? cands.find((c) => c.shoppingListItemId === item.shoppingListItemId) : undefined;
    if (!sug) return { lineId: line.id, candidates: cands, classification: 'none' as const };
    const lineRival = Math.max(0, ...cands.filter((c) => c !== sug).map((c) => c.score));
    const itemRival = Math.max(
      0,
      ...ranked.flatMap((cs, r2i) => (r2i === r ? [] : cs.filter((c) => c.shoppingListItemId === sug.shoppingListItemId).map((c) => c.score))),
    );
    const margin = sug.score - Math.max(lineRival, itemRival);
    return { lineId: line.id, candidates: cands, suggestion: sug, classification: classify(sug, margin, o) };
  });
}
