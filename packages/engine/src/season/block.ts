import {
  SEASON_BLOCK_COUNT,
  SEASON_ROUND_COUNT,
  SEASON_SEED_NAMESPACES,
  SEASON_TEAM_COUNT,
  blockRoundRange,
  seasonNamespaceSeed,
  type EraSimulationProfile,
  type SeasonBlockRunContext,
  type SeasonCandidateCheckpoint,
  type SeasonCheckpointVersions,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonGamePlayerInput,
  type SeasonGameSimulationInput,
  type SeasonGameSummary,
  type SeasonRetainedGameDetail,
  type SeasonSchedule,
  type SeasonScheduleGame,
  type SeasonSubmitBlockCommand,
  type SeasonSubmitBlockRejection,
  type SeasonSubmitBlockResult,
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
import type { Position } from '@hoop-rush/data-contracts';

/**
 * M2.3 pure block pipeline (spec/2.0/02 ten-game blocks, season-block-v1).
 * One authoritative path — used by the worker AND the CLI — validates the
 * command cursor, block boundary, and the locked 30-rotation digest, expands
 * the 300 drafted versions, simulates the block's games in stable game-id
 * order, converts to compact summaries, folds standings and aggregates,
 * audits everything, builds the recap, and returns one candidate checkpoint.
 *
 * The pipeline never fabricates a winner: a `no-legal-five-both` game is a
 * typed invariant failure with seed/game diagnostics. No RNG streams are
 * shared across games and no `Math.random()` exists in domain code; every
 * game seed derives from the named `schedule-games` namespace.
 *
 * `priorSummaries` carries the compact summaries of every earlier block
 * (empty for block 0): the run snapshot does not retain compact summaries,
 * and standings/aggregates are cumulative, so the runner must supply them.
 *
 * M2.4: the input carries the pre-block effects state (300 player loads +
 * 1,350 pair chemistries) and the candidate checkpoint freezes it (plus the
 * stamina/chemistry/effect-targets material versions) unchanged. Transition
 * folding is the stamina/chemistry workstream's seam; this pipeline only
 * carries the state.
 *
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

/** Number of accepted blocks implied by a completed-round cursor value. */
export function seasonAcceptedBlockCount(completedRounds: number): number {
  if (completedRounds <= 0) return 0;
  if (completedRounds > SEASON_ROUND_COUNT) {
    throw new Error(`completedRounds ${String(completedRounds)} out of range`);
  }
  // One block per 10 rounds; the final block covers rounds 81-82.
  return Math.ceil(completedRounds / 10);
}

/** The 0-based block the cursor expects next (null when the season is complete). */
export function seasonNextBlockIndex(completedRounds: number): number | null {
  if (completedRounds >= SEASON_ROUND_COUNT) return null;
  return seasonAcceptedBlockCount(completedRounds);
}

/** The cursor value the run must carry for a block submission. */
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

/** Typed invariant failure carrying determinism diagnostics. */
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

/** Thrown by the cancellation seam after `cancelAfterGames` games. */
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

/** Everything the block pipeline needs for one block submission. */
export interface SeasonBlockSimulationInput {
  /** The validated SubmitSeasonBlock command to execute. */
  command: SeasonSubmitBlockCommand;
  /**
   * The run context at the block boundary (identity, cursor, league,
   * rosters, locked rotations, versions). The block pipeline never reads the
   * scheduled games array, standings, draft, ownership, postseason, AI
   * assignments, evaluations, or generation audit, so the worker wire only
   * carries this context; a full `SeasonRun` satisfies the same shape.
   */
  run: SeasonBlockRunContext;
  /** Expanded roster players keyed by playerVersionId (300 entries). */
  expanded: ReadonlyMap<string, SeasonGamePlayerInput>;
  /** The committed 1,230-game schedule artifact. */
  schedule: SeasonSchedule;
  /** Packaged draft catalog (data version + candidate facts). */
  catalog: SeasonDraftCatalog;
  /** Era simulation profile for the Season Run environment. */
  profile: EraSimulationProfile;
  /** Human franchise (retained details only); null in a pure AI/CLI context. */
  humanFranchiseId: string | null;
  /** playerVersionId -> person playerId (identity facts for the recap). */
  rosterPlayerIds: ReadonlyMap<string, string>;
  /**
   * Compact summaries of every earlier block, in stable schedule order
   * (empty for block 0). Required: standings/aggregates/recaps are
   * cumulative, and the run snapshot does not retain compact summaries.
   */
  priorSummaries: readonly SeasonGameSummary[];
  /**
   * M2.4: the pre-block/pregame effects state (300 player loads + 1,350
   * pair chemistries) carried through the block. The pipeline carries this
   * state into the candidate checkpoint unchanged: transition folding (per-
   * game load and pair-chemistry deltas) is owned by the stamina/chemistry
   * workstream and lands on top of this seam. For block 0, callers pass the
   * zero state.
   */
  effects: SeasonEffectsState;
}

/** Duplicate-detection seam for the command handler. */
export interface SeasonSubmitBlockCommandInput extends SeasonBlockSimulationInput {
  /** Append-only history of command ids already accepted by the run. */
  acceptedCommandIds: readonly string[];
}

/** Additive pipeline options (the worker and CLI use the one-argument form). */
export interface SeasonBlockSimulationOptions {
  /**
   * Cancellation seam for determinism evidence: stops the pipeline after
   * this many games with `SeasonBlockCancelledError`; the caller discards
   * the partial result and re-runs. The candidate digest never depends on
   * how the games were executed.
   */
  cancelAfterGames?: number;
}

/**
 * Resolves every roster's ten playerVersionIds to catalog entries and
 * asserts unique ownership: exactly 300 distinct versions across the league.
 */
export function expandSeasonRunRosters(
  run: SeasonBlockRunContext,
  catalog: SeasonDraftCatalog,
): Map<string, SeasonGamePlayerInput> {
  const candidates = new Map(
    catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
  );
  const expanded = new Map<string, SeasonGamePlayerInput>();
  const seen = new Set<string>();
  for (const roster of run.rosters) {
    for (const player of roster.players) {
      const candidate = candidates.get(player.playerVersionId);
      if (candidate === undefined) {
        throw new Error(
          `roster ${roster.franchiseId} references unknown catalog version ${player.playerVersionId}`,
        );
      }
      if (seen.has(player.playerVersionId)) {
        throw new Error(
          `playerVersionId ${player.playerVersionId} appears on more than one roster`,
        );
      }
      seen.add(player.playerVersionId);
      expanded.set(player.playerVersionId, {
        playerVersionId: player.playerVersionId,
        playerId: player.playerId,
        displayName: player.displayName,
        positions: candidate.positions.playable,
        heightInches: candidate.heightInches,
        weightLbs: candidate.weightLbs,
        ratings: candidate.detailedRatings,
        tendencies: candidate.tendencies,
        // M2.4: the build-time stamina profile rides the expanded input so
        // the effects seam and recovery ticks read the derived rating.
        stamina: {
          schemaVersion: 1,
          playerVersionId: player.playerVersionId,
          rating: candidate.stamina.rating,
          historicalMpg: candidate.stamina.historicalMpg,
          derivationVersion: candidate.stamina.derivationVersion,
        },
      });
    }
  }
  if (expanded.size !== SEASON_TEAM_COUNT * 10) {
    throw new Error(
      `expanded rosters must own exactly ${String(SEASON_TEAM_COUNT * 10)} distinct versions (got ${String(expanded.size)})`,
    );
  }
  return expanded;
}

/** playerVersionId -> person playerId derived from the run rosters. */
export function rosterPlayerIdsOf(run: SeasonBlockRunContext): Map<string, string> {
  const ids = new Map<string, string>();
  for (const roster of run.rosters) {
    for (const player of roster.players) {
      ids.set(player.playerVersionId, player.playerId);
    }
  }
  return ids;
}

/**
 * The command rejection, in fixed priority order: run identity, duplicate
 * command, stale cursor, non-boundary block, invalid rotations. Returns null
 * when the command is valid. Duplicate detection runs only when the accepted
 * command history is supplied. Exported so the worker and application layer
 * can reject a submission before any simulation starts.
 */
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
      // A completed season has no next block; the final block index is the
      // closest expressible value and the rejection is unconditional.
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

/** Throwing validation used by the pipeline itself. */
function requireValidSeasonBlockCommand(input: SeasonBlockSimulationInput): void {
  const rejection = seasonBlockRejection(input);
  if (rejection !== null) throw new SeasonBlockValidationError(rejection);
}

/**
 * The authoritative block pipeline. Returns one candidate checkpoint; every
 * validation, accounting, recap, and digest check runs before anything is
 * returned. The candidate's digest is a pure function of the recorded facts.
 *
 * The pipeline is split into public pieces so the browser worker can yield
 * between games and observe cancellation while the CLI runs the whole block
 * through this same function; both paths call the same code:
 * `seasonBlockGamesOf` -> `simulateSeasonBlockGame` ->
 * `assembleSeasonBlockCandidate` are exactly what this function does.
 */
export function simulateSeasonBlock(
  input: SeasonBlockSimulationInput,
  options: SeasonBlockSimulationOptions = {},
): SeasonCandidateCheckpoint {
  requireValidSeasonBlockCommand(input);
  const summaries: SeasonGameSummary[] = [];
  const retainedDetails: SeasonRetainedGameDetail[] = [];
  // M2.4 recovery cadence: exactly one deterministic between-round tick per
  // player (every team plays once per round, so the round boundary is the
  // between-game interval). The tick fires once per round advance — before
  // the first game of each new round — and never before the season's first
  // game. `previousRound` starts at the block's first round minus one so a
  // block continuation (round 10 -> 11) still ticks exactly once.
  const { fromRound } = blockRoundRange(input.command.blockIndex);
  let previousRound = fromRound - 1;
  let effects = input.effects;
  for (const game of seasonBlockGamesOf(input.schedule, input.command.blockIndex)) {
    if (options.cancelAfterGames !== undefined && summaries.length >= options.cancelAfterGames) {
      throw new SeasonBlockCancelledError(input.command.blockIndex, summaries.length);
    }
    const outcome = simulateSeasonBlockGame(input, game, effects, {
      skipRecoveryTick: !(previousRound !== 0 && game.round > previousRound),
    });
    effects = outcome.effects;
    previousRound = game.round;
    summaries.push(outcome.summary);
    if (outcome.retainedDetail !== null) retainedDetails.push(outcome.retainedDetail);
  }
  return assembleSeasonBlockCandidate(input, summaries, retainedDetails, effects);
}

/**
 * The block's games in stable execution order (gameId ascending within the
 * block's synchronized rounds). Every game id appears exactly once.
 */
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

/**
 * Simulates one block game through `simulateSeasonGameWithEffects` with the
 * derived named seed and the carried effects state, applies the between-game
 * recovery tick (skipped only for the season's first game), verifies the
 * result seed, converts to the compact summary (attaching the effects
 * rollup), and returns the retained detail row for human-team games (with
 * the full mechanism evidence) plus the authoritative next effects state.
 * `no-legal-five-both` is a typed invariant failure (a winner is never
 * fabricated).
 */
export function simulateSeasonBlockGame(
  input: SeasonBlockSimulationInput,
  game: SeasonScheduleGame,
  effects: SeasonEffectsState,
  options: { skipRecoveryTick?: boolean } = {},
): {
  summary: SeasonGameSummary;
  retainedDetail: SeasonRetainedGameDetail | null;
  effects: SeasonEffectsState;
} {
  const command = input.command;
  const run = input.run;
  const gameNumberById = new Map(
    input.schedule.games.map((game, index) => [game.gameId, index + 1]),
  );
  const rotationByFranchise = new Map(
    run.rotations.map((rotation) => [rotation.franchiseId, rotation]),
  );
  const rosterByFranchise = new Map(run.rosters.map((roster) => [roster.franchiseId, roster]));

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
      available: true,
    })),
    removals: [],
    homeCourt: SEASON_HOME_COURT_PROFILE,
  };
  // M2.4: one deterministic between-game recovery tick precedes every game
  // except the season's first (abstract schedule rounds; no calendar).
  let pregame = effects;
  if (!(options.skipRecoveryTick ?? false)) {
    pregame = applySeasonRecoveryTick(pregame, staminaByVersionOf(input));
  }
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
  const summary = seasonGameSummaryFromResult(result, game, transition);
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
    retainedDetail = seasonRetainedDetailFromResult(result, game, run.runId, transition);
  }
  return { summary, retainedDetail, effects: nextEffects };
}

/**
 * playerVersionId -> stamina rating for every expanded version (300 entries).
 * Stamina profiles are required on every expanded player (the catalog
 * derives them at build time), so a missing profile is an invariant failure.
 */
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

/**
 * Folds everything the block produced into one audited candidate checkpoint:
 * cumulative standings and aggregates over prior + block summaries, the
 * recap, all accounting audits, and the canonical digest. Used by the
 * whole-block pipeline and by the worker's chunked loop.
 */
export function assembleSeasonBlockCandidate(
  input: SeasonBlockSimulationInput,
  summaries: readonly SeasonGameSummary[],
  retainedDetails: readonly SeasonRetainedGameDetail[],
  effects: SeasonEffectsState,
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
    // M2.4: the checkpoint freezes the stamina, chemistry, and effect-targets
    // material versions with the effects state it carries.
    staminaVersion: run.versions.staminaVersion,
    chemistryVersion: run.versions.chemistryVersion,
    effectsTargetsVersion: run.versions.effectsTargetsVersion,
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
    // M2.4: the authoritative post-block effects state (300 player loads +
    // 1,350 pair states after this block's games and recovery ticks).
    effects,
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

/**
 * Applies a SubmitSeasonBlock command through the same validation path and
 * returns the typed rejection or the accepted candidate checkpoint. The
 * fixed rejection priority is run identity, duplicate command, stale cursor,
 * non-boundary block, invalid rotations.
 */
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

/**
 * Full accounting audit of a candidate checkpoint: summary count and
 * completeness (every block game present exactly once), unique ownership,
 * aggregate reconciliation against a fresh fold, standings reconciliation,
 * per-summary validity, retained-detail coverage, cursor advancement,
 * revision facts, and digest verification. Returns failure strings; empty
 * means valid.
 */
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

  // Summary count, uniqueness, and block coverage.
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

  // Per-summary validity.
  for (const summary of candidate.gameSummaries) {
    failures.push(
      ...auditSeasonGameSummary(summary).map((failure) => `summary ${summary.gameId}: ${failure}`),
    );
  }

  // Ownership: exactly 300 distinct player aggregates.
  if (candidate.playerAggregates.length !== SEASON_TEAM_COUNT * 10) {
    failures.push(
      `candidate must carry 300 player aggregates (got ${String(candidate.playerAggregates.length)})`,
    );
  }
  const aggregateIds = candidate.playerAggregates.map((player) => player.playerVersionId);
  if (new Set(aggregateIds).size !== aggregateIds.length) {
    failures.push('candidate player aggregates contain duplicate versions');
  }
  if (candidate.teamAggregates.length !== SEASON_TEAM_COUNT) {
    failures.push(
      `candidate must carry 30 team aggregates (got ${String(candidate.teamAggregates.length)})`,
    );
  }

  // Aggregate and standings reconciliation against a fresh fold.
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

  // Retained details: human games only, bounded, within the block.
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

  // Recap audit.
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
    }),
  );

  // M2.4 effects-state audit: the candidate's authoritative post-block state
  // covers exactly the 300 expanded versions and never reports a round beyond
  // the checkpoint cursor (schema shape, ranges, pair canonicality, and
  // uniqueness are enforced by seasonEffectsStateSchema at the boundary).
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

  // Digest verification.
  const recomputed = seasonCheckpointDigest(candidate);
  if (recomputed !== candidate.digest) {
    failures.push(`digest mismatch: stored ${candidate.digest}, recomputed ${recomputed}`);
  }
  return failures;
}
