// Typical shelf life (D87). The table lives in @fr/engine/pantry (scan-review.ts) so the Android app estimates the same
// way (D343); see there for the rules (opt-in, always labelled as an estimate, never overrides a read date).
export { estimateShelfLife, type ShelfLifeEstimate } from '@fr/engine/pantry';
