export { projectBaseFive, type LedgerSide } from './base.ts';
export { projectExpectedLedger, expectedStealShare } from './expected-ledger.ts';
export {
  neutralReference,
  archetypeReference,
  archetypeReferences,
  resolveReference,
} from './reference-lineups.ts';
export { identifyWeaknesses, weaknessPenalty } from './weaknesses.ts';
export { ProjectionCache, type ProjectionCacheStats } from './cache.ts';
export {
  traceRotationNormal,
  traceRotationClose,
  traceContext,
  type RotationTraceResult,
  type RotationTraceUnit,
} from './rotation-trace.ts';
export { projectSeasonRoster, type SeasonProjectionOptions } from './season.ts';
export {
  projectedQualityWeights,
  optimizeSeasonRotation,
  type MinutePlanOptimizationResult,
  type OptimizedMinutePlan,
} from './minute-plan-quality.ts';
export {
  rankCandidates,
  rankingVectorOf,
  normalizeComponent,
  hardGateReasons,
  paretoFilter,
  redundancyPenaltyValue,
  type RankingGates,
  type RankingResult,
  type RankingVector,
  type RankedCandidate,
  type RejectedCandidate,
} from './ranking.ts';
export {
  searchRosterRotationCandidates,
  buildHumanSeasonRoster,
  SEARCH_LENSES,
  type RosterRotationSearchInput,
  type RosterRotationSearchResult,
  type HumanRosterBuildInput,
  type HumanRosterBuildResult,
  type SearchAudit,
  type SearchLens,
  type SearchedCandidate,
} from './candidate-search.ts';
