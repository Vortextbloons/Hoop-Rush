export { canPlay, type SlotGroup } from './domain/positions.ts';
export { slotRequirement, validateLineup } from './domain/lineup.ts';
export {
  planLineupReposition,
  type LineupRepositionMove,
  type LineupRepositionPlan,
  type LineupRepositionPlayer,
  type LineupRepositionSubject,
} from './domain/lineup-reposition.ts';
export {
  scoreDraftPool,
  DRAFT_FIT_REFINE_DEFAULT,
  DRAFT_FIT_REFINE_MAX,
  DRAFT_FIT_TOP_COUNT,
  type DraftFitNeed,
  type DraftFitProjectionOptions,
  type DraftFitReport,
  type DraftFitScore,
  type DraftFitTier,
} from './challenge/draft-fit-projection.ts';
export { toSimulationPlayer } from './modes/sandbox/adapters.ts';
export { capRushPayrollStatus } from './modes/cap-rush/salary.ts';
export { havocMutationDefinitionOf } from './modes/havoc/mutations.ts';
