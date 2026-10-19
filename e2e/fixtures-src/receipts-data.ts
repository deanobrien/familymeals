// Synthetic UK-supermarket-style receipts ("FICTIONAL FOODS" - no real retailer branding).
// Money = integer pence. `pence` is the LINE total (qty already applied); discounts are negative.
export interface RLine { raw: string; kind?: 'item' | 'multibuy_discount' | 'promo_discount'; qty?: number; pence: number; ing: string | null; }
export interface ReceiptDef { slug: string; retailer: string; date: string; note: string; lines: RLine[]; totalPence: number; }

export const RECEIPTS: ReceiptDef[] = [
  { slug: 'r1-weekly-shop', retailer: 'FICTIONAL FOODS', date: '2026-10-10', note: 'Abbreviations + a non-food line that must not match',
    lines: [
      { raw: 'SPAGH 500G', pence: 95, ing: 'spaghetti' },
      { raw: 'CHOP TOM 400G', qty: 2, pence: 130, ing: 'tinned chopped tomatoes' },
      { raw: 'BRWN ONION 1KG', pence: 110, ing: 'onion' },
      { raw: 'SEMI SKIM MLK 2.27L', pence: 175, ing: 'milk' },
      { raw: 'CARRIERBAG 5P', pence: 5, ing: null },
    ], totalPence: 515 },
  { slug: 'r2-multibuy', retailer: 'FICTIONAL FOODS', date: '2026-10-11', note: 'Multi-buy 3 for 2 on chickpeas; discount line must not be treated as an item',
    lines: [
      { raw: 'CHICKPEAS 400G', qty: 3, pence: 270, ing: 'chickpeas' },
      { raw: 'MULTIBUY 3 FOR 2', kind: 'multibuy_discount', pence: -90, ing: null },
      { raw: 'COCNUT MLK 400ML', pence: 120, ing: 'coconut milk' },
      { raw: 'BABY SPINACH 200G', pence: 110, ing: 'spinach' },
    ], totalPence: 410 },
  { slug: 'r3-fish-promo', retailer: 'FICTIONAL FOODS', date: '2026-10-12', note: 'Promo discount, fish, unmatched household item',
    lines: [
      { raw: 'WHT FISH FLLT 500G', pence: 450, ing: 'white fish fillets' },
      { raw: 'SMKD HADDOCK 250G', pence: 320, ing: 'smoked haddock' },
      { raw: 'FLOURY POTS 2.5KG', pence: 285, ing: 'floury potatoes' },
      { raw: 'MEMBER PRICE', kind: 'promo_discount', pence: -100, ing: null },
      { raw: 'WASHING UP LIQ', pence: 90, ing: null },
    ], totalPence: 1045 },
  { slug: 'r4-baking', retailer: 'FICTIONAL FOODS', date: '2026-10-13', note: 'Heavy abbreviation, qty>1, non-food line',
    lines: [
      { raw: 'SR FLR 1.5KG', pence: 150, ing: 'self-raising flour' },
      { raw: 'CSTR SGR 1KG', pence: 165, ing: 'caster sugar' },
      { raw: 'UNSLT BTR 250G', qty: 2, pence: 440, ing: 'butter' },
      { raw: 'LEMONS 4PK', pence: 100, ing: 'lemons' },
      { raw: 'FR RNG EGGS 12', pence: 245, ing: 'eggs' },
      { raw: 'DISHWSHR TABS', pence: 399, ing: null },
    ], totalPence: 1499 },
];
