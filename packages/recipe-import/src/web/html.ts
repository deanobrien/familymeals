// A small, dependency-free, forgiving HTML reader for recipe web pages (P1-B, D370). Pure TS, client-safe.
// It builds a light element tree (enough for JSON-LD script tags, microdata and a visible-text pass for the AI fallback).
// It is NOT a conforming HTML parser and never executes or fetches anything. Hostile input is bounded: node and depth caps.

export interface HtmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: (HtmlNode | string)[];
  parent?: HtmlNode;
}

export interface HtmlLimits { maxNodes: number; maxDepth: number }
const DEFAULT_LIMITS: HtmlLimits = { maxNodes: 60_000, maxDepth: 200 };

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'noscript']);
/** Opening one of these closes an open <li> / <p> of the same list or paragraph level. */
const CLOSES_P = new Set(['p', 'div', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'section', 'article', 'header', 'footer', 'nav', 'form', 'pre', 'blockquote']);

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'",
  rdquo: '"', ldquo: '"', deg: '°', frac12: '½', frac14: '¼', frac34: '¾', times: 'x', eacute: 'é',
  egrave: 'è', agrave: 'à', ccedil: 'ç', ntilde: 'ñ', ocirc: 'ô', uuml: 'ü', ouml: 'ö',
  auml: 'ä', pound: '£', euro: '€', bull: '-', middot: '-', reg: '', trade: '', copy: '', shy: '', zwnj: '', zwj: '',
};

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]{1,8});/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      try { return String.fromCodePoint(code) === ' ' ? ' ' : String.fromCodePoint(code); } catch { return ''; }
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

const ATTR_RX = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RX.lastIndex = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = ATTR_RX.exec(src)) && n++ < 60) {
    const k = m[1]!.toLowerCase();
    if (!(k in out)) out[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

export function parseHtml(html: string, limits: Partial<HtmlLimits> = {}): HtmlNode {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const root: HtmlNode = { tag: '#root', attrs: {}, children: [] };
  let cur = root;
  let depth = 0;
  let nodes = 0;
  let i = 0;
  const n = html.length;

  const text = (t: string) => { if (t) cur.children.push(t); };
  const closeTo = (tag: string): boolean => {
    for (let c: HtmlNode | undefined = cur; c && c !== root; c = c.parent) {
      if (c.tag === tag) {
        while (cur !== c) { cur = cur.parent!; depth--; }
        cur = c.parent ?? root; depth--;
        return true;
      }
    }
    return false;
  };

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { text(html.slice(i)); break; }
    if (lt > i) text(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', lt)) {
      const end = html.indexOf(']]>', lt + 9);
      text(html.slice(lt + 9, end === -1 ? n : end));
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt + 2);
      const name = html.slice(lt + 2, end === -1 ? n : end).trim().split(/\s/)[0]!.toLowerCase();
      if (name) closeTo(name);
      i = end === -1 ? n : end + 1;
      continue;
    }
    const m = /^<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/.exec(html.slice(lt, lt + 8192));
    if (!m) { text('<'); i = lt + 1; continue; }
    const tag = m[1]!.toLowerCase();
    const attrSrc = m[2]!;
    const selfClose = attrSrc.endsWith('/');
    i = lt + m[0].length;
    if (++nodes > lim.maxNodes) break;

    // Implied end tags for the common unclosed cases.
    if (tag === 'li') {
      for (let c: HtmlNode | undefined = cur; c && c !== root; c = c.parent) {
        if (c.tag === 'li') { closeTo('li'); break; }
        if (c.tag === 'ul' || c.tag === 'ol') break;
      }
    } else if (CLOSES_P.has(tag) && cur.tag === 'p') closeTo('p');

    const node: HtmlNode = { tag, attrs: parseAttrs(attrSrc), children: [], parent: cur };
    cur.children.push(node);
    if (VOID.has(tag) || selfClose) continue;
    if (RAW_TEXT.has(tag)) {
      const re = new RegExp(`</${tag}\\s*>`, 'i');
      const rest = html.slice(i);
      const e = re.exec(rest);
      const body = e ? rest.slice(0, e.index) : rest;
      if (body) node.children.push(body);
      i += e ? e.index + e[0].length : rest.length;
      continue;
    }
    if (depth + 1 > lim.maxDepth) continue; // too deep: keep the node as a leaf, do not descend
    cur = node;
    depth++;
  }
  return root;
}

export function walk(node: HtmlNode, visit: (n: HtmlNode) => boolean | void): void {
  const stack: HtmlNode[] = [node];
  while (stack.length) {
    const n = stack.pop()!;
    if (visit(n) === false) continue;
    for (let k = n.children.length - 1; k >= 0; k--) {
      const c = n.children[k]!;
      if (typeof c !== 'string') stack.push(c);
    }
  }
}

export function findAll(node: HtmlNode, pred: (n: HtmlNode) => boolean): HtmlNode[] {
  const out: HtmlNode[] = [];
  walk(node, (n) => { if (pred(n)) out.push(n); });
  return out;
}

const SKIP_TEXT = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'head']);

/** Concatenated text of a node (scripts and styles skipped), entities decoded, whitespace collapsed. */
export function textOf(node: HtmlNode): string {
  const parts: string[] = [];
  const rec = (n: HtmlNode) => {
    for (const c of n.children) {
      if (typeof c === 'string') parts.push(c);
      else if (!SKIP_TEXT.has(c.tag)) { if (c.tag === 'br') parts.push(' '); rec(c); }
    }
  };
  rec(node);
  return decodeEntities(parts.join('')).replace(/\s+/g, ' ').trim();
}

const NOISE = new Set(['nav', 'header', 'footer', 'aside', 'form', 'button', 'select', 'dialog', 'menu']);
const BLOCK = new Set([
  'p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'main', 'br', 'tr', 'table', 'dt', 'dd', 'blockquote', 'pre',
]);

/**
 * The page's readable text, one block per line, for the AI fallback: scripts, navigation, headers/footers, forms and
 * hidden elements dropped; <main> or the biggest <article> preferred. Capped to `maxChars`.
 */
export function visibleText(root: HtmlNode, maxChars = 20_000): string {
  const mains = findAll(root, (n) => n.tag === 'main' || n.tag === 'article');
  let scope: HtmlNode = findAll(root, (n) => n.tag === 'body')[0] ?? root;
  if (mains.length) {
    scope = mains.reduce((best, c) => (textOf(c).length > textOf(best).length ? c : best));
  }
  const lines: string[] = [];
  let line = '';
  const flush = () => { const t = decodeEntities(line).replace(/\s+/g, ' ').trim(); if (t) lines.push(t); line = ''; };
  const rec = (n: HtmlNode) => {
    for (const c of n.children) {
      if (typeof c === 'string') { line += c; continue; }
      if (SKIP_TEXT.has(c.tag) || (NOISE.has(c.tag) && scope.tag !== c.tag) || c.attrs.hidden !== undefined || c.attrs['aria-hidden'] === 'true') continue;
      const block = BLOCK.has(c.tag);
      if (block) flush();
      rec(c);
      if (block) flush();
    }
  };
  rec(scope);
  flush();
  let out = '';
  for (const l of lines) {
    if (out.length + l.length + 1 > maxChars) break;
    out += (out ? '\n' : '') + l;
  }
  return out;
}
