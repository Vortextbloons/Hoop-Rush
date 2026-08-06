/**
 * Season Run AI league generation (spec/2.0/03, season-ai-v2,
 * roster-generation-v2, M2.4). The authoritative implementation lives in
 * `ai-generation.ts` (percentile tiering, league-wide private-pool
 * allocation, repair, and backtracking) and `ai-scoring.ts` (identity
 * weights, role scores from possession inputs, and tier classification).
 * This module is the public seam consumed by the draft commands and the CLI.
 */

export {
  SOLO_BAND_QUOTAS,
  DUO_BAND_QUOTAS,
  AI_GENERATION_NODE_BUDGET,
  BAND_ORDER,
  IDENTITIES,
  DEFAULT_IDENTITY_PRIORITY_ROLES,
  SeasonAiGenerationError,
  SeasonAiTargetsError,
  assignAiBandsAndIdentities,
  evaluateSeasonRoster,
  fiveReachableFromCounts,
  generateAiLeague,
  identityPriorityRolesOf,
  runSeasonRosterCalibrationSeeds,
  validateSeasonRosterTargets,
  type SeasonAiGenerationInput,
  type SeasonAiGenerationPhase,
  type SeasonRosterCalibrationRunV2,
} from './ai-generation.ts';
export type { SeasonLeagueGenerationResult } from '@hoop-rush/data-contracts';
