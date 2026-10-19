/**
 * @fr/engine-planner (destined for @fr/engine/planner). Pure, deterministic, no I/O.
 * The LLM only produces PlanConstraints; this module picks recipes and explains the result.
 */
export * from './schemas';
export { solvePlan, type PlanProposal } from './solver';
export {
  validatePlan,
  type PlanToValidate,
  type PlanSlotToValidate,
  type PlanValidation,
  type HardViolation,
  type HardViolationCode,
} from './validate';
export {
  formatPence,
  type ConstraintReportItem,
  type ConstraintStatus,
  type ConstraintKind,
  type ProposedSlot,
  type GapSuggestion,
  type PlanCost,
  type PlanEvaluation,
  type HardExclusionSummary,
} from './report';
export { hardCheck, termMatches, resolveTarget, countsTowards, type HardReason, type HardReasonCode, type ResolvedTarget } from './problem';
