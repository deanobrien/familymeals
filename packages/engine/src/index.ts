/**
 * @fr/engine - pure, deterministic engine (PRJ-018). No I/O.
 * Root export = L3 core. Higher-level modules live on subpaths:
 * ./cost ./nutrition ./planner ./receipt-match ./shopping ./pantry
 * (they re-use names, so they are deliberately not re-exported from here).
 */
export * from './contract';
export * from './units/index';
export * from './parse/index';
export * from './normalise/index';
export * from './scale/index';
export * from './aggregate/index';
