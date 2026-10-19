/**
 * Dev aid: for each seed ingredient, list candidate CoFID foods using the cofidQuery regex alternatives
 * (top-level '|' alternatives are tried in priority order). Output is REVIEWED BY A HUMAN and the
 * confident picks are pinned in data/seed/cofid-map.json. Nothing is auto-mapped.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ds = JSON.parse(readFileSync(resolve(root, 'data/out/cofid.json'), 'utf8')) as { foods: { code: string; name: string }[] };

function splitTop(s: string): string[] {
  const out: string[] = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === '|' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.filter(Boolean);
}

const lines = readFileSync(resolve(root, 'data/seed/ingredients.tsv'), 'utf8').trim().split(/\r?\n/).slice(1);
const out: string[] = [];
for (const line of lines) {
  const parts = line.split('|');
  // fields 0-3 fixed; the rest is the query (re-joined)
  const [name] = parts;
  const query = parts.slice(4).join('|');
  const alts = splitTop(query);
  let hits: { code: string; name: string }[] = [];
  let used = '';
  for (const a of alts) {
    const re = new RegExp(a, 'i');
    hits = ds.foods.filter((f) => re.test(f.name));
    if (hits.length) { used = a; break; }
  }
  out.push(`${name} :: ${used || 'NO MATCH'}`);
  for (const h of hits.sort((a, b) => a.name.length - b.name.length).slice(0, 4)) out.push(`    ${h.code}  ${h.name}`);
}
writeFileSync(resolve(root, 'data/out/cofid-candidates.txt'), out.join('\n'));
console.log(`${lines.length} ingredients; no-match: ${out.filter((l) => l.endsWith('NO MATCH')).length}`);
