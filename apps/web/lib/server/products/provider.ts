import 'server-only';
import { MockProductSource, OpenFoodFactsSource, type ProductSource } from '@fr/product-sources';
import { getIngredientCatalogue } from '../refdata/catalogue';

/**
 * Which product source this process uses (D180-D181):
 *   PRODUCT_PROVIDER=off  -> Open Food Facts (live network; needs OFF_CONTACT for the User-Agent)
 *   anything else         -> the offline mock over UK fixtures (the default: dev, tests and e2e never hit the network)
 */
export interface ProductProviderInfo {
  id: string;
  isMock: boolean;
}

const KEY = Symbol.for('fr.products.source');
type G = typeof globalThis & { [KEY]?: ProductSource };

export function productProviderMode(env: Record<string, string | undefined> = process.env): 'off' | 'mock' {
  return env.PRODUCT_PROVIDER?.trim().toLowerCase() === 'off' ? 'off' : 'mock';
}

export function createProductSource(env: Record<string, string | undefined> = process.env): ProductSource {
  const cat = getIngredientCatalogue();
  const opts = { matcher: cat.matcher, nameOf: (id: string) => cat.get(id)?.name };
  return productProviderMode(env) === 'off'
    ? new OpenFoodFactsSource({ ...opts, ...(env.OFF_CONTACT ? { contact: env.OFF_CONTACT } : {}) })
    : new MockProductSource(opts);
}

export function getProductSource(): ProductSource {
  const g = globalThis as G;
  return (g[KEY] ??= createProductSource());
}

/** Tests: inject a source (or undefined to rebuild from env). */
export function setProductSourceForTests(source: ProductSource | undefined): void {
  (globalThis as G)[KEY] = source;
}

export function productProviderInfo(source: ProductSource = getProductSource()): ProductProviderInfo {
  return { id: source.id, isMock: source.id === 'mock' };
}
