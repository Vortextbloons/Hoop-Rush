/**
 * Season Run AI league generation (spec/2.0/03, season-ai-v1,
 * roster-generation-v1, M2.1). The authoritative implementation lives in
 * `ai-generation.ts` (bands, identities, greedy generation, repair, and
 * backtracking) and `ai-scoring.ts` (identity weights and role scores from
 * possession inputs). This module is the public seam consumed by the draft
 * commands and the CLI.
 */

export {
  SOLO_BAND_QUOTAS,
  DUO_BAND_QUOTAS,
  AI_GENERATION_NODE_BUDGET,
  SeasonAiGenerationError,
  assignAiBandsAndIdentities,
  evaluateSeasonRoster,
  generateAiLeague,
  runSeasonRosterCalibrationSeeds,
  type SeasonAiGenerationInput,
} from './ai-generation.js';
export type { SeasonLeagueGenerationResult } from '@hoop-rush/data-contracts';
