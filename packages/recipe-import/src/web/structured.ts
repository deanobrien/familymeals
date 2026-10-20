// schema.org Recipe extraction from a web page: JSON-LD first, microdata second (P1-B, D370). Pure TS, client-safe.
// Output is a plain StructuredRecipe; `toExtraction` (./to-extraction.ts) turns it into the SAME RecipeExtraction a photo
// import produces, so the review screen is shared. Nothing here is AI.
import { decodeEntities, findAll, textOf, type HtmlNode } from './html.js';

export interface StructuredRecipe {
  via: 'json-ld' | 'microdata';
  name: string;
  description?: string;
  ingredients: string[];
  steps: string[];
  servings?: number;
  prepMinutes?: number;
  cookMinutes?: number;
  totalMinutes?: number;
  /** Absolute http(s) URL of the page's own picture of the dish. */
  imageUrl?: string;
  author?: string;
  publisher?: string;
  keywords: string[];
  category?: string;
  cuisine?: string;
  /** schema.org suitableForDiet values as published (never trusted for labels). */
  suitableForDiet: string[];
}

export interface PageMeta {
  title?: string;
  siteName?: string;
  canonicalUrl?: string;
  imageUrl?: string;
}

const MAX_INGREDIENTS = 80;
const MAX_STEPS = 60;

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);

/** Strip tags (turning breaks / list items into spaces or newlines), decode entities, collapse spaces. */
export function cleanText(v: string, keepNewlines = false): string {
  const withBreaks = v.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*(?:p|li|div|h[1-6])\s*>/gi, '\n');
  const noTags = withBreaks.replace(/<[^>]*>/g, ' ');
  const dec = decodeEntities(noTags).replace(new RegExp(String.fromCharCode(160), 'g'), ' ');
  return keepNewlines
    ? dec.split(/\r?\n/).map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n')
    : dec.replace(/\s+/g, ' ').trim();
}

/** ISO 8601 duration ("PT1H30M", "P0DT45M") or plain "45 minutes" -> whole minutes. */
export function parseDurationMinutes(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v <= 20_160 ? Math.round(v) : undefined;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  const iso = /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(s);
  if (iso && s.length > 2) {
    const [, w, d, h, m, sec] = iso;
    const total = (Number(w ?? 0) * 7 + Number(d ?? 0)) * 1440 + Number(h ?? 0) * 60 + Number(m ?? 0) + Number(sec ?? 0) / 60;
    return total >= 0 && total <= 20_160 ? Math.round(total) : undefined;
  }
  const plain = /^(?:(\d+)\s*(?:h|hr|hrs|hours?))?\s*(?:(\d+)\s*(?:m|mins?|minutes?))?$/i.exec(s);
  if (plain && (plain[1] || plain[2])) return Number(plain[1] ?? 0) * 60 + Number(plain[2] ?? 0);
  return undefined;
}

/** recipeYield: 4, "4", "4 servings", "Serves 4-6", ["4", "4 servings"] -> 4 (first number; implausible values dropped). */
export function parseYield(v: unknown): number | undefined {
  if (Array.isArray(v)) {
    for (const x of v) { const r = parseYield(x); if (r !== undefined) return r; }
    return undefined;
  }
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(/(\d+(?:\.\d+)?)/.exec(cleanText(v))?.[1]) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 60 ? n : undefined;
}

type Json = unknown;
const isObj = (v: Json): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v);

function typesOf(o: Record<string, Json>): string[] {
  const t = o['@type'];
  const arr = Array.isArray(t) ? t : [t];
  return arr.filter((x): x is string => typeof x === 'string').map((x) => x.replace(/^.*[/#]/, '').toLowerCase());
}

function strings(v: Json, depth = 0): string[] {
  if (depth > 4 || v === undefined || v === null) return [];
  if (typeof v === 'string') return [v];
  if (typeof v === 'number') return [String(v)];
  if (Array.isArray(v)) return v.flatMap((x) => strings(x, depth + 1));
  if (isObj(v)) return strings(v.text ?? v.name ?? v['@value'], depth + 1);
  return [];
}

/** Parse the contents of a JSON-LD script tolerantly (stray comments, CDATA, control characters, trailing commas). */
export function parseJsonLd(raw: string): Json | undefined {
  const base = raw.replace(/^\s*<!--/, '').replace(/-->\s*$/, '').replace(/^\s*\/\/\s*<!\[CDATA\[|\/\/\s*\]\]>\s*$/g, '').trim();
  const attempts = [
    base,
    // Raw newlines / tabs inside string values are the commonest publisher bug.
    // eslint-disable-next-line no-control-regex
    base.replace(/[\u0000-\u001f]+/g, ' '),
    // eslint-disable-next-line no-control-regex
    base.replace(/[\u0000-\u001f]+/g, ' ').replace(/,\s*([}\]])/g, '$1'),
  ];
  for (const a of attempts) {
    try { return JSON.parse(a) as Json; } catch { /* try the next repair */ }
  }
  return undefined;
}

interface Graph { byId: Map<string, Record<string, Json>>; recipes: Record<string, Json>[] }

function collect(root: Json, g: Graph, depth = 0, seen = new Set<unknown>()): void {
  if (depth > 8 || root === null || typeof root !== 'object' || seen.has(root)) return;
  seen.add(root);
  if (Array.isArray(root)) { for (const x of root.slice(0, 200)) collect(x, g, depth + 1, seen); return; }
  const o = root as Record<string, Json>;
  const id = o['@id'];
  if (typeof id === 'string' && Object.keys(o).length > 1) g.byId.set(id, o);
  if (typesOf(o).includes('recipe')) g.recipes.push(o);
  for (const k of Object.keys(o)) {
    if (k === '@context') continue;
    const v = o[k];
    if (v && typeof v === 'object') collect(v, g, depth + 1, seen);
  }
}

const deref = (v: Json, g: Graph): Json => {
  if (isObj(v) && typeof v['@id'] === 'string' && Object.keys(v).length === 1) return g.byId.get(v['@id']) ?? v;
  return v;
};

function nameOf(v: Json, g: Graph): string | undefined {
  const x = deref(Array.isArray(v) ? v[0] : v, g);
  const s = (typeof x === 'string' ? x : isObj(x) ? strings(x.name)[0] : undefined)?.trim();
  return s ? clip(cleanText(s), 120) : undefined;
}

function flattenInstructions(v: Json, g: Graph, out: string[], depth = 0): void {
  if (depth > 5 || out.length >= MAX_STEPS * 2) return;
  const x = deref(v, g);
  if (typeof x === 'string') {
    for (const line of cleanText(x, true).split('\n')) if (line) out.push(line);
  } else if (Array.isArray(x)) {
    for (const e of x) flattenInstructions(e, g, out, depth + 1);
  } else if (isObj(x)) {
    const t = typesOf(x);
    if (t.includes('howtosection') || (x.itemListElement !== undefined && x.text === undefined)) flattenInstructions(x.itemListElement, g, out, depth + 1);
    else {
      const text = strings(x.text)[0] ?? strings(x.name)[0];
      if (text) for (const line of cleanText(text, true).split('\n')) if (line) out.push(line);
    }
  }
}

function imageOf(v: Json, g: Graph, base: string, depth = 0): string | undefined {
  if (depth > 3) return undefined;
  const x = deref(v, g);
  if (typeof x === 'string') return absoluteHttp(x, base);
  if (Array.isArray(x)) {
    for (const e of x) { const r = imageOf(e, g, base, depth + 1); if (r) return r; }
    return undefined;
  }
  if (isObj(x)) return imageOf(x.url ?? x.contentUrl, g, base, depth + 1);
  return undefined;
}

export function absoluteHttp(u: string, base: string): string | undefined {
  try {
    const url = new URL(u.trim(), base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.hash = '';
    return url.toString().length <= 1000 ? url.toString() : undefined;
  } catch { return undefined; }
}

function keywordList(v: Json): string[] {
  return strings(v).flatMap((s) => cleanText(s).split(/[,;]/)).map((s) => s.trim().toLowerCase()).filter((s) => s && s.length <= 40);
}

function fromJsonLd(o: Record<string, Json>, g: Graph, base: string): StructuredRecipe {
  const ingredients = strings(o.recipeIngredient ?? o.ingredients).flatMap((s) => cleanText(s, true).split('\n')).filter(Boolean).slice(0, MAX_INGREDIENTS);
  const steps: string[] = [];
  flattenInstructions(o.recipeInstructions, g, steps);
  const author = nameOf(o.author, g);
  const publisher = nameOf(o.publisher, g);
  const category = strings(o.recipeCategory)[0];
  const cuisine = strings(o.recipeCuisine)[0];
  const description = o.description !== undefined ? cleanText(strings(o.description)[0] ?? '') : '';
  const imageUrl = imageOf(o.image, g, base);
  const prep = parseDurationMinutes(o.prepTime);
  const cook = parseDurationMinutes(o.cookTime);
  const total = parseDurationMinutes(o.totalTime);
  const servings = parseYield(o.recipeYield);
  return {
    via: 'json-ld',
    name: clip(cleanText(strings(o.name)[0] ?? ''), 160),
    ...(description ? { description: clip(description, 600) } : {}),
    ingredients: ingredients.map((s) => clip(s, 300)),
    steps: steps.map((s) => clip(s, 1500)).slice(0, MAX_STEPS),
    ...(servings !== undefined ? { servings } : {}),
    ...(prep !== undefined ? { prepMinutes: prep } : {}),
    ...(cook !== undefined ? { cookMinutes: cook } : {}),
    ...(total !== undefined ? { totalMinutes: total } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(author ? { author } : {}),
    ...(publisher ? { publisher } : {}),
    keywords: [...new Set([...keywordList(o.keywords), ...keywordList(o.recipeCategory)])].slice(0, 12),
    ...(category ? { category: clip(cleanText(category), 60) } : {}),
    ...(cuisine ? { cuisine: clip(cleanText(cuisine), 60) } : {}),
    suitableForDiet: strings(o.suitableForDiet).map((s) => s.replace(/^.*[/#]/, '')).slice(0, 6),
  };
}

// ---- microdata ----

const itemtypeIsRecipe = (n: HtmlNode): boolean => (n.attrs.itemtype ?? '').trim().split(/\s+/).some((t) => /schema\.org\/Recipe$/i.test(t));

function propValue(n: HtmlNode, base: string): string {
  const a = n.attrs;
  switch (n.tag) {
    case 'meta': return a.content ?? '';
    case 'img': case 'source': case 'audio': case 'video': return a.src ? (absoluteHttp(a.src, base) ?? '') : '';
    case 'a': case 'link': case 'area': return a.href ? (absoluteHttp(a.href, base) ?? '') : '';
    case 'time': return a.datetime ?? a.content ?? textOf(n);
    default: return a.content ?? textOf(n);
  }
}

function fromMicrodata(scope: HtmlNode, base: string): StructuredRecipe {
  const props = new Map<string, HtmlNode[]>();
  const visit = (n: HtmlNode) => {
    for (const c of n.children) {
      if (typeof c === 'string') continue;
      const prop = c.attrs.itemprop;
      if (prop) for (const p of prop.trim().split(/\s+/)) { const l = props.get(p) ?? []; l.push(c); props.set(p, l); }
      // Do not descend into a different item (a nested Person / Review / another Recipe); its itemprops are not ours.
      if (c.attrs.itemscope !== undefined && prop) continue;
      visit(c);
    }
  };
  visit(scope);
  const first = (k: string): string | undefined => { const n = props.get(k)?.[0]; return n ? propValue(n, base) : undefined; };
  const all = (k: string): string[] => (props.get(k) ?? []).map((n) => propValue(n, base)).filter(Boolean);

  const ingredients = [...all('recipeIngredient'), ...all('ingredients')].flatMap((s) => cleanText(s, true).split('\n')).filter(Boolean).slice(0, MAX_INGREDIENTS);
  const steps: string[] = [];
  for (const n of props.get('recipeInstructions') ?? []) {
    const items = findAll(n, (x) => x.tag === 'li' || x.attrs.itemprop === 'text');
    if (items.length) for (const li of items) { const t = textOf(li); if (t) steps.push(t); }
    else for (const line of cleanText(n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('\n'), true).split('\n')) if (line) steps.push(line);
  }
  // A method written as <ol itemprop="recipeInstructions"> nested inside li items would repeat; drop consecutive duplicates.
  const dedupedSteps = steps.filter((s, i) => s !== steps[i - 1]);

  const authorNode = props.get('author')?.[0];
  const author = authorNode ? (() => {
    const nm = findAll(authorNode, (x) => x.attrs.itemprop === 'name')[0];
    return clip(cleanText(nm ? propValue(nm, base) : propValue(authorNode, base)), 120);
  })() : undefined;
  const imageRaw = first('image');
  const imageUrl = imageRaw ? absoluteHttp(imageRaw, base) : undefined;
  const prep = parseDurationMinutes(first('prepTime'));
  const cook = parseDurationMinutes(first('cookTime'));
  const total = parseDurationMinutes(first('totalTime'));
  const servings = parseYield(first('recipeYield'));
  const description = clip(cleanText(first('description') ?? ''), 600);
  const category = first('recipeCategory');
  const cuisine = first('recipeCuisine');
  return {
    via: 'microdata',
    name: clip(cleanText(first('name') ?? ''), 160),
    ...(description ? { description } : {}),
    ingredients: ingredients.map((s) => clip(s, 300)),
    steps: dedupedSteps.map((s) => clip(s, 1500)).slice(0, MAX_STEPS),
    ...(servings !== undefined ? { servings } : {}),
    ...(prep !== undefined ? { prepMinutes: prep } : {}),
    ...(cook !== undefined ? { cookMinutes: cook } : {}),
    ...(total !== undefined ? { totalMinutes: total } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(author ? { author } : {}),
    keywords: [...new Set([...keywordList(first('keywords')), ...keywordList(category)])].slice(0, 12),
    ...(category ? { category: clip(cleanText(category), 60) } : {}),
    ...(cuisine ? { cuisine: clip(cleanText(cuisine), 60) } : {}),
    suitableForDiet: all('suitableForDiet').map((s) => s.replace(/^.*[/#]/, '')).slice(0, 6),
  };
}

/** A recipe is usable when it has a name, at least one ingredient and at least one step. */
export const isUsable = (r: StructuredRecipe): boolean => r.name.length > 0 && r.ingredients.length > 0 && r.steps.length > 0;

/**
 * The first usable schema.org Recipe on the page: JSON-LD (including @graph and @id references), then microdata.
 * `undefined` when there is none (the caller falls back to the AI text reading).
 */
export function extractStructuredRecipe(root: HtmlNode, pageUrl: string): StructuredRecipe | undefined {
  const scripts = findAll(root, (n) => n.tag === 'script' && /ld\+json/i.test(n.attrs.type ?? ''));
  const g: Graph = { byId: new Map(), recipes: [] };
  for (const s of scripts.slice(0, 20)) {
    const raw = s.children.filter((c): c is string => typeof c === 'string').join('');
    if (raw.length > 1_500_000) continue;
    const json = parseJsonLd(raw);
    if (json !== undefined) collect(json, g);
  }
  for (const r of g.recipes) {
    const sr = fromJsonLd(r, g, pageUrl);
    if (isUsable(sr)) return sr;
  }
  for (const n of findAll(root, itemtypeIsRecipe).slice(0, 5)) {
    const sr = fromMicrodata(n, pageUrl);
    if (isUsable(sr)) return sr;
  }
  return undefined;
}

/** Title, site name, canonical link and share image from <head> (Open Graph preferred). */
export function pageMeta(root: HtmlNode, pageUrl: string): PageMeta {
  const metas = findAll(root, (n) => n.tag === 'meta');
  const meta = (key: string): string | undefined => {
    const m = metas.find((x) => (x.attrs.property ?? x.attrs.name ?? '').toLowerCase() === key);
    const v = m?.attrs.content?.trim();
    return v ? v : undefined;
  };
  const titleNode = findAll(root, (n) => n.tag === 'title')[0];
  const title = cleanText(meta('og:title') ?? (titleNode ? textOf(titleNode) : ''));
  const siteName = meta('og:site_name');
  const canonical = findAll(root, (n) => n.tag === 'link' && (n.attrs.rel ?? '').toLowerCase().split(/\s+/).includes('canonical'))[0]?.attrs.href;
  const img = meta('og:image') ?? meta('twitter:image');
  const canonicalUrl = canonical ? absoluteHttp(canonical, pageUrl) : undefined;
  const imageUrl = img ? absoluteHttp(img, pageUrl) : undefined;
  return {
    ...(title ? { title: clip(title, 200) } : {}),
    ...(siteName ? { siteName: clip(cleanText(siteName), 80) } : {}),
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}
