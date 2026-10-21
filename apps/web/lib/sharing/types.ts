// Client-safe view types for the shared family cookbook (P3-A, D420-D424). The Android app parses the same shapes.
// What a share can expose is exactly SharedRecipeView: no notes, ratings, favourites, cooking history, original photos or ids of
// the sharing household or its members.

export type ShareScope = 'recipe' | 'collection';
export type ShareStatus = 'active' | 'expired' | 'revoked';

export const SHARE_TOKEN_RE = /^[0-9a-f]{64}$/;
export const SHARE_MAX_RECIPES = 50;
export const SHARE_MAX_DAYS = 365;
/** Expiry choices offered in the UI (days); `null` = never. */
export const SHARE_EXPIRY_CHOICES: ReadonlyArray<{ days: number | null; label: string }> = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: null, label: 'No expiry' },
];

export interface SharedIngredientView {
  /** "400 g beef mince", ready to show. */
  text: string;
  optional: boolean;
}

export interface SharedRecipeView {
  id: string;
  title: string;
  description: string;
  sourceUrl: string;
  /** The ORIGINAL recipe's own attribution (a cookbook, a website), not the sharer's. */
  sourceAttribution: string;
  prepMinutes: number | null;
  cookMinutes: number | null;
  servings: number;
  cuisine: string;
  tags: string[];
  ingredients: SharedIngredientView[];
  steps: string[];
  /** Path of the share-scoped image route (`/api/shares/<token>/image/<id>`), or null when there is no photo / not allowed. */
  imagePath: string | null;
}

export type SharePreview =
  | { kind: 'invalid' }
  | { kind: 'minimal'; scope: ShareScope; title: string | null; sharedBy: string | null; recipeCount: number }
  | {
      kind: 'full';
      scope: ShareScope;
      title: string | null;
      /** "Shared by Alice's household" (or "Shared by a family"). */
      attribution: string;
      recipes: SharedRecipeView[];
      expiresAt: string | null;
      /** The viewer is signed in (false = a public preview: text only, no save). */
      signedIn: boolean;
      /** The viewer belongs to the sharing household (nothing to save: it is already theirs). */
      own: boolean;
    };

export interface ShareSummary {
  id: string;
  scope: ShareScope;
  title: string | null;
  recipes: Array<{ id: string; title: string }>;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  publicPreview: boolean;
  status: ShareStatus;
  /** How many people opened it and how many recipes were saved (never who). */
  openedBy: number;
  saved: number;
  createdByMe: boolean;
}

export type ShareError = 'invalid_input' | 'forbidden' | 'read_only' | 'not_found' | 'rate_limited' | 'own_share' | 'unknown';
export type ShareResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: ShareError; message: string; fieldErrors?: Record<string, string> };

export const SHARE_ERROR_MESSAGE: Record<ShareError, string> = {
  invalid_input: 'Some values were not accepted.',
  forbidden: 'You do not have access to that.',
  read_only: 'This household is read-only while it is pending deletion.',
  // One message for unknown, expired and revoked links: the page must not say which.
  not_found: 'This link is not available. It may have expired or been switched off.',
  rate_limited: 'Too many tries. Please wait a few minutes and try again.',
  own_share: 'That recipe is already in your household.',
  unknown: 'Something went wrong. Please try again.',
};

export interface CreatedShare {
  id: string;
  /** Shown ONCE, never stored: the link is `<site>/s/<token>`. */
  token: string;
  path: string;
  expiresAt: string | null;
}

export const sharePath = (token: string): string => `/s/${token}`;
export const shareAppUrl = (token: string): string => `familyrecipes://s/${token}`;
