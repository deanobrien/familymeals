import 'server-only';
import { MockRecipeSource, TheMealDbSource, type RecipeSource } from '@fr/recipe-sources';

/**
 * The recipe-discovery provider for this process (D170). Server only: the key is read from env and used to build
 * request URLs on the server; it never reaches the browser, the settings page or a log.
 *   RECIPE_SOURCE=mock          fixtures, no network (e2e, offline dev)
 *   THEMEALDB_API_KEY           supporter key; unset = the published test key '1' (development / educational use)
 */
export interface RecipeSourceStatus {
  provider: 'themealdb' | 'mock';
  label: string;
  keyKind: 'test' | 'supporter' | 'none';
  /** One sentence for the Settings page. Never contains the key. */
  note: string;
}

const TEST_KEY = '1';
const INJECTED = '__injected__';

function configuredKey(): string {
  return (process.env.THEMEALDB_API_KEY ?? '').trim() || TEST_KEY;
}

export function recipeSourceStatus(): RecipeSourceStatus {
  if (process.env.RECIPE_SOURCE === 'mock') {
    return { provider: 'mock', label: 'Sample recipes (offline)', keyKind: 'none', note: 'Offline sample recipes are in use; nothing is fetched from the internet.' };
  }
  const supporter = configuredKey() !== TEST_KEY;
  return {
    provider: 'themealdb',
    label: 'TheMealDB',
    keyKind: supporter ? 'supporter' : 'test',
    note: supporter
      ? 'A TheMealDB supporter key is configured on the server.'
      : "TheMealDB's free test key is in use. It is for development and educational use only; add a supporter key (THEMEALDB_API_KEY) before releasing publicly.",
  };
}

const g = globalThis as unknown as { __frRecipeSource?: { sig: string; src: RecipeSource } };

/** Process-wide provider (keeps its cache between requests). Tests inject their own through `setRecipeSource`. */
export function getRecipeSource(): RecipeSource {
  const sig = `${process.env.RECIPE_SOURCE ?? ''}|${configuredKey()}`;
  if (!g.__frRecipeSource || (g.__frRecipeSource.sig !== sig && g.__frRecipeSource.sig !== INJECTED)) {
    g.__frRecipeSource = { sig, src: process.env.RECIPE_SOURCE === 'mock' ? new MockRecipeSource() : new TheMealDbSource({ apiKey: configuredKey() }) };
  }
  return g.__frRecipeSource.src;
}

export function setRecipeSource(src: RecipeSource | undefined): void {
  g.__frRecipeSource = src ? { sig: INJECTED, src } : undefined;
}
