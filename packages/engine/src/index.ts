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
export { usageOf } from './sim/recorder.ts';
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
// FROZEN postseason-v1 state machine (M2.6 replaced the v1 contract with
// postseason-v2; the v1 machine stays readable for legacy v1 artifacts).
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
} from './season/postseason-legacy.ts';
// Season Run (2.0 M2.6) authoritative regular-season tiebreak ranking:
// ranks all 15 teams of both conferences from the saved standings facts
// with the published NBA tiebreak sequence and records every applied
// criterion as a deterministic tie-resolution trace.
export {
  rankSeasonPostseason,
  type SeasonConferenceRanking,
  type SeasonPostseasonRankings,
} from './season/tiebreakers.ts';
// Season Run (2.0 M2.6) postseason-v2 state machine: Play-In resolution,
// the fixed 16-team best-of-seven bracket with 2-2-1-1-1 home pattern, the
// deterministic Finals home-court decision, per-game postseason summaries,
// and the injury/rehab/forfeit paths.
export {
  SEASON_POSTSEASON_RISKY_REHAB_COST,
  POSTSEASON_ALMANAC_DIGEST_PLACEHOLDER,
  seasonPostseasonSetRankings,
  seasonPostseasonNextGame,
  seasonPostseasonUpcomingGames,
  seasonPostseasonGameTeamsOf,
  seasonPostseasonHumanPlaysGame,
  seasonPostseasonHumanEliminated,
  seasonPostseasonApplyGameResult,
  decideSeasonFinalsHomeCourt,
  seasonPostseasonStageOf,
  rollPostseasonInjuryForPlayer,
  rollPostseasonRehabOutcome,
  defaultSeasonPostseasonGameResolver,
  zeroSeasonGameTransition,
  simulateSeasonPostseasonGame,
  seasonPostseasonSummaryFromGame,
  SeasonPostseasonInvariantError,
  type SeasonPostseasonRankingsInput,
  type SeasonPostseasonRankingsFn,
  type SeasonPostseasonNextGame,
  type SeasonPostseasonGameFacts,
  type SeasonPostseasonGameResolver,
  type SeasonPostseasonGameOutcome,
  type SeasonPostseasonGameSimulationInput,
} from './season/postseason.ts';
// Season Run (2.0 M2.6) awards: MVP, Defensive Player of the Year, Sixth
// Man of the Year, and All-League First Team, derived from recorded
// regular-season facts with the transparent composite and availability
// factor, plus the deterministic self-consistent digest.
export {
  deriveSeasonAwards,
  SEASON_AWARD_MIN_GAME_SHARE,
  SEASON_AWARD_FULL_SEASON_GAMES,
  type SeasonAwardsInput,
} from './season/awards.ts';
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
  simulateSeasonGameWithEffects,
  type SeasonGameAvailabilitySeam,
  type SeasonGameEffectsMode,
} from './season/season-game.ts';
export { checkSeasonGameResult } from './season/season-game-audit.ts';
export { seasonGenerationDigest, type SeasonGenerationDigestInput } from './season/digest.ts';
export {
  seasonDraftStateDigest,
  seasonDraftStateCanonical,
  applySeasonDraftCommand,
  type SeasonAiGenerationDeps,
} from './season/draft.ts';
export {
  drawGlobalOffer,
  selectionKeepsFeasibility,
  remainingCandidates,
  offerSeedPath,
  SEASON_DRAFT_COVERAGE_REASON,
  type SeasonOfferDrawResult,
} from './season/draft-offers.ts';
export {
  SOLO_BAND_QUOTAS,
  DUO_BAND_QUOTAS,
  AI_GENERATION_NODE_BUDGET,
  BAND_ORDER,
  IDENTITIES,
  DEFAULT_IDENTITY_PRIORITY_ROLES,
  SeasonAiGenerationError,
  SeasonAiTargetsError,
  generateAiLeague,
  assignAiBandsAndIdentities,
  evaluateSeasonRoster,
  fiveReachableFromCounts,
  identityPriorityRolesOf,
  runSeasonRosterCalibrationSeeds,
  validateSeasonRosterTargets,
  attachAiProjectionSummaries,
  type SeasonAiGenerationInput,
  type SeasonAiGenerationPhase,
  type SeasonRosterCalibrationRunV2,
} from './season/ai.ts';
export {
  TIER_ORDER,
  TIER_PERCENTILES,
  nearestRankThreshold,
  rolePercentileThresholds,
  percentileTierOf,
  playerPercentileTier,
  type PercentileTier,
  type RoleThresholds,
} from './season/ai-scoring.ts';
// M2.3 full-league blocks: home-court profile, compact summaries, aggregate
// folding, game reconstruction, checkpoint digests, block recaps, and the
// authoritative block pipeline shared by the worker and the CLI.
export {
  SEASON_HOME_COURT_DEFENSE_MAX_ADJUSTMENT,
  SEASON_HOME_COURT_TURNOVER_MAX_ADJUSTMENT,
  SEASON_HOME_COURT_PROFILE,
  seasonHomeCourtMechanisms,
  type SeasonHomeCourtMechanisms,
} from './season/home-court.ts';
export {
  seasonGameSummaryFromResult,
  seasonRetainedDetailFromResult,
  auditSeasonGameSummary,
  seasonEffectsRollupFromEvidence,
  seasonEffectsEvidenceOf,
} from './season/game-summary.ts';
// M2.4 stamina and chemistry effects: fixed-point fatigue transitions,
// canonical pair chemistry, the neutral effects hook, and the effects state
// helpers the block pipeline and calibration use.
export {
  SEASON_STAMINA_RATING_FLOOR,
  SEASON_STAMINA_RATING_CEIL,
  SEASON_STAMINA_RATING_PER_MPG,
  staminaRatingFromMpg,
  historicalMpgOf,
  onCourtFatigueBp,
  offCourtRecoveryBp,
  halftimeRemovalBp,
  regulationShareBp,
  recentLoadAfterGame,
  stintMultiplierBp,
  applySeasonRecoveryTick,
} from './season/stamina.ts';
export {
  SEASON_CHEMISTRY_HALF_SHARED,
  seasonPairKey,
  seasonPairIsCanonical,
  canonicalRosterPairs,
  unitPairs,
  pairChemistryBasisPoints,
  unitChemistryBasisPoints,
  unitSharedPossessions,
} from './season/chemistry.ts';
export {
  SEASON_EFFECTS_SHOOTER_FATIGUE_MAX_PP,
  SEASON_EFFECTS_HANDLER_FATIGUE_MAX_PP,
  SEASON_EFFECTS_DEFENSE_FATIGUE_MAX_PP,
  SEASON_EFFECTS_TURNOVER_SECURITY_MAX_PP,
  SEASON_EFFECTS_ASSIST_CONVERSION_MAX_PP,
  SEASON_EFFECTS_HELP_DEFENSE_MAX_PP,
  SEASON_EFFECTS_MECHANISM_CAPS,
  createSeasonEffectsBuffer,
  createSeasonEffectsState,
  applySeasonGameEffectsTransition,
  type SeasonEffectsHook,
  type SeasonEffectsBuffer,
  type SeasonEffectsTripFacts,
} from './season/effects.ts';
export {
  foldSeasonTeamAggregates,
  foldSeasonPlayerAggregates,
  auditSeasonAggregates,
  deriveSeasonLeaders,
  provisionalStandingOrder,
} from './season/aggregates.ts';
export {
  reconstructSeasonGames,
  seasonCheckpointCanonical,
  seasonCheckpointDigest,
} from './season/checkpoint.ts';
export {
  buildSeasonBlockRecap,
  auditSeasonBlockRecap,
  seasonBlockGameCount,
  seasonBlockRecapCanonical,
  seasonBlockRecapDigest,
  type SeasonBlockRecapInput,
} from './season/recap.ts';
export {
  seasonAcceptedBlockCount,
  seasonNextBlockIndex,
  expandSeasonRunRosters,
  rosterPlayerIdsOf,
  simulateSeasonBlock,
  seasonBlockGamesOf,
  simulateSeasonBlockGame,
  assembleSeasonBlockCandidate,
  seasonBlockRejection,
  auditSeasonBlock,
  handleSubmitSeasonBlockCommand,
  completeSeasonBlockCommit,
  deriveSeasonPostBlockState,
  resumeSeasonBlockFromPending,
  SeasonBlockValidationError,
  SeasonBlockInvariantError,
  SeasonBlockCancelledError,
  type SeasonBlockSimulationInput,
  type SeasonBlockSimulationOptions,
  type SeasonSubmitBlockCommandInput,
  type SeasonBlockGameOutcome,
} from './season/block.ts';
export { seasonRotationSetDigest } from './season/rotation.ts';
// Projection milestone minute-policy contract (minute-policy-v1): the
// risk-adjusted minute-plan optimizer, its facts, and the engine-authoritative
// fatigue bands consumed by the web app's projection worker and effects view.
export {
  buildMinutePlanCandidates,
  fatigueBandOf,
  minutePlanHorizonGames,
  minuteStrategyOfPreset,
  STRATEGY_TO_PRESET,
  MINUTE_PLAN_HEAVY_THRESHOLD_BP,
  FATIGUE_BAND_FRESH_MAX,
  FATIGUE_BAND_READY_MAX,
  FATIGUE_BAND_TIRED_MAX,
  type FatigueBand,
  type MinutePlanCandidate,
  type MinutePlanCandidates,
  type MinutePlanPlayerInput,
  type MinutePlanStructure,
} from './season/minute-plan.ts';
// Season Run (2.0 M2.5) health, influence, objectives, trades, command
// dispatch, and state digests consumed by the web app, persistence seam, and
// CLI calibration commands.
export { seasonFranchiseLegalFiveFacts, assembleSeasonPendingBlock } from './season/health.ts';
export {
  seasonGameHealthSeam,
  seasonForfeitSummaryForGame,
  advancePendingAfterForfeit,
  type HealthRunView,
} from './season/health.ts';
export {
  rollSeasonInjuryForPlayer,
  seasonInjuryRiskBasisPoints,
  seasonInjuryIdOf,
  applySeasonGameHealthTransition,
  seasonPlayerAvailable,
  rollSeasonRehabOutcome,
  applyRiskyRehabOutcome,
  SEASON_INJURY_BASE_RISK_BP,
  SEASON_INJURY_RISK_MIN_BP,
  SEASON_INJURY_RISK_MAX_BP,
  SEASON_INJURY_RECURRENCE_BONUS_BP,
  SEASON_INJURY_RECURRENCE_WINDOW_GAMES,
  SEASON_INJURY_SAME_GAME_RETURN_BP,
  SEASON_INJURY_REHAB_SUCCESS_BP,
  SEASON_INJURY_RECOVERY_RANGES,
  type SeasonInjuryRollInput,
  type SeasonInjuryRollResult,
} from './season/injuries.ts';
export { createInitialSeasonInfluenceState } from './season/influence.ts';
export { seasonObjectiveChoicesForBlock } from './season/objectives.ts';
export {
  handleSeasonRunCommand,
  SeasonRunCommandNotImplementedError,
  type SeasonRunCommandContext,
  type SeasonRunCommandResult,
  type SeasonRunCommandOutput,
} from './season/season-commands.ts';
export { seasonRunStateDigest, type SeasonRunStateDigestFacts } from './season/state-digest.ts';
export {
  openSeasonTradeWindow,
  WINDOW_BLOCK_INDEX_TO_INDEX,
  type SeasonWindowOpenResult,
} from './season/trades.ts';
// Classic draft exports live under the `classic` namespace: the module's
// `slotRequirement` would otherwise collide with domain/lineup.js.
export * as classic from './modes/classic/draft.ts';
// Projection milestone: deterministic, calculation-only base and Season
// projections over the possession engine's pure probability functions.
// Seedless; no Overall-derived value is used.
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
  projectSeasonRoster,
  projectedQualityWeights,
  optimizeSeasonRotation,
  traceRotationNormal,
  traceRotationClose,
  rankCandidates,
  searchRosterRotationCandidates,
  buildHumanSeasonRoster,
  SEARCH_LENSES,
  type ProjectionCacheStats,
  type RankedCandidate,
  type SearchLens,
  type RosterRotationSearchInput,
  type RosterRotationSearchResult,
  type HumanRosterBuildInput,
  type HumanRosterBuildResult,
  type MinutePlanOptimizationResult,
  type OptimizedMinutePlan,
} from './projection/index.ts';
