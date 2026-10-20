import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CONFIGURABLE_TYPES, TYPE_META } from './types';

/** Drift guard (D310 parity): the Android copy of the notification types and labels must match the web contract. */
const src = readFileSync(fileURLToPath(new URL('../../../../mobile/src/lib/notificationsApi.ts', import.meta.url)), 'utf8');
const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} as { CONFIGURABLE_TYPES: readonly string[]; TYPE_LABELS: Record<string, { label: string; hint: string }>; linkToRoute(l: string): string } };
new Function('module', 'exports', 'require', out)(mod, mod.exports, () => ({}));

describe('Android notification contract equals the web one', () => {
  it('same configurable types, same labels and hints', () => {
    expect([...mod.exports.CONFIGURABLE_TYPES]).toEqual([...CONFIGURABLE_TYPES]);
    for (const t of CONFIGURABLE_TYPES) expect(mod.exports.TYPE_LABELS[t]).toEqual({ label: TYPE_META[t].label, hint: TYPE_META[t].hint });
  });
  it('every link the server produces maps to a real app screen', () => {
    // '/notifications' is the fallback screen, so anything else mapping to it would mean "unknown link".
    for (const link of ['/pantry?item=x', '/shopping', '/plan', '/recipes/abc', '/recipes', '/household']) {
      expect(mod.exports.linkToRoute(link)).not.toBe('/notifications');
    }
  });
});
