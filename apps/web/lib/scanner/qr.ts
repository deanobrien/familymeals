// QR code for the phone link (P3-C, D447). qrcode-generator (MIT, no dependencies) builds the module matrix; we draw it as plain SVG
// (one <path>), so nothing is injected as HTML and the strict CSP is untouched. Pure: unit-tested by decoding the result.
import qrcode from 'qrcode-generator';

/** Error correction M (15%): plenty for a screen, and keeps the code small enough to scan from across a desk. */
export function qrMatrix(value: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(value, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** Quiet zone in modules (the spec asks for 4). */
export const QUIET = 4;

/** SVG path data for the dark modules (module = 1 unit; offset by the quiet zone). */
export function qrPath(matrix: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  matrix.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) { c += 1; continue; }
      let end = c;
      while (end < row.length && row[end]) end += 1;
      parts.push(`M${c + QUIET} ${r + QUIET}h${end - c}v1h-${end - c}z`); // a run of dark modules in one rectangle
      c = end;
    }
  });
  return parts.join('');
}

export const qrViewBox = (matrix: readonly (readonly boolean[])[]): number => matrix.length + QUIET * 2;
