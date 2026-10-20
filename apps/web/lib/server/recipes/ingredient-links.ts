import 'server-only';
import type { CanonicalIngredient } from '@fr/domain';
import { parseIngredientLine } from '@fr/engine/parse';
import type { IngredientCatalogue } from '../refdata/catalogue';
import type { IngredientCandidate } from '../../recipes/link-types';
import type { RecipeInput } from '../../recipes/schema';
import type { IngredientLine } from '../../recipes/types';

/**
 * Ingredient links for recipes created or edited by hand (DECISIONS D220-D229).
 *
 * A recipe line is "linked" when it carries the canonical `ingredientId` of the refdata catalogue. Cost, nutrition,
 * pantry and the planner's allergy safety net all key off that id, so a line typed in the form must be matched on
 * save just as seed and imported lines are. Matching is the engine matcher (exact name/alias only, no guessing).
 */

export type { IngredientCandidate };

export type LinkStatus = 'matched' | 'ambiguous' | 'unmatched';

export interface LinkSuggestion {
  status: LinkStatus;
  ingredientId?: string;
  ingredientName?: string;
  /** Ambiguous: the colliding ingredients. Unmatched: near-misses to offer ("did you mean"); never auto-applied. */
  candidates: IngredientCandidate[];
}

const MAX_SUGGESTIONS = 6;

const toCandidate = (catalogue: IngredientCatalogue, id: string): IngredientCandidate | null => {
  const ing = catalogue.get(id);
  return ing ? { id: ing.id, name: ing.name } : null;
};
const toCandidates = (catalogue: IngredientCatalogue, ids: readonly string[]): IngredientCandidate[] =>
  ids.map((id) => toCandidate(catalogue, id)).filter((c): c is IngredientCandidate => c !== null);

/** Names to try, in order: as typed, then as the engine line parser reads it ("400g chopped tomatoes" -> "chopped tomatoes"). */
function nameVariants(raw: string): string[] {
  const out = [raw.trim()];
  try {
    const parsed = parseIngredientLine(raw.trim()).name.trim();
    if (parsed && !out.includes(parsed)) out.push(parsed);
  } catch {
    /* the parser is total in practice; the raw name is always tried */
  }
  return out.filter(Boolean);
}

/** Match ONE ingredient name against the catalogue. Pure. */
export function suggestLink(catalogue: IngredientCatalogue, rawName: string): LinkSuggestion {
  let ambiguous: string[] | null = null;
  let near: string[] = [];
  for (const variant of nameVariants(rawName)) {
    const m = catalogue.matcher.match(variant);
    if (m.status === 'matched' && m.ingredientId) {
      const c = toCandidate(catalogue, m.ingredientId);
      if (c) return { status: 'matched', ingredientId: c.id, ingredientName: c.name, candidates: [] };
    }
    if (m.status === 'ambiguous' && !ambiguous) ambiguous = m.candidates;
    if (near.length === 0) near = m.suggestions;
  }
  if (ambiguous) return { status: 'ambiguous', candidates: toCandidates(catalogue, ambiguous) };
  return { status: 'unmatched', candidates: toCandidates(catalogue, near).slice(0, MAX_SUGGESTIONS) };
}

const fold = (s: string): string =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Free-text search over the catalogue (names and aliases) for the "Matched to" picker. Ranked: exact, prefix,
 * word-prefix, substring; alias hits rank just below name hits. Pure and deterministic (ties by name).
 */
export function searchCatalogue(catalogue: IngredientCatalogue, query: string, limit = 12): IngredientCandidate[] {
  const q = fold(query);
  if (q.length < 2) return [];
  const scored: Array<{ ing: CanonicalIngredient; score: number }> = [];
  for (const ing of catalogue.all) {
    let best = Infinity;
    for (const label of [ing.name, ...ing.aliases]) {
      const f = fold(label);
      let s = Infinity;
      if (f === q) s = 0;
      else if (f.startsWith(q)) s = 1;
      else if (f.split(' ').some((w) => w.startsWith(q))) s = 2;
      else if (f.includes(q)) s = 3;
      if (label !== ing.name && s < Infinity) s += 0.5;
      best = Math.min(best, s);
    }
    if (best < Infinity) scored.push({ ing, score: best });
  }
  scored.sort((a, b) => a.score - b.score || a.ing.name.localeCompare(b.ing.name));
  return scored.slice(0, limit).map((s) => ({ id: s.ing.id, name: s.ing.name }));
}

export type LinkSource = 'chosen' | 'kept' | 'auto' | 'none';

/** Per-line outcome of a save, in input order. */
export interface LineLinkReport {
  index: number;
  name: string;
  status: LinkStatus;
  source: LinkSource;
  ingredientId?: string;
  ingredientName?: string;
  /** Ambiguous (or near-miss) candidates for a line left unlinked. */
  candidates: IngredientCandidate[];
}

type InputLine = RecipeInput['ingredients'][number];

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Decide the canonical id of every line of a recipe being saved.
 *  - an id the caller sends that exists in the catalogue is a manual/kept choice and always wins;
 *  - `null` is an explicit "not in list" and is never re-matched;
 *  - otherwise a line whose name equals a line of the previous version keeps that line's link (re-matching only
 *    happens for changed or new lines, so manual choices survive an edit);
 *  - a new/changed line is matched now: exactly one match links it, an ambiguous or unknown name stays unlinked
 *    and the candidates are reported.
 * Linked lines carry the id, unlinked ones `null` so neither repository carries a stale link over.
 */
export function resolveLinks(
  catalogue: IngredientCatalogue,
  lines: readonly InputLine[],
  previous: readonly IngredientLine[] | null,
): { ingredients: InputLine[]; report: LineLinkReport[] } {
  const report: LineLinkReport[] = [];
  const ingredients = lines.map((line, index): InputLine => {
    const named = (r: Omit<LineLinkReport, 'index' | 'name'>): LineLinkReport => ({ index, name: line.name, ...r });
    const sent = typeof line.ingredientId === 'string' ? line.ingredientId.trim() : line.ingredientId;
    const sentIng = typeof sent === 'string' && sent ? catalogue.get(sent) : undefined;
    if (sentIng) {
      report.push(named({ status: 'matched', source: 'chosen', ingredientId: sentIng.id, ingredientName: sentIng.name, candidates: [] }));
      return { ...line, ingredientId: sentIng.id };
    }
    if (sent === null) {
      report.push(named({ status: 'unmatched', source: 'none', candidates: [] }));
      return { ...line, ingredientId: null };
    }
    const prev = previous?.find((p) => sameName(p.name, line.name));
    if (prev) {
      const prevIng = prev.ingredientId ? catalogue.get(prev.ingredientId) : undefined;
      report.push(
        named(
          prevIng
            ? { status: 'matched', source: 'kept', ingredientId: prevIng.id, ingredientName: prevIng.name, candidates: [] }
            : { status: 'unmatched', source: 'kept', candidates: [] },
        ),
      );
      return { ...line, ingredientId: prevIng ? prevIng.id : null };
    }
    const s = suggestLink(catalogue, line.name);
    if (s.status === 'matched' && s.ingredientId) {
      report.push(
        named({ status: 'matched', source: 'auto', ingredientId: s.ingredientId, ...(s.ingredientName ? { ingredientName: s.ingredientName } : {}), candidates: [] }),
      );
      return { ...line, ingredientId: s.ingredientId };
    }
    report.push(named({ status: s.status, source: 'auto', candidates: s.candidates }));
    return { ...line, ingredientId: null };
  });
  return { ingredients, report };
}
