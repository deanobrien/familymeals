import { createHash } from 'node:crypto';
import { archivePathFor, parseObjectRef, refKey, type ObjectReader, type ObjectRef, type StorageBucket } from '../objects/port';
import {
  DROPPED_COLUMNS,
  EXPORT_TABLES,
  SCHEMA_VERSION,
  SECRET_COLUMN_RE,
  isUserRefColumn,
  type ExportScope,
  type RowSource,
  type TableSpec,
} from './tables';
import type { ZipEntry } from './zip';

/**
 * Builds a data export archive (DX1, D250/D251). Pure orchestration over two ports:
 *  - ExportRowReader: table rows (Supabase: the signed-in user's PostgREST client, so RLS applies)
 *  - ObjectReader: image bytes (Supabase Storage and/or the legacy local photo store)
 * Output is a lazy sequence of zip entries (README, data/*.json, recipes.csv, images/**, manifest.json last).
 */
export type Row = Record<string, unknown>;

export interface RowFilter {
  eq: Record<string, string>;
  in?: { col: string; values: string[] };
}

export interface ExportRowReader {
  select(spec: TableSpec, filter: RowFilter): Promise<Row[]>;
}

export interface ExportRequest {
  scope: ExportScope;
  householdId: string;
  userId: string;
  /** The requester's own email (from the verified session). Never anyone else's. */
  email: string | null;
  generatedAt?: Date;
  /** 'supabase' | 'mock' — recorded in the README so a demo export is not mistaken for real data. */
  mode?: string;
}

export interface ExportData {
  files: Record<string, Record<string, Row[]>>;
  account: Row;
  counts: Record<string, number>;
  images: ObjectRef[];
  externalImages: string[];
}

export const YOU = 'you';
export const ANOTHER_MEMBER = 'another member';

/** Applies the column rules to one row: derived/secret columns dropped, user ids anonymised. */
export function redactRow(row: Row, userId: string): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (DROPPED_COLUMNS.has(k) || SECRET_COLUMN_RE.test(k)) continue;
    if (isUserRefColumn(k) && typeof v === 'string') {
      out[k] = v === userId ? YOU : ANOTHER_MEMBER;
      continue;
    }
    out[k] = v;
  }
  return out;
}

function sourceFor(spec: TableSpec, scope: ExportScope): RowSource | null {
  return scope === 'household' ? spec.household : spec.member;
}

async function loadTable(
  reader: ExportRowReader,
  spec: TableSpec,
  source: RowSource,
  req: ExportRequest,
  loaded: Map<string, Row[]>,
): Promise<Row[]> {
  switch (source.kind) {
    case 'household-row':
      return reader.select(spec, { eq: { id: req.householdId } });
    case 'household':
      return reader.select(spec, { eq: { household_id: req.householdId } });
    case 'self':
      return reader.select(spec, { eq: { household_id: req.householdId, [source.col]: req.userId } });
    case 'child': {
      const parents = loaded.get(source.parent) ?? [];
      const field = source.field ?? 'id';
      const values = [...new Set(parents.map((r) => r[field]).filter((x): x is string => typeof x === 'string'))];
      if (values.length === 0) return [];
      return reader.select(spec, { eq: { household_id: req.householdId }, in: { col: source.col, values } });
    }
  }
}

function collectImages(loaded: Map<string, Row[]>, householdId: string): { refs: ObjectRef[]; external: string[] } {
  const refs = new Map<string, ObjectRef>();
  const external = new Set<string>();
  const add = (value: unknown, bucket: StorageBucket) => {
    if (typeof value !== 'string' || !value) return;
    const ref = parseObjectRef(value, householdId, bucket);
    if (ref) refs.set(refKey(ref), ref);
    else if (/^https?:\/\//i.test(value)) external.add(value);
  };
  for (const r of loaded.get('recipe_images') ?? []) add(r.storage_path, 'recipe-images');
  for (const r of loaded.get('recipes') ?? []) {
    add(r.cover_image_path, 'recipe-images');
    add(r.image_url, 'recipe-images'); // memory-mode rows
  }
  for (const r of loaded.get('recipe_versions') ?? []) {
    const corrected = r.corrected as { imageUrl?: unknown } | null | undefined;
    add(corrected?.imageUrl, 'recipe-images');
    for (const p of (r.source_image_paths as unknown[] | undefined) ?? []) add(p, 'recipe-images');
  }
  for (const r of loaded.get('receipts') ?? []) {
    for (const p of (r.image_paths as unknown[] | undefined) ?? []) add(p, 'receipt-images');
  }
  return { refs: [...refs.values()], external: [...external].sort() };
}

/** Loads and redacts every table for the request's scope. */
export async function loadExportData(req: ExportRequest, reader: ExportRowReader): Promise<ExportData> {
  const loaded = new Map<string, Row[]>();
  const files: Record<string, Record<string, Row[]>> = {};
  const counts: Record<string, number> = {};
  for (const spec of EXPORT_TABLES) {
    const source = sourceFor(spec, req.scope);
    if (!source) continue;
    const rows = await loadTable(reader, spec, source, req, loaded);
    loaded.set(spec.table, rows);
    (files[spec.file] ??= {})[spec.key] = rows.map((r) => redactRow(r, req.userId));
    counts[spec.table] = rows.length;
  }
  const me = (loaded.get('household_members') ?? []).find((m) => m.user_id === req.userId);
  const account: Row = {
    user_id: req.userId,
    email: req.email,
    display_name: typeof me?.display_name === 'string' ? me.display_name : null,
    role: typeof me?.role === 'string' ? me.role : null,
    household_id: req.householdId,
  };
  const { refs, external } = collectImages(loaded, req.householdId);
  return { files, account, counts, images: refs, externalImages: external };
}

const CSV_FORMULA = /^[=+\-@\t\r]/;
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (CSV_FORMULA.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Flat convenience copy: one line per recipe (title, servings, times, ingredients, method). */
export function recipesCsv(data: ExportData): string {
  const r = data.files['recipes.json'] ?? {};
  const byRecipe = <T>(rows: Row[] | undefined, pick: (x: Row) => T) => {
    const m = new Map<string, T[]>();
    for (const x of rows ?? []) {
      const id = x.recipe_id;
      if (typeof id === 'string') (m.get(id) ?? m.set(id, []).get(id)!).push(pick(x));
    }
    return m;
  };
  const ingredients = byRecipe(
    [...(r.ingredients ?? [])].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0)),
    (x) => String(x.original_text ?? x.display_name ?? ''),
  );
  const steps = byRecipe(
    [...(r.steps ?? [])].sort((a, b) => Number(a.step_number ?? 0) - Number(b.step_number ?? 0)),
    (x) => String(x.instructions ?? ''),
  );
  const lines = [['id', 'title', 'servings', 'prep_minutes', 'cook_minutes', 'ingredients', 'method'].join(',')];
  for (const rec of r.recipes ?? []) {
    const id = String(rec.id ?? '');
    const nestedIngredients = Array.isArray(rec.ingredients)
      ? (rec.ingredients as { name?: string; quantity?: { originalText?: string } }[]).map((l) => l.quantity?.originalText || l.name || '')
      : undefined;
    const nestedSteps = Array.isArray(rec.steps) ? (rec.steps as { text?: string }[]).map((s) => s.text ?? '') : undefined;
    lines.push(
      [
        id,
        rec.title,
        rec.default_servings ?? rec.servings,
        rec.prep_minutes,
        rec.cook_minutes,
        (nestedIngredients ?? ingredients.get(id) ?? []).join('\n'),
        (nestedSteps ?? steps.get(id) ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n'),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

function readme(req: ExportRequest, generatedAt: string): string {
  const scope =
    req.scope === 'household'
      ? 'everything stored for your household (you are an owner)'
      : 'your own data in this household: things you created or recorded, your profile, consents, favourites and ratings';
  return [
    'Family Recipes - data export',
    '',
    `Generated: ${generatedAt} (UTC)`,
    `Scope: ${scope}`,
    `Schema version: ${SCHEMA_VERSION}${req.mode === 'mock' ? '\nNOTE: demo mode - this export contains demo data only.' : ''}`,
    '',
    'Contents',
    '  data/account.json        your account (your email only)',
    '  data/household.json      household settings and members (display names and roles only)',
    '  data/recipes.json        recipes, versions, steps, ingredients, images, tags, your favourites, ratings, nutrition',
    '  data/meal_plans.json     meal plans and planned meals',
    '  data/shopping_lists.json shopping lists, items and where each item came from',
    '  data/purchases.json      purchase history, receipts and receipt lines',
    '  data/pantry.json         pantry items and settings',
    '  data/prices.json         prices and product packs your household recorded',
    '  data/spending.json       spending entries you added by hand and which store each receipt shop is linked to',
    '  data/dietary.json        foods to avoid and person profiles',
    '  data/consents.json       your consent records',
    '  data/ai_usage.json       amount of AI use (never the content)',
    '  recipes.csv              one line per recipe, for spreadsheets',
    '  images/                  recipe photos and receipt images',
    '  manifest.json            file list with SHA-256 checksums and row counts',
    '',
    'Format: JSON (UTF-8), timestamps are ISO-8601 UTC, money is integer pence. Ids are UUIDs so rows can be linked.',
    'Other people\'s account ids and email addresses are never included: columns that name a person show "you" or',
    '"another member". Not included: AI provider keys, invitations, internal logs.',
    '',
  ].join('\n');
}

export interface ExportSummary {
  counts: Record<string, number>;
  images: number;
  missingImages: number;
  files: number;
}

/**
 * Lazy archive entries. `summary` is filled while iterating (complete once the iterator finishes), for the audit row.
 */
export function exportEntries(
  req: ExportRequest,
  deps: { rows: ExportRowReader; objects: ObjectReader },
): { entries: AsyncIterable<ZipEntry>; summary: ExportSummary } {
  const summary: ExportSummary = { counts: {}, images: 0, missingImages: 0, files: 0 };
  async function* gen(): AsyncGenerator<ZipEntry> {
    const generatedAt = (req.generatedAt ?? new Date()).toISOString();
    const data = await loadExportData(req, deps.rows);
    summary.counts = data.counts;
    const checksums: Record<string, string> = {};
    const emit = (name: string, body: string | Uint8Array): ZipEntry => {
      checksums[name] = createHash('sha256').update(body).digest('hex');
      summary.files += 1;
      return { name, data: body };
    };
    yield emit('README.txt', readme(req, generatedAt));
    yield emit('data/account.json', JSON.stringify(data.account, null, 2));
    for (const [file, groups] of Object.entries(data.files)) {
      yield emit(`data/${file}`, JSON.stringify(groups, null, 2));
    }
    yield emit('recipes.csv', recipesCsv(data));
    const imageIndex: { file: string; source: string }[] = [];
    const missing: string[] = [];
    for (const ref of data.images) {
      const bytes = await deps.objects.read(ref);
      const source = ref.kind === 'local' ? `/api/uploads/${ref.uploadId}/${ref.file}` : `${ref.bucket}/${ref.path}`;
      if (!bytes) {
        missing.push(source);
        continue;
      }
      const file = archivePathFor(ref, req.householdId);
      imageIndex.push({ file, source });
      summary.images += 1;
      yield emit(file, bytes);
    }
    summary.missingImages = missing.length;
    const manifest = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt,
      scope: req.scope,
      householdId: req.householdId,
      counts: data.counts,
      images: imageIndex,
      missingImages: missing,
      externalImages: data.externalImages,
      checksums,
    };
    summary.files += 1;
    yield { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) };
  }
  return { entries: gen(), summary };
}
