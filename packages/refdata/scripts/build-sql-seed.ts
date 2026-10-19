// Writes supabase/seed.sql (reference ingredients + aliases, D145) from the refdata seed.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadSeed, PACKAGE_ROOT } from '../src/load.js';
import { ingredientsSeedSql } from '../src/sql-seed.js';

const { ingredients } = loadSeed();
const out = resolve(PACKAGE_ROOT, '../../supabase/seed.sql');
writeFileSync(out, ingredientsSeedSql(ingredients));
console.log(`wrote ${out} (${ingredients.length} ingredients)`);
