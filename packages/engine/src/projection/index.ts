/**
 * Deterministic possession projection (projection milestone): a seedless,
 * calculation-only evaluation layer that composes the possession engine's
 * pure probability functions into expected ledgers, base-five projections,
 * and Season roster projections. Pure engine modules only — no simulation
 * sampling, Svelte, persistence, browser APIs, Supabase, or workers.
 */

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
