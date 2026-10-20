import 'server-only';
import type { NextResponse } from 'next/server';
import { json } from '../api/bearer-route';
import type { SaveResult } from './service';

/** The SaveResult as the API answers it: 200 when saved, 404 when the recipe is gone, else 422 (field errors / duplicates). */
export function saveResponse(result: SaveResult): NextResponse {
  if (result.ok) return json(result, 200);
  return json(result, result.message === 'Recipe not found' ? 404 : 422);
}
