import { z } from 'zod';

/**
 * OpenAI "strict" structured outputs accept only a subset of JSON Schema: every property must be listed
 * in `required`, objects must set `additionalProperties: false`, open-ended maps are not allowed and most
 * validation keywords are rejected. This converts one of our zod schemas into that subset and returns a
 * `decode` that turns the model's answer back into the shape the zod schema expects (optional properties
 * that came back as null are dropped; map-entry arrays become records again). zod stays the source of truth:
 * the decoded value is always validated by the original schema afterwards.
 */
export interface StrictSchema {
  schema: Record<string, unknown>;
  decode: (value: unknown) => unknown;
}

const DROP_KEYS = new Set([
  '$schema', 'default', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'propertyNames', 'examples', 'title',
]);

type Node = Record<string, any>;
type Conv = { out: Node; dec: (v: unknown) => unknown };

const identity = (v: unknown) => v;

function isObjectNode(n: Node): boolean {
  return n.type === 'object' || n.properties !== undefined;
}

function convert(node: Node): Conv {
  if (typeof node !== 'object' || node === null) return { out: node, dec: identity };

  // Unions (incl. nullable): convert each branch; decode by structural guess (null passes through).
  for (const key of ['anyOf', 'oneOf'] as const) {
    if (Array.isArray(node[key])) {
      const branches = (node[key] as Node[]).map(convert);
      const out: Node = { anyOf: branches.map((b) => b.out) };
      if (node.description) out.description = node.description;
      const idx = (node[key] as Node[]).map((_, i) => i).filter((i) => (node[key] as Node[])[i]?.type !== 'null');
      const nonNull = idx.map((i) => branches[i]!);
      const dec = (v: unknown) => {
        if (v === null) return null;
        if (nonNull.length === 1) return nonNull[0]!.dec(v);
        // Several object branches (e.g. {fraction} | {count} | {min?, max?}): decode with the branch that declares
        // every key the model filled in, so null "optional" keys of that branch are dropped.
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const filled = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null).map(([k]) => k);
          const match = idx.find((i) => {
            const props = (node[key] as Node[])[i]!.properties as Record<string, unknown> | undefined;
            return props !== undefined && filled.every((k) => k in props);
          });
          if (match !== undefined) return branches[match]!.dec(v);
        }
        return v;
      };
      return { out, dec };
    }
  }

  // Open-ended map (z.record) -> array of {key, value} entries.
  if (isObjectNode(node) && node.properties === undefined && typeof node.additionalProperties === 'object' && node.additionalProperties !== null) {
    const value = convert(node.additionalProperties);
    const out: Node = {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, value: value.out },
        required: ['key', 'value'],
        additionalProperties: false,
      },
    };
    if (node.description) out.description = node.description;
    const dec = (v: unknown) => {
      if (!Array.isArray(v)) return v;
      const rec: Record<string, unknown> = {};
      for (const e of v) if (e && typeof e === 'object' && typeof (e as any).key === 'string') rec[(e as any).key] = value.dec((e as any).value);
      return rec;
    };
    return { out, dec };
  }

  if (isObjectNode(node)) {
    const props = (node.properties ?? {}) as Record<string, Node>;
    const required = new Set<string>(node.required ?? []);
    const outProps: Record<string, Node> = {};
    const decs: Record<string, (v: unknown) => unknown> = {};
    for (const [k, sub] of Object.entries(props)) {
      const c = convert(sub);
      decs[k] = c.dec;
      // Optional -> required-but-nullable.
      outProps[k] = required.has(k) ? c.out : { anyOf: [c.out, { type: 'null' }] };
    }
    const out: Node = { type: 'object', properties: outProps, required: Object.keys(outProps), additionalProperties: false };
    if (node.description) out.description = node.description;
    const dec = (v: unknown) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
      const src = v as Record<string, unknown>;
      const res: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(src)) {
        if (!(k in props)) continue;
        if (val === null && !required.has(k)) continue; // was optional, model said null
        res[k] = decs[k]!(val);
      }
      return res;
    };
    return { out, dec };
  }

  if (node.type === 'array' && node.items) {
    const item = convert(node.items);
    const out: Node = { type: 'array', items: item.out };
    if (node.description) out.description = node.description;
    return { out, dec: (v) => (Array.isArray(v) ? v.map(item.dec) : v) };
  }

  const out: Node = {};
  for (const [k, v] of Object.entries(node)) if (!DROP_KEYS.has(k)) out[k] = v;
  return { out, dec: identity };
}

export function toStrictSchema(schema: z.ZodType): StrictSchema {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Node;
  const { out, dec } = convert(json);
  return { schema: out, decode: dec };
}

/** Plain (non-strict) JSON schema text, used to describe the shape in the prompt of json_object fallbacks. */
export function jsonSchemaText(schema: z.ZodType): string {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Node;
  const strip = (n: any): any => {
    if (Array.isArray(n)) return n.map(strip);
    if (n && typeof n === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n)) if (k !== '$schema' && k !== 'additionalProperties') o[k] = strip(v);
      return o;
    }
    return n;
  };
  return JSON.stringify(strip(json));
}
