// Wire shapes for the pantry scan (DECISIONS D83-D84). Client-safe: plain serialisable data only.
// The server (lib/server/pantry/scan.ts) maps the @fr/ai PantryScan onto these; the browser never sees @fr/ai.

// The scan / review / commit shapes are shared with the Android app through @fr/engine/pantry (D343).
import type { ScanRowDto } from '@fr/engine/pantry';

export type {
  IngredientRef, ScanCommitRow, ScanForm, ScanMatch, ScanPackaging, ScanPreviewLine, ScanRowDto,
} from '@fr/engine/pantry';

export interface ScanProviderInfo {
  label: string;
  isMock: boolean;
  configured: boolean;
}

export interface ScanApiOk {
  rows: ScanRowDto[];
  warnings: string[];
  provider?: ScanProviderInfo;
}

export interface ScanApiError {
  error: { code: string; message: string; retryable: boolean };
}
