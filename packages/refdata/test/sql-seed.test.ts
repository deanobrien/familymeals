import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSeed, PACKAGE_ROOT } from '../src/load.js';
import { ingredientsSeedSql } from '../src/sql-seed.js';

describe('supabase/seed.sql (D145)', () => {
  it('is up to date with the refdata seed (run `pnpm --filter @fr/refdata build:sql-seed`)', () => {
    const committed = readFileSync(resolve(PACKAGE_ROOT, '../../supabase/seed.sql'), 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(ingredientsSeedSql(loadSeed().ingredients));
  });

  it('quotes names safely', () => {
    const sql = ingredientsSeedSql([{ id: 'x', slug: 'gran-s', name: "gran's", category: 'other', aliases: ["o'clock"] }]);
    expect(sql).toContain("'gran''s'");
    expect(sql).toContain("'o''clock'");
    expect(sql).toContain(", null)");
  });
});
