export { canPlay, type SlotGroup } from './domain/positions.ts';
export { slotRequirement, validateLineup } from './domain/lineup.ts';
export { classifyArchetype } from './domain/archetypes.ts';
export { createEngineContext, type EngineContext } from './sim/context.ts';
export { fnv1a32, hex32, createRng, type Rng, shuffle, swapAt } from './sim/rng.ts';
export { usageOf } from './sim/recorder.ts';
export { simulateGame } from './sim/game.ts';
export { checkGameResult, gameResultDigest } from './sim/invariants.ts';
export { evaluateLineupStrength } from './challenge/lineup-eval.ts';
export { evaluateContextualPlayerValue, evaluateLineupFit, evaluateMatchup, evaluateLineupMatchup, } from './challenge/contextual-value.ts';
export { explainSeason } from './challenge/explain.ts';
export { leagueMvp } from './challenge/mvp.ts';
export { perGamePlayer } from './challenge/aggregates.ts';
export { acceptGameResult, createChallenge, createGameInput, simulateChallenge, validateBracketContent, type ChallengeCreation, } from './challenge/commands.ts';
export { generateSchedule, scheduleInvariants } from './bracket/schedule.ts';
export { generateBracket, type BracketCandidatePlayer, type FranchiseCandidates, } from './bracket/generator.ts';
export { toSimulationPlayer } from './modes/sandbox/adapters.ts';
export { BEST_OF_ATTEMPTS, chooseBestRunSeed, simulateChallengeBestOf, } from './modes/sandbox/selection.ts';
export { conferenceOf, divisionOf, franchisesInConference, divisionOpponentsOf, conferenceNonDivisionOpponentsOf, oppositeConferenceOpponentsOf, } from './season/league.ts';
export { generateSeasonSchedule, auditSeasonSchedule, type GenerateSeasonScheduleInput, } from './season/schedule.ts';
export { reduceSeasonStandings, auditSeasonStandings } from './season/standings.ts';
export { setPlayInRankings, submitPlayInGame, createPlayoffBracket, submitPlayoffGame, currentSeriesId, auditSeasonPostseason, type PostseasonRankings, type PlayInGameResult, type PlayoffGameResult, } from './season/postseason-legacy.ts';
export { rankSeasonPostseason, type SeasonConferenceRanking, type SeasonPostseasonRankings, } from './season/tiebreakers.ts';
export { SEASON_POSTSEASON_RISKY_REHAB_COST, POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER, seasonPostseasonSetRankings, seasonPostseasonNextGame, seasonPostseasonUpcomingGames, seasonPostseasonGameTeamsOf, seasonPostseasonHumanPlaysGame, seasonPostseasonHumanEliminated, seasonPostseasonApplyGameResult, decideSeasonFinalsHomeCourt, seasonPostseasonStageOf, rollPostseasonInjuryForPlayer, rollPostseasonRehabOutcome, defaultSeasonPostseasonGameResolver, zeroSeasonGameTransition, simulateSeasonPostseasonGame, seasonPostseasonSummaryFromGame, SeasonPostseasonInvariantError, type SeasonPostseasonRankingsInput, type SeasonPostseasonRankingsFn, type SeasonPostseasonNextGame, type SeasonPostseasonGameFacts, type SeasonPostseasonGameResolver, type SeasonPostseasonGameOutcome, type SeasonPostseasonGameSimulationInput, } from './season/postseason.ts';
export { deriveSeasonAwards, SEASON_AWARD_MIN_GAME_SHARE, SEASON_AWARD_FULL_SEASON_GAMES, type SeasonAwardsInput, } from './season/awards.ts';
export { SEASON_ROSTER_RULES, groupMaskOf, rosterGroupCounts, legalFiveExists, legalFiveAfterAnyRemoval, completionTargetsMet, validateSeasonRoster, rosterFeasible, anyMemberPlays, type SeasonRosterMemberInput, } from './season/roster-rules.ts';
export { matchStartingFive, buildMinimalRotation, rotationTargetMinutes, auditSeasonRotation, validateSeasonRotation, applySeasonRotationPreset, handleSetSeasonRotationCommand, } from './season/rotation.ts';
export { enumerateLegalFives, chooseInitialUnit, planUnit, type PlannerMember, type PlannerRotationContext, type PlannerUnitRequest, } from './season/rotation-planner.ts';
export { simulateSeasonGame, simulateSeasonGameWithEffects, type SeasonGameAvailabilitySeam, type SeasonGameEffectsMode, } from './season/season-game.ts';
export { checkSeasonGameResult } from './season/season-game-audit.ts';
export { seasonGenerationDigest, type SeasonGenerationDigestInput } from './season/digest.ts';
export { seasonDraftStateDigest, seasonDraftStateCanonical, applySeasonDraftCommand, type SeasonAiGenerationDeps, } from './season/draft.ts';
export { drawGlobalOffer, selectionKeepsFeasibility, remainingCandidates, offerSeedPath, SEASON_DRAFT_COVERAGE_REASON, type SeasonOfferDrawResult, } from './season/draft-offers.ts';
export { SOLO_BAND_QUOTAS, DUO_BAND_QUOTAS, AI_GENERATION_NODE_BUDGET, BAND_ORDER, IDENTITIES, DEFAULT_IDENTITY_PRIORITY_ROLES, SeasonAiGenerationError, SeasonAiTargetsError, generateAiLeague, assignAiBandsAndIdentities, evaluateSeasonRoster, fiveReachableFromCounts, identityPriorityRolesOf, runSeasonRosterCalibrationSeeds, validateSeasonRosterTargets, attachAiProjectionSummaries, type SeasonAiGenerationInput, type SeasonAiGenerationPhase, type SeasonRosterCalibrationRunV2, } from './season/ai.ts';
export { TIER_ORDER, TIER_PERCENTILES, nearestRankThreshold, rolePercentileThresholds, percentileTierOf, playerPercentileTier, type PercentileTier, type RoleThresholds, } from './season/ai-scoring.ts';
export { SEASON_HOME_COURT_DEFENSE_MAX_ADJUSTMENT, SEASON_HOME_COURT_TURNOVER_MAX_ADJUSTMENT, SEASON_HOME_COURT_PROFILE, seasonHomeCourtMechanisms, type SeasonHomeCourtMechanisms, } from './season/home-court.ts';
export { seasonGameSummaryFromResult, seasonRetainedDetailFromResult, auditSeasonGameSummary, seasonEffectsRollupFromEvidence, seasonEffectsEvidenceOf, } from './season/game-summary.ts';
export { SEASON_STAMINA_RATING_FLOOR, SEASON_STAMINA_RATING_CEIL, SEASON_STAMINA_RATING_PER_MPG, staminaRatingFromMpg, historicalMpgOf, onCourtFatigueBp, offCourtRecoveryBp, halftimeRemovalBp, regulationShareBp, recentLoadAfterGame, stintMultiplierBp, applySeasonRecoveryTick, } from './season/stamina.ts';
export { SEASON_CHEMISTRY_HALF_SHARED, seasonPairKey, seasonPairIsCanonical, canonicalRosterPairs, unitPairs, pairChemistryBasisPoints, unitChemistryBasisPoints, unitSharedPossessions, } from './season/chemistry.ts';
export { SEASON_EFFECTS_SHOOTER_FATIGUE_MAX_PP, SEASON_EFFECTS_HANDLER_FATIGUE_MAX_PP, SEASON_EFFECTS_DEFENSE_FATIGUE_MAX_PP, SEASON_EFFECTS_TURNOVER_SECURITY_MAX_PP, SEASON_EFFECTS_ASSIST_CONVERSION_MAX_PP, SEASON_EFFECTS_HELP_DEFENSE_MAX_PP, SEASON_EFFECTS_MECHANISM_CAPS, createSeasonEffectsBuffer, createSeasonEffectsState, applySeasonGameEffectsTransition, type SeasonEffectsHook, type SeasonEffectsBuffer, type SeasonEffectsTripFacts, } from './season/effects.ts';
export { foldSeasonTeamAggregates, foldSeasonPlayerAggregates, auditSeasonAggregates, deriveSeasonLeaders, provisionalStandingOrder, } from './season/aggregates.ts';
export { reconstructSeasonGames, seasonCheckpointCanonical, seasonCheckpointDigest, } from './season/checkpoint.ts';
export { buildSeasonBlockRecap, auditSeasonBlockRecap, seasonBlockGameCount, seasonBlockRecapCanonical, seasonBlockRecapDigest, type SeasonBlockRecapInput, } from './season/recap.ts';
export { seasonAcceptedBlockCount, seasonNextBlockIndex, expandSeasonRunRosters, rosterPlayerIdsOf, simulateSeasonBlock, seasonBlockGamesOf, simulateSeasonBlockGame, assembleSeasonBlockCandidate, seasonBlockRejection, auditSeasonBlock, handleSubmitSeasonBlockCommand, completeSeasonBlockCommit, deriveSeasonPostBlockState, resumeSeasonBlockFromPending, SeasonBlockValidationError, SeasonBlockInvariantError, SeasonBlockCancelledError, type SeasonBlockSimulationInput, type SeasonBlockSimulationOptions, type SeasonSubmitBlockCommandInput, type SeasonBlockGameOutcome, } from './season/block.ts';
export { seasonRotationSetDigest } from './season/rotation.ts';
export { buildMinutePlanCandidates, fatigueBandOf, minutePlanHorizonGames, minuteStrategyOfPreset, STRATEGY_TO_PRESET, MINUTE_PLAN_HEAVY_THRESHOLD_BP, FATIGUE_BAND_FRESH_MAX, FATIGUE_BAND_READY_MAX, FATIGUE_BAND_TIRED_MAX, type FatigueBand, type MinutePlanCandidate, type MinutePlanCandidates, type MinutePlanPlayerInput, type MinutePlanStructure, } from './season/minute-plan.ts';
export { seasonFranchiseLegalFiveFacts, assembleSeasonPendingBlock } from './season/health.ts';
export { seasonGameHealthSeam, seasonForfeitSummaryForGame, advancePendingAfterForfeit, type HealthRunView, } from './season/health.ts';
export { rollSeasonInjuryForPlayer, seasonInjuryRiskBasisPoints, seasonInjuryIdOf, applySeasonGameHealthTransition, seasonPlayerAvailable, rollSeasonRehabOutcome, applyRiskyRehabOutcome, SEASON_INJURY_BASE_RISK_BP, SEASON_INJURY_RISK_MIN_BP, SEASON_INJURY_RISK_MAX_BP, SEASON_INJURY_RECURRENCE_BONUS_BP, SEASON_INJURY_RECURRENCE_WINDOW_GAMES, SEASON_INJURY_SAME_GAME_RETURN_BP, SEASON_INJURY_REHAB_SUCCESS_BP, SEASON_INJURY_RECOVERY_RANGES, type SeasonInjuryRollInput, type SeasonInjuryRollResult, } from './season/injuries.ts';
export { createInitialSeasonInfluenceState } from './season/influence.ts';
export { seasonObjectiveChoicesForBlock } from './season/objectives.ts';
export { handleSeasonRunCommand, SeasonRunCommandNotImplementedError, type SeasonRunCommandContext, type SeasonRunCommandResult, type SeasonRunCommandOutput, } from './season/season-commands.ts';
export { seasonRunStateDigest, type SeasonRunStateDigestFacts } from './season/state-digest.ts';
export { openSeasonTradeWindow, WINDOW_BLOCK_INDEX_TO_INDEX, seasonTradeValueBandFor, ratioMutuallyWithinBand, type SeasonTradePackageKind, type SeasonWindowOpenResult, } from './season/trades.ts';
export { SEASON_FREE_AGENCY_BAND_SIGNING_CAPS, SEASON_FREE_AGENCY_WINDOW_COMPOSITION, SEASON_FREE_AGENCY_WINDOW_MAX_CANDIDATES, SEASON_FREE_AGENCY_WINDOW_BLOCK_INDEXES, freeAgencySeed, seasonFreeAgencyUniverseOf, canonicalFreeAgencyIdentity, composeSeasonFreeAgencyWindow, openSeasonFreeAgencyWindow, freeAgencyUnresolvedWindowIndex, applyFreeAgencyDeclaration, applyFreeAgencySkip, resolveSeasonFreeAgencyWindow, FreeAgencyValidationRejection, type SeasonFreeAgencyContext, type SeasonFreeAgencyWindowOpenResult, type SeasonFreeAgencyResolutionResult, } from './season/free-agency.ts';
export { reconcileSeasonEffects, type SeasonEffectsReconcileInput } from './season/effects.ts';
export { generateSeasonCampaignOffers, evaluateSeasonCampaignOpportunity, generateSeasonCampaignEvolutionOffers, applySeasonCampaignEvolutionSelection, applySeasonCampaignReward, buildEmptyCampaignState, normalizeCampaignState, SEASON_CAMPAIGN_VERSION, SEASON_CAMPAIGN_TARGETS_VERSION, } from './season/campaign.ts';
export { deriveSeasonTradeGrades, seasonTradeGradeLabelOf, SEASON_TRADE_GRADE_MIN_SAMPLE, SEASON_TRADE_GRADE_NEUTRAL_SCORE, SEASON_TRADE_GRADE_WEIGHTS, type SeasonTradeGradesInput, } from './season/trade-grades.ts';
export { buildLocalSoloAuthority, buildMultiplayerAuthority, participantFranchiseIdsOf, authorityForFranchise, franchiseForParticipant, type SeasonRunAuthority, type SeasonParticipantId, type SeasonParticipantControl, } from '@hoop-rush/data-contracts';
import { classicRollSeed, sortClassicCatalog, slotRequirement as classicSlotRequirement, classicRollCandidates, classicRerollAvailable, rollClassicPair, createClassicDraft, rerollClassicFranchise, rerollClassicEra, draftClassicPlayer, repositionClassicPlayer, createClassicChallenge, } from './modes/classic/draft.ts';
export { classicRollSeed, sortClassicCatalog, classicRollCandidates, classicRerollAvailable, rollClassicPair, createClassicDraft, rerollClassicFranchise, rerollClassicEra, draftClassicPlayer, repositionClassicPlayer, createClassicChallenge, } from './modes/classic/draft.ts';
export { classicSlotRequirement };
export type { ClassicRollKind, ClassicDraftInput, ClassicDraftPlayerInput, ClassicRepositionInput, ClassicChallengeEnvironment, } from './modes/classic/draft.ts';
export const classic = Object.freeze({
    classicRollSeed,
    sortClassicCatalog,
    slotRequirement: classicSlotRequirement,
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
export { projectBaseFive, projectExpectedLedger, expectedStealShare, neutralReference, archetypeReference, archetypeReferences, resolveReference, identifyWeaknesses, weaknessPenalty, ProjectionCache, projectSeasonRoster, projectedQualityWeights, optimizeSeasonRotation, traceRotationNormal, traceRotationClose, rankCandidates, searchRosterRotationCandidates, buildHumanSeasonRoster, SEARCH_LENSES, type ProjectionCacheStats, type RankedCandidate, type SearchLens, type RosterRotationSearchInput, type RosterRotationSearchResult, type HumanRosterBuildInput, type HumanRosterBuildResult, type MinutePlanOptimizationResult, type OptimizedMinutePlan, } from './projection/index.ts';
export { FIXED_FIVE_SEED_VERSION, fixedFiveParticipantSeed, fixedFiveDraftSeed, fixedFiveFirstPicker, fixedFiveDuelGameSeed, fixedFiveSharedGameSeed, fixedFiveH2HSeed, fixedFiveAutopickSeed, fixedFiveAutopickSeedPath, FIXED_FIVE_TIEBREAK_PATH, fixedFiveTiebreakWinner, } from './modes/fixed-five/seeds.ts';
export { createSandboxBuilder, applySandboxBuilderCommand, isSandboxBuilderComplete, enumerateSandboxSafeMoves, type FixedFiveCandidate, type SandboxBuilderState, type SandboxBuilderCommand, } from './modes/fixed-five/sandbox-builder.ts';
export { applyClassicBuilderCommand, createParticipantClassicDraft, type ClassicBuilderCommand, type PoolEligibilityPolicy, } from './modes/fixed-five/classic-reducer.ts';
export { createDuelDraft, rerollDuel, claimDuelPlayer, duelPicksFor, isDuelComplete, duelAlternationHolds, duelCurrentPicker, type DuelDraftState, type DuelDraftPick, } from './modes/fixed-five/duel.ts';
export { enumerateClassicSafeMoves, enumerateDuelSafeMoves, chooseAutopick, chooseSandboxAutopicksUntilFull, type AutopickSelection, } from './modes/fixed-five/timeout.ts';
export { findWeakestOpponent, h2hGameNumbersFor, displayHomeForH2hIndex, simulateShared82, type Shared82SimulationInput, type Shared82SimulationOutput, } from './modes/fixed-five/shared82.ts';
export { simulateDuelSeries, type DuelSimulationInput, type DuelSimulationOutput, } from './modes/fixed-five/duel-sim.ts';
export { fixedFiveResultDigest, verifyFixedFiveDigest, canonicalFixedFiveDigestPayload, } from './modes/fixed-five/digest.ts';
