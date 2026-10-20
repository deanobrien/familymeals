// View models for "What can I make now?" (P1-B, D375). Client-safe: plain serialisable data only.

export interface MakeNowMissing {
  name: string;
  /** "200 g", "2 cloves" ... what the recipe asks for (empty for to-taste lines). */
  quantityLabel: string;
}

export interface MakeNowItem {
  recipeId: string;
  title: string;
  href: string;
  /** Share of the recipe's required ingredients the pantry covers, 0..100. */
  coveragePct: number;
  /** 0..100: how much of the cover is stock that is expiring soon. */
  urgencyPct: number;
  /** Everything needed is in the pantry. */
  makeable: boolean;
  usesExpiring: boolean;
  covered: string[];
  missing: MakeNowMissing[];
  headline: string;
}

export interface MakeNowView {
  items: MakeNowItem[];
  /** Recipes left out because they contain (or could not be proven free of) an excluded allergen. Count only. */
  hiddenByAllergy: number;
  exclusionsActive: boolean;
  /** Allergy exclusions withheld because the recorder's consent was withdrawn (drives the consent notice). */
  withheldExclusions: number;
  totalRecipes: number;
  /** The household has no usable pantry stock at all. */
  pantryEmpty: boolean;
}

export type MakeNowAddResult =
  | { ok: true; added: number; alreadyOnList: number; message: string }
  | { ok: false; error: string };
