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
  seasonNamespaceSeed,
  type EraSimulationProfile,
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
import { applySeasonGameEffectsTransition } from './effects.ts';
import { applySeasonRecoveryTick } from './stamina.ts';
import { auditSeasonStandings, reduceSeasonStandings } from './standings.ts';
import {
  seasonFranchiseLegalFiveFacts,
  seasonGameHealthSeam,
  seasonPregameAvailabilityOf,
} from './health.ts';
import { applySeasonGameHealthTransition } from './injuries.ts';
import { evaluateSeasonBlockObjective, seasonObjectiveChoicesForBlock } from './objectives.ts';
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
  readonly diagnostics: { seed?: string; gameId?: string; blockIndex?: number };

  constructor(
    message: string,
    diagnostics: { seed?: string; gameId?: string; blockIndex?: number } = {},
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

  rosterPlayerIds: ReadonlyMap<string, string>;

  priorSummaries: readonly SeasonGameSummary[];

  effects: SeasonEffectsState;

  health: SeasonHealthState;

  objectiveId: SeasonObjectiveId | null;

  influence?: SeasonInfluenceState;

  transactions?: SeasonTransactionEntry[];

  freeAgency?: SeasonFreeAgencyState;

  objectives?: SeasonObjectiveState;

  collectedTipAvailability?: { gameId: string; availableCount: number }[];
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
    rosters: next.rosters,
    ownership: next.ownership,
    rotations: next.rotations,
    effects,
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

  if (input.objectives !== undefined) {
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

  const computedDigest = seasonRotationSetDigest(run.rotations);
  const franchiseFailures: Array<{ franchiseId: string; reasons: string[] }> = [];
  if (computedDigest !== command.rotationDigest) {
    for (const rotation of run.rotations) {
      franchiseFailures.push({
        franchiseId: rotation.franchiseId,
        reasons: [
          `rotation set digest ${computedDigest} does not match the submitted lock ${command.rotationDigest}`,
        ],
      });
    }
    return { code: 'invalid-rotations', franchiseFailures };
  }
  for (const rotation of run.rotations) {
    const roster = run.rosters.find((entry) => entry.franchiseId === rotation.franchiseId);
    const memberPlayable = new Map<string, readonly Position[]>();
    for (const player of roster?.players ?? []) {
      const expanded = input.expanded.get(player.playerVersionId);
      if (expanded !== undefined) {
        memberPlayable.set(expanded.playerVersionId, expanded.positions);
      }
    }
    const reasons = validateSeasonRotation(rotation, memberPlayable);
    if (reasons.length > 0) {
      franchiseFailures.push({ franchiseId: rotation.franchiseId, reasons });
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
    const outcome = simulateSeasonBlockGame(input, game, effects, health, {
      skipRecoveryTick: !(previousRound !== 0 && game.round > previousRound),
      ...shared,
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
  return assembleSeasonBlockCandidate(input, summaries, retainedDetails, effects, health);
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
  | { interruption: SeasonInvalidRosterInterruption };

export function simulateSeasonBlockGame(
  input: SeasonBlockSimulationInput,
  game: SeasonScheduleGame,
  effects: SeasonEffectsState,
  health: SeasonHealthState,
  options: SeasonBlockGameSimulationOptions = {},
): SeasonBlockGameOutcome {
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
  const homePlayers = homeRoster.players.map((player) =>
    expandedPlayer(input, game.gameId, player.playerVersionId),
  );
  const awayPlayers = awayRoster.players.map((player) =>
    expandedPlayer(input, game.gameId, player.playerVersionId),
  );
  const seed = seasonNamespaceSeed(run.rootSeed, SEASON_SEED_NAMESPACES.scheduleGames, game.gameId);

  let pregame = effects;
  if (!(options.skipRecoveryTick ?? false)) {
    pregame = applySeasonRecoveryTick(
      pregame,
      options.staminaByVersion ?? staminaByVersionOf(input),
    );
  }

  const positions = options.positions ?? positionsOf(input);
  const humanFranchiseId = input.humanFranchiseId;
  const humanPlays =
    humanFranchiseId !== null &&
    (game.homeFranchiseId === humanFranchiseId || game.awayFranchiseId === humanFranchiseId);
  let homeLegalFacts: { legal: boolean; unavailablePlayerVersionIds: string[] } | null = null;
  let awayLegalFacts: { legal: boolean; unavailablePlayerVersionIds: string[] } | null = null;
  if (humanPlays) {
    const facts = seasonFranchiseLegalFiveFacts(run, humanFranchiseId, health, positions);
    if (humanFranchiseId === game.homeFranchiseId) homeLegalFacts = facts;
    if (humanFranchiseId === game.awayFranchiseId) awayLegalFacts = facts;
    if (!facts.legal) {
      const interruption: SeasonInvalidRosterInterruption = {
        code: 'invalid-roster',
        runId: run.runId,
        blockIndex: command.blockIndex,
        commandId: command.commandId,
        nextGameId: game.gameId,
        humanFranchiseId,
        unavailablePlayerVersionIds: facts.unavailablePlayerVersionIds,
      };
      return { interruption };
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
    const humanRoster = rosterByFranchise.get(humanFranchiseId);
    const availableCount =
      humanRoster === undefined
        ? 0
        : humanRoster.players.filter((player) => seam.pregame.get(player.playerVersionId) === true)
            .length;
    const collection = input.collectedTipAvailability ?? (input.collectedTipAvailability = []);
    collection.push({ gameId: game.gameId, availableCount });
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
    input.humanFranchiseId !== null &&
    (game.homeFranchiseId === input.humanFranchiseId ||
      game.awayFranchiseId === input.humanFranchiseId)
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
): { injuryId: string; returned: boolean }[] {
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

export function assembleSeasonBlockCandidate(
  input: SeasonBlockSimulationInput,
  summaries: readonly SeasonGameSummary[],
  retainedDetails: readonly SeasonRetainedGameDetail[],
  effects: SeasonEffectsState,
  health: SeasonHealthState,
): SeasonCandidateCheckpoint {
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

  const humanRotation =
    input.humanFranchiseId === null
      ? null
      : (run.rotations.find((rotation) => rotation.franchiseId === input.humanFranchiseId) ?? null);
  const objective = evaluateSeasonBlockObjective({
    objectiveId: input.objectiveId,
    blockIndex: command.blockIndex,
    humanFranchiseId: input.humanFranchiseId,
    rotation: humanRotation,
    summaries: [...summaries],
    tipAvailability: input.collectedTipAvailability ?? [],
  });

  const franchiseIds = run.league.teams.map((team) => team.franchiseId);

  const preBlockInfluence =
    input.influence ??
    (input.run as Partial<SeasonRun>).influence ??
    createInitialSeasonInfluenceState(franchiseIds);
  const grantResult = applySeasonBlockInfluenceGrants({
    influence: preBlockInfluence,
    blockIndex: command.blockIndex,
    humanFranchiseId: input.humanFranchiseId,
    objectiveSuccess: objective.success,
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
    transactions: postTransactions,
    influence: grantResult.influence,
  };
  const recap = buildSeasonBlockRecap(recapInput);

  const aggregateFailures = auditSeasonAggregates({
    teams,
    players,
    summaries: allSummaries,
    standings,
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
  objectives: SeasonObjectiveState,
  candidate: SeasonCandidateCheckpoint,
): SeasonObjectiveState {
  if (candidate.blockIndex === 8) return objectives;
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

export function deriveSeasonPostBlockState(input: {
  run: SeasonRun;
  candidate: SeasonCandidateCheckpoint;
  commandId: string;
  rotationDigest: string;
}): { checkpointState: SeasonCheckpointState; stateRevision: number; stateDigest: string } {
  const objectives = objectivesWithBlockSuccess(input.run.objectives, input.candidate);
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
    rosters: input.run.rosters,
    ownership: input.run.ownership,
    rotations: input.run.rotations,
    effects: input.candidate.effects,
  });
  return { checkpointState, stateRevision, stateDigest };
}

export function completeSeasonBlockCommit(input: {
  run: SeasonRun;
  candidate: SeasonCandidateCheckpoint;
  commandId: string;
  rotationDigest: string;
  humanFranchiseId: string | null;

  catalog?: SeasonDraftCatalog;

  effects?: SeasonEffectsState;

  freeAgencyIndex?: SeasonFreeAgencyIndex;

  freeAgencyTargets?: SeasonRosterTargets;
}): {
  checkpointState: SeasonCheckpointState;
  stateRevision: number;
  stateDigest: string;
  window: SeasonWindowOpenResult | null;

  freeAgencyWindow: SeasonFreeAgencyWindowState | null;

  freeAgency: SeasonFreeAgencyState;
} {
  const objectives = objectivesWithBlockSuccess(input.run.objectives, input.candidate);
  const derived = deriveSeasonPostBlockState({
    run: { ...input.run, objectives },
    candidate: input.candidate,
    commandId: input.commandId,
    rotationDigest: input.rotationDigest,
  });
  const postBlockRun: SeasonRun = {
    ...input.run,
    cursor: { schemaVersion: 1, completedRounds: input.candidate.completedRounds },
    standings: input.candidate.standings,
    health: input.candidate.health,
    influence: input.candidate.influence,
    transactions: input.candidate.transactions,
    freeAgency: input.candidate.freeAgency,
    objectives,
    checkpointState: derived.checkpointState,
    stateRevision: derived.stateRevision,
    stateDigest: derived.stateDigest,
  };
  const window = openSeasonTradeWindow({
    run: postBlockRun,
    blockIndex: input.candidate.blockIndex,
    rootSeed: input.run.rootSeed,
    humanFranchiseId: input.humanFranchiseId,
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
    if (input.freeAgencyIndex === undefined) {
      throw new SeasonBlockInvariantError(
        `block ${String(input.candidate.blockIndex)} needs the packaged free-agency index to open its market window`,
        { blockIndex: input.candidate.blockIndex },
      );
    }
    const windowIndex = freeAgencyBlockIndexes.indexOf(input.candidate.blockIndex);
    const opened = openSeasonFreeAgencyWindow(
      {
        run: runAfterTrade,
        effects: input.effects ?? input.candidate.effects,
        catalog: input.catalog as SeasonDraftCatalog,
        index: input.freeAgencyIndex,
        targets: input.freeAgencyTargets,
        humanFranchiseId: input.humanFranchiseId,
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

  if (window === null && freeAgencyWindow === null) {
    return {
      checkpointState: derived.checkpointState,
      stateRevision: derived.stateRevision,
      stateDigest: derived.stateDigest,
      window: null,
      freeAgencyWindow: null,
      freeAgency,
    };
  }
  return {
    checkpointState: derived.checkpointState,
    stateRevision: runAfterTrade.stateRevision,
    stateDigest: runAfterTrade.stateDigest,
    window,
    freeAgencyWindow,
    freeAgency,
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
      objective: {
        objectiveId: candidate.objective.objectiveId,
        success: candidate.objective.success,
        evaluation: candidate.objective.evaluation,
      },
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
    const occurrenceRound = scheduleRoundById.get(record.gameId);
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

  if (candidate.objective.objectiveId !== command.objectiveId) {
    failures.push(
      `candidate objective ${String(candidate.objective.objectiveId)} does not match the command ${String(command.objectiveId)}`,
    );
  }
  if (candidate.objective.objectiveId !== null) {
    if (candidate.objective.evaluation.blockIndex !== command.blockIndex) {
      failures.push('candidate objective evaluation blockIndex does not match the command');
    }
    if (candidate.objective.success !== candidate.objective.evaluation.success) {
      failures.push('candidate objective success does not match its evaluation');
    }
  }
  if (command.blockIndex === 8 && candidate.objective.objectiveId !== null) {
    failures.push('the final two-game block must carry a null objective');
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
