export * from './types';
export * from './barcode';
export { OpenFoodFactsSource, OFF_FIELDS, type OffClientOptions } from './off/client';
export {
  mapOffProduct, mapNutrition, mapAllergens, parsePackSize, suggestIngredient,
  OFF_ATTRIBUTION, OFF_PUBLISHER, OFF_LICENCE, OFF_IMAGE_LICENCE_NOTE, productPageUrl,
  type MapOptions,
} from './off/map';
export { OffProduct, OffProductResponse, OffSearchResponse } from './off/schema';
export { MockProductSource, type MockProductOptions } from './mock';
export { OFF_FIXTURES, FIXTURE_CODES } from './fixtures';
export { StoredProduct, parseStoredProduct } from './stored';
export { eanModules, renderEanGray, placeOnCanvas, grayToRgba, type RenderedBitmap, type RenderOptions } from './ean13-render';
