/**
 * Conservative ingredient-name normalisation and matching.
 *
 * Principles (BRIEF §8):
 *  - Only EXACT matches on a normalised key (canonical name or alias) are accepted.
 *  - No substring / fuzzy matching is ever used to pick an ingredient. Near-misses are returned as
 *    `suggestions` for a human to confirm, with status 'no_match'.
 *  - Form words (fresh / dried / ground / frozen / canned) are significant: "ground coriander" never
 *    matches the fresh herb, and vice-versa.
 *  - Different cuts / products are different keys ("chicken breast" ≠ "chicken thigh" ≠ "chicken").
 *  - Ambiguity returns 'ambiguous' with candidates instead of guessing.
 */
import type { CanonicalIngredient, Uuid } from '../contract';

export type IngredientForm = NonNullable<CanonicalIngredient['form']>;

/** Words that change what product you buy. Keep them in the key. */
const FORM_WORDS: Record<string, IngredientForm> = {
  fresh: 'fresh',
  dried: 'dried',
  dry: 'dried',
  ground: 'ground',
  powdered: 'ground',
  frozen: 'frozen',
  canned: 'canned',
  tinned: 'canned',
};

/** Words that do NOT change the product (safe to drop). Deliberately short. */
const NOISE_WORDS = new Set([
  'large', 'small', 'medium', 'big', 'organic', 'ripe',
  'some', 'of', 'the', 'a', 'an',
]);

/** Words that must never be singularised (or have unusual plurals). */
const PLURAL_EXCEPTIONS: Record<string, string> = {
  leaves: 'leaf',
  loaves: 'loaf',
  halves: 'half',
  knives: 'knife',
  potatoes: 'potato',
  tomatoes: 'tomato',
  mangoes: 'mango',
  chillies: 'chilli',
  chilies: 'chili',
  anchovies: 'anchovy',
  cherries: 'cherry',
  berries: 'berry',
  peas: 'pea',
  oats: 'oat',
  // invariant / mass nouns ending in "s"
  asparagus: 'asparagus',
  couscous: 'couscous',
  hummus: 'hummus',
  houmous: 'houmous',
  molasses: 'molasses',
  swiss: 'swiss',
  brussels: 'brussels',
  lentils: 'lentil',
  chickpeas: 'chickpea',
  greens: 'greens',
  bass: 'bass',
  grass: 'grass',
  cress: 'cress',
  watercress: 'watercress',
  citrus: 'citrus',
  octopus: 'octopus',
  haggis: 'haggis',
};

/** Singularise one lower-case word conservatively. */
export function singularise(word: string): string {
  const exc = PLURAL_EXCEPTIONS[word];
  if (exc !== undefined) return exc;
  if (word.length <= 3) return word;
  if (/(ss|us|is|os)$/.test(word)) return word;
  if (/[^aeiou]ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ches|shes|xes|zes|sses)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

export interface NormalisedName {
  /** Full normalised key including any form word, e.g. "ground coriander". */
  key: string;
  /** Key with form words removed, e.g. "coriander". */
  core: string;
  /** Form detected from form words, if any. */
  form?: IngredientForm;
}

/**
 * Normalise a raw ingredient name into a comparison key.
 * Lower-case, strip accents/punctuation, drop noise words, singularise each word, keep form words.
 */
export function normaliseName(raw: string): NormalisedName {
  let s = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/[^a-z0-9\s-]/g, ' ');
  s = s.replace(/\bfree[\s-]range\b/g, ' ').replace(/\bgood[\s-]quality\b/g, ' ');
  const words = s.split(/[\s-]+/).filter((w) => w.length > 0 && !NOISE_WORDS.has(w)).map(singularise);
  let form: IngredientForm | undefined;
  const coreWords: string[] = [];
  for (const w of words) {
    const f = FORM_WORDS[w];
    if (f !== undefined) {
      // Two conflicting form words ("fresh dried") -> keep the first; they stay in the key anyway.
      form ??= f;
    } else {
      coreWords.push(w);
    }
  }
  const key = words.map((w) => (FORM_WORDS[w] !== undefined ? FORM_WORDS[w] : w)).join(' ');
  const res: NormalisedName = { key, core: coreWords.join(' ') };
  if (form) res.form = form;
  return res;
}

export type MatchStatus = 'matched' | 'ambiguous' | 'no_match';
export type MatchMethod = 'exact_name' | 'exact_alias' | 'core_with_form' | 'none';

export interface MatchResult {
  status: MatchStatus;
  ingredientId?: Uuid;
  ingredient?: CanonicalIngredient;
  /** 1 = exact name/alias; 0.9 = core + form agreement; 0 = no match / ambiguous. */
  confidence: number;
  method: MatchMethod;
  /** Ambiguous candidates (status 'ambiguous'). */
  candidates: Uuid[];
  /** Near-miss ids for human review only (status 'no_match'). Never auto-applied. */
  suggestions: Uuid[];
}

interface IndexEntry {
  ingredient: CanonicalIngredient;
  viaAlias: boolean;
}

/** Pre-built lookup over a catalogue; build once, match many. */
export class IngredientMatcher {
  private readonly byKey = new Map<string, IndexEntry[]>();
  private readonly byCore = new Map<string, CanonicalIngredient[]>();
  private readonly all: CanonicalIngredient[];

  constructor(catalogue: Iterable<CanonicalIngredient>) {
    this.all = [...catalogue].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const ing of this.all) {
      const keys = new Map<string, boolean>();
      const nameN = normaliseName(ing.name);
      keys.set(nameN.key, false);
      for (const alias of ing.aliases) {
        const k = normaliseName(alias).key;
        if (!keys.has(k)) keys.set(k, true);
      }
      for (const [k, viaAlias] of keys) {
        if (!k) continue;
        const list = this.byKey.get(k) ?? [];
        list.push({ ingredient: ing, viaAlias });
        this.byKey.set(k, list);
      }
      // core index (form stripped) from the canonical name and aliases
      const cores = new Set<string>([nameN.core, ...ing.aliases.map((a) => normaliseName(a).core)]);
      for (const core of cores) {
        if (!core) continue;
        const list = this.byCore.get(core) ?? [];
        if (!list.includes(ing)) list.push(ing);
        this.byCore.set(core, list);
      }
    }
  }

  match(rawName: string): MatchResult {
    const n = normaliseName(rawName);
    const none: MatchResult = { status: 'no_match', confidence: 0, method: 'none', candidates: [], suggestions: [] };
    if (!n.key) return none;

    // 1. exact key (name or alias)
    const exact = this.byKey.get(n.key);
    if (exact && exact.length > 0) {
      const unique = uniqueIngredients(exact.map((e) => e.ingredient));
      if (unique.length === 1) {
        const ing = unique[0]!;
        const viaAlias = exact.every((e) => e.viaAlias);
        return matched(ing, 1, viaAlias ? 'exact_alias' : 'exact_name');
      }
      // Same key on several ingredients: try to disambiguate by form, else refuse to guess.
      const byForm = n.form ? unique.filter((i) => i.form === n.form) : [];
      if (byForm.length === 1) return matched(byForm[0]!, 1, 'exact_name');
      return { ...none, status: 'ambiguous', candidates: unique.map((i) => i.id) };
    }

    // 2. core + explicit form agreement: "dried oregano" -> ingredient {name: 'oregano', form: 'dried'}
    //    Only when the INPUT states a form and the catalogue entry declares the SAME form.
    if (n.form && n.core) {
      const sameForm = (this.byCore.get(n.core) ?? []).filter((i) => i.form === n.form);
      if (sameForm.length === 1) return matched(sameForm[0]!, 0.9, 'core_with_form');
      if (sameForm.length > 1) return { ...none, status: 'ambiguous', candidates: sameForm.map((i) => i.id) };
    }

    // 3. no match: offer near-misses (typos, a different form of the same thing) for review only.
    return { ...none, suggestions: this.suggest(n) };
  }

  private suggest(n: NormalisedName): Uuid[] {
    const out = new Set<Uuid>();
    for (const ing of this.byCore.get(n.core) ?? []) out.add(ing.id);
    for (const [key, entries] of this.byKey) {
      if (Math.abs(key.length - n.key.length) <= 2 && editDistance(key, n.key) <= (n.key.length >= 6 ? 2 : 1)) {
        for (const e of entries) out.add(e.ingredient.id);
      }
    }
    return [...out].sort();
  }
}

function matched(ing: CanonicalIngredient, confidence: number, method: MatchMethod): MatchResult {
  return { status: 'matched', ingredientId: ing.id, ingredient: ing, confidence, method, candidates: [], suggestions: [] };
}

function uniqueIngredients(list: CanonicalIngredient[]): CanonicalIngredient[] {
  const seen = new Set<Uuid>();
  return list.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

/** Convenience one-shot matcher. Prefer `new IngredientMatcher(catalogue)` for repeated use. */
export function matchIngredient(rawName: string, catalogue: Iterable<CanonicalIngredient>): MatchResult {
  return new IngredientMatcher(catalogue).match(rawName);
}

/** Optimal-string-alignment edit distance (Levenshtein + adjacent transposition). Small strings only. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}
