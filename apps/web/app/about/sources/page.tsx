import s from '../../../lib/dashboard/dashboard.module.css';
import { PRODUCT_ATTRIBUTION } from '../../../lib/products/types';

export const metadata = { title: 'Data sources' };

/** Where our reference data comes from, and the licences we owe credit under (D184, D189). */
export default function SourcesPage() {
  return (
    <article className={s.prose}>
      <h1>Data sources</h1>

      <h2>Packaged products: Open Food Facts</h2>
      <p data-testid="off-attribution">
        <strong>{PRODUCT_ATTRIBUTION}.</strong> When you scan a barcode we look the product up in{' '}
        <a href="https://world.openfoodfacts.org/" target="_blank" rel="noopener noreferrer">Open Food Facts</a>, a free
        database written by volunteers. We use its product name, brand, pack size, allergens and nutrition per 100 g, and show
        a link to the product&rsquo;s own page wherever we use it.
      </p>
      <ul>
        <li>
          The database is available under the{' '}
          <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener noreferrer">Open Database Licence (ODbL)</a>{' '}
          and its individual entries under the Database Contents Licence. Product photos are shared by contributors under
          Creative Commons Attribution-ShareAlike (CC BY-SA); we show them straight from Open Food Facts and do not copy them.
        </li>
        <li>
          We keep a copy of a product&rsquo;s details (not its photo) in your household only when you confirm that item, so the
          nutrition we show stays the same later. We do not publish or redistribute that data.
        </li>
        <li>
          The data is entered by volunteers and can be wrong or out of date. <strong>Always check allergens on the pack.</strong>{' '}
          If a product has no allergen information we say so; that never means it is allergen free.
        </li>
      </ul>

      <h2>Postcode lookup: postcodes.io</h2>
      <p data-testid="postcodes-attribution">
        When you save a store&rsquo;s location from a UK postcode we look the postcode up with{' '}
        <a href="https://postcodes.io/" target="_blank" rel="noopener noreferrer">postcodes.io</a>, a free service built on
        the ONS Postcode Directory. Only the postcode is sent. Contains OS data &copy; Crown copyright and database right;
        Royal Mail data &copy; Royal Mail copyright and database right; National Statistics data &copy; Crown copyright and
        database right. Licensed under the Open Government Licence v3.0.
      </p>

      <h2>Ingredient nutrition: CoFID</h2>
      <p>
        Nutrition for ingredients comes from the UK Composition of Foods Integrated Dataset (CoFID, 2021) published by
        the UK Health Security Agency under the Open Government Licence, unless a product label has been linked to the
        ingredient (see above), in which case the figure is marked &ldquo;from product label via Open Food Facts&rdquo;.
      </p>

      <h2>Prices</h2>
      <p>
        Generic prices are our own typical shelf-price estimates, not live retailer prices. Prices you confirm or read from your
        receipts take priority.
      </p>
    </article>
  );
}
