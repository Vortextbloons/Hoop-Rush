export { canPlay, type SlotGroup } from './domain/positions.ts';
export { positionDefenseOf } from './sim/position-responsibilities.ts';
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
export { simulateChallengeAttempts } from './modes/sandbox/selection.ts';
export { type HomeCourtMechanisms } from './game/home-court.ts';
export { type EffectsHook } from './game/effects.ts';
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
} from './projection/index.ts';
export {
  FIXED_FIVE_SEED_VERSION,
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
  replayFixedFiveLogTail,
  isDraftComplete,
  isFixedFiveDraftTurn,
  picksCommittedOf,
  lockedOf,
  roomLogFacts,
  mergeFixedFiveCommands,
  restoreFixedFiveCommandSyncState,
  deriveEffectivePhase,
  pickOrdinalOf,
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
  draftDuelSharedBandSeed,
  draftDuelOfferSeed,
  draftDuelFirstPicker,
  draftDuelTimeoutSeed,
  draftDuelTimeoutSeedPath,
  draftDuelHomeWinner,
  draftDuelGameSeed,
} from './modes/draft-duel/seeds.ts';
export {
  buildDraftDuelCatalog,
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
export {
  buildFullCourtHistoricalField,
  buildFullCourtLeagueSchedule,
  type FullCourtHistoricalTeam,
  type FullCourtLeagueGame,
} from './modes/full-court/league.ts';
export {
  fullCourtDraftIndexOf,
  fullCourtEligibleCandidates,
  fullCourtSalaryDollarsOf,
  type FullCourtCatalogIndex,
} from './modes/full-court/draft-catalog.ts';
export {
  applyFullCourtCommand,
  createFullCourtDraftState,
  fullCourtPurchasePhaseRejection,
  type FullCourtPurchasePhase,
} from './modes/full-court/draft-commands.ts';
export {
  fullCourtAbsenceTolerance,
  fullCourtAssessPick,
  fullCourtAssessPurchase,
  fullCourtDepthForecast,
  fullCourtPayrollDollars,
  fullCourtPayrollStatus,
  fullCourtWarChestDollars,
} from './modes/full-court/draft-economy.ts';
export { fullCourtStateDigest } from './modes/full-court/state-digest.ts';
export {
  assertFullCourtCoachingRoster,
  defaultFullCourtCoachingRotation,
} from './modes/full-court/coaching.ts';
export {
  FULL_COURT_MANUAL_MATCHUP_INTERIOR_WEIGHT,
  FULL_COURT_MANUAL_MATCHUP_PERIMETER_WEIGHT,
  applyFullCourtDefensiveMatchupsToPrep,
  assertFullCourtDefensiveMatchups,
  fixtureFullCourtDefensiveMatchups,
  resolveFullCourtDefensiveMatchups,
  validateFullCourtDefensiveMatchups,
  type FullCourtMatchupValidationInput,
} from './modes/full-court/matchups.ts';
export {
  unitNameFor,
  unitNameForPlayerIds,
  type FullCourtRotationPlanInput,
  type FullCourtRotationUnit,
  type FullCourtRotationUnitInput,
  type FullCourtStaggeringInput,
} from './modes/full-court/rotation.ts';
export {
  buildFullCourtBlueprintHierarchy,
  resolveFullCourtBlueprintHierarchy,
  type FullCourtBlueprintBindingPreview,
  type FullCourtBlueprintRoleBinding,
  type FullCourtBlueprintRoleBindingStatus,
  type FullCourtBlueprintRotationRef,
} from './modes/full-court/blueprint.ts';
export {
  simulateFullCourtGame,
  simulateRecordedFullCourtGame,
  type FullCourtGameInput,
  type FullCourtGameLineupFacts,
  type FullCourtGameResult,
  type FullCourtLineupFactRow,
  type FullCourtRecordedGameOutput,
  type FullCourtTapeEvent,
} from './modes/full-court/game.ts';
export {
  buildFullCourtRegularSeason,
  fullCourtRegularSeasonGameInput,
  simulateFullCourtRegularSeasonGame,
  type FullCourtRegularSeason,
} from './modes/full-court/regular-season.ts';
export {
  FULL_COURT_TRAINING_CAMP_SEED_PURPOSE,
  fullCourtTrainingCampSeed,
  simulateFullCourtTrainingCamp,
  type FullCourtTrainingCampInput,
  type FullCourtTrainingCampOptions,
} from './modes/full-court/preparation.ts';
export {
  fullCourtAvailabilityForGame,
  type FullCourtGameHealthOptions,
  type FullCourtGameHealthOutcome,
} from './modes/full-court/health.ts';
export {
  createFullCourtSeasonCheckpoint,
  lockFullCourtRegularSeason,
  simulateFullCourtAiGames,
  simulateFullCourtSeasonSlot,
  simulateFullCourtUserSlot,
  type FullCourtAiGameChunk,
  type FullCourtUserSlotOutcome,
  type FullCourtSeasonLock,
  type FullCourtSeasonSlotOptions,
  type FullCourtSeasonSlotOutcome,
} from './modes/full-court/season-slot.ts';
export { type FullCourtInjuryEvent } from './modes/full-court/injuries.ts';
export {
  fullCourtFreePlayerReport,
  fullCourtLineupFitReport,
  fullCourtScoutPlayer,
  type FullCourtLineupFinding,
  type FullCourtLineupFindingCode,
  type FullCourtLineupFitReport,
} from './modes/full-court/scouting.ts';
export {
  fullCourtFilmReport,
  fullCourtLeagueWeaknesses,
  type FullCourtFilmPlayer,
  type FullCourtLeagueOpponentInput,
  type FullCourtOpponentWeaknessCode,
  type FullCourtOpponentWeaknessSummary,
} from './modes/full-court/opponent-film.ts';
export {
  buildFullCourtGameLineups,
  buildFullCourtGameLineupsFromFacts,
  buildFullCourtGameReport,
  type FullCourtCompletedGameFacts,
  type FullCourtLineupFactsOptions,
  type FullCourtPlayedGameFactsInput,
} from './modes/full-court/report.ts';
export {
  buildFullCourtAwards,
  buildFullCourtPlayerSeasonStats,
  type FullCourtAwardCandidate,
  type FullCourtAwardResult,
  type FullCourtAwardsBoard,
  type FullCourtAwardsTeamInput,
  type FullCourtLeagueLeaders,
  type FullCourtPlayerSeasonRow,
} from './modes/full-court/awards.ts';
export {
  buildFullCourtNotableMoments,
  fullCourtGameMomentsFromResult,
  type FullCourtMomentsTeamInput,
  type FullCourtNotableMoment,
  type FullCourtNotableMomentCategory,
  type FullCourtNotableMomentsSummary,
  type FullCourtNotableMomentTier,
} from './modes/full-court/moments.ts';
export {
  buildFullCourtSeasonStats,
  buildFullCourtSeasonSummary,
  type FullCourtSeasonLineupOmitted,
  type FullCourtSeasonLineupRow,
  type FullCourtSeasonLineupSummary,
  type FullCourtSeasonPlayoffStats,
  type FullCourtSeasonStatsInput,
  type FullCourtSeasonStatsSummary,
} from './modes/full-court/report-season.ts';
export {
  fullCourtPlayoffSeeds,
  fullCourtStandings,
  type FullCourtPlayoffSeeds,
  type FullCourtStandings,
  type FullCourtStandingsRow,
} from './modes/full-court/standings.ts';
export {
  lockFullCourtPlayoffs,
  createFullCourtPlayoffCheckpoint,
  fullCourtPlayoffView,
  fullCourtUserNextPlayoffMatchup,
  simulateFullCourtPlayoffGame,
  type FullCourtPlayoffFixture,
  type FullCourtPlayoffGameOutcome,
  type FullCourtPlayoffLock,
  type FullCourtPlayoffOpponentPreview,
  type FullCourtPlayoffSeries,
} from './modes/full-court/playoffs.ts';
export {
  FULL_COURT_INSIDE_SCORING_GAME_FLOOR_BPS,
  FULL_COURT_INSIDE_SCORING_THRESHOLD_BPS,
  FULL_COURT_OPPORTUNITY_CONCENTRATION_GAME_FLOOR_BPS,
  FULL_COURT_OPPORTUNITY_CONCENTRATION_THRESHOLD_BPS,
  FULL_COURT_PLAYOFF_ADAPTATION_MIN_GAMES,
  FULL_COURT_PLAYOFF_ADAPTATION_MIN_GAME_FGA,
  FULL_COURT_PLAYOFF_ADAPTATION_MIN_GAME_USAGE_CENTIS,
  FULL_COURT_PLAYOFF_ADAPTATION_WINDOW_GAMES,
  fullCourtPlayoffAdaptationForTeam,
  fullCourtPlayoffGameEvidence,
  fullCourtPlayoffMatchupAdaptations,
  fullCourtPlayoffSeriesEvidenceCount,
} from './modes/full-court/playoff-adaptation.ts';
export * from './profile.ts';
export { evaluateRunAchievements } from './achievements/classic.ts';
export {
  capRushAchievementFactsFromReport,
  evaluateCapRushAchievements,
} from './achievements/cap-rush.ts';
export { evaluateHavocAchievements, havocAchievementFactsFromRun } from './achievements/havoc.ts';
export {
  evaluateIndividualGameAchievements,
  evaluateIndividualSeasonAchievements,
  individualGameLineFromBoxScore,
  INDIVIDUAL_ACHIEVEMENT_IDS,
  type IndividualAchievement,
  type IndividualAchievementId,
  type IndividualAchievementMode,
  type IndividualGameFacts,
  type IndividualGamePlayerLine,
  type IndividualSeasonFacts,
  type IndividualSeasonPlayerFacts,
} from './achievements/individual.ts';
export {
  evaluateCapRushMultiplayerAchievements,
  evaluateSeriesAchievements,
  evaluateSharedSeasonAchievements,
  type CapRushMultiplayerAchievementFacts,
  type SeriesAchievementFacts,
  type SharedSeasonAchievementFacts,
} from './achievements/multiplayer.ts';
