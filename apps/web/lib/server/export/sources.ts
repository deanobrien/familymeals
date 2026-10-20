import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getRecipeRepositoryFor } from '../../recipes/factory';
import { parseRecipeQuery } from '../../recipes/schema';
import type { ExportRowReader, Row, RowFilter } from './builder';
import type { TableSpec } from './tables';

const PAGE = 1000; // PostgREST default max-rows
const IN_CHUNK = 100; // keeps `in.(...)` URLs short

/**
 * Rows through the signed-in user's PostgREST client: RLS is applied by the database on every request, the filters
 * only narrow to the household / the requester. Pages with a stable order so nothing is skipped or repeated.
 */
export function supabaseExportRows(client: SupabaseClient): ExportRowReader {
  async function page(spec: TableSpec, filter: RowFilter, inValues?: string[]): Promise<Row[]> {
    const out: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = client.from(spec.table).select('*');
      for (const [k, v] of Object.entries(filter.eq)) q = q.eq(k, v);
      if (filter.in && inValues) q = q.in(filter.in.col, inValues);
      for (const c of spec.order) q = q.order(c, { ascending: true });
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw new Error(`export read failed for ${spec.table}`);
      const rows = (data ?? []) as Row[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }
  return {
    async select(spec, filter) {
      if (!filter.in) return page(spec, filter);
      const out: Row[] = [];
      for (let i = 0; i < filter.in.values.length; i += IN_CHUNK) {
        out.push(...(await page(spec, filter, filter.in.values.slice(i, i + IN_CHUNK))));
      }
      return out;
    },
  };
}

/**
 * Demo (memory) mode: only the in-memory recipe library exists, so the export holds the household row and its
 * recipes (as the app models them). Member scope has no per-user authorship in demo data, so only account details.
 */
export function memoryExportRows(household: { id: string; name: string }): ExportRowReader {
  return {
    async select(spec, filter) {
      if (spec.table === 'households') return [{ id: household.id, name: household.name }];
      if (spec.table !== 'recipes' || Object.keys(filter.eq).some((k) => k !== 'household_id')) return [];
      const repo = getRecipeRepositoryFor(household.id);
      const rows: Row[] = [];
      const base = parseRecipeQuery({});
      for (let page = 1; page <= 50; page++) {
        const res = await repo.list({ ...base, page, pageSize: 100 });
        for (const r of res.items) {
          rows.push({
            id: r.id,
            household_id: household.id,
            title: r.title,
            description: r.description,
            default_servings: r.servings,
            prep_minutes: r.prepMinutes,
            cook_minutes: r.cookMinutes,
            cuisine: r.cuisine,
            meal_type: r.mealType,
            diet_category: r.diet,
            tags: r.tags,
            image_url: r.imageUrl,
            source_url: r.sourceUrl,
            source_attribution: r.sourceAttribution,
            ingredients: r.ingredients,
            steps: r.steps,
          });
        }
        if (page >= res.pageCount) break;
      }
      return rows;
    },
  };
}
