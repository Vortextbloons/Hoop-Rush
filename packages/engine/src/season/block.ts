import {
  SEASON_ENDING_MISSED_GAMES_SENTINEL,
  SEASON_BLOCK_COUNT,
  SEASON_FREE_AGENCY_VERSION,
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
  /**
   * M2.5: the pre-block health state (append-only injury records). The
   * pipeline threads it exactly like effects: per-game availability and
   * injury rolls derive from it, every game's health transition folds on
   * top of it, and the post-block state rides the candidate checkpoint.
   */
  health: SeasonHealthState;
  /**
   * M2.5: the locked block objective (blocks 0-7), or null for the final
   * two-game block 8. The pipeline evaluates it at assembly from saved
   * facts only (never invents numbers).
   */
  objectiveId: SeasonObjectiveId | null;
  /**
   * M2.5: the pre-block Influence state (30 balances + ledger + spend
   * tracking). Optional seam: when absent, assembly starts from the
   * run-creation initial state (the authoritative run is the commit side's
   * source; the worker/runner thread it explicitly at integration).
   */
  influence?: SeasonInfluenceState;
  /**
   * M2.5: the pre-block run-scoped transaction entries (append-only).
   * Optional seam: when absent, assembly starts from an empty log (the
   * candidate then carries only this block's new entries).
   */
  transactions?: SeasonTransactionEntry[];
  /**
   * M2.6.5: the pre-block free-agency state. Optional seam like influence:
   * the candidate carries it into the checkpoint so the post-block facts
   * (including any window the commit side opens) stay digest-consistent.
   * When absent, assembly starts from the empty state.
   */
  freeAgency?: SeasonFreeAgencyState;
  /**
   * M2.5: the run's objective state (fixed catalog + selections). Optional
   * seam for the submit-command validation path: when absent, the
   * `invalid-objective` check is skipped (the commit side validates the
   * locked objective against the authoritative run).
   */
  objectives?: SeasonObjectiveState;
  /**
   * M2.5: in-place per-game tip availability collection (one entry per
   * human-team game, in block game order). `simulateSeasonBlockGame` fills
   * it as it runs; `assembleSeasonBlockCandidate` reads it for the locked
   * objective's availability measure. Deterministic by construction: every
   * pipeline path simulates through the same input object.
   */
  collectedTipAvailability?: { gameId: string; availableCount: number }[];
}

/** Duplicate-detection seam for the command handler. */
export interface SeasonSubmitBlockCommandInput extends SeasonBlockSimulationInput {
  /** Append-only history of command ids already accepted by the run. */
  acceptedCommandIds: readonly string[];
  /**
   * M2.5: the run's objective state (fixed catalog + selections). Required
   * on the typed command path so the `invalid-objective` validation binds
   * the submitted objectiveId to the block's deterministic offer and the
   * recorded selection. Optional seam: when absent, the check is skipped
   * (the commit side validates the locked objective against the
   * authoritative run).
   */
  objectives?: SeasonObjectiveState;
}

/** M2.6.5: the empty free-agency state (30 franchises, no windows). */
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

/** The run state facts the digest covers (frozen scope, self-excluded). */
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
 * Per-game simulation options. The block loop precomputes the run-constant
 * lookup maps once per block and threads them through so a 10-game block
 * never rebuilds them per game; direct callers (tests) may omit them and the
 * per-game fallbacks compute the same maps.
 */
export interface SeasonBlockGameSimulationOptions {
  /** Skip the between-round recovery tick (first game of the season). */
  skipRecoveryTick?: boolean;
  /** gameId -> 1-based game number across the schedule (1,230 entries). */
  gameNumberById?: Map<string, number>;
  /** franchiseId -> locked rotation (30 entries). */
  rotationByFranchise?: Map<string, SeasonRotation>;
  /** franchiseId -> roster (30 entries). */
  rosterByFranchise?: Map<string, SeasonRoster>;
  /** playerVersionId -> stamina rating (300 entries). */
  staminaByVersion?: Map<string, number>;
  /** playerVersionId -> catalog durability rating (300 entries). */
  durabilityByVersion?: Map<string, number>;
  /** playerVersionId -> playable positions (300 entries). */
  positions?: Map<string, readonly Position[]>;
}

/**
 * Resolves every LOCKED ROTATION's ten playerVersionIds to catalog entries
 * and asserts unique ownership: exactly 300 distinct versions across the
 * league (ten per franchise). M2.6.5 (spec/2.0/15): rosters may hold 10-15
 * players, but the game pipeline receives exactly the ten rotation members
 * per side — inactive depth never plays, records no minutes, and receives no
 * stamina/chemistry/injury exposure.
 */
export function expandSeasonRunRosters(
  run: SeasonBlockRunContext,
  catalog: SeasonDraftCatalog,
): Map<string, SeasonGamePlayerInput> {
  const candidates = new Map(
    catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
  );
  const rosterByFranchise = new Map(run.rosters.map((roster) => [roster.franchiseId, roster]));
  const expanded = new Map<string, SeasonGamePlayerInput>();
  const seen = new Set<string>();
  for (const rotation of run.rotations) {
    const roster = rosterByFranchise.get(rotation.franchiseId);
    if (roster === undefined) {
      throw new Error(`rotation for unknown franchise ${rotation.franchiseId}`);
    }
    const rosterById = new Map(roster.players.map((player) => [player.playerVersionId, player]));
    for (const playerVersionId of [...rotation.starters, ...rotation.benchOrder]) {
      const player = rosterById.get(playerVersionId);
      if (player === undefined) {
        throw new Error(
          `rotation member ${playerVersionId} is not on roster ${rotation.franchiseId}`,
        );
      }
      const candidate = candidates.get(playerVersionId);
      if (candidate === undefined) {
        throw new Error(
          `roster ${rotation.franchiseId} references unknown catalog version ${playerVersionId}`,
        );
      }
      if (seen.has(playerVersionId)) {
        throw new Error(`playerVersionId ${playerVersionId} appears on more than one roster`);
      }
      seen.add(playerVersionId);
      expanded.set(playerVersionId, {
        playerVersionId,
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
          playerVersionId,
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

  // M2.5: the locked objective must bind to this block. Blocks 0-7 require
  // a selected objective that was offered for the block (deterministic
  // three-choice set) and recorded in the run's objective selections;
  // block 8 must carry null. Skipped when the seam does not supply the
  // run's objective state (the commit side validates against the
  // authoritative run).
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

  // M2.6.5: an open free-agency market blocks the next rotation lock. There
  // is no automatic skip or automatic resolution of saved picks; the window
  // must be explicitly resolved (see spec/2.0/15).
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
  let health = input.health;
  // Run-constant lookup maps: pure functions of the block input, computed
  // once and threaded through every game (never rebuilt per game).
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
      // The whole-block path (CLI/fixture runs) never expects an invalid-
      // roster interruption: a winner is never fabricated, and the typed
      // interruption is surfaced as an invariant failure with its facts.
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
 * The per-game simulation outcome: either the game facts (summary, retained
 * detail, and the next effects/health states) or a typed `invalid-roster`
 * interruption marker when the human franchise cannot field a legal five at
 * tipoff from health availability. The caller assembles a pending candidate
 * from an interruption; the accepted cursor never advances.
 */
export type SeasonBlockGameOutcome =
  | {
      summary: SeasonGameSummary;
      retainedDetail: SeasonRetainedGameDetail | null;
      effects: SeasonEffectsState;
      health: SeasonHealthState;
    }
  | { interruption: SeasonInvalidRosterInterruption };

/**
 * Simulates one block game through `simulateSeasonGameWithEffects` with the
 * derived named seed, the carried effects state, and the M2.5 health seam
 * (availability + seeded injury rolls + same-game returns), applies the
 * between-game recovery tick (skipped only for the season's first game),
 * folds the game's health transition, verifies the result seed, converts to
 * the compact summary (attaching the effects rollup and the compact injury
 * events), and returns the retained detail row for human-team games (with
 * the full mechanism evidence) plus the authoritative next effects/health
 * states. Before simulation, a human-team game whose availability cannot
 * field a legal five returns the typed interruption instead of simulating.
 * `no-legal-five-both` is a typed invariant failure (a winner is never
 * fabricated).
 */
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

  // M2.4: one deterministic between-round recovery tick precedes every game
  // except the season's first (abstract schedule rounds; no calendar). The
  // seam reads the pregame effects state (fatigue/recent load at this game).
  let pregame = effects;
  if (!(options.skipRecoveryTick ?? false)) {
    pregame = applySeasonRecoveryTick(
      pregame,
      options.staminaByVersion ?? staminaByVersionOf(input),
    );
  }

  // M2.5: tipoff availability is decided BEFORE any injury rolls. A game
  // where either team cannot field a legal five from health availability is
  // a forfeit (or, for the human, the typed interruption) — no player is
  // exposed, so no injuries roll for it (exposure means actually playing;
  // rolling for a forfeited game would fabricate records without events).
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

  // M2.5: the health seam — pregame availability for all 20 players, the
  // seeded injury rolls for this game, and the same-game return clocks.
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

  // M2.5: fold the game's health transition — new injuries append, same-
  // game returns resolve from the applied return events, and the two
  // franchises that played advance one recovery cadence.
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

/** playerVersionId -> catalog durability rating (45..95) for every version. */
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

/**
 * Same-game return resolutions for the game's rolled records: a return
 * applied when the completed result carries a return event for the player
 * (forfeited games never resolve a return).
 */
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

/**
 * Compact per-game injury events (season-game-summary-v3): one event per
 * rolled record with the applied removal/return clocks (the rolled clock
 * when the game ended before the removal could apply).
 */
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

/**
 * Folds everything the block produced into one audited candidate checkpoint:
 * cumulative standings and aggregates over prior + block summaries, the
 * recap (with the M2.5 injury/objective/trade/influence evidence), the
 * M2.5 objective evaluation from saved facts, the post-block Influence
 * state (block grants for all 30 franchises plus the human objective
 * reward), the block's grant transaction entries, the run state chain facts
 * the command asserted, and the canonical digest. Used by the whole-block
 * pipeline and by the worker's chunked loop.
 */
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

  // M2.5: evaluate the locked objective from saved facts only (the human
  // rotation identifies starters for bench-320; the collected tip
  // availability feeds availability-eight).
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

  // M2.5: the post-block Influence state (this block's grants + objective
  // reward over the pre-block state) and the block's transaction entries.
  const franchiseIds = run.league.teams.map((team) => team.franchiseId);
  // M2.5: the pre-block Influence state. `input.influence` is the explicit
  // carrier (the worker threads it from the wire); CLI and test callers
  // pass the full run snapshot, whose `influence` field is authoritative;
  // the initial state is the last-resort fallback so an empty carrier can
  // never fabricate grants over a stale economy.
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
    // M2.4: the checkpoint freezes the stamina, chemistry, and effect-targets
    // material versions with the effects state it carries.
    staminaVersion: run.versions.staminaVersion,
    chemistryVersion: run.versions.chemistryVersion,
    effectsTargetsVersion: run.versions.effectsTargetsVersion,
    // M2.5: the checkpoint freezes the health, trade, influence, objective,
    // and targets material versions with the facts it carries.
    healthVersion: run.versions.healthVersion,
    tradeVersion: run.versions.tradeVersion,
    influenceVersion: run.versions.influenceVersion,
    objectiveVersion: run.versions.objectiveVersion,
    injuryTargetsVersion: run.versions.injuryTargetsVersion,
    tradeTargetsVersion: run.versions.tradeTargetsVersion,
    influenceTargetsVersion: run.versions.influenceTargetsVersion,
    // M2.6.5: the checkpoint freezes the free-agency material versions with
    // the free-agency state it carries.
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
    // M2.4: the authoritative post-block effects state (300 player loads +
    // 1,350 pair states after this block's games and recovery ticks).
    effects,
    // M2.5: the authoritative post-block health state, the post-block
    // Influence state (this block's grants + objective reward), and the
    // post-block transaction entries (this block's grant entries over the
    // carried pre-block log).
    health,
    influence: grantResult.influence,
    // M2.6.5: the free-agency state across the block (windows open at the
    // commit side, never inside the pipeline).
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
    // M2.5: the pre-block run state facts the command asserted. The
    // post-block facts are placeholders here (LEAD DECISION): the commit
    // side derives them through `deriveSeasonPostBlockState`.
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

/**
 * M2.5: derives the post-block run state chain facts from the submitted run
 * and the accepted candidate (LEAD DECISION §20.4): the checkpoint state
 * (the accepted block's identity facts), `stateRevision = run.stateRevision
 * + 1`, and the canonical `stateDigest` over the post-block run state
 * (`seasonRunStateDigest`: state chain + candidate health/influence/
 * transactions + the run's trade/objectives/rosters/ownership/rotations +
 * the candidate effects). The no-window path's authoritative facts; the
 * trade-window path re-derives through `completeSeasonBlockCommit`.
 */
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

/**
 * M2.5: the full block commit seam — `deriveSeasonPostBlockState` plus the
 * optional trade-window open on the post-block run state. Window blocks
 * (2/4/5) open their deterministic window through `openSeasonTradeWindow`
 * (a missing catalog throws `SeasonTradeFactsError` rather than recording
 * an unvalidated window); non-window blocks return `window: null`. When a
 * window opens, the returned state chain facts are the POST-WINDOW facts
 * (the window advanced the chain by one more revision), so the persisted
 * trade/influence/transactions/effects and the chain stay coherent.
 */
export function completeSeasonBlockCommit(input: {
  run: SeasonRun;
  candidate: SeasonCandidateCheckpoint;
  commandId: string;
  rotationDigest: string;
  humanFranchiseId: string | null;
  /** Packaged draft catalog (required for window blocks; §13/§20). */
  catalog?: SeasonDraftCatalog;
  /** The pre-window effects state; defaults to the candidate's. */
  effects?: SeasonEffectsState;
  /** M2.6.5: packaged free-agency index (required for free-agency window blocks). */
  freeAgencyIndex?: SeasonFreeAgencyIndex;
  /** M2.6.5: frozen roster-targets policy (AI free-agency ceilings). */
  freeAgencyTargets?: SeasonRosterTargets;
}): {
  checkpointState: SeasonCheckpointState;
  stateRevision: number;
  stateDigest: string;
  window: SeasonWindowOpenResult | null;
  /** M2.6.5: the opened free-agency window (null on non-window blocks). */
  freeAgencyWindow: SeasonFreeAgencyWindowState | null;
  /** M2.6.5: the post-window free-agency state (unchanged on non-window blocks). */
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

  // M2.6.5: free-agency windows open after accepted blocks 2, 4, 6, on top
  // of the post-block (and post-trade-window) state. Each open advances the
  // state chain by exactly one revision.
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

/**
 * M2.5: engine-side resume facts for an interrupted block. Validates the
 * pending candidate against the resume identity facts (run, block, rotation
 * digest) and returns the exact next game to simulate; the block runner
 * executes the resume through the ordinary per-game pipeline. Rejected
 * resumes return the typed rejection (the run command layer applies the
 * same rules through `handleSeasonRunCommand`).
 */
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

  // Ownership: player aggregates fold the players who actually played (a
  // franchise that forfeits every game contributes no lines, so the row
  // count can dip below 300); every row must be a rostered version and
  // distinct.
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

  // M2.5 health-state audit: every recorded injury references a rostered
  // version of a league franchise and a scheduled game at or before the
  // checkpoint cursor (the run health is cumulative across blocks, so prior
  // blocks' injuries are legitimate), and every active-return fact stays
  // inside the season.
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

  // M2.5 objective audit: the evaluated objective binds to the command and
  // the recorded evaluation facts. A null objective (no lock / final block)
  // carries the unevaluated placeholder evaluation with zeroed facts, so
  // the evaluation consistency checks apply only to evaluated objectives.
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

  // M2.5 run state chain facts: the asserted pre-block facts and the
  // assembly placeholders the commit side patches.
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

  // M2.5 transaction audit: unique ids, bound to this block or the carried
  // pre-block log, and never duplicated.
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
