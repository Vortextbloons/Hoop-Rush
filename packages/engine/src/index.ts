/**
 * Domain model and possession engine for Hoop Rush. Pure TypeScript: no
 * Svelte, no persistence, no DOM, no clocks, no platform randomness. Types
 * come from the validated @hoop-rush/data-contracts schemas.
 *
 * This entry exports only the surface consumed by the web app and CLI; the
 * sim plumbing (possession, shooting, fouls, rebounding, usage, recorder,
 * facts, timing, constants, seeds) stays internal to the package.
 */
export { canPlay, type SlotGroup } from './domain/positions.ts';
export { slotRequirement, validateLineup } from './domain/lineup.ts';
export { classifyArchetype } from './domain/archetypes.ts';
export { createEngineContext, type EngineContext } from './sim/context.ts';
export { fnv1a32, hex32 } from './sim/rng.ts';
export { simulateGame } from './sim/game.ts';
export { checkGameResult, gameResultDigest } from './sim/invariants.ts';
export { evaluateLineupStrength } from './challenge/lineup-eval.ts';
export {
  evaluateContextualPlayerValue,
  evaluateLineupFit,
  evaluateMatchup,
  evaluateLineupMatchup,
} from './challenge/contextual-value.ts';
export { explainSeason } from './challenge/explain.ts';
export { leagueMvp } from './challenge/mvp.ts';
export { perGamePlayer } from './challenge/aggregates.ts';
export {
  acceptGameResult,
  createChallenge,
  createGameInput,
  simulateChallenge,
  validateBracketContent,
  type ChallengeCreation,
} from './challenge/commands.ts';
export { generateSchedule, scheduleInvariants } from './bracket/schedule.ts';
export {
  generateBracket,
  type BracketCandidatePlayer,
  type FranchiseCandidates,
} from './bracket/generator.ts';
export { toSimulationPlayer } from './modes/sandbox/adapters.ts';
export {
  BEST_OF_ATTEMPTS,
  chooseBestRunSeed,
  simulateChallengeBestOf,
} from './modes/sandbox/selection.ts';
// Season Run (2.0 M2.0) league skeleton: league membership, the deterministic
// schedule generator and auditor, pure standings reduction, and the
// Play-In/playoff state machine.
export {
  conferenceOf,
  divisionOf,
  franchisesInConference,
  divisionOpponentsOf,
  conferenceNonDivisionOpponentsOf,
  oppositeConferenceOpponentsOf,
} from './season/league.ts';
export {
  generateSeasonSchedule,
  auditSeasonSchedule,
  type GenerateSeasonScheduleInput,
} from './season/schedule.ts';
export { reduceSeasonStandings, auditSeasonStandings } from './season/standings.ts';
export {
  setPlayInRankings,
  submitPlayInGame,
  createPlayoffBracket,
  submitPlayoffGame,
  currentSeriesId,
  auditSeasonPostseason,
  type PostseasonRankings,
  type PlayInGameResult,
  type PlayoffGameResult,
} from './season/postseason.ts';
// Season Run (2.0 M2.1) ten-player draft, roster legality, AI generation,
// rotations, and generation digests.
export {
  SEASON_ROSTER_RULES,
  groupMaskOf,
  rosterGroupCounts,
  legalFiveExists,
  legalFiveAfterAnyRemoval,
  completionTargetsMet,
  validateSeasonRoster,
  rosterFeasible,
  anyMemberPlays,
  type SeasonRosterMemberInput,
} from './season/roster-rules.ts';
export {
  matchStartingFive,
  buildMinimalRotation,
  rotationTargetMinutes,
  auditSeasonRotation,
  validateSeasonRotation,
  applySeasonRotationPreset,
  handleSetSeasonRotationCommand,
} from './season/rotation.ts';
export {
  enumerateLegalFives,
  chooseInitialUnit,
  planUnit,
  type PlannerMember,
  type PlannerRotationContext,
  type PlannerUnitRequest,
} from './season/rotation-planner.ts';
export {
  simulateSeasonGame,
  checkSeasonGameResult,
  type SeasonGameAvailabilitySeam,
} from './season/season-game.ts';
export { seasonGenerationDigest, type SeasonGenerationDigestInput } from './season/digest.ts';
export {
  seasonDraftStateDigest,
  seasonDraftStateCanonical,
  applySeasonDraftCommand,
  type SeasonAiGenerationDeps,
  type SeasonAiGenerationInput,
} from './season/draft.ts';
export {
  SOLO_BAND_QUOTAS,
  DUO_BAND_QUOTAS,
  AI_GENERATION_NODE_BUDGET,
  SeasonAiGenerationError,
  generateAiLeague,
  assignAiBandsAndIdentities,
  evaluateSeasonRoster,
  runSeasonRosterCalibrationSeeds,
} from './season/ai.ts';
// Classic draft exports live under the `classic` namespace: the module's
// `slotRequirement` would otherwise collide with domain/lineup.js.
export * as classic from './modes/classic/draft.ts';
