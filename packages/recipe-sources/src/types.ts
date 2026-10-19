/** Where a recipe came from. Shown on every card and kept with the saved recipe. */
export interface SourceAttribution {
  publisher: string;
  /** Link back to the recipe's page at the publisher. */
  url: string;
  id: string;
}

export interface SourceIngredient {
  name: string;
  /** Measure exactly as the publisher wrote it ("1 tbsp", "200g", "Pinch"); may be empty. */
  measure: string;
}

/** One recipe from an external source, validated and normalised (not yet our extraction shape). */
export interface SourceRecipe {
  provider: string;
  id: string;
  title: string;
  category?: string;
  area?: string;
  tags: string[];
  /** Raw instructions text as published. */
  instructions: string;
  imageUrl?: string;
  youtubeUrl?: string;
  /** TheMealDB's strCreativeCommons flag, when present. */
  creativeCommons?: string;
  attribution: SourceAttribution;
  ingredients: SourceIngredient[];
}

export interface SearchFilters {
  area?: string;
  category?: string;
  ingredient?: string;
  /** Max recipes to return (and to fetch details for). */
  limit?: number;
}

/** Provider contract. Implementations must never throw on "no results" (return []/null). */
export interface RecipeSource {
  readonly name: string;
  search(q: string, filters?: SearchFilters): Promise<SourceRecipe[]>;
  byId(id: string): Promise<SourceRecipe | null>;
  byIngredient(name: string, limit?: number): Promise<SourceRecipe[]>;
  byCategory(category: string, limit?: number): Promise<SourceRecipe[]>;
  byArea(area: string, limit?: number): Promise<SourceRecipe[]>;
  random(): Promise<SourceRecipe | null>;
  categories(): Promise<string[]>;
  areas(): Promise<string[]>;
}

export class RecipeSourceError extends Error {
  constructor(
    public readonly code: 'UNAVAILABLE' | 'BAD_RESPONSE' | 'RATE_LIMITED',
    message: string,
  ) {
    super(message);
    this.name = 'RecipeSourceError';
  }
}

export const DEFAULT_LIMIT = 12;
