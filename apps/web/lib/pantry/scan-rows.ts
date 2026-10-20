// Review-row state and its pure transitions for /pantry/scan (DECISIONS D84-D88). Client-safe, no I/O.
// The logic lives in @fr/engine/pantry (scan-review.ts) so the Android app reviews scans the same way (D343-D344);
// this module pins the product type to the web's full Open Food Facts Product.
import {
  applyEstimates as engineApplyEstimates, mergeCloseUp as engineMergeCloseUp, mergeLookup as engineMergeLookup,
  nameItMyself as engineNameItMyself, rowFromDto as engineRowFromDto, rowFromProduct as engineRowFromProduct,
  rowFromRapid as engineRowFromRapid, withCount as engineWithCount, withDate as engineWithDate, withQuantity as engineWithQuantity,
  type LookupState, type ScanRow as EngineScanRow,
} from '@fr/engine/pantry';
import type { ScanRowDto } from './scan-types';
import type { Product, ProductLookupDto } from '../products/types';

export {
  confidenceTone, defaultQuantity, fmtNum, rapidKey, rowExpiry, rowName, toCommitRows,
  type CloseUpState, type CommitResult, type DateSource,
} from '@fr/engine/pantry';

export type ScanRow = EngineScanRow<Product>;

export const rowFromDto = (dto: ScanRowDto): ScanRow => engineRowFromDto<Product>(dto);
export const rowFromProduct = (lookup: ProductLookupDto, key: string): ScanRow => engineRowFromProduct(lookup, key);
export const rowFromRapid = (barcode: string, count: number, state: LookupState<ProductLookupDto> | undefined): ScanRow =>
  engineRowFromRapid(barcode, count, state);
export const mergeLookup = (row: ScanRow, state: LookupState<ProductLookupDto> | undefined): ScanRow => engineMergeLookup(row, state);
export const nameItMyself = (row: ScanRow): ScanRow => engineNameItMyself(row);
export const withCount = (row: ScanRow, count: string): ScanRow => engineWithCount(row, count);
export const withQuantity = (row: ScanRow, patch: { value?: string; unit?: string }): ScanRow => engineWithQuantity(row, patch);
export const withDate = (row: ScanRow, field: 'useBy' | 'bestBefore', value: string): ScanRow => engineWithDate(row, field, value);
export const mergeCloseUp = (row: ScanRow, result: ScanRowDto | undefined): ScanRow => engineMergeCloseUp(row, result);
export const applyEstimates = (rows: readonly ScanRow[], enabled: boolean, today: string): ScanRow[] => engineApplyEstimates(rows, enabled, today);
