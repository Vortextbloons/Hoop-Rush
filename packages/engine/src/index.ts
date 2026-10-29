export { canPlay, type SlotGroup } from './domain/positions.ts';
export { slotRequirement, validateLineup } from './domain/lineup.ts';
export {
  planLineupReposition,
  type LineupRepositionMove,
  type LineupRepositionPlan,
  type LineupRepositionPlayer,
  type LineupRepositionSubject,
} from './domain/lineup-reposition.ts';
import { slotRequirement as canonicalSlotRequirement } from './domain/lineup.ts';
export { classifyArchetype } from './domain/archetypes.ts';
export { createEngineContext, type EngineContext } from './sim/kernel.ts';
export { fnv1a32, hex32, createRng, type Rng, shuffle, swapAt } from './sim/rng.ts';
export { createGameBatchSimulator, simulateGame } from './sim/game.ts';
export { checkGameResult, gameResultDigest } from './sim/invariants.ts';
export { evaluateLineupStrength } from './challenge/lineup-eval.ts';
export {
  evaluateContextualPlayerValue,
  evaluateLineupMatchup,
} from './challenge/contextual-value.ts';
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
export { explainSeason } from './challenge/explain.ts';
export { selectMemorableGames } from './challenge/memorable.ts';
export { leagueMvp, type LeagueMvp } from './challenge/mvp.ts';
export {
  createLeagueSimulation,
  leagueGamesSimulated,
  leagueQuotas,
  leagueUserGameCounts,
  planLeagueSchedule,
  simulateLeague,
  validateLeagueSchedule,
  LEAGUE_GAMES_PER_TEAM,
  type LeagueGamePlan,
  type LeagueSimulation,
  type LeagueSimulationInput,
} from './challenge/league.ts';
export { perGamePlayer } from './challenge/aggregates.ts';
export {
  acceptGameResult,
  createChallenge,
  createGameInput,
  simulateChallenge,
  validateBracketContent,
  type ChallengeCreation,
} from './challenge/commands.ts';
export { deriveAttemptSeed, SEED_DERIVATION_VERSION } from './challenge/seeds.ts';
export { challengeRunProgressDigest } from './challenge/digests.ts';
export { generateSchedule, scheduleInvariants } from './bracket/schedule.ts';
export {
  bestLegalFiveWithin,
  generateBracket,
  type BracketCandidatePlayer,
  type FranchiseCandidates,
} from './bracket/generator.ts';
export { toSimulationPlayer } from './modes/sandbox/adapters.ts';
export {
  BEST_OF_ATTEMPTS,
  chooseBestRunSeed,
  simulateChallengeAttempts,
  simulateChallengeBestOf,
} from './modes/sandbox/selection.ts';
export { plannerCandidates } from './game/rotation-planner.ts';
export {
  simulateGameWithEffects,
  defaultGameSeam,
  sameUnit,
  type GameAvailabilitySeam,
  type GameEffectsMode,
} from './game/controller.ts';
export { type HomeCourtMechanisms } from './game/home-court.ts';
export { createEffectsBuffer, type EffectsBuffer, type EffectsHook } from './game/effects.ts';
export { minuteQualityOf, minuteReliefOf } from './game/minute-plan.ts';
export {
  FIRST_TO_SEVEN_TARGET,
  FIRST_TO_SEVEN_SAFETY_POSSESSIONS,
  DEEP_FOUR_SPLIT,
  DEEP_FOUR_MAKE_SCALE,
} from './sim/evolution-rules.ts';
import {
  classicRollSeed,
  sortClassicCatalog,
  classicRollCandidates,
  classicRerollAvailable,
  rollClassicPair,
  createClassicDraft,
  rerollClassicFranchise,
  rerollClassicEra,
  draftClassicPlayer,
  repositionClassicPlayer,
  createClassicChallenge,
} from './modes/classic/draft.ts';
export type {
  ClassicRollKind,
  ClassicDraftInput,
  ClassicDraftPlayerInput,
  ClassicRepositionInput,
  ClassicChallengeEnvironment,
} from './modes/classic/draft.ts';
export const classic = Object.freeze({
  classicRollSeed,
  sortClassicCatalog,
  slotRequirement: canonicalSlotRequirement,
  classicRollCandidates,
  classicRerollAvailable,
  rollClassicPair,
  createClassicDraft,
  rerollClassicFranchise,
  rerollClassicEra,
  draftClassicPlayer,
  repositionClassicPlayer,
  createClassicChallenge,
});
export {
  projectBaseFive,
  projectExpectedLedger,
  expectedStealShare,
  neutralReference,
  archetypeReference,
  archetypeReferences,
  resolveReference,
  identifyWeaknesses,
  weaknessPenalty,
  ProjectionCache,
  type ProjectionCacheStats,
} from './projection/index.ts';
export {
  FIXED_FIVE_SEED_VERSION,
  FIXED_FIVE_SANDBOX_DRAFT_ORDER_VERSION,
  fixedFiveParticipantSeed,
  fixedFiveDraftSeed,
  fixedFiveFirstPicker,
  fixedFiveSandboxFirstPicker,
  fixedFiveSandboxDraftPicker,
  fixedFiveDuelGameSeed,
  fixedFiveSharedGameSeed,
  fixedFiveH2HSeed,
  fixedFiveAutopickSeed,
  fixedFiveAutopickSeedPath,
  FIXED_FIVE_TIEBREAK_PATH,
  fixedFiveTiebreakWinner,
} from './modes/fixed-five/seeds.ts';
export {
  createSandboxBuilder,
  applySandboxBuilderCommand,
  enumerateSandboxSafeMoves,
  type FixedFiveCandidate,
  type SandboxBuilderState,
  type SandboxBuilderCommand,
} from './modes/fixed-five/sandbox-builder.ts';
export {
  applyClassicBuilderCommand,
  createParticipantClassicDraft,
  type ClassicBuilderCommand,
  type PoolEligibilityPolicy,
} from './modes/classic/draft.ts';
export {
  createDuelDraft,
  rerollDuel,
  claimDuelPlayer,
  repositionDuelPlayer,
  isDuelComplete,
  duelAlternationHolds,
  duelCurrentPicker,
  type DuelClaimInput,
  type DuelRepositionInput,
  type DuelDraftState,
  type DuelDraftPick,
} from './modes/fixed-five/duel.ts';
export {
  createSandboxDuelDraft,
  claimSandboxDuelPlayer,
  repositionSandboxDuelPlayer,
  sandboxDuelPicksFor,
  isSandboxDuelComplete,
  sandboxDuelAlternationHolds,
  sandboxDuelSnakeOrderHolds,
  sandboxDuelPicker,
  type SandboxDuelClaimInput,
  type SandboxDuelRepositionInput,
  type SandboxDuelState,
  type SandboxDuelPick,
} from './modes/fixed-five/sandbox-duel.ts';
export {
  enumerateClassicSafeMoves,
  enumerateDuelSafeMoves,
  enumerateSandboxDuelSafeMoves,
  chooseAutopick,
  chooseSandboxAutopicksUntilFull,
  type AutopickSelection,
} from './modes/fixed-five/timeout.ts';
export {
  findWeakestOpponent,
  h2hGameNumbersFor,
  shared82H2HGameInput,
  simulateRecordedShared82H2HGame,
  simulateShared82,
  shared82GameEvents,
  type Shared82GameEvent,
  type RecordedShared82H2HGame,
  type Shared82SimulationInput,
  type Shared82SimulationOutput,
} from './modes/fixed-five/shared82.ts';
export {
  simulateDuelSeries,
  duelGameEvents,
  duelGameSimulationInput,
  duelHomeParticipantId,
  simulateRecordedDuelGame,
  type DuelGameEvent,
  type DuelSimulationInput,
  type DuelSimulationOutput,
  type RecordedDuelGame,
} from './modes/fixed-five/duel-sim.ts';
export {
  summarizeShared82Games,
  summarizeDuelGames,
  type Shared82GameGroups,
  type Shared82Summary,
  type DuelGameGroup,
} from './modes/fixed-five/results.ts';
export {
  fixedFiveResultDigest,
  verifyFixedFiveDigest,
  canonicalFixedFiveDigestPayload,
  isFixedFiveGameInputCommand,
  gameInputCommands,
  fixedFiveDuelGameInputDigest,
  fixedFiveDuelGameResultDigest,
  fixedFiveDuelGameTapeDigest,
} from './modes/fixed-five/digest.ts';
export {
  verifyFixedFiveCompetition,
  type FixedFiveVerificationInput,
  type FixedFiveVerificationResult,
  type FixedFiveVerificationReceipt,
  type FixedFiveReceiptGameSeed,
} from './modes/fixed-five/verification.ts';
export {
  replayFixedFiveLog,
  isDraftComplete,
  isFixedFiveDraftTurn,
  picksCommittedOf,
  lockedOf,
  roomLogFacts,
  mergeFixedFiveCommands,
  restoreFixedFiveCommandSyncState,
  deriveEffectivePhase,
  pickOrdinalOf,
  timeoutMsFor,
  computeDueAutopick,
  summarizeWorkerEntries,
  lineupEntryFor,
  assembleCompetitionRun,
  computeCompetitionDigest,
  buildFixedFiveVerificationInput,
  type FixedFiveDraftLogInputs,
  type FixedFivePickRef,
  type DraftReplay,
  type ClassicDraftReplay,
  type SandboxDraftReplay,
  type SandboxSnakeDraftReplay,
  type DuelDraftReplay,
  type SandboxDuelDraftReplay,
  type RoomLogFacts,
  type WorkerSummaryInput,
  type CompetitionAssembleInput,
  type CompetitionDigestInput,
  type VerificationInputBuild,
} from './modes/fixed-five/log.ts';
export { ENGINE_VERSION } from './sim/constants.ts';
export {
  DRAFT_DUEL_SEED_VERSION,
  DRAFT_DUEL_FAIR_BAND_VERSION,
  draftDuelSharedBandSeed,
  draftDuelOfferSeed,
  draftDuelSafetySeed,
  draftDuelFirstPicker,
  draftDuelTimeoutSeed,
  draftDuelTimeoutSeedPath,
  draftDuelHomeWinner,
  draftDuelGameSeed,
  draftDuelRematchSeed,
} from './modes/draft-duel/seeds.ts';
export {
  buildDraftDuelCatalog,
  cardGroupSet,
  cardPlayableAt,
  catalogEntryForVersion,
  catalogSimulationForVersion,
  type DraftDuelCatalog,
} from './modes/draft-duel/catalog.ts';
export {
  createDraftDuelDraft,
  draftDuelCurrentPicker,
  isDraftDuelComplete,
  draftDuelRoster,
  draftDuelLegalPicks,
  applyDraftDuelPick,
  draftDuelTimeoutPick,
  repositionDraftDuelCard,
  DraftDuelDraftError,
  type DraftDuelDraftErrorCode,
  type CreateDraftDuelDraftInput,
  type DraftDuelPickInput,
  type DraftDuelRepositionInput,
  type DraftDuelTimeoutPick,
} from './modes/draft-duel/draft.ts';
export {
  buildRoundOffers,
  DraftDuelGenerationError,
  draftDuelFairBandTokens,
  draftDuelFairAttemptForState,
} from './modes/draft-duel/offers.ts';
export {
  assignSlots,
  neededGroups,
  completionFeasible,
  unclaimedProfileCounts,
  rosterCompletionPossible,
  draftDuelCardProfileMask,
  draftDuelClaimedPlayerIds,
  buildDraftDuelSafetyInput,
  assessDraftDuelOffers,
  draftDuelRoundSafetyHolds,
  draftDuelRepositionPlan,
  draftDuelRepositionSlots,
  type DraftDuelGroupNeeds,
  type DraftDuelRoundOffers,
  type DraftDuelSafetyInput,
  type DraftDuelSlotPlacement,
} from './modes/draft-duel/feasibility.ts';
export {
  createDraftDuelSeries,
  draftDuelHomeForGame,
  applyDraftDuelGameResult,
  draftDuelSimulationTeam,
  draftDuelSeriesMvp,
  draftDuelStandouts,
  type DraftDuelPlayedGame,
  type DraftDuelSeriesRosters,
} from './modes/draft-duel/series.ts';
export { replayDraftDuelLog, type DraftDuelLogReplayInput } from './modes/draft-duel/log.ts';
export { simulateRecordedGame, type RecordedGameOutput } from './sim/tape.ts';
export type { GameObservers, PeriodObservation, TripObservation } from './sim/game.ts';
export {
  draftDuelSimulationInputDigest,
  draftDuelGameResultDigest,
  draftDuelGameTapeDigest,
} from './modes/draft-duel/digests.ts';
export * from './modes/havoc/index.ts';
export * from './modes/cap-rush/index.ts';
export * from './profile.ts';
