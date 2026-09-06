import {
  SEASON_ENDING_MISSED_GAMES_SENTINEL,
  SEASON_BLOCK_COUNT,
  SEASON_FREE_AGENCY_VERSION,
  SEASON_ROSTER_MAX_SIZE,
  SEASON_ROSTER_MIN_SIZE,
  SEASON_ROUND_COUNT,
  SEASON_SEED_NAMESPACES,
  SEASON_TEAM_COUNT,
  blockRoundRange,
  franchiseIdSchema,
  normalizeEvolutionState,
  seasonGameIdSchema,
  seasonNamespaceSeed,
  type EraSimulationProfile,
  type FranchiseId,
  type Position,
  type SeasonBlockRunContext,
  type SeasonCandidateCheckpoint,
  type SeasonCheckpointState,
  type SeasonCheckpointVersions,
  type SeasonCompactInjuryEvent,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonFreeAgencyIndex,
  type SeasonFreeAgencyState,
  type SeasonFreeAgencyWindowState,
  type SeasonGamePlayerInput,
  type SeasonGameSimulationInput,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonInfluenceState,
  type SeasonInjuryRecord,
  type SeasonInvalidRosterInterruption,
  type SeasonObjectiveId,
  type SeasonObjectiveState,
  type SeasonCampaignState,
  type SeasonPendingBlockCandidate,
  type SeasonRemovalEvent,
  type SeasonResumeSeasonBlockCommand,
  type SeasonResumeSeasonBlockResult,
  type SeasonRetainedGameDetail,
  type SeasonReturnEvent,
  type SeasonRoster,
  type SeasonRotation,
  type SeasonRun,
  type SeasonSchedule,
  type SeasonScheduleGame,
  type SeasonSubmitBlockCommand,
  type SeasonSubmitBlockRejection,
  type SeasonSubmitBlockResult,
  type SeasonTransactionEntry,
  type SeasonRosterTargets,
  type SeasonEvolutionState,
} from '@hoop-rush/data-contracts';
import { createEngineContext } from '../sim/context.ts';
import {
  auditSeasonAggregates,
  foldSeasonPlayerAggregates,
  foldSeasonTeamAggregates,
} from './aggregates.ts';
import { reconstructSeasonGames, seasonCheckpointDigest } from './checkpoint.ts';
import {
  auditSeasonGameSummary,
  seasonGameSummaryFromResult,
  seasonRetainedDetailFromResult,
} from './game-summary.ts';
import { SEASON_HOME_COURT_PROFILE } from './home-court.ts';
import { auditSeasonBlockRecap, buildSeasonBlockRecap, seasonBlockGameCount } from './recap.ts';
import { seasonRotationSetDigest, validateSeasonRotation } from './rotation.ts';
import { simulateSeasonGameWithEffects } from './season-game.ts';
import { resolveHomeGameRule } from './evolution.ts';
import { evolutionWithBlockCommit, type AiSelectionDataSource } from './evolution.ts';
import { applySeasonGameEffectsTransition } from './effects.ts';
import { applySeasonRecoveryTick } from './stamina.ts';
import { auditSeasonStandings, reduceSeasonStandings } from './standings.ts';
import {
  seasonFranchiseLegalFiveFacts,
  seasonGameHealthSeam,
  seasonPregameAvailabilityOf,
} from './health.ts';
import { applySeasonGameHealthTransition } from './injuries.ts';
import { generateSeasonSchedule } from './schedule.ts';
import { evaluateSeasonBlockObjective, seasonObjectiveChoicesForBlock } from './objectives.ts';
import {
  SEASON_CHALLENGE_CATALOG,
  type SeasonBlockChallengeEvaluation,
  type SeasonChallengeDeal,
  type SeasonChallengeState,
} from '@hoop-rush/data-contracts';
import { dealSeasonBlockChallenges, evaluateSeasonBlockChallenges } from './challenges.ts';
import {
  SEASON_CAMPAIGN_TARGETS_VERSION,
  SEASON_CAMPAIGN_VERSION,
  normalizeCampaignState,
} from './campaign.ts';
import { applySeasonBlockInfluenceGrants, createInitialSeasonInfluenceState } from './influence.ts';
import { seasonRunStateDigest } from './state-digest.ts';
import { openSeasonTradeWindow, type SeasonWindowOpenResult } from './trades.ts';
import { freeAgencyUnresolvedWindowIndex, openSeasonFreeAgencyWindow } from './free-agency.ts';
export function seasonAcceptedBlockCount(completedRounds: number): number {
  if (completedRounds <= 0) return 0;
  if (completedRounds > SEASON_ROUND_COUNT) {
    throw new Error(`completedRounds ${String(completedRounds)} out of range`);
  }
  return Math.ceil(completedRounds / 10);
}
export function seasonNextBlockIndex(completedRounds: number): number | null {
  if (completedRounds >= SEASON_ROUND_COUNT) return null;
  return seasonAcceptedBlockCount(completedRounds);
}
function cursorOfBlock(blockIndex: number): number {
  return blockIndex === 0 ? 0 : blockIndex * 10;
}
export class SeasonBlockValidationError extends Error {
  readonly rejection: SeasonSubmitBlockRejection;
  constructor(rejection: SeasonSubmitBlockRejection) {
    super(`season block rejected (${rejection.code})`);
    this.name = 'SeasonBlockValidationError';
    this.rejection = rejection;
  }
}
export class SeasonBlockInvariantError extends Error {
  readonly diagnostics: {
    seed?: string;
    gameId?: string;
    blockIndex?: number;
  };
  constructor(
    message: string,
    diagnostics: {
      seed?: string;
      gameId?: string;
      blockIndex?: number;
    } = {},
  ) {
    super(message);
    this.name = 'SeasonBlockInvariantError';
    this.diagnostics = diagnostics;
  }
}
export class SeasonBlockCancelledError extends Error {
  readonly blockIndex: number;
  readonly gamesCompleted: number;
  constructor(blockIndex: number, gamesCompleted: number) {
    super(`season block ${String(blockIndex)} cancelled after ${String(gamesCompleted)} games`);
    this.name = 'SeasonBlockCancelledError';
    this.blockIndex = blockIndex;
    this.gamesCompleted = gamesCompleted;
  }
}
export interface SeasonBlockSimulationInput {
  command: SeasonSubmitBlockCommand;
  run: SeasonBlockRunContext;
  expanded: ReadonlyMap<string, SeasonGamePlayerInput>;
  schedule: SeasonSchedule;
  catalog: SeasonDraftCatalog;
  profile: EraSimulationProfile;
  humanFranchiseId: string | null;
  participantFranchiseIds?: readonly string[] | null;
  rosterPlayerIds: ReadonlyMap<string, string>;
  priorSummaries: readonly SeasonGameSummary[];
  effects: SeasonEffectsState;
  health: SeasonHealthState;
  objectiveId: SeasonObjectiveId | null;
  objectiveIds?: ReadonlyMap<string, SeasonObjectiveId | null> | null;
  challengeDeal?: SeasonChallengeDeal | null;
  challengeDealsByFranchise?: ReadonlyMap<string, SeasonChallengeDeal | null> | null;
  challengeState?: SeasonChallengeState | null;
  campaignOpportunityId?: string | null;
  campaignOpportunityIds?: ReadonlyMap<string, string | null> | null;
  influence?: SeasonInfluenceState;
  transactions?: SeasonTransactionEntry[];
  freeAgency?: SeasonFreeAgencyState;
  objectives?: SeasonObjectiveState;
  campaignState?: SeasonCampaignState;
  collectedTipAvailability?: {
    gameId: string;
    availableCount: number;
  }[];
}
export interface SeasonSubmitBlockCommandInput extends SeasonBlockSimulationInput {
  acceptedCommandIds: readonly string[];
  objectives?: SeasonObjectiveState;
}
function emptyFreeAgencyStateOf(run: SeasonRun | SeasonBlockRunContext): SeasonFreeAgencyState {
  const franchiseIds = run.league.teams.map((team) => team.franchiseId);
  return {
    schemaVersion: 1,
    freeAgencyVersion: SEASON_FREE_AGENCY_VERSION,
    windows: [],
    canonicalCandidates: {},
    signingCounts: Object.fromEntries(franchiseIds.map((franchiseId) => [franchiseId, 0])),
    seasonSpend: Object.fromEntries(franchiseIds.map((franchiseId) => [franchiseId, 0])),
  };
}
export function seasonRunStateDigestFactsOf(
  next: SeasonRun,
  effects: SeasonEffectsState,
): Parameters<typeof seasonRunStateDigest>[0] {
  return {
    stateRevision: next.stateRevision,
    stage: next.stage,
    postseason: next.postseason,
    awards: next.awards,
    completion: next.completion,
    checkpointState: next.checkpointState,
    health: next.health,
    influence: next.influence,
    transactions: next.transactions,
    trade: next.trade,
    freeAgency: next.freeAgency,
    objectives: next.objectives,
    challenges: (next as unknown as { challenges?: SeasonChallengeState }).challenges ?? null,
    campaign: (
      next as {
        campaign?: unknown;
      }
    ).campaign as never,
    evolution: (
      next as unknown as {
        evolution?: import('@hoop-rush/data-contracts').SeasonEvolutionState | null;
      }
    ).evolution,
    rosters: next.rosters,
    ownership: next.ownership,
    rotations: next.rotations,
    effects,
    authority: next.authority,
  };
}
export interface SeasonBlockSimulationOptions {
  cancelAfterGames?: number;
}
export interface SeasonBlockGameSimulationOptions {
  skipRecoveryTick?: boolean;
  gameNumberById?: Map<string, number>;
  rotationByFranchise?: Map<string, SeasonRotation>;
  rosterByFranchise?: Map<string, SeasonRoster>;
  staminaByVersion?: Map<string, number>;
  durabilityByVersion?: Map<string, number>;
  positions?: Map<string, readonly Position[]>;
}
export function expandSeasonRunRosters(
  run: SeasonBlockRunContext,
  catalog: SeasonDraftCatalog,
): Map<string, SeasonGamePlayerInput> {
  const candidates = new Map(
    catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
  );
  const expanded = new Map<string, SeasonGamePlayerInput>();
  for (const roster of run.rosters) {
    for (const player of roster.players) {
      const { playerVersionId } = player;
      if (expanded.has(playerVersionId)) {
        throw new Error(`playerVersionId ${playerVersionId} appears on more than one roster`);
      }
      const candidate = candidates.get(playerVersionId);
      if (candidate === undefined) {
        throw new Error(
          `roster ${roster.franchiseId} references unknown catalog version ${playerVersionId}`,
        );
      }
      expanded.set(playerVersionId, {
        playerVersionId,
        playerId: player.playerId,
        displayName: player.displayName,
        positions: candidate.positions.playable,
        heightInches: candidate.heightInches,
        weightLbs: candidate.weightLbs,
        ratings: candidate.detailedRatings,
        tendencies: candidate.tendencies,
        stamina: {
          schemaVersion: 1,
          playerVersionId,
          rating: candidate.stamina.rating,
          historicalMpg: candidate.stamina.historicalMpg,
          derivationVersion: candidate.stamina.derivationVersion,
        },
      });
    }
  }
  const minExpanded = SEASON_TEAM_COUNT * SEASON_ROSTER_MIN_SIZE;
  const maxExpanded = SEASON_TEAM_COUNT * SEASON_ROSTER_MAX_SIZE;
  if (expanded.size < minExpanded || expanded.size > maxExpanded) {
    throw new Error(
      `expanded rosters must own between ${String(minExpanded)} and ${String(maxExpanded)} distinct versions (got ${String(expanded.size)})`,
    );
  }
  return expanded;
}
export function rosterPlayerIdsOf(run: SeasonBlockRunContext): Map<string, string> {
  const ids = new Map<string, string>();
  for (const roster of run.rosters) {
    for (const player of roster.players) {
      ids.set(player.playerVersionId, player.playerId);
    }
  }
  return ids;
}
export function seasonBlockRejection(
  input: SeasonBlockSimulationInput,
  acceptedCommandIds?: readonly string[],
): SeasonSubmitBlockRejection | null {
  const command = input.command;
  const run = input.run;
  if (command.runId !== run.runId) {
    return { code: 'run-mismatch', expectedRunId: run.runId };
  }
  if (acceptedCommandIds !== undefined && acceptedCommandIds.includes(command.commandId)) {
    return { code: 'duplicate-command', commandId: command.commandId };
  }
  const currentRevision = seasonAcceptedBlockCount(run.cursor.completedRounds);
  if (command.expectedRevision !== currentRevision) {
    return {
      code: 'stale-cursor',
      currentRevision,
      currentCompletedRounds: run.cursor.completedRounds,
    };
  }
  const expectedBlockIndex = seasonNextBlockIndex(run.cursor.completedRounds);
  if (expectedBlockIndex === null || command.blockIndex !== expectedBlockIndex) {
    return {
      code: 'non-boundary-block',
      expectedBlockIndex: expectedBlockIndex ?? SEASON_BLOCK_COUNT - 1,
      submittedBlockIndex: command.blockIndex,
    };
  }
  if (run.cursor.completedRounds !== cursorOfBlock(command.blockIndex)) {
    return {
      code: 'non-boundary-block',
      expectedBlockIndex,
      submittedBlockIndex: command.blockIndex,
    };
  }
  const hasChallengeInput =
    input.challengeDeal !== undefined ||
    input.challengeDealsByFranchise !== undefined ||
    input.challengeState !== undefined ||
    command.challengeIds !== undefined;
  if (hasChallengeInput) {
    const deal = input.challengeDeal ?? null;
    const commandIds = command.challengeIds ?? null;
    if (command.blockIndex >= 8) {
      if (commandIds !== null) {
        return {
          code: 'invalid-challenge',
          expected: 'none',
          blockIndex: command.blockIndex,
        };
      }
      if (deal !== null) {
        return {
          code: 'invalid-challenge',
          expected: 'none',
          blockIndex: command.blockIndex,
        };
      }
    } else {
      if (deal === null) {
        return {
          code: 'invalid-challenge',
          expected: 'required',
          blockIndex: command.blockIndex,
        };
      }
      if (deal.blockIndex !== command.blockIndex) {
        return {
          code: 'invalid-challenge',
          expected: 'not-offered',
          blockIndex: command.blockIndex,
        };
      }
      if (commandIds !== null) {
        const dealIds = [...deal.challengeIds].sort();
        const cmdIds = [...commandIds].sort();
        if (
          dealIds.length !== 3 ||
          cmdIds.length !== 3 ||
          dealIds.some((id, index) => id !== cmdIds[index])
        ) {
          return {
            code: 'invalid-challenge',
            expected: 'not-offered',
            blockIndex: command.blockIndex,
          };
        }
      }
    }
  } else if (input.objectives !== undefined) {
    if (command.blockIndex <= 7) {
      if (command.objectiveId === null) {
        return {
          code: 'invalid-objective',
          expected: 'required',
          blockIndex: command.blockIndex,
        };
      }
      const selection = input.objectives.selections[command.blockIndex];
      const offered = seasonObjectiveChoicesForBlock(run.rootSeed, command.blockIndex);
      const selectedAndOffered =
        selection !== undefined &&
        selection.objectiveId === command.objectiveId &&
        offered.includes(command.objectiveId);
      if (!selectedAndOffered) {
        return {
          code: 'invalid-objective',
          expected: 'not-offered',
          objectiveId: command.objectiveId,
          blockIndex: command.blockIndex,
        };
      }
    } else if (command.objectiveId !== null) {
      return {
        code: 'invalid-objective',
        expected: 'none',
        objectiveId: command.objectiveId,
        blockIndex: command.blockIndex,
      };
    }
  }
  const preBlockFreeAgency =
    input.freeAgency ?? (input.run as Partial<SeasonRun>).freeAgency ?? emptyFreeAgencyStateOf(run);
  const unresolvedWindowIndex = freeAgencyUnresolvedWindowIndex(preBlockFreeAgency);
  if (unresolvedWindowIndex !== null) {
    return {
      code: 'free-agency-unresolved',
      windowIndex: unresolvedWindowIndex,
      blockIndex: command.blockIndex,
    };
  }
  if (command.blockIndex >= 3) {
    const gate = evolutionSelectionGate({
      blockIndex: command.blockIndex,
      run,
      humanFranchiseId: input.humanFranchiseId,
    });
    if (gate !== null) return gate;
  }
  const computedDigest = seasonRotationSetDigest(run.rotations);
  const franchiseFailures: Array<{
    franchiseId: FranchiseId;
    reasons: string[];
  }> = [];
  if (computedDigest !== command.rotationDigest) {
    for (const rotation of run.rotations) {
      franchiseFailures.push({
        franchiseId: franchiseIdSchema.parse(rotation.franchiseId),
        reasons: [
          `rotation set digest ${computedDigest} does not match the submitted lock ${command.rotationDigest}`,
        ],
      });
    }
    return { code: 'invalid-rotations', franchiseFailures };
  }
  for (const rotation of run.rotations) {
    const roster = run.rosters.find((entry) => entry.franchiseId === rotation.franchiseId);
    const activePlayerIds = new Set([...rotation.starters, ...rotation.benchOrder]);
    const memberPlayable = new Map<string, readonly Position[]>();
    for (const player of roster?.players ?? []) {
      if (!activePlayerIds.has(player.playerVersionId)) continue;
      const expanded = input.expanded.get(player.playerVersionId);
      if (expanded !== undefined) {
        memberPlayable.set(expanded.playerVersionId, expanded.positions);
      }
    }
    const reasons = validateSeasonRotation(rotation, memberPlayable);
    if (reasons.length > 0) {
      franchiseFailures.push({
        franchiseId: franchiseIdSchema.parse(rotation.franchiseId),
        reasons,
      });
    }
  }
  if (franchiseFailures.length > 0) {
    return { code: 'invalid-rotations', franchiseFailures };
  }
  return null;
}
function requireValidSeasonBlockCommand(input: SeasonBlockSimulationInput): void {
  const rejection = seasonBlockRejection(input);
  if (rejection !== null) throw new SeasonBlockValidationError(rejection);
}
export function simulateSeasonBlock(
  input: SeasonBlockSimulationInput,
  options: SeasonBlockSimulationOptions = {},
): SeasonCandidateCheckpoint {
  requireValidSeasonBlockCommand(input);
  const summaries: SeasonGameSummary[] = [];
  const retainedDetails: SeasonRetainedGameDetail[] = [];
  const { fromRound } = blockRoundRange(input.command.blockIndex);
  let previousRound = fromRound - 1;
  let effects = input.effects;
  let health = input.health;
  const shared: SeasonBlockGameSimulationOptions = {
    gameNumberById: new Map(input.schedule.games.map((game, index) => [game.gameId, index + 1])),
    rotationByFranchise: new Map(
      input.run.rotations.map((rotation) => [rotation.franchiseId, rotation]),
    ),
    rosterByFranchise: new Map(input.run.rosters.map((roster) => [roster.franchiseId, roster])),
    staminaByVersion: staminaByVersionOf(input),
    durabilityByVersion: durabilityByVersionOf(input),
    positions: positionsOf(input),
  };
  for (const game of seasonBlockGamesOf(input.schedule, input.command.blockIndex)) {
    if (options.cancelAfterGames !== undefined && summaries.length >= options.cancelAfterGames) {
      throw new SeasonBlockCancelledError(input.command.blockIndex, summaries.length);
    }
    const outcome = simulateSeasonBlockGame({
      input,
      game,
      effects,
      health,
      options: {
        skipRecoveryTick: !(previousRound !== 0 && game.round > previousRound),
        ...shared,
      },
    });
    if ('interruption' in outcome) {
      throw new SeasonBlockInvariantError(
        `game ${game.gameId} interrupted: the human franchise ${outcome.interruption.humanFranchiseId} cannot field a legal five from health availability`,
        { seed: input.command.runId, gameId: game.gameId, blockIndex: input.command.blockIndex },
      );
    }
    effects = outcome.effects;
    health = outcome.health;
    previousRound = game.round;
    summaries.push(outcome.summary);
    if (outcome.retainedDetail !== null) retainedDetails.push(outcome.retainedDetail);
  }
  return assembleSeasonBlockCandidate({ input, summaries, retainedDetails, effects, health });
}
export function seasonBlockGamesOf(
  schedule: SeasonSchedule,
  blockIndex: number,
): SeasonScheduleGame[] {
  const { fromRound, toRound } = blockRoundRange(blockIndex);
  const blockGames = schedule.games
    .filter((game) => game.round >= fromRound && game.round <= toRound)
    .sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
  const expectedGameCount = seasonBlockGameCount(blockIndex);
  if (blockGames.length !== expectedGameCount) {
    throw new SeasonBlockInvariantError(
      `block ${String(blockIndex)} holds ${String(blockGames.length)} games, expected ${String(expectedGameCount)}`,
      { blockIndex },
    );
  }
  return blockGames;
}
export type SeasonBlockGameOutcome =
  | {
      summary: SeasonGameSummary;
      retainedDetail: SeasonRetainedGameDetail | null;
      effects: SeasonEffectsState;
      health: SeasonHealthState;
    }
  | {
      interruption: SeasonInvalidRosterInterruption;
    };
export interface SimulateSeasonBlockGameArgs {
  input: SeasonBlockSimulationInput;
  game: SeasonScheduleGame;
  effects: SeasonEffectsState;
  health: SeasonHealthState;
  options?: SeasonBlockGameSimulationOptions;
}
function isSimulateSeasonBlockGameArgs(
  value: SimulateSeasonBlockGameArgs | SeasonBlockSimulationInput,
): value is SimulateSeasonBlockGameArgs {
  return 'game' in value && 'effects' in value && 'health' in value;
}
export function simulateSeasonBlockGame(args: SimulateSeasonBlockGameArgs): SeasonBlockGameOutcome;
export function simulateSeasonBlockGame(
  input: SeasonBlockSimulationInput,
  game: SeasonScheduleGame,
  effects: SeasonEffectsState,
  health: SeasonHealthState,
  options?: SeasonBlockGameSimulationOptions,
): SeasonBlockGameOutcome;
export function simulateSeasonBlockGame(
  argsOrInput: SimulateSeasonBlockGameArgs | SeasonBlockSimulationInput,
  positionalGame?: SeasonScheduleGame,
  positionalEffects?: SeasonEffectsState,
  positionalHealth?: SeasonHealthState,
  positionalOptions: SeasonBlockGameSimulationOptions = {},
): SeasonBlockGameOutcome {
  let input: SeasonBlockSimulationInput;
  let game: SeasonScheduleGame;
  let effects: SeasonEffectsState;
  let health: SeasonHealthState;
  let options: SeasonBlockGameSimulationOptions;
  if (
    positionalGame !== undefined &&
    positionalEffects !== undefined &&
    positionalHealth !== undefined
  ) {
    if (isSimulateSeasonBlockGameArgs(argsOrInput)) {
      throw new SeasonBlockInvariantError(
        'simulateSeasonBlockGame: ambiguous call shape (object and positional args)',
      );
    }
    input = argsOrInput;
    game = positionalGame;
    effects = positionalEffects;
    health = positionalHealth;
    options = positionalOptions;
  } else {
    if (!isSimulateSeasonBlockGameArgs(argsOrInput)) {
      throw new SeasonBlockInvariantError('simulateSeasonBlockGame: missing game/effects/health');
    }
    input = argsOrInput.input;
    game = argsOrInput.game;
    effects = argsOrInput.effects;
    health = argsOrInput.health;
    options = argsOrInput.options ?? {};
  }
  const command = input.command;
  const run = input.run;
  const gameNumberById =
    options.gameNumberById ??
    new Map(input.schedule.games.map((game, index) => [game.gameId, index + 1]));
  const rotationByFranchise =
    options.rotationByFranchise ??
    new Map(run.rotations.map((rotation) => [rotation.franchiseId, rotation]));
  const rosterByFranchise =
    options.rosterByFranchise ?? new Map(run.rosters.map((roster) => [roster.franchiseId, roster]));
  const homeRoster = rosterByFranchise.get(game.homeFranchiseId);
  const awayRoster = rosterByFranchise.get(game.awayFranchiseId);
  const homeRotation = rotationByFranchise.get(game.homeFranchiseId);
  const awayRotation = rotationByFranchise.get(game.awayFranchiseId);
  if (
    homeRoster === undefined ||
    awayRoster === undefined ||
    homeRotation === undefined ||
    awayRotation === undefined
  ) {
    throw new SeasonBlockInvariantError(
      `game ${game.gameId} references a roster or rotation outside the run`,
      { gameId: game.gameId, blockIndex: command.blockIndex },
    );
  }
  const activePlayers = (roster: typeof homeRoster, rotation: typeof homeRotation) => {
    const activeIds = new Set([...rotation.starters, ...rotation.benchOrder]);
    return roster.players
      .filter((player) => activeIds.has(player.playerVersionId))
      .map((player) => expandedPlayer(input, game.gameId, player.playerVersionId));
  };
  const homePlayers = activePlayers(homeRoster, homeRotation);
  const awayPlayers = activePlayers(awayRoster, awayRotation);
  const seed = seasonNamespaceSeed(run.rootSeed, SEASON_SEED_NAMESPACES.scheduleGames, game.gameId);
  let pregame = effects;
  if (!(options.skipRecoveryTick ?? false)) {
    pregame = applySeasonRecoveryTick(
      pregame,
      options.staminaByVersion ?? staminaByVersionOf(input),
    );
  }
  const positions = options.positions ?? positionsOf(input);
  const participantFranchiseIds =
    input.participantFranchiseIds ?? (input.humanFranchiseId ? [input.humanFranchiseId] : []);
  const humanPlays = participantFranchiseIds.some(
    (id) => game.homeFranchiseId === id || game.awayFranchiseId === id,
  );
  let homeLegalFacts: {
    legal: boolean;
    unavailablePlayerVersionIds: string[];
  } | null = null;
  let awayLegalFacts: {
    legal: boolean;
    unavailablePlayerVersionIds: string[];
  } | null = null;
  if (humanPlays) {
    for (const pid of participantFranchiseIds) {
      if (game.homeFranchiseId !== pid && game.awayFranchiseId !== pid) continue;
      const facts = seasonFranchiseLegalFiveFacts(run, pid, health, positions);
      if (pid === game.homeFranchiseId) homeLegalFacts = facts;
      if (pid === game.awayFranchiseId) awayLegalFacts = facts;
      if (!facts.legal) {
        const interruption: SeasonInvalidRosterInterruption = {
          code: 'invalid-roster',
          runId: run.runId,
          blockIndex: command.blockIndex,
          commandId: command.commandId,
          nextGameId: game.gameId,
          humanFranchiseId: franchiseIdSchema.parse(pid),
          unavailablePlayerVersionIds: facts.unavailablePlayerVersionIds,
        };
        return { interruption };
      }
    }
  }
  homeLegalFacts ??= seasonFranchiseLegalFiveFacts(run, game.homeFranchiseId, health, positions);
  awayLegalFacts ??= seasonFranchiseLegalFiveFacts(run, game.awayFranchiseId, health, positions);
  const forfeitPending = !homeLegalFacts.legal || !awayLegalFacts.legal;
  const targetMinutesByPlayer = targetMinutesOf(input, game, rotationByFranchise);
  const seam = forfeitPending
    ? {
        pregame: seasonPregameAvailabilityOf(health, [...homePlayers, ...awayPlayers]),
        removals: [],
        returns: [],
        newInjuries: [],
      }
    : seasonGameHealthSeam(run, health, {
        rootSeed: run.rootSeed,
        gameId: game.gameId,
        round: game.round,
        homeFranchiseId: game.homeFranchiseId,
        awayFranchiseId: game.awayFranchiseId,
        targetMinutesByPlayer,
        durabilityByPlayer: options.durabilityByVersion ?? durabilityByVersionOf(input),
        effects: pregame,
      });
  if (humanPlays) {
    for (const pid of [...participantFranchiseIds].sort()) {
      if (game.homeFranchiseId !== pid && game.awayFranchiseId !== pid) continue;
      const roster = rosterByFranchise.get(pid);
      const availableCount =
        roster === undefined
          ? 0
          : roster.players.filter((player) => seam.pregame.get(player.playerVersionId) === true)
              .length;
      const nextEntry = { gameId: game.gameId, availableCount };
      if (input.collectedTipAvailability === undefined) {
        input.collectedTipAvailability = [nextEntry];
      } else {
        input.collectedTipAvailability.push(nextEntry);
      }
    }
  }
  const gameInput: SeasonGameSimulationInput = {
    schemaVersion: 1,
    seed,
    gameNumber: gameNumberById.get(game.gameId) ?? 1,
    dataVersion: input.catalog.dataVersion,
    profile: input.profile,
    home: {
      teamId: game.homeFranchiseId,
      displayName: game.homeFranchiseId,
      franchiseId: game.homeFranchiseId,
      players: homePlayers,
    },
    away: {
      teamId: game.awayFranchiseId,
      displayName: game.awayFranchiseId,
      franchiseId: game.awayFranchiseId,
      players: awayPlayers,
    },
    homeRotation,
    awayRotation,
    availability: [...homePlayers, ...awayPlayers].map((player) => ({
      playerVersionId: player.playerVersionId,
      available: seam.pregame.get(player.playerVersionId) ?? true,
    })),
    removals: seam.removals.map((removal) => ({
      side: sideOfPlayer(game, removal.playerVersionId, rosterByFranchise),
      playerVersionId: removal.playerVersionId,
      period: removal.clock.period,
      secondsRemaining: removal.clock.seconds,
      reason: 'injury',
    })),
    returns: seam.returns.map((ret) => ({
      side: sideOfPlayer(game, ret.playerVersionId, rosterByFranchise),
      playerVersionId: ret.playerVersionId,
      period: ret.clock.period,
      secondsRemaining: ret.clock.seconds,
      reason: 'injury-return',
    })),
    homeCourt: SEASON_HOME_COURT_PROFILE,
    gameRule: resolveHomeGameRule(
      (run as unknown as { evolution?: import('@hoop-rush/data-contracts').SeasonEvolutionState })
        .evolution ?? null,
      game.homeFranchiseId,
    ),
  };
  const { result, transition } = simulateSeasonGameWithEffects(
    gameInput,
    createEngineContext(),
    pregame,
  );
  if (result.seed !== seed) {
    throw new SeasonBlockInvariantError(
      `game ${game.gameId} result seed ${result.seed} does not match the derived seed ${seed}`,
      { seed, gameId: game.gameId, blockIndex: command.blockIndex },
    );
  }
  if (result.outcome === 'no-legal-five-both') {
    throw new SeasonBlockInvariantError(
      `game ${game.gameId} has no legal five on either side (seed ${seed}); refusing to fabricate a winner`,
      { seed, gameId: game.gameId, blockIndex: command.blockIndex },
    );
  }
  const nextEffects = applySeasonGameEffectsTransition(pregame, transition);
  const sameGameReturned = sameGameReturnResolutionsOf(seam.newInjuries, result);
  const nextHealth = applySeasonGameHealthTransition(health, {
    gameId: game.gameId,
    round: game.round,
    franchises: [game.homeFranchiseId, game.awayFranchiseId],
    newInjuries: seam.newInjuries,
    sameGameReturned,
  });
  const injuryEvents = compactInjuryEventsOf(game, rosterByFranchise, seam, result);
  const summary = seasonGameSummaryFromResult(result, game, transition, injuryEvents);
  const summaryFailures = auditSeasonGameSummary(summary);
  if (summaryFailures.length > 0) {
    throw new SeasonBlockInvariantError(
      `game ${game.gameId} summary audit failed: ${summaryFailures.join('; ')}`,
      { seed, gameId: game.gameId, blockIndex: command.blockIndex },
    );
  }
  let retainedDetail: SeasonRetainedGameDetail | null = null;
  if (
    participantFranchiseIds.some((id) => game.homeFranchiseId === id || game.awayFranchiseId === id)
  ) {
    retainedDetail = seasonRetainedDetailFromResult(
      result,
      game,
      run.runId,
      transition,
      injuryEvents,
    );
  }
  return { summary, retainedDetail, effects: nextEffects, health: nextHealth };
}
function staminaByVersionOf(input: SeasonBlockSimulationInput): Map<string, number> {
  const ratings = new Map<string, number>();
  for (const player of input.expanded.values()) {
    if (player.stamina === undefined) {
      throw new SeasonBlockInvariantError(
        `expanded player ${player.playerVersionId} has no stamina profile`,
      );
    }
    ratings.set(player.playerVersionId, player.stamina.rating);
  }
  return ratings;
}
function targetMinutesOf(
  input: SeasonBlockSimulationInput,
  game: SeasonScheduleGame,
  rotationByFranchise: ReadonlyMap<string, SeasonRotation>,
): Map<string, number> {
  const targets = new Map<string, number>();
  for (const franchiseId of [game.homeFranchiseId, game.awayFranchiseId]) {
    const rotation = rotationByFranchise.get(franchiseId);
    if (rotation === undefined) {
      throw new SeasonBlockInvariantError(
        `game ${game.gameId} references rotation ${franchiseId}`,
        { gameId: game.gameId, blockIndex: input.command.blockIndex },
      );
    }
    for (const entry of rotation.targetMinutes) {
      targets.set(entry.playerVersionId, entry.minutes);
    }
  }
  return targets;
}
function durabilityByVersionOf(input: SeasonBlockSimulationInput): Map<string, number> {
  const ratings = new Map<string, number>();
  for (const candidate of input.catalog.candidates) {
    ratings.set(candidate.playerVersionId, candidate.durability.rating);
  }
  return ratings;
}
function positionsOf(input: SeasonBlockSimulationInput): Map<string, readonly Position[]> {
  const positions = new Map<string, readonly Position[]>();
  for (const player of input.expanded.values()) {
    positions.set(player.playerVersionId, player.positions);
  }
  return positions;
}
function sideOfPlayer(
  game: SeasonScheduleGame,
  playerVersionId: string,
  rosterByFranchise: ReadonlyMap<string, SeasonRoster>,
): 'home' | 'away' {
  const homeRoster = rosterByFranchise.get(game.homeFranchiseId);
  if (homeRoster?.players.some((player) => player.playerVersionId === playerVersionId)) {
    return 'home';
  }
  const awayRoster = rosterByFranchise.get(game.awayFranchiseId);
  if (awayRoster?.players.some((player) => player.playerVersionId === playerVersionId)) {
    return 'away';
  }
  throw new Error(`season block: version ${playerVersionId} plays neither side of ${game.gameId}`);
}
function sameGameReturnResolutionsOf(
  newInjuries: readonly SeasonInjuryRecord[],
  result: ReturnType<typeof simulateSeasonGameWithEffects>['result'],
): {
  injuryId: string;
  returned: boolean;
}[] {
  const candidates = newInjuries.filter((record) => record.sameGameReturn);
  if (candidates.length === 0) return [];
  const returnedIds = new Set<string>();
  if (result.outcome === 'completed') {
    for (const side of [result.home, result.away]) {
      for (const ret of side.returns) returnedIds.add(ret.playerVersionId);
    }
  }
  return candidates.map((record) => ({
    injuryId: record.injuryId,
    returned: returnedIds.has(record.playerVersionId),
  }));
}
function compactInjuryEventsOf(
  game: SeasonScheduleGame,
  rosterByFranchise: ReadonlyMap<string, SeasonRoster>,
  seam: ReturnType<typeof seasonGameHealthSeam>,
  result: ReturnType<typeof simulateSeasonGameWithEffects>['result'],
): SeasonCompactInjuryEvent[] {
  if (seam.newInjuries.length === 0) return [];
  const appliedRemovalByPlayer = new Map<string, SeasonRemovalEvent>();
  const appliedReturnByPlayer = new Map<string, SeasonReturnEvent>();
  if (result.outcome === 'completed') {
    for (const event of result.removals) {
      appliedRemovalByPlayer.set(event.playerVersionId, event);
    }
    for (const side of [result.home, result.away]) {
      for (const event of side.returns) {
        appliedReturnByPlayer.set(event.playerVersionId, event);
      }
    }
  }
  const rolledRemovalByPlayer = new Map(
    seam.removals.map((removal) => [removal.playerVersionId, removal.clock]),
  );
  return seam.newInjuries.map((record) => {
    const appliedRemoval = appliedRemovalByPlayer.get(record.playerVersionId);
    const rolledRemoval = rolledRemovalByPlayer.get(record.playerVersionId);
    const removedClock =
      appliedRemoval !== undefined
        ? { period: appliedRemoval.period, seconds: appliedRemoval.secondsRemaining }
        : (rolledRemoval ?? { period: 1, seconds: 720 });
    const appliedReturn = appliedReturnByPlayer.get(record.playerVersionId);
    return {
      playerVersionId: record.playerVersionId,
      side: sideOfPlayer(game, record.playerVersionId, rosterByFranchise),
      type: record.type,
      severity: record.severity,
      removedClock,
      returned: appliedReturn !== undefined,
      returnClock:
        appliedReturn !== undefined
          ? { period: appliedReturn.period, seconds: appliedReturn.secondsRemaining }
          : null,
    };
  });
}
export interface AssembleSeasonBlockCandidateArgs {
  input: SeasonBlockSimulationInput;
  summaries: readonly SeasonGameSummary[];
  retainedDetails: readonly SeasonRetainedGameDetail[];
  effects: SeasonEffectsState;
  health: SeasonHealthState;
}
function isAssembleSeasonBlockCandidateArgs(
  value: AssembleSeasonBlockCandidateArgs | SeasonBlockSimulationInput,
): value is AssembleSeasonBlockCandidateArgs {
  return (
    'summaries' in value && 'retainedDetails' in value && 'effects' in value && 'health' in value
  );
}
export function assembleSeasonBlockCandidate(
  args: AssembleSeasonBlockCandidateArgs,
): SeasonCandidateCheckpoint;
export function assembleSeasonBlockCandidate(
  input: SeasonBlockSimulationInput,
  summaries: readonly SeasonGameSummary[],
  retainedDetails: readonly SeasonRetainedGameDetail[],
  effects: SeasonEffectsState,
  health: SeasonHealthState,
): SeasonCandidateCheckpoint;
export function assembleSeasonBlockCandidate(
  argsOrInput: AssembleSeasonBlockCandidateArgs | SeasonBlockSimulationInput,
  positionalSummaries?: readonly SeasonGameSummary[],
  positionalRetainedDetails?: readonly SeasonRetainedGameDetail[],
  positionalEffects?: SeasonEffectsState,
  positionalHealth?: SeasonHealthState,
): SeasonCandidateCheckpoint {
  let input: SeasonBlockSimulationInput;
  let summaries: readonly SeasonGameSummary[];
  let retainedDetails: readonly SeasonRetainedGameDetail[];
  let effects: SeasonEffectsState;
  let health: SeasonHealthState;
  if (
    positionalSummaries !== undefined &&
    positionalRetainedDetails !== undefined &&
    positionalEffects !== undefined &&
    positionalHealth !== undefined
  ) {
    if (isAssembleSeasonBlockCandidateArgs(argsOrInput)) {
      throw new SeasonBlockInvariantError(
        'assembleSeasonBlockCandidate: ambiguous call shape (object and positional args)',
      );
    }
    input = argsOrInput;
    summaries = positionalSummaries;
    retainedDetails = positionalRetainedDetails;
    effects = positionalEffects;
    health = positionalHealth;
  } else {
    if (!isAssembleSeasonBlockCandidateArgs(argsOrInput)) {
      throw new SeasonBlockInvariantError(
        'assembleSeasonBlockCandidate: missing summaries/retainedDetails/effects/health',
      );
    }
    input = argsOrInput.input;
    summaries = argsOrInput.summaries;
    retainedDetails = argsOrInput.retainedDetails;
    effects = argsOrInput.effects;
    health = argsOrInput.health;
  }
  const command = input.command;
  const run = input.run;
  const allSummaries = [...input.priorSummaries, ...summaries];
  const standingsBefore = reduceSeasonStandings(
    run.league,
    reconstructSeasonGames(input.schedule, input.priorSummaries),
  );
  const standings = reduceSeasonStandings(
    run.league,
    reconstructSeasonGames(input.schedule, allSummaries),
  );
  const teams = foldSeasonTeamAggregates(allSummaries);
  const players = foldSeasonPlayerAggregates(allSummaries);
  const { toRound } = blockRoundRange(command.blockIndex);
  const completedRounds = toRound;
  const participantIds = [
    ...(input.participantFranchiseIds ?? (input.humanFranchiseId ? [input.humanFranchiseId] : [])),
  ].sort();
  const primaryFranchiseId = participantIds[0] ?? input.humanFranchiseId;
  const humanRotation =
    primaryFranchiseId === null
      ? null
      : (run.rotations.find((rotation) => rotation.franchiseId === primaryFranchiseId) ?? null);
  const hasChallengeDeal =
    input.challengeDeal !== undefined ||
    input.challengeDealsByFranchise !== undefined ||
    input.challengeState !== undefined;
  const primaryDeal: SeasonChallengeDeal | null =
    input.challengeDeal ??
    (primaryFranchiseId !== null
      ? (input.challengeDealsByFranchise?.get(primaryFranchiseId) ?? null)
      : null);
  let challengeEvaluation: SeasonBlockChallengeEvaluation | null = null;
  const challengeEvaluationsByFranchise: Record<string, SeasonBlockChallengeEvaluation> = {};
  if (hasChallengeDeal && primaryDeal !== null) {
    challengeEvaluation = evaluateSeasonBlockChallenges({
      deal: primaryDeal,
      blockIndex: command.blockIndex,
      humanFranchiseId: primaryFranchiseId,
      summaries: [...summaries],
    });
    for (const pid of participantIds) {
      const dealForPid =
        input.challengeDealsByFranchise?.get(pid) ??
        (pid === primaryFranchiseId ? primaryDeal : null);
      if (dealForPid === null) continue;
      challengeEvaluationsByFranchise[pid] = evaluateSeasonBlockChallenges({
        deal: dealForPid,
        blockIndex: command.blockIndex,
        humanFranchiseId: pid,
        summaries: [...summaries],
      });
    }
  }
  const objective = evaluateSeasonBlockObjective({
    objectiveId: input.objectiveId,
    blockIndex: command.blockIndex,
    humanFranchiseId: primaryFranchiseId,
    rotation: humanRotation,
    summaries: [...summaries],
    tipAvailability: input.collectedTipAvailability ?? [],
  });
  const objectiveEvaluations: Record<
    string,
    import('@hoop-rush/data-contracts').SeasonObjectiveEvaluation
  > = {};
  const objectiveSuccessByFranchise: Record<string, boolean | null> = {};
  for (const pid of participantIds) {
    const oid =
      input.objectiveIds?.get(pid) ?? (pid === primaryFranchiseId ? input.objectiveId : null);
    const rot = run.rotations.find((r) => r.franchiseId === pid) ?? null;
    const evalRes = evaluateSeasonBlockObjective({
      objectiveId: oid,
      blockIndex: command.blockIndex,
      humanFranchiseId: pid,
      rotation: rot,
      summaries: [...summaries],
      tipAvailability: [...(input.collectedTipAvailability ?? [])],
    });
    objectiveEvaluations[pid] = evalRes.evaluation;
    objectiveSuccessByFranchise[pid] = evalRes.success;
  }
  if (participantIds.length === 0) {
    objectiveEvaluations['solo'] = objective.evaluation;
    objectiveSuccessByFranchise['solo'] = objective.success;
  }
  const campaign: {
    opportunityId: string | null;
    outcome: 'missed' | 'completed' | 'breakthrough' | null;
    evaluation: import('@hoop-rush/data-contracts').SeasonCampaignEvaluation | null;
  } = {
    opportunityId: null,
    outcome: null,
    evaluation: null,
  };
  const franchiseIds = run.league.teams.map((team) => team.franchiseId);
  const preBlockInfluence =
    input.influence ??
    (input.run as Partial<SeasonRun>).influence ??
    createInitialSeasonInfluenceState(franchiseIds);
  const grantResult = hasChallengeDeal
    ? applySeasonBlockInfluenceGrants({
        influence: preBlockInfluence,
        blockIndex: command.blockIndex,
        humanFranchiseId: primaryFranchiseId,
        participantFranchiseIds: participantIds,
        challengeSuccesses: challengeEvaluation
          ? challengeEvaluation.results.map((result) => ({
              challengeId: result.challengeId,
              success: result.success,
              reward:
                SEASON_CHALLENGE_CATALOG.find((entry) => entry.challengeId === result.challengeId)
                  ?.reward ?? 1,
            }))
          : null,
        challengeSuccessesByFranchise: Object.fromEntries(
          Object.entries(challengeEvaluationsByFranchise).map(([franchiseId, evaluation]) => [
            franchiseId,
            evaluation.results.map((result) => ({
              challengeId: result.challengeId,
              success: result.success,
              reward:
                SEASON_CHALLENGE_CATALOG.find((entry) => entry.challengeId === result.challengeId)
                  ?.reward ?? 1,
            })),
          ]),
        ),
      })
    : applySeasonBlockInfluenceGrants({
        influence: preBlockInfluence,
        blockIndex: command.blockIndex,
        humanFranchiseId: primaryFranchiseId,
        participantFranchiseIds: participantIds,
        objectiveSuccess: objective.success,
        objectiveSuccessByFranchise,
      });
  const postTransactions = [...(input.transactions ?? []), ...grantResult.entries];
  const recapInput = {
    runId: run.runId,
    blockIndex: command.blockIndex,
    completedRounds,
    humanFranchiseId: input.humanFranchiseId,
    summaries: allSummaries,
    standingsBefore,
    standingsAfter: standings,
    playerAggregates: players,
    schedule: input.schedule,
    rosterPlayerIds: input.rosterPlayerIds,
    health,
    objective,
    challenges: challengeEvaluation,
    campaign,
    transactions: postTransactions,
    influence: grantResult.influence,
  };
  const recap = buildSeasonBlockRecap(recapInput);
  const aggregateFailures = auditSeasonAggregates({
    teams,
    players,
    summaries: allSummaries,
    standings,
    freshTeams: teams,
    freshPlayers: players,
  });
  const recapFailures = auditSeasonBlockRecap(recap, recapInput);
  if (aggregateFailures.length > 0 || recapFailures.length > 0) {
    throw new SeasonBlockInvariantError(
      `block ${String(command.blockIndex)} audit failed: ${[...aggregateFailures, ...recapFailures].join('; ')}`,
      { blockIndex: command.blockIndex },
    );
  }
  const versions: SeasonCheckpointVersions = {
    blockVersion: run.versions.blockVersion,
    summaryVersion: run.versions.summaryVersion,
    aggregatesVersion: run.versions.aggregatesVersion,
    recapVersion: run.versions.recapVersion,
    leadersVersion: run.versions.leadersVersion,
    homeCourtVersion: run.versions.homeCourtVersion,
    gameVersion: run.versions.gameVersion,
    gameTargetsVersion: run.versions.gameTargetsVersion,
    seedDerivationVersion: run.versions.seedDerivationVersion,
    staminaVersion: run.versions.staminaVersion,
    chemistryVersion: run.versions.chemistryVersion,
    effectsTargetsVersion: run.versions.effectsTargetsVersion,
    healthVersion: run.versions.healthVersion,
    tradeVersion: run.versions.tradeVersion,
    influenceVersion: run.versions.influenceVersion,
    objectiveVersion: run.versions.objectiveVersion,
    challengeVersion: (
      run.versions as unknown as {
        challengeVersion?: SeasonCheckpointVersions['challengeVersion'];
      }
    ).challengeVersion,
    challengeTargetsVersion: (
      run.versions as unknown as {
        challengeTargetsVersion?: SeasonCheckpointVersions['challengeTargetsVersion'];
      }
    ).challengeTargetsVersion,
    campaignVersion:
      (
        run.versions as unknown as {
          campaignVersion?: typeof SEASON_CAMPAIGN_VERSION;
        }
      ).campaignVersion ?? SEASON_CAMPAIGN_VERSION,
    campaignTargetsVersion:
      (
        run.versions as unknown as {
          campaignTargetsVersion?: typeof SEASON_CAMPAIGN_TARGETS_VERSION;
        }
      ).campaignTargetsVersion ?? SEASON_CAMPAIGN_TARGETS_VERSION,
    injuryTargetsVersion: run.versions.injuryTargetsVersion,
    tradeTargetsVersion: run.versions.tradeTargetsVersion,
    influenceTargetsVersion: run.versions.influenceTargetsVersion,
    freeAgencyVersion: run.versions.freeAgencyVersion,
    freeAgencyIndexVersion: run.versions.freeAgencyIndexVersion,
    freeAgencyTargetsVersion: run.versions.freeAgencyTargetsVersion,
  };
  const candidate: SeasonCandidateCheckpoint = {
    schemaVersion: 1,
    checkpointVersion: run.versions.checkpointVersion,
    runId: run.runId,
    rootSeed: run.rootSeed,
    versions,
    blockIndex: command.blockIndex,
    completedRounds,
    revision: command.expectedRevision,
    rotationDigest: command.rotationDigest,
    standings,
    teamAggregates: teams,
    playerAggregates: players,
    gameSummaries: [...summaries].sort((a, b) => (a.gameId < b.gameId ? -1 : 1)),
    retainedDetails: [...retainedDetails].sort((a, b) => (a.gameId < b.gameId ? -1 : 1)),
    recap,
    effects,
    health,
    influence: grantResult.influence,
    freeAgency:
      input.freeAgency ??
      (input.run as Partial<SeasonRun>).freeAgency ??
      emptyFreeAgencyStateOf(run),
    transactions: postTransactions,
    objective: {
      objectiveId: objective.objectiveId,
      success: objective.success,
      evaluation: objective.evaluation,
    },
    objectiveEvaluations:
      Object.keys(objectiveEvaluations).length > 0 ? objectiveEvaluations : undefined,
    challenges: challengeEvaluation ?? undefined,
    challengeIds: primaryDeal
      ? ([...primaryDeal.challengeIds] as SeasonCandidateCheckpoint['challengeIds'])
      : undefined,
    campaign,
    expectedStateRevision: command.expectedStateRevision,
    expectedStateDigest: command.expectedStateDigest,
    stateRevision: 0,
    stateDigest: '0'.repeat(32),
    digest: '',
  };
  const digest = seasonCheckpointDigest(candidate);
  return { ...candidate, digest };
}
function expandedPlayer(
  input: SeasonBlockSimulationInput,
  gameId: string,
  playerVersionId: string,
): SeasonGamePlayerInput {
  const player = input.expanded.get(playerVersionId);
  if (player === undefined) {
    throw new SeasonBlockInvariantError(
      `game ${gameId} references an unexpanded version ${playerVersionId}`,
      { gameId },
    );
  }
  return player;
}
export function handleSubmitSeasonBlockCommand(
  input: SeasonSubmitBlockCommandInput,
): SeasonSubmitBlockResult {
  const rejection = seasonBlockRejection(input, input.acceptedCommandIds);
  if (rejection !== null) return { status: 'rejected', rejection };
  try {
    const checkpoint = simulateSeasonBlock(input);
    return { status: 'accepted', checkpoint };
  } catch (error) {
    if (error instanceof SeasonBlockValidationError) {
      return { status: 'rejected', rejection: error.rejection };
    }
    throw error;
  }
}
function objectivesWithBlockSuccess(
  objectives: SeasonObjectiveState | undefined,
  candidate: SeasonCandidateCheckpoint,
): SeasonObjectiveState | undefined {
  if (objectives === undefined) return undefined;
  if (candidate.blockIndex === 8) return objectives;
  if (candidate.objective === undefined) return objectives;
  const selection = objectives.selections[candidate.blockIndex];
  if (selection === undefined) return objectives;
  return {
    ...objectives,
    selections: {
      ...objectives.selections,
      [candidate.blockIndex]: { ...selection, success: candidate.objective.success },
    },
  };
}
function challengesWithBlockEvaluation(
  challenges: SeasonChallengeState | undefined,
  candidate: SeasonCandidateCheckpoint,
): SeasonChallengeState | undefined {
  if (challenges === undefined) return undefined;
  if (candidate.challenges == null) return challenges;
  const evaluation = candidate.challenges;
  const existing = challenges.evaluations.some(
    (entry) => entry.blockIndex === evaluation.blockIndex,
  );
  if (existing) return challenges;
  return {
    ...challenges,
    evaluations: [...challenges.evaluations, evaluation].sort(
      (a, b) => a.blockIndex - b.blockIndex,
    ),
  };
}

function challengesWithNextDeal(input: {
  challenges: SeasonChallengeState | undefined;
  run: SeasonRun;
  candidate: SeasonCandidateCheckpoint;
  schedule: SeasonSchedule | null;
  humanFranchiseId: string | null;
}): SeasonChallengeState | undefined {
  const { challenges, run, candidate, schedule, humanFranchiseId } = input;
  if (challenges === undefined) return undefined;
  if (humanFranchiseId === null) return challenges;
  const nextBlockIndex = candidate.blockIndex + 1;
  if (nextBlockIndex < 0 || nextBlockIndex > 7) return challenges;
  if (challenges.deals[nextBlockIndex] !== undefined) return challenges;
  if (schedule === null) return challenges;
  const deal = dealSeasonBlockChallenges(run.rootSeed, nextBlockIndex, {
    league: run.league,
    schedule,
    standings: candidate.standings,
    humanFranchiseId,
  });
  if (deal === null) return challenges;
  return {
    ...challenges,
    deals: { ...challenges.deals, [nextBlockIndex]: deal },
  };
}
function campaignWithBlockEvaluation(
  campaignState: import('@hoop-rush/data-contracts').SeasonCampaignState | undefined,
  candidate: SeasonCandidateCheckpoint,
): import('@hoop-rush/data-contracts').SeasonCampaignState | undefined {
  if (!candidate.campaign || !candidate.campaign.evaluation) return campaignState;
  const base = normalizeCampaignState(campaignState);
  const evalResult = candidate.campaign.evaluation;
  const existing = base.evaluations.some(
    (e) => e.blockIndex === evalResult.blockIndex && e.opportunityId === evalResult.opportunityId,
  );
  const evaluations = existing ? base.evaluations : [...base.evaluations, evalResult];
  const branchId =
    (
      candidate.campaign.evaluation as unknown as {
        branchId?: string;
      }
    ).branchId ?? evalResult.opportunityId.slice(0, 12);
  const nextBranchState = { ...base.branchState };
  const oppId = evalResult.opportunityId;
  const offersForBlock = base.offers[evalResult.blockIndex] ?? [];
  const opp = offersForBlock.find((o) => o.opportunityId === oppId);
  const bId = opp?.branchId ?? branchId;
  if (bId) {
    if (evalResult.outcome === 'missed') nextBranchState[bId] = 'missed';
    else if (evalResult.outcome === 'completed') nextBranchState[bId] = 'open';
    else nextBranchState[bId] = 'completed';
  }
  const applied = [...base.appliedRewardIds];
  let influenceEarned = base.rewardEntitlements.influenceEarned;
  let inquiryCredits = base.rewardEntitlements.inquiryCredits;
  let informationBenefits = base.rewardEntitlements.informationBenefits;
  const followUpUnlocks = [...base.rewardEntitlements.followUpUnlocks];
  for (const rid of evalResult.appliedRewardIds) {
    if (!applied.includes(rid)) {
      applied.push(rid);
      const allOffers = Object.values(base.offers).flat();
      const offerForReward = allOffers.find(
        (o) => o.completedReward.rewardId === rid || o.breakthroughReward?.rewardId === rid,
      );
      const reward =
        offerForReward?.completedReward.rewardId === rid
          ? offerForReward.completedReward
          : offerForReward?.breakthroughReward;
      if (reward) {
        if (reward.type === 'influence') {
          const requested = reward.amount;
          influenceEarned = Math.min(8, influenceEarned + requested);
        } else if (reward.type === 'trade-inquiry-credit') inquiryCredits += reward.amount;
        else if (reward.type === 'trade-board-information') informationBenefits += reward.amount;
        else followUpUnlocks.push(rid);
      }
    }
  }
  return {
    ...base,
    evaluations,
    branchState: nextBranchState,
    rewardEntitlements: {
      ...base.rewardEntitlements,
      influenceEarned: Math.min(8, influenceEarned),
      inquiryCredits,
      informationBenefits,
      followUpUnlocks,
    },
    appliedRewardIds: applied,
  };
}
export function deriveSeasonPostBlockState(input: {
  run: SeasonRun;
  candidate: SeasonCandidateCheckpoint;
  commandId: string;
  rotationDigest: string;
  humanFranchiseId?: string | null;
  aiFranchiseIds?: readonly string[];
  evolutionData?: AiSelectionDataSource | null;
}): {
  checkpointState: SeasonCheckpointState;
  stateRevision: number;
  stateDigest: string;
  evolution: SeasonEvolutionState;
} {
  const objectives = objectivesWithBlockSuccess(input.run.objectives, input.candidate);
  const runChallenges = (input.run as unknown as { challenges?: SeasonChallengeState }).challenges;
  const challenges = challengesWithBlockEvaluation(runChallenges, input.candidate);
  const evolution = evolutionWithBlockCommit({
    rootSeed: input.run.rootSeed,
    blockIndex: input.candidate.blockIndex,
    evolution: normalizeEvolutionState((input.run as unknown as { evolution?: unknown }).evolution),
    humanFranchiseId: input.humanFranchiseId ?? null,
    aiFranchiseIds: input.aiFranchiseIds ?? input.run.league.teams.map((team) => team.franchiseId),
    data: input.evolutionData ?? null,
  });
  const campaign = campaignWithBlockEvaluation(
    (
      input.run as {
        campaign?: import('@hoop-rush/data-contracts').SeasonCampaignState;
      }
    ).campaign,
    input.candidate,
  );
  const checkpointState: SeasonCheckpointState = {
    runId: input.run.runId,
    blockIndex: input.candidate.blockIndex,
    completedRounds: input.candidate.completedRounds,
    revision: input.candidate.revision + 1,
    commandId: input.commandId,
    rotationDigest: input.rotationDigest,
    checkpointDigest: input.candidate.digest,
  };
  const stateRevision = input.run.stateRevision + 1;
  const stateDigest = seasonRunStateDigest({
    stateRevision,
    stage: input.run.stage,
    postseason: input.run.postseason,
    awards: input.run.awards,
    completion: input.run.completion,
    checkpointState,
    health: input.candidate.health,
    influence: input.candidate.influence,
    transactions: input.candidate.transactions,
    trade: input.run.trade,
    freeAgency: input.candidate.freeAgency,
    objectives,
    challenges: challenges ?? null,
    campaign: campaign,
    rosters: input.run.rosters,
    ownership: input.run.ownership,
    rotations: input.run.rotations,
    effects: input.candidate.effects,
    evolution,
    authority: input.run.authority,
  });
  return { checkpointState, stateRevision, stateDigest, evolution };
}
export function evolutionSelectionGate(input: {
  blockIndex: number;
  run: SeasonRun | SeasonBlockRunContext;
  humanFranchiseId: string | null;
}): SeasonSubmitBlockRejection | null {
  if (input.blockIndex < 3) return null;
  const evolution = normalizeEvolutionState(
    (input.run as unknown as { evolution?: unknown }).evolution,
  );
  if (evolution.discovery === null) return null;
  const humanFid =
    input.humanFranchiseId ??
    input.run.league.teams.find((t) => t.control === 'human')?.franchiseId ??
    null;
  if (
    humanFid !== null &&
    (evolution.selections as unknown as Record<string, unknown>)[humanFid] === undefined
  ) {
    return { code: 'evolution-selection-required', blockIndex: input.blockIndex };
  }
  return null;
}
export function buildEvolutionDataSource(input: {
  run: SeasonRun;
  candidate: SeasonCandidateCheckpoint;
  priorSummaries?: readonly SeasonGameSummary[];
  schedule?: SeasonSchedule;
}): AiSelectionDataSource | null {
  if (input.schedule === undefined) return null;
  const run = input.run;
  const aiOrder = new Map<string, number>(
    run.aiAssignments.map((assignment, index) => [assignment.franchiseId, index] as const),
  );
  return {
    summaries: [...(input.priorSummaries ?? []), ...input.candidate.gameSummaries],
    rotations: run.rotations,
    schedule: input.schedule,
    completedRounds: input.candidate.completedRounds,
    aiOrderIndexOf: (franchiseId: string) => aiOrder.get(franchiseId) ?? 0,
  };
}
export function completeSeasonBlockCommit(input: {
  run: SeasonRun;
  candidate: SeasonCandidateCheckpoint;
  commandId: string;
  rotationDigest: string;
  humanFranchiseId: string | null;
  participantFranchiseIds?: readonly string[];
  catalog?: SeasonDraftCatalog;
  effects?: SeasonEffectsState;
  freeAgencyIndex?: SeasonFreeAgencyIndex;
  freeAgencyTargets?: SeasonRosterTargets;
  profile?: EraSimulationProfile;
  schedule?: SeasonSchedule;
  priorSummaries?: readonly SeasonGameSummary[];
}): {
  checkpointState: SeasonCheckpointState;
  stateRevision: number;
  stateDigest: string;
  window: SeasonWindowOpenResult | null;
  freeAgencyWindow: SeasonFreeAgencyWindowState | null;
  freeAgency: SeasonFreeAgencyState;
  campaign: import('@hoop-rush/data-contracts').SeasonCampaignState | null;
  challenges: SeasonChallengeState | undefined;
  evolution: SeasonEvolutionState;
} {
  const objectives = objectivesWithBlockSuccess(input.run.objectives, input.candidate);
  const baseChallenges = (input.run as unknown as { challenges?: SeasonChallengeState }).challenges;
  const evaluatedChallenges = challengesWithBlockEvaluation(baseChallenges, input.candidate);
  const campaign = campaignWithBlockEvaluation(
    (
      input.run as {
        campaign?: import('@hoop-rush/data-contracts').SeasonCampaignState;
      }
    ).campaign,
    input.candidate,
  );
  const derived = deriveSeasonPostBlockState({
    run: { ...input.run, objectives, campaign: campaign } as SeasonRun,
    candidate: input.candidate,
    commandId: input.commandId,
    rotationDigest: input.rotationDigest,
    humanFranchiseId: input.humanFranchiseId,
    evolutionData: buildEvolutionDataSource({
      run: input.run,
      candidate: input.candidate,
      priorSummaries: input.priorSummaries,
      schedule: input.schedule,
    }),
  });
  const participantIds =
    input.participantFranchiseIds ?? (input.humanFranchiseId ? [input.humanFranchiseId] : []);
  const primaryFranchiseId = participantIds[0] ?? input.humanFranchiseId;
  let postBlockRun: SeasonRun = {
    ...input.run,
    cursor: { schemaVersion: 1, completedRounds: input.candidate.completedRounds },
    standings: input.candidate.standings,
    health: input.candidate.health,
    influence: input.candidate.influence,
    transactions: input.candidate.transactions,
    freeAgency: input.candidate.freeAgency,
    objectives,
    campaign: campaign,
    evolution: derived.evolution,
    checkpointState: derived.checkpointState,
    stateRevision: derived.stateRevision,
    stateDigest: derived.stateDigest,
  } as SeasonRun;
  const runChallengesAfterEval =
    evaluatedChallenges ??
    (postBlockRun as unknown as { challenges?: SeasonChallengeState }).challenges;
  if (runChallengesAfterEval !== undefined) {
    (postBlockRun as unknown as { challenges?: SeasonChallengeState }).challenges =
      runChallengesAfterEval;
  }
  const nextBlockIndex = input.candidate.blockIndex + 1;
  if (nextBlockIndex >= 0 && nextBlockIndex <= 7 && primaryFranchiseId !== null) {
    const currentDeals = (postBlockRun as unknown as { challenges?: SeasonChallengeState })
      .challenges;
    if (currentDeals !== undefined && currentDeals.deals[nextBlockIndex] === undefined) {
      let scheduleForDeal: SeasonSchedule | null = input.schedule ?? null;
      if (scheduleForDeal === null) {
        try {
          scheduleForDeal = generateSeasonSchedule({
            league: input.run.league,
            seed: input.run.schedule.generationSeed,
          });
        } catch {
          scheduleForDeal = null;
        }
      }
      if (scheduleForDeal !== null) {
        const withNext = challengesWithNextDeal({
          challenges: currentDeals,
          run: input.run,
          candidate: input.candidate,
          schedule: scheduleForDeal,
          humanFranchiseId: primaryFranchiseId,
        });
        if (withNext !== undefined) {
          (postBlockRun as unknown as { challenges?: SeasonChallengeState }).challenges = withNext;
          postBlockRun = {
            ...postBlockRun,
            stateDigest: seasonRunStateDigest(
              seasonRunStateDigestFactsOf(postBlockRun, input.effects ?? input.candidate.effects),
            ),
          };
        }
      }
    }
  }
  const window = openSeasonTradeWindow({
    run: postBlockRun,
    blockIndex: input.candidate.blockIndex,
    rootSeed: input.run.rootSeed,
    humanFranchiseId: primaryFranchiseId,
    participantFranchiseIds: participantIds.length > 1 ? participantIds : undefined,
    catalog: input.catalog,
    effects: input.effects ?? input.candidate.effects,
  });
  let runAfterTrade: SeasonRun = postBlockRun;
  if (window !== null) {
    runAfterTrade = {
      ...postBlockRun,
      trade: window.trade,
      influence: window.influence,
      transactions: window.transactions,
      rosters: window.rosters,
      ownership: window.ownership,
      rotations: window.rotations,
      health: window.health,
      checkpointState: derived.checkpointState,
      stateRevision: window.stateRevision,
      stateDigest: window.stateDigest,
    };
  }
  let freeAgency: SeasonFreeAgencyState = input.candidate.freeAgency;
  let freeAgencyWindow: SeasonFreeAgencyWindowState | null = null;
  const freeAgencyBlockIndexes = [2, 4, 6];
  if (
    freeAgencyBlockIndexes.includes(input.candidate.blockIndex) &&
    freeAgencyUnresolvedWindowIndex(freeAgency) === null
  ) {
    const freeAgencyIndex = input.freeAgencyIndex;
    if (freeAgencyIndex === undefined) {
      throw new SeasonBlockInvariantError(
        `block ${String(input.candidate.blockIndex)} needs the packaged free-agency index to open its market window`,
        { blockIndex: input.candidate.blockIndex },
      );
    }
    const freeAgencyCatalog = input.catalog;
    if (freeAgencyCatalog === undefined) {
      throw new SeasonBlockInvariantError(
        `block ${String(input.candidate.blockIndex)} needs the packaged catalog to open its market window`,
        { blockIndex: input.candidate.blockIndex },
      );
    }
    const windowIndex = freeAgencyBlockIndexes.indexOf(input.candidate.blockIndex);
    const opened = openSeasonFreeAgencyWindow(
      {
        run: runAfterTrade,
        effects: input.effects ?? input.candidate.effects,
        catalog: freeAgencyCatalog,
        index: freeAgencyIndex,
        targets: input.freeAgencyTargets,
        humanFranchiseId: primaryFranchiseId,
      },
      windowIndex,
      input.candidate.blockIndex,
    );
    freeAgency = opened.freeAgency;
    freeAgencyWindow = opened.window;
    const postWindowEffects =
      window !== null ? window.effects : (input.effects ?? input.candidate.effects);
    const next: SeasonRun = {
      ...runAfterTrade,
      freeAgency,
      stateRevision: runAfterTrade.stateRevision + 1,
      stateDigest: '',
    };
    runAfterTrade = {
      ...next,
      stateDigest: seasonRunStateDigest(seasonRunStateDigestFactsOf(next, postWindowEffects)),
    };
  }
  const finalCampaign = runAfterTrade.campaign ?? campaign ?? null;
  const finalChallenges =
    (runAfterTrade as unknown as { challenges?: SeasonChallengeState }).challenges ??
    (postBlockRun as unknown as { challenges?: SeasonChallengeState }).challenges;
  if (window === null && freeAgencyWindow === null) {
    return {
      checkpointState: derived.checkpointState,
      stateRevision: derived.stateRevision,
      stateDigest: postBlockRun.stateDigest,
      window: null,
      freeAgencyWindow: null,
      freeAgency,
      campaign: finalCampaign,
      challenges: finalChallenges,
      evolution: derived.evolution,
    };
  }
  return {
    checkpointState: derived.checkpointState,
    stateRevision: runAfterTrade.stateRevision,
    stateDigest: runAfterTrade.stateDigest,
    window,
    freeAgencyWindow,
    freeAgency,
    campaign: finalCampaign,
    challenges: finalChallenges,
    evolution: derived.evolution,
  };
}
export function resumeSeasonBlockFromPending(input: {
  run: SeasonRun;
  pending: SeasonPendingBlockCandidate;
  command: SeasonResumeSeasonBlockCommand;
}): SeasonResumeSeasonBlockResult {
  const { run, pending, command } = input;
  if (command.runId !== run.runId) {
    return {
      status: 'rejected',
      commandId: command.commandId,
      rejection: { code: 'run-mismatch', expectedRunId: run.runId },
    };
  }
  if (pending.blockIndex !== command.blockIndex) {
    return {
      status: 'rejected',
      commandId: command.commandId,
      rejection: {
        code: 'block-mismatch',
        blockIndex: command.blockIndex,
        pendingBlockIndex: pending.blockIndex,
      },
    };
  }
  if (pending.rotationDigest !== command.rotationDigest) {
    return {
      status: 'rejected',
      commandId: command.commandId,
      rejection: {
        code: 'rotation-digest-mismatch',
        rotationDigest: command.rotationDigest,
        pendingRotationDigest: pending.rotationDigest,
      },
    };
  }
  return {
    status: 'accepted',
    commandId: command.commandId,
    blockIndex: pending.blockIndex,
    nextGameId: pending.nextGameId,
  };
}
export function auditSeasonBlock(
  candidate: SeasonCandidateCheckpoint,
  input: SeasonBlockSimulationInput,
): string[] {
  const failures: string[] = [];
  const command = input.command;
  const run = input.run;
  if (candidate.runId !== run.runId) failures.push('candidate runId does not match the run');
  if (candidate.blockIndex !== command.blockIndex) {
    failures.push('candidate blockIndex does not match the command');
  }
  if (candidate.rotationDigest !== command.rotationDigest) {
    failures.push('candidate rotationDigest does not match the command');
  }
  if (candidate.revision !== command.expectedRevision) {
    failures.push(
      `candidate revision ${String(candidate.revision)} does not match expectedRevision ${String(command.expectedRevision)}`,
    );
  }
  if (candidate.revision !== seasonAcceptedBlockCount(run.cursor.completedRounds)) {
    failures.push('candidate revision does not match the run cursor');
  }
  const { toRound } = blockRoundRange(command.blockIndex);
  if (candidate.completedRounds !== toRound) {
    failures.push(
      `candidate completedRounds ${String(candidate.completedRounds)} must be the block end ${String(toRound)} (cursor advanced)`,
    );
  }
  if (candidate.completedRounds !== command.blockIndex * 10 + (command.blockIndex >= 8 ? 2 : 10)) {
    failures.push('candidate completedRounds must equal the block end');
  }
  const expectedCount = seasonBlockGameCount(command.blockIndex);
  if (candidate.gameSummaries.length !== expectedCount) {
    failures.push(
      `candidate must carry exactly ${String(expectedCount)} summaries (got ${String(candidate.gameSummaries.length)})`,
    );
  }
  const gameIds = candidate.gameSummaries.map((summary) => summary.gameId);
  if (new Set(gameIds).size !== gameIds.length) {
    failures.push('candidate gameSummaries contain duplicate game ids');
  }
  const { fromRound } = blockRoundRange(command.blockIndex);
  const blockGameIds = new Set(
    input.schedule.games
      .filter((game) => game.round >= fromRound && game.round <= toRound)
      .map((game) => game.gameId),
  );
  for (const gameId of blockGameIds) {
    if (!gameIds.includes(gameId)) {
      failures.push(`candidate misses block game ${gameId}`);
    }
  }
  for (const gameId of gameIds) {
    if (!blockGameIds.has(gameId)) {
      failures.push(`candidate carries a game outside the block: ${gameId}`);
    }
  }
  for (const summary of candidate.gameSummaries) {
    failures.push(
      ...auditSeasonGameSummary(summary).map((failure) => `summary ${summary.gameId}: ${failure}`),
    );
  }
  if (candidate.playerAggregates.length > SEASON_TEAM_COUNT * 10) {
    failures.push(
      `candidate must carry at most 300 player aggregates (got ${String(candidate.playerAggregates.length)})`,
    );
  }
  const aggregateIds = candidate.playerAggregates.map((player) => player.playerVersionId);
  if (new Set(aggregateIds).size !== aggregateIds.length) {
    failures.push('candidate player aggregates contain duplicate versions');
  }
  for (const player of candidate.playerAggregates) {
    if (!input.expanded.has(player.playerVersionId)) {
      failures.push(`player aggregate references an unrostered version ${player.playerVersionId}`);
    }
  }
  if (candidate.teamAggregates.length !== SEASON_TEAM_COUNT) {
    failures.push(
      `candidate must carry 30 team aggregates (got ${String(candidate.teamAggregates.length)})`,
    );
  }
  const allSummaries = [...input.priorSummaries, ...candidate.gameSummaries];
  failures.push(
    ...auditSeasonStandings(
      run.league,
      reconstructSeasonGames(input.schedule, allSummaries),
      candidate.standings,
    ),
  );
  failures.push(
    ...auditSeasonAggregates({
      teams: candidate.teamAggregates,
      players: candidate.playerAggregates,
      summaries: allSummaries,
      standings: candidate.standings,
    }),
  );
  if (candidate.retainedDetails.length > 10) {
    failures.push('candidate retained details exceed 10');
  }
  if (input.humanFranchiseId !== null) {
    for (const detail of candidate.retainedDetails) {
      if (
        detail.homeFranchiseId !== input.humanFranchiseId &&
        detail.awayFranchiseId !== input.humanFranchiseId
      ) {
        failures.push(`retained detail ${detail.gameId} is not a human-team game`);
      }
      if (!gameIds.includes(detail.gameId)) {
        failures.push(`retained detail ${detail.gameId} is outside the block`);
      }
    }
  }
  failures.push(
    ...auditSeasonBlockRecap(candidate.recap, {
      runId: run.runId,
      blockIndex: command.blockIndex,
      completedRounds: candidate.completedRounds,
      humanFranchiseId: input.humanFranchiseId,
      summaries: allSummaries,
      standingsBefore: reduceSeasonStandings(
        run.league,
        reconstructSeasonGames(input.schedule, input.priorSummaries),
      ),
      standingsAfter: candidate.standings,
      playerAggregates: candidate.playerAggregates,
      schedule: input.schedule,
      rosterPlayerIds: input.rosterPlayerIds,
      health: candidate.health,
      objective:
        candidate.objective === undefined
          ? null
          : {
              objectiveId: candidate.objective.objectiveId,
              success: candidate.objective.success,
              evaluation: candidate.objective.evaluation,
            },
      challenges: candidate.challenges ?? null,
      transactions: candidate.transactions,
      influence: candidate.influence,
    }),
  );
  const effectsVersions = new Set(candidate.effects.playerStates.map((p) => p.playerVersionId));
  if (effectsVersions.size !== 300) {
    failures.push(
      `effects state must carry 300 distinct players (got ${String(effectsVersions.size)})`,
    );
  }
  const expandedVersions = new Set(input.expanded.keys());
  if (
    effectsVersions.size === expandedVersions.size &&
    ![...effectsVersions].every((version) => expandedVersions.has(version))
  ) {
    failures.push('effects state player set does not match the expanded rosters');
  }
  for (const player of candidate.effects.playerStates) {
    if (player.lastCompletedRound > candidate.completedRounds) {
      failures.push(
        `effects ${player.playerVersionId} lastCompletedRound ${String(player.lastCompletedRound)} exceeds ${String(candidate.completedRounds)}`,
      );
    }
  }
  const expandedVersionsSet = new Set(input.expanded.keys());
  const leagueFranchiseIds = new Set(run.league.teams.map((team) => team.franchiseId));
  const scheduleRoundById = new Map(input.schedule.games.map((game) => [game.gameId, game.round]));
  for (const record of candidate.health.injuries) {
    if (!expandedVersionsSet.has(record.playerVersionId)) {
      failures.push(
        `injury ${record.injuryId} references an unrostered version ${record.playerVersionId}`,
      );
    }
    if (!leagueFranchiseIds.has(record.franchiseId)) {
      failures.push(`injury ${record.injuryId} references a franchise outside the league`);
    }
    const parsedGameId = seasonGameIdSchema.safeParse(record.gameId);
    const occurrenceRound = parsedGameId.success
      ? scheduleRoundById.get(parsedGameId.data)
      : undefined;
    if (occurrenceRound === undefined) {
      failures.push(`injury ${record.injuryId} references an unscheduled game ${record.gameId}`);
    } else if (occurrenceRound > candidate.completedRounds) {
      failures.push(`injury ${record.injuryId} references a game past the checkpoint cursor`);
    }
    if (record.actualReturnRound !== null && record.actualReturnRound > candidate.completedRounds) {
      failures.push(
        `injury ${record.injuryId} actualReturnRound ${String(record.actualReturnRound)} exceeds ${String(candidate.completedRounds)}`,
      );
    }
    if (record.seasonEnding !== (record.severity === 'season-ending')) {
      failures.push(`injury ${record.injuryId} seasonEnding flag does not match its severity`);
    }
    if (
      record.seasonEnding &&
      (record.missedGamesTotal !== SEASON_ENDING_MISSED_GAMES_SENTINEL ||
        record.missedGamesRemaining !== SEASON_ENDING_MISSED_GAMES_SENTINEL)
    ) {
      failures.push(
        `season-ending injury ${record.injuryId} must carry the missed-games sentinel ${String(SEASON_ENDING_MISSED_GAMES_SENTINEL)}`,
      );
    }
    if (record.recurrenceWindowRoundsRemaining > 0 && record.actualReturnRound === null) {
      failures.push(`injury ${record.injuryId} has an open window before its actual return`);
    }
    if (record.sameGameReturn && record.missedGamesTotal !== 0) {
      failures.push(`injury ${record.injuryId} same-game return must carry zero missed games`);
    }
  }
  const hasCandidateChallenges = candidate.challenges != null;
  if (hasCandidateChallenges) {
    const evaluation = candidate.challenges;
    if (evaluation == null) {
      failures.push('candidate challenges missing after presence check');
    } else {
      if (evaluation.blockIndex !== command.blockIndex) {
        failures.push('candidate challenges blockIndex does not match the command');
      }
      const deal = input.challengeDeal ?? null;
      if (deal !== null) {
        const dealIds = [...deal.challengeIds].sort();
        const resultIds = evaluation.results.map((result) => result.challengeId).sort();
        if (JSON.stringify(dealIds) !== JSON.stringify(resultIds)) {
          failures.push('candidate challenges do not match the dealt challengeIds');
        }
        if (deal.seedPath !== undefined) {
          const [seedNamespace, ...seedRest] = deal.seedPath;
          const reseeded = seasonNamespaceSeed(
            run.rootSeed,
            seedNamespace ?? 'challenges',
            ...seedRest,
          );
          if (reseeded !== deal.seedDigest) {
            failures.push('candidate challenge deal seedDigest does not match its seedPath');
          }
        }
        if (deal.standingsSnapshot !== undefined && input.humanFranchiseId !== null) {
          const snapshotById = new Map(deal.standingsSnapshot.map((row) => [row.franchiseId, row]));
          const humanSnapshot = snapshotById.get(franchiseIdSchema.parse(input.humanFranchiseId));
          if (humanSnapshot === undefined) {
            failures.push('candidate challenge deal snapshot misses the human franchise');
          } else {
            const { fromRound, toRound } = blockRoundRange(command.blockIndex);
            const scheduledOpponents = new Set(
              input.schedule.games
                .filter(
                  (game) =>
                    game.round >= fromRound &&
                    game.round <= toRound &&
                    (game.homeFranchiseId === input.humanFranchiseId ||
                      game.awayFranchiseId === input.humanFranchiseId),
                )
                .map((game) =>
                  game.homeFranchiseId === input.humanFranchiseId
                    ? game.awayFranchiseId
                    : game.homeFranchiseId,
                ),
            );
            const leader = deal.targets.leaderFranchiseId;
            if (leader !== null) {
              const leaderSnapshot = snapshotById.get(leader);
              if (leaderSnapshot === undefined) {
                failures.push('candidate challenge deal snapshot misses the dealt leader');
              } else if (!scheduledOpponents.has(leader)) {
                failures.push('dealt beat-leader target is not scheduled in the block');
              }
            }
            for (const opponent of deal.targets.qualifyingOpponentIds) {
              const oppSnapshot = snapshotById.get(opponent);
              if (oppSnapshot === undefined) {
                failures.push(`candidate challenge deal snapshot misses qualifier ${opponent}`);
                continue;
              }
              const better =
                oppSnapshot.wins !== humanSnapshot.wins
                  ? oppSnapshot.wins > humanSnapshot.wins
                  : oppSnapshot.losses < humanSnapshot.losses;
              if (!better) {
                failures.push(
                  `dealt beat-higher qualifier ${opponent} is not strictly better in the snapshot`,
                );
              }
              if (!scheduledOpponents.has(opponent)) {
                failures.push(
                  `dealt beat-higher qualifier ${opponent} is not scheduled in the block`,
                );
              }
            }
          }
        }
        const recomputed = evaluateSeasonBlockChallenges({
          deal,
          blockIndex: command.blockIndex,
          humanFranchiseId: input.humanFranchiseId,
          summaries: candidate.gameSummaries,
        });
        if (JSON.stringify(recomputed) !== JSON.stringify(evaluation)) {
          failures.push('candidate challenges do not replay from the recorded summaries and deal');
        }
      }
      if (candidate.challengeIds !== undefined) {
        const ordered = [...evaluation.results.map((r) => r.challengeId)].sort();
        if (
          JSON.stringify([...(candidate.challengeIds as readonly string[])].sort()) !==
          JSON.stringify(ordered)
        ) {
          failures.push('candidate challengeIds do not match the evaluated challenges');
        }
      }
      const recapEvidence = candidate.recap.challengeEvidence ?? [];
      if (recapEvidence.length !== 3) {
        failures.push('candidate recap must carry exactly 3 challenge results');
      }
      const rewardEntries = candidate.transactions.filter(
        (entry) => entry.type === 'challenge-reward' && entry.blockIndex === command.blockIndex,
      );
      const expectedRewards = evaluation.results.filter((r) => r.success).length;
      const humanRewards = rewardEntries.filter(
        (entry) => entry.franchiseId === input.humanFranchiseId,
      ).length;
      const priorHumanRewards = (input.transactions ?? []).filter(
        (entry) =>
          entry.type === 'challenge-reward' &&
          entry.blockIndex === command.blockIndex &&
          entry.franchiseId === input.humanFranchiseId,
      ).length;
      if (input.humanFranchiseId !== null && humanRewards !== priorHumanRewards + expectedRewards) {
        failures.push(
          `candidate must append ${String(expectedRewards)} challenge-reward transactions for the human (got ${String(humanRewards - priorHumanRewards)})`,
        );
      }
    }
    if (command.blockIndex === 8 && candidate.challenges !== undefined) {
      failures.push('the final two-game block must carry no challenges');
    }
  } else {
    const objective = candidate.objective;
    if (objective === undefined) {
      failures.push('candidate must carry an objective evaluation for legacy blocks');
    } else {
      if (objective.objectiveId !== command.objectiveId) {
        failures.push(
          `candidate objective ${String(objective.objectiveId)} does not match the command ${String(command.objectiveId)}`,
        );
      }
      if (objective.objectiveId !== null) {
        if (objective.evaluation.blockIndex !== command.blockIndex) {
          failures.push('candidate objective evaluation blockIndex does not match the command');
        }
        if (objective.success !== objective.evaluation.success) {
          failures.push('candidate objective success does not match its evaluation');
        }
      }
      if (command.blockIndex === 8 && objective.objectiveId !== null) {
        failures.push('the final two-game block must carry a null objective');
      }
    }
  }
  if (candidate.expectedStateRevision !== command.expectedStateRevision) {
    failures.push('candidate expectedStateRevision does not match the command');
  }
  if (candidate.expectedStateDigest !== command.expectedStateDigest) {
    failures.push('candidate expectedStateDigest does not match the command');
  }
  if (candidate.stateRevision !== 0 || candidate.stateDigest !== '0'.repeat(32)) {
    failures.push(
      'candidate post-block state facts must be the assembly placeholders (the commit side derives them)',
    );
  }
  const transactionIds = candidate.transactions.map((entry) => entry.transactionId);
  if (new Set(transactionIds).size !== transactionIds.length) {
    failures.push('candidate transactions contain duplicate ids');
  }
  const recomputed = seasonCheckpointDigest(candidate);
  if (recomputed !== candidate.digest) {
    failures.push(`digest mismatch: stored ${candidate.digest}, recomputed ${recomputed}`);
  }
  return failures;
}
