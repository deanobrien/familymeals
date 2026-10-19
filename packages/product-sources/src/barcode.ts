/**
 * Barcode (GTIN) validation. Accepts EAN-8, UPC-A (12), EAN-13 and GTIN-14 with a valid GS1 check digit.
 * UPC-A is normalised to EAN-13 (leading 0), as Open Food Facts stores it.
 */

export function gtinCheckDigitOk(digits: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  // Weights 3,1,3,1... from the digit next to the check digit.
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/** The normalised code, or null when it is not a valid GTIN. Whitespace and hyphens are tolerated (manual entry). */
export function normaliseBarcode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  if (!gtinCheckDigitOk(digits)) return null;
  return digits.length === 12 ? '0' + digits : digits;
}
