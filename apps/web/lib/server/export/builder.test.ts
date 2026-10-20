import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ObjectReader, ObjectRef } from '../objects/port';
import { ANOTHER_MEMBER, YOU, csvCell, exportEntries, loadExportData, redactRow, type ExportRowReader, type Row } from './builder';
import { EXCLUDED_TABLES, EXPORT_TABLES } from './tables';
import { unzip, unzipText } from './unzip';
import { zipChunks } from './zip';

const H1 = '11111111-1111-4111-8111-111111111111';
const H2 = '22222222-2222-4222-8222-222222222222';
const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const OWNER = 'aaaaaaaa-0000-4000-8000-000000000002';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000003';
const STRANGER = 'aaaaaaaa-0000-4000-8000-000000000004';
const UPLOAD = '33333333-3333-4333-8333-333333333333';

const DB: Record<string, Row[]> = {
  households: [
    { id: H1, name: 'Home', created_by: OWNER },
    { id: H2, name: 'Elsewhere', created_by: STRANGER },
  ],
  household_members: [
    { id: 'm1', household_id: H1, user_id: ME, role: 'member', display_name: 'Me', status: 'active' },
    { id: 'm2', household_id: H1, user_id: OWNER, role: 'owner', display_name: 'Olive', status: 'active' },
    { id: 'm3', household_id: H1, user_id: OTHER, role: 'member', display_name: 'Otto', status: 'active' },
    { id: 'm4', household_id: H2, user_id: STRANGER, role: 'owner', display_name: 'Stan', status: 'active' },
  ],
  person_profiles: [{ id: 'pp1', household_id: H1, user_id: OTHER, display_name: 'Otto', preferences: {} }],
  household_exclusions: [{ id: 'x1', household_id: H1, term: 'coriander', kind: 'avoid', created_by: ME, api_key: 'sk-live-secret' }],
  consent_records: [
    { id: 'c1', household_id: H1, user_id: ME, consent_type: 'allergy_data' },
    { id: 'c2', household_id: H1, user_id: OTHER, consent_type: 'allergy_data' },
  ],
  recipes: [
    { id: 'r1', household_id: H1, title: 'Soup', default_servings: 4, created_by: ME, cover_image_path: `${H1}/recipes/r1/cover.jpg`, search_tsv: "'soup'" },
    { id: 'r2', household_id: H1, title: 'Stew', default_servings: 2, created_by: OWNER, cover_image_path: null },
    { id: 'r3', household_id: H2, title: 'Secret', default_servings: 2, created_by: STRANGER },
  ],
  recipe_versions: [
    { id: 'v1', recipe_id: 'r1', household_id: H1, corrected: { imageUrl: `/api/uploads/${UPLOAD}/cover.jpg` }, source_image_paths: [`/api/uploads/${UPLOAD}/page-1.jpg`], created_by: ME },
    { id: 'v2', recipe_id: 'r2', household_id: H1, corrected: { imageUrl: 'https://www.themealdb.com/images/x.jpg' }, source_image_paths: [], created_by: OWNER },
  ],
  recipe_steps: [{ id: 's1', recipe_id: 'r1', household_id: H1, step_number: 1, instructions: '=HYPERLINK("http://evil")' }],
  recipe_ingredients: [
    { id: 'i1', recipe_id: 'r1', household_id: H1, original_text: '1 onion', position: 0 },
    { id: 'i2', recipe_id: 'r2', household_id: H1, original_text: '2 carrots', position: 0 },
  ],
  recipe_images: [{ id: 'im1', recipe_id: 'r1', household_id: H1, storage_path: `${H1}/../escape.jpg` }],
  purchase_events: [
    { id: 'p1', household_id: H1, created_by: ME, created_by_display_name: 'Me', voided_by: null },
    { id: 'p2', household_id: H1, created_by: OTHER, created_by_display_name: 'Otto', voided_by: ME },
  ],
  receipts: [{ id: 'rc1', household_id: H1, created_by: OTHER, image_paths: [`${H1}/receipts/rc1/1.jpg`] }],
  receipt_lines: [{ id: 'rl1', receipt_id: 'rc1', household_id: H1, description: 'MILK' }],
  pantry_settings: [{ household_id: H1, purchase_mode: 'ask' }],
};

/** Fake PostgREST: applies the filters AND a crude RLS (requester's households only; consents own only). */
function fakeReader(requester: string, log: string[] = []): ExportRowReader {
  const myHouseholds = new Set(DB.household_members!.filter((m) => m.user_id === requester).map((m) => m.household_id));
  return {
    async select(spec, filter) {
      log.push(spec.table);
      if (EXCLUDED_TABLES.includes(spec.table)) throw new Error(`excluded table read: ${spec.table}`);
      return (DB[spec.table] ?? []).filter((r) => {
        const hid = spec.table === 'households' ? r.id : r.household_id;
        if (!myHouseholds.has(hid)) return false; // RLS
        if (spec.table === 'consent_records' && r.user_id !== requester) return false; // RLS: own only
        for (const [k, v] of Object.entries(filter.eq)) if (r[k] !== v) return false;
        if (filter.in && !filter.in.values.includes(r[filter.in.col] as string)) return false;
        return true;
      });
    },
  };
}

const objects = (have: Set<string>): ObjectReader => ({
  async read(ref: ObjectRef) {
    const key = ref.kind === 'local' ? `local:${ref.uploadId}/${ref.file}` : `${ref.bucket}:${ref.path}`;
    return have.has(key) ? new TextEncoder().encode(`bytes of ${key}`) : null;
  },
});

describe('export builder: household scope (owner)', () => {
  it('exports the whole household, nothing from other households, never excluded tables', async () => {
    const log: string[] = [];
    const d = await loadExportData({ scope: 'household', householdId: H1, userId: OWNER, email: 'olive@example.test' }, fakeReader(OWNER, log));
    expect(d.files['recipes.json']!.recipes!.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(d.files['household.json']!.members!.map((m) => m.display_name)).toEqual(['Me', 'Olive', 'Otto']);
    expect(d.files['purchases.json']!.purchase_events).toHaveLength(2);
    expect(d.files['consents.json']!.consent_records).toEqual([]); // owner has none; others' are never visible
    expect(log.some((t) => EXCLUDED_TABLES.includes(t))).toBe(false);
    const json = JSON.stringify(d);
    expect(json).not.toContain('Secret');
    expect(json).not.toContain(STRANGER);
  });

  it('never leaks other members\' account ids, emails or secret-looking columns', async () => {
    const d = await loadExportData({ scope: 'household', householdId: H1, userId: OWNER, email: 'olive@example.test' }, fakeReader(OWNER));
    const json = JSON.stringify(d.files);
    for (const id of [ME, OTHER, STRANGER]) expect(json).not.toContain(id);
    expect(json).not.toContain('sk-live-secret');
    expect(json).not.toContain('api_key');
    expect(json).not.toContain('search_tsv');
    expect(json).not.toMatch(/@example\.test/);
    expect(d.account).toEqual({ user_id: OWNER, email: 'olive@example.test', display_name: 'Olive', role: 'owner', household_id: H1 });
    const members = d.files['household.json']!.members!;
    expect(members.map((m) => m.user_id)).toEqual([ANOTHER_MEMBER, YOU, ANOTHER_MEMBER]);
    expect(d.files['purchases.json']!.purchase_events!.find((p) => p.id === 'p2')!.voided_by).toBe(ANOTHER_MEMBER);
  });

  it('collects storage, local and receipt images; external URLs listed; traversal paths ignored', async () => {
    const d = await loadExportData({ scope: 'household', householdId: H1, userId: OWNER, email: null }, fakeReader(OWNER));
    const keys = d.images.map((r) => (r.kind === 'local' ? `local:${r.uploadId}/${r.file}` : `${r.bucket}:${r.path}`)).sort();
    expect(keys).toEqual([
      `local:${UPLOAD}/cover.jpg`,
      `local:${UPLOAD}/page-1.jpg`,
      `receipt-images:${H1}/receipts/rc1/1.jpg`,
      `recipe-images:${H1}/recipes/r1/cover.jpg`,
    ]);
    expect(d.externalImages).toEqual(['https://www.themealdb.com/images/x.jpg']);
  });
});

describe('export builder: member scope', () => {
  it('contains only what the member created or owns, plus children of those rows', async () => {
    const d = await loadExportData({ scope: 'member', householdId: H1, userId: ME, email: 'me@example.test' }, fakeReader(ME));
    expect(d.files['recipes.json']!.recipes!.map((r) => r.id)).toEqual(['r1']);
    expect(d.files['recipes.json']!.versions!.map((r) => r.id)).toEqual(['v1']);
    expect(d.files['recipes.json']!.ingredients!.map((r) => r.id)).toEqual(['i1']);
    expect(d.files['household.json']!.members!.map((m) => m.display_name)).toEqual(['Me']);
    expect(d.files['purchases.json']!.purchase_events!.map((p) => p.id)).toEqual(['p1']);
    expect(d.files['purchases.json']!.receipts).toEqual([]);
    expect(d.files['purchases.json']!.receipt_lines).toEqual([]);
    expect(d.files['consents.json']!.consent_records!.map((c) => c.id)).toEqual(['c1']);
    expect(d.files['dietary.json']!.person_profiles).toEqual([]);
    expect(d.files['pantry.json']?.pantry_settings).toBeUndefined();
    const json = JSON.stringify(d.files);
    expect(json).not.toContain('Otto');
    expect(json).not.toContain('Stew');
  });
});

describe('export archive', () => {
  it('zips README, data, csv, images and a manifest whose checksums match', async () => {
    const have = new Set([`recipe-images:${H1}/recipes/r1/cover.jpg`, `local:${UPLOAD}/cover.jpg`]);
    const { entries, summary } = exportEntries(
      { scope: 'household', householdId: H1, userId: OWNER, email: 'olive@example.test', generatedAt: new Date('2026-10-20T10:00:00Z') },
      { rows: fakeReader(OWNER), objects: objects(have) },
    );
    const parts: Uint8Array[] = [];
    for await (const c of zipChunks(entries)) parts.push(c);
    const files = unzip(Buffer.concat(parts));
    const manifest = JSON.parse(unzipText(files, 'manifest.json'));
    expect(manifest.scope).toBe('household');
    expect(manifest.generatedAt).toBe('2026-10-20T10:00:00.000Z');
    expect(manifest.counts.recipes).toBe(2);
    expect(manifest.missingImages.sort()).toEqual([`/api/uploads/${UPLOAD}/page-1.jpg`, `receipt-images/${H1}/receipts/rc1/1.jpg`]);
    expect(manifest.images.map((i: { file: string }) => i.file).sort()).toEqual([
      'images/recipe-images/recipes/r1/cover.jpg',
      `images/uploads/${UPLOAD}/cover.jpg`,
    ]);
    for (const [name, sum] of Object.entries(manifest.checksums as Record<string, string>)) {
      expect(createHash('sha256').update(files.get(name)!).digest('hex')).toBe(sum);
    }
    expect(files.has('data/account.json')).toBe(true);
    expect(unzipText(files, 'README.txt')).toContain('Scope: everything stored for your household');
    const csv = unzipText(files, 'recipes.csv');
    expect(csv).toContain(`"1. =HYPERLINK(""http://evil"")"`); // numbered, so not at cell start: inert
    expect(csv).toContain('Stew');
    expect(summary).toMatchObject({ images: 2, missingImages: 2 });
    expect(Object.keys(manifest.checksums)).toHaveLength(summary.files - 1);
  });
});

describe('row rules', () => {
  it('redacts user-reference columns and secret-looking names generically', () => {
    expect(redactRow({ id: 'x', approved_by: OTHER, linked_by: ME, user_id: null, token_hash: 'abc', keys: {}, config: {}, title: 't' }, ME)).toEqual({
      id: 'x',
      approved_by: ANOTHER_MEMBER,
      linked_by: YOU,
      user_id: null,
      title: 't',
    });
  });

  it('neutralises spreadsheet formulas in CSV cells', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
  });

  it('every export table is household-scoped and none is excluded', () => {
    for (const t of EXPORT_TABLES) expect(EXCLUDED_TABLES).not.toContain(t.table);
    expect(EXPORT_TABLES.map((t) => t.table)).not.toContain('household_ai_settings');
  });
});
