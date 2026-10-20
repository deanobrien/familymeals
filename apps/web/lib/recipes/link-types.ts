// Client-safe shapes for ingredient links (the matching itself is server-only: lib/server/recipes/ingredient-links.ts).

/** A catalogue ingredient offered for a recipe line. */
export interface IngredientCandidate {
  id: string;
  name: string;
}
