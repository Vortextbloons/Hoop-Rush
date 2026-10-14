export { projectBaseFive, type LedgerSide } from './base.ts';
export { projectExpectedLedger, expectedStealShare } from './expected-ledger.ts';
export { estimateFirstToSevenRace, projectGameWithRule } from './evolution.ts';
export {
  neutralReference,
  archetypeReference,
  archetypeReferences,
  resolveReference,
} from './reference-lineups.ts';
export { identifyWeaknesses, weaknessPenalty } from './weaknesses.ts';
export { ProjectionCache, type ProjectionCacheStats } from './cache.ts';
export { traceRotationNormal, traceRotationClose } from './rotation-trace.ts';
export { projectSeasonRoster } from './season.ts';
export {
  projectedQualityWeights,
  optimizeSeasonRotation,
  type MinutePlanOptimizationResult,
  type OptimizedMinutePlan,
} from './minute-plan-quality.ts';
export { rankCandidates, type RankedCandidate } from './ranking.ts';
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
