/**
 * Barcode scan handling for the capture screen (X2). Pure: no React, no camera.
 * expo-camera's `onBarcodeScanned` fires many times a second for the same code, so the handler validates the code
 * (retail EAN/UPC with a good GS1 check digit, so a QR code or a misread never reaches the server), ignores repeats of
 * the same code inside a cool-down, and ignores everything while a lookup is running.
 */

/** expo-camera `barcodeTypes` for retail products. */
export const RETAIL_BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

export function gtinCheckDigitOk(digits: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/** Digits only (manual entry tolerates spaces and hyphens); null when it is not a valid GTIN. */
export function normaliseBarcode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return gtinCheckDigitOk(digits) ? digits : null;
}

export interface ScanGate {
  /** The last accepted code and when. */
  last?: { code: string; at: number };
  busy: boolean;
}

export const SAME_CODE_COOLDOWN_MS = 4000;

/** The code to look up, or null to ignore this scan event. `gate` is mutated only when a code is accepted. */
export function acceptScan(event: { data: string }, gate: ScanGate, now: number): string | null {
  if (gate.busy) return null;
  const code = normaliseBarcode(event.data);
  if (!code) return null;
  if (gate.last && gate.last.code === code && now - gate.last.at < SAME_CODE_COOLDOWN_MS) return null;
  gate.last = { code, at: now };
  return code;
}
