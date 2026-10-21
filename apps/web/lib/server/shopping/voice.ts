// Voice add, server side (P2-A, D395): the transcript the device recognised -> reviewable rows. READS ONLY: nothing is
// added to any list here. The device did the speech-to-text; this reads the TEXT with the engine's line parser and the
// catalogue matcher (the same conservative matching as the handwritten list scan), and files each item under an aisle.
// Adding goes through the existing idempotent /api/shopping/scan/confirm, so voice cannot add anything twice.
import { MAX_SPOKEN_ITEMS, parseSpokenList } from '@fr/engine/shopping';
import { aisleForCategory } from '../../shopping/aisles';
import { matchScannedName } from '../pantry/scan';
import { getIngredientCatalogue, type IngredientCatalogue } from '../refdata/catalogue';
import { guessAisle } from './list-scan';

export const MAX_TRANSCRIPT_CHARS = 1200;

export interface VoiceRow {
  key: string;
  /** The words this row was read from. */
  text: string;
  name: string;
  /** Set when the name matched a catalogue ingredient exactly (name / alias): the list item is then linked to it. */
  ingredientId?: string;
  ingredientName?: string;
  value?: number;
  unit?: string;
  notes?: string;
  aisle: string;
}

export type VoiceParseResult = { ok: true; rows: VoiceRow[]; truncated: boolean } | { ok: false; message: string };

export function parseVoiceTranscript(raw: unknown, cat: IngredientCatalogue = getIngredientCatalogue()): VoiceParseResult {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, message: 'Say or type what to add.' };
  if (raw.length > MAX_TRANSCRIPT_CHARS) return { ok: false, message: 'That is too long. Add a few items at a time.' };
  const items = parseSpokenList(raw);
  if (items.length === 0) return { ok: false, message: 'No items could be made out. Try "milk, two tins of tomatoes and eggs".' };
  const rows = items.map((i): VoiceRow => {
    const match = matchScannedName(cat, i.name.toLowerCase(), i.unit === 'can' ? 'canned' : 'other');
    const linked = match.status === 'matched' ? match.ingredient : null;
    return {
      key: i.key,
      text: i.text,
      name: linked ? linked.name : i.name,
      ...(linked ? { ingredientId: linked.id, ingredientName: linked.name } : {}),
      ...(i.value !== undefined ? { value: i.value, unit: i.unit ?? 'item' } : {}),
      ...(i.notes ? { notes: i.notes } : {}),
      aisle: linked ? aisleForCategory(linked.category) : guessAisle(i.name),
    };
  });
  return { ok: true, rows, truncated: items.length >= MAX_SPOKEN_ITEMS };
}
