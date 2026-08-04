/**
 * Domain model and possession engine for Hoop Rush. Pure TypeScript: no
 * Svelte, no persistence, no DOM, no clocks, no platform randomness. Types
 * come from the validated @hoop-rush/data-contracts schemas.
 *
 * This entry exports only the surface consumed by the web app and CLI; the
 * sim plumbing (possession, shooting, fouls, rebounding, usage, recorder,
 * facts, timing, constants, seeds) stays internal to the package.
 */
export { canPlay, type SlotGroup } from './domain/positions.js';
export { slotRequirement, validateLineup } from './domain/lineup.js';
export { classifyArchetype } from './domain/archetypes.js';
export { createEngineContext, type EngineContext } from './sim/context.js';
export { fnv1a32, hex32 } from './sim/rng.js';
export { simulateGame } from './sim/game.js';
export { checkGameResult, gameResultDigest } from './sim/invariants.js';
export { evaluateLineupStrength } from './challenge/lineup-eval.js';
export {
  evaluateContextualPlayerValue,
  evaluateLineupFit,
  evaluateMatchup,
  evaluateLineupMatchup,
} from './challenge/contextual-value.js';
export { explainSeason } from './challenge/explain.js';
export { leagueMvp } from './challenge/mvp.js';
export { perGamePlayer } from './challenge/aggregates.js';
export {
  acceptGameResult,
  createChallenge,
  createGameInput,
  simulateChallenge,
  validateBracketContent,
  type ChallengeCreation,
} from './challenge/commands.js';
export { generateSchedule, scheduleInvariants } from './bracket/schedule.js';
export {
  generateBracket,
  type BracketCandidatePlayer,
  type FranchiseCandidates,
} from './bracket/generator.js';
export { toSimulationPlayer } from './modes/sandbox/adapters.js';
export {
  BEST_OF_ATTEMPTS,
  chooseBestRunSeed,
  simulateChallengeBestOf,
} from './modes/sandbox/selection.js';
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
} from './season/league.js';
export {
  generateSeasonSchedule,
  auditSeasonSchedule,
  type GenerateSeasonScheduleInput,
} from './season/schedule.js';
export { reduceSeasonStandings, auditSeasonStandings } from './season/standings.js';
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
} from './season/postseason.js';
// Classic draft exports live under the `classic` namespace: the module's
// `slotRequirement` would otherwise collide with domain/lineup.js.
export * as classic from './modes/classic/draft.js';
