import { z } from 'zod';
import {
  NUTRIENT_KEYS, NUTRIENT_UNITS, NutrientKeySchema, NutrientUnitSchema, ValueStatusSchema,
  type NutrientKey, type ValueStatus,
} from './nutrients.js';

/**
 * CoFID cell semantics (CoFID 2021 "Notes" sheet):
 *   number   -> measured / calculated value
 *   (number) -> estimated / imputed value (brackets)
 *   'Tr'     -> trace: present but below the quantification limit
 *   'N'      -> present in significant amount but not known (NOT zero)
 *   blank    -> not applicable / not reported
 *
 * Mapping to ValueStatus (never present unknown as zero - BRIEF section 11):
 *   number > 0       -> known, estimate=false
 *   number == 0      -> zero
 *   (number)         -> known/zero, estimate=true
 *   'Tr'             -> known, value 0, estimate=true, trace=true. Rule: a trace is a real but
 *                       negligible amount, so it contributes 0 to sums but is flagged estimate,
 *                       and is deliberately NOT status 'zero'.
 *   'N'              -> unknown (consumers must surface incompleteness)
 *   blank/other      -> unavailable
 */
export interface ParsedCell { status: ValueStatus; value?: number; estimate: boolean; trace?: boolean }

export function parseCofidCell(raw: unknown): ParsedCell {
  if (raw === null || raw === undefined) return { status: 'unavailable', estimate: false };
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { status: 'unavailable', estimate: false };
    return raw === 0 ? { status: 'zero', value: 0, estimate: false } : { status: 'known', value: raw, estimate: false };
  }
  const s = String(raw).trim();
  if (s === '') return { status: 'unavailable', estimate: false };
  if (/^tr$/i.test(s)) return { status: 'known', value: 0, estimate: true, trace: true };
  if (/^n$/i.test(s)) return { status: 'unknown', estimate: false };
  const m = /^\((-?\d+(?:\.\d+)?)\)$/.exec(s);
  if (m) {
    const v = Number(m[1]);
    return v === 0 ? { status: 'zero', value: 0, estimate: true } : { status: 'known', value: v, estimate: true };
  }
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return parseCofidCell(Number(s));
  return { status: 'unavailable', estimate: false };
}

export const CofidNutrientSchema = z.object({
  nutrient: NutrientKeySchema,
  status: ValueStatusSchema,
  value: z.number().nonnegative().optional(),
  unit: NutrientUnitSchema,
  estimate: z.boolean(),
  trace: z.boolean().optional(),
  derived: z.string().optional(),
}).superRefine((n, ctx) => {
  if (n.unit !== NUTRIENT_UNITS[n.nutrient]) ctx.addIssue({ code: 'custom', message: `bad unit ${n.unit} for ${n.nutrient}` });
  if ((n.status === 'known' || n.status === 'zero') && n.value === undefined) ctx.addIssue({ code: 'custom', message: 'value required' });
  if ((n.status === 'unknown' || n.status === 'unavailable') && n.value !== undefined) ctx.addIssue({ code: 'custom', message: 'no value when unknown/unavailable' });
  if (n.status === 'zero' && n.value !== 0) ctx.addIssue({ code: 'custom', message: 'zero must be 0' });
});

export const CofidFoodSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  group: z.string().optional(),
  /** True when the source dataset reuses this code for more than one food (a CoFID 2021 data error). Do not map to these. */
  duplicateCode: z.boolean().optional(),
  nutrients: z.array(CofidNutrientSchema).length(NUTRIENT_KEYS.length),
});
export type CofidFood = z.infer<typeof CofidFoodSchema>;

export const CofidDatasetSchema = z.object({
  source: z.object({
    name: z.string(), url: z.string().url(), version: z.string(), licence: z.string(), basis: z.literal('per_100g_edible_portion'),
  }),
  foods: z.array(CofidFoodSchema).min(1),
});
export type CofidDataset = z.infer<typeof CofidDatasetSchema>;

/** CoFID column mnemonics (row 2 of the sheet) feeding each contract nutrient. */
export const PROXIMATE_COLUMNS = {
  energy_kcal: 'KCALS', energy_kj: 'KJ', protein: 'PROT', carbohydrate: 'CHO',
  sugars: 'TOTSUG', fat: 'FAT', saturates: 'SATFOD',
} as const;
/** Fibre: AOAC (current UK labelling definition) preferred; NSP (older Englyst) as fallback. */
export const FIBRE_PRIMARY = 'AOACFIB';
export const FIBRE_FALLBACK = 'ENGFIB';
export const SODIUM_COLUMN = 'NA';

/** Build mnemonic->column index from a CoFID sheet's 2D array (row0 headers, row1 mnemonics, row2 labels, data after). */
export function colIndex(sheet: unknown[][]): Map<string, number> {
  const m = new Map<string, number>();
  (sheet[1] ?? []).forEach((c, i) => { if (typeof c === 'string' && c.trim()) m.set(c.trim(), i); });
  return m;
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}
function round(n: number, dp: number) { const f = 10 ** dp; return Math.round(n * f) / f; }

export function buildFoods(proximates: unknown[][], inorganics: unknown[][]): CofidFood[] {
  const pIdx = colIndex(proximates);
  const iIdx = colIndex(inorganics);
  const need = (idx: Map<string, number>, k: string) => {
    const v = idx.get(k);
    if (v === undefined) throw new Error(`CoFID column ${k} not found - sheet layout changed?`);
    return v;
  };
  const sodiumCol = need(iIdx, SODIUM_COLUMN);
  const sodiumByCode = new Map<string, unknown>();
  for (const r of inorganics.slice(3)) { const c = str(r[0]); if (c) sodiumByCode.set(c, r[sodiumCol]); }

  const foods: CofidFood[] = [];
  for (const r of proximates.slice(3)) {
    const code = str(r[0]);
    const name = str(r[1]);
    if (!code || !name) continue;
    const nutrients: CofidFood['nutrients'] = [];
    const push = (nutrient: NutrientKey, p: ParsedCell, derived?: string) =>
      nutrients.push({
        nutrient, status: p.status, ...(p.value !== undefined ? { value: p.value } : {}),
        unit: NUTRIENT_UNITS[nutrient], estimate: p.estimate,
        ...(p.trace ? { trace: true } : {}), ...(derived ? { derived } : {}),
      });

    for (const [k, mn] of Object.entries(PROXIMATE_COLUMNS)) push(k as NutrientKey, parseCofidCell(r[need(pIdx, mn)]));

    let fibre = parseCofidCell(r[need(pIdx, FIBRE_PRIMARY)]);
    let fibreDerived: string | undefined;
    if (fibre.status === 'unavailable' || fibre.status === 'unknown') {
      const nsp = parseCofidCell(r[need(pIdx, FIBRE_FALLBACK)]);
      if (nsp.status === 'known' || nsp.status === 'zero') { fibre = { ...nsp, estimate: true }; fibreDerived = 'NSP fibre (AOAC not reported)'; }
      else if (nsp.status === 'unknown') fibre = { status: 'unknown', estimate: false };
    }
    push('fibre', fibre, fibreDerived);

    const na = parseCofidCell(sodiumByCode.get(code));
    // salt (g) = sodium (mg) x 2.5 / 1000 (UK/EU labelling convention); inherits uncertainty from sodium.
    const salt: ParsedCell = na.value !== undefined ? { ...na, value: round(na.value * 2.5 / 1000, 3) } : na;
    push('salt', salt, na.value !== undefined ? 'sodium_mg*2.5/1000' : undefined);
    push('sodium', na);

    foods.push({
      code, name,
      ...(str(r[2]) ? { description: str(r[2]) } : {}),
      ...(str(r[3]) ? { group: str(r[3]) } : {}),
      nutrients,
    });
  }
  const seen = new Map<string, number>();
  for (const f of foods) seen.set(f.code, (seen.get(f.code) ?? 0) + 1);
  return foods.map((f) => (seen.get(f.code)! > 1 ? { ...f, duplicateCode: true } : f));
}

export const COFID_SOURCE = {
  name: "McCance and Widdowson's Composition of Foods Integrated Dataset (CoFID)",
  url: 'https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid',
  version: '2021 update (published 19 March 2021)',
  licence: 'Open Government Licence v3.0',
  basis: 'per_100g_edible_portion',
} as const;
