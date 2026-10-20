/** Name/value pairs of a FormData, whichever implementation the test runtime provides (RN `_parts` or standard `entries`). */
export function formParts(form: unknown): Array<[string, unknown]> {
  const f = form as { _parts?: Array<[string, unknown]>; entries?: () => Iterable<[string, unknown]> };
  if (Array.isArray(f._parts)) return f._parts;
  return f.entries ? [...f.entries()] : [];
}
