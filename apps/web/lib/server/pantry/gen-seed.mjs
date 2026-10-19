// Regenerates data/recipes.json from e2e fixtures, resolving ingredient ids against @fr/refdata data/out/ingredients.json.
// (The ingredient catalogue itself is no longer snapshotted: see lib/server/refdata/catalogue.ts.)
// Run: node apps/web/lib/server/pantry/gen-seed.mjs   (the drift test fails if these are stale)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../..');
const ing = JSON.parse(readFileSync(resolve(root, 'packages/refdata/data/out/ingredients.json'), 'utf8'));
const slim = ing.map((i) => ({ id: i.id, name: i.name, category: i.category, aliases: i.aliases }));

// Hand-maintained fixes so fixture lines resolve to canonical ingredients.
const MANUAL = {
  onions: 'onion',
  'tinned chopped tomatoes': 'chopped tomatoes',
  'floury potatoes': 'potato',
  'red peppers': 'red pepper',
};
const norm = (s) => s.toLowerCase().trim();
const byName = new Map();
for (const i of slim) {
  byName.set(norm(i.name), i);
  for (const a of i.aliases) if (!byName.has(norm(a))) byName.set(norm(a), i);
}
function resolveName(n) {
  const k = norm(n);
  const cands = [k, MANUAL[k], k.replace(/ies$/, 'y'), k.replace(/es$/, ''), k.replace(/s$/, '')].filter(Boolean);
  for (const c of cands) if (byName.has(c)) return byName.get(c);
  return undefined;
}
const dir = resolve(root, 'e2e/fixtures/recipes');
const recipes = readdirSync(dir)
  .filter((f) => f.endsWith('.expected.json'))
  .sort()
  .map((f) => {
    const r = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
    return {
      id: 'fx-' + f.replace('.expected.json', ''),
      title: r.expected.title,
      lines: r.expected.ingredients.map((g) => {
        const m = resolveName(g.name);
        return { ...(m ? { ingredientId: m.id } : {}), displayName: g.name, quantity: g.quantity, optional: !!g.optional };
      }),
    };
  });
writeFileSync(resolve(here, 'data/recipes.json'), JSON.stringify(recipes, null, 1) + '\n');
for (const r of recipes) {
  console.log(r.title, '| unresolved:', r.lines.filter((l) => !l.ingredientId).map((l) => l.displayName).join(', '));
}
