import {
  SEASON_GAME_SUMMARY_VERSION,
  type Position,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonInjuryRecord,
  type SeasonObjectiveId,
  type SeasonPendingBlockCandidate,
  type SeasonRetainedGameDetail,
  type SeasonRun,
  type SeasonTeamBox,
} from '@hoop-rush/data-contracts';
import { foldSeasonPlayerAggregates, foldSeasonTeamAggregates } from './aggregates.ts';
import { rollSeasonInjuryForPlayer, seasonPlayerAvailable } from './injuries.ts';
import { chooseInitialUnit, type PlannerRotationContext } from './rotation-planner.ts';
import { reduceSeasonStandings } from './standings.ts';

/**
 * M2.5 health availability and interruption seams (season-health-v1, engine
 * side). Availability is DERIVED from the recorded injuries, never stored.
 * The human franchise with no legal five before a game produces a typed
 * `invalid-roster` interruption and an uncommitted pending candidate; AI
 * franchises with no legal five forfeit 2-0 through the ordinary game path.
 *
 * `SeasonInvalidRosterInterruption` is the data-contracts type (season-
 * pending-block.ts); it is re-exported here so engine consumers keep one
 * import surface.
 *
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

export type { SeasonInvalidRosterInterruption } from '@hoop-rush/data-contracts';

/**
 * The run facts the health seams read: identity, league, rosters,
 * rotations, and versions. Both the full `SeasonRun` (runner, command
 * layer) and the `SeasonBlockRunContext` the block pipeline carries satisfy
 * this shape.
 */
export type HealthRunView = Pick<
  SeasonRun,
  'runId' | 'rootSeed' | 'league' | 'rosters' | 'rotations' | 'versions'
>;

/** Regulation target seconds for one rostered version (target minutes x 60). */
function targetSecondsOf(
  rotation: SeasonRun['rotations'][number],
  playerVersionId: string,
): number {
  const entry = rotation.targetMinutes.find((row) => row.playerVersionId === playerVersionId);
  return (entry?.minutes ?? 0) * 60;
}

/**
 * Legal-five availability for one franchise (roster + positions + health).
 * The human pipeline check passes the expanded position facts (catalog-
 * derived); the runner-side reconstruction (no catalog in scope) falls back
 * to the lock-time-legal starters witness, then the availability-count
 * approximation — the authoritative legality decision always happens in the
 * pipeline, where the expanded positions are available.
 */
export function seasonFranchiseLegalFiveFacts(
  run: HealthRunView,
  franchiseId: string,
  health: SeasonHealthState,
  positions?: ReadonlyMap<string, readonly Position[]>,
): { legal: boolean; unavailablePlayerVersionIds: string[] } {
  const roster = run.rosters.find((entry) => entry.franchiseId === franchiseId);
  const rotation = run.rotations.find((entry) => entry.franchiseId === franchiseId);
  if (roster === undefined || rotation === undefined) {
    throw new Error(`season health: no roster or rotation for ${franchiseId}`);
  }
  const rosterIds = roster.players.map((player) => player.playerVersionId);
  const unavailablePlayerVersionIds = rosterIds.filter(
    (playerVersionId) => !seasonPlayerAvailable(health, playerVersionId),
  );
  const unavailable = new Set(unavailablePlayerVersionIds);

  let legal: boolean;
  if (positions !== undefined) {
    const members = new Map<string, readonly Position[]>();
    const targets = new Map<string, number>();
    for (const playerVersionId of rosterIds) {
      const playable = positions.get(playerVersionId);
      if (playable === undefined) {
        throw new Error(`season health: no positions for ${playerVersionId}`);
      }
      members.set(playerVersionId, playable);
      targets.set(playerVersionId, targetSecondsOf(rotation, playerVersionId));
    }
    const context: PlannerRotationContext = { rotation, members, targets };
    legal = chooseInitialUnit(context, unavailable) !== null;
  } else {
    // No position facts in scope (runner-side reconstruction): the rotation
    // lock validated the starters as a legal ordered five, so all starters
    // available is a sound legality witness; otherwise approximate with the
    // available-count rule (the pipeline's authoritative check uses the
    // full planner enumeration).
    const startersAvailable = rotation.starters.every(
      (playerVersionId) => !unavailable.has(playerVersionId),
    );
    legal = startersAvailable || rosterIds.length - unavailable.size >= 5;
  }
  return { legal, unavailablePlayerVersionIds };
}

/**
 * The pregame availability map for a set of rostered versions, derived from
 * health only (no rolls): used when a game is forfeit-pending (no player is
 * exposed, so no injuries roll) and by the runner-side reconstruction.
 */
export function seasonPregameAvailabilityOf(
  health: SeasonHealthState,
  players: readonly { playerVersionId: string }[],
): ReadonlyMap<string, boolean> {
  const map = new Map<string, boolean>();
  for (const player of players) {
    map.set(player.playerVersionId, seasonPlayerAvailable(health, player.playerVersionId));
  }
  return map;
}

/**
 * One game's availability/removal/return seam facts, derived from health
 * plus the seeded injury rolls for that game (engine-side seam builder the
 * block pipeline consumes). `pregame` covers all 20 rostered versions of
 * the two teams; exposed players (rotation target minutes > 0 and available)
 * roll against the frozen risk profile with durability from the catalog
 * and fatigue/recent load from the pregame effects state. All rolls are
 * named-seed pure functions, so replay and retry reproduce the exact seam.
 */
export function seasonGameHealthSeam(
  run: HealthRunView,
  health: SeasonHealthState,
  input: {
    rootSeed: string;
    gameId: string;
    round: number;
    homeFranchiseId: string;
    awayFranchiseId: string;
    targetMinutesByPlayer: ReadonlyMap<string, number>;
    /** M2.5: catalog durability rating per player (45..95); 45 when absent. */
    durabilityByPlayer?: ReadonlyMap<string, number>;
    /** M2.5: the pregame effects state (fatigue + recent load per player). */
    effects?: SeasonEffectsState;
  },
): {
  pregame: ReadonlyMap<string, boolean>;
  removals: readonly {
    playerVersionId: string;
    clock: { period: number; seconds: number };
    reason: 'injury';
  }[];
  returns: readonly {
    playerVersionId: string;
    clock: { period: number; seconds: number };
    reason: 'injury-return';
  }[];
  newInjuries: readonly SeasonInjuryRecord[];
} {
  const rosterByFranchise = new Map(run.rosters.map((roster) => [roster.franchiseId, roster]));
  const fatigueOf = new Map<string, number>();
  const loadOf = new Map<string, number>();
  for (const player of input.effects?.playerStates ?? []) {
    fatigueOf.set(player.playerVersionId, player.fatigueBasisPoints);
    loadOf.set(player.playerVersionId, player.recentLoadBasisPoints);
  }
  // The recurrence bonus applies while ANY of the player's injuries has an
  // open window (the highest open window is the active risk input).
  const recurrenceOf = new Map<string, number>();
  for (const record of health.injuries) {
    const current = recurrenceOf.get(record.playerVersionId) ?? 0;
    if (record.recurrenceWindowRoundsRemaining > current) {
      recurrenceOf.set(record.playerVersionId, record.recurrenceWindowRoundsRemaining);
    }
  }

  const pregame = new Map<string, boolean>();
  const removals: {
    playerVersionId: string;
    clock: { period: number; seconds: number };
    reason: 'injury';
  }[] = [];
  const returns: {
    playerVersionId: string;
    clock: { period: number; seconds: number };
    reason: 'injury-return';
  }[] = [];
  const newInjuries: SeasonInjuryRecord[] = [];

  for (const franchiseId of [input.homeFranchiseId, input.awayFranchiseId]) {
    const roster = rosterByFranchise.get(franchiseId);
    if (roster === undefined) {
      throw new Error(`season health: game ${input.gameId} references roster ${franchiseId}`);
    }
    for (const player of roster.players) {
      const available = seasonPlayerAvailable(health, player.playerVersionId);
      pregame.set(player.playerVersionId, available);
      const targetMinutes = input.targetMinutesByPlayer.get(player.playerVersionId) ?? 0;
      // Exposed = rotation target minutes > 0; an unavailable player never
      // rolls (they cannot take the floor).
      if (targetMinutes <= 0 || !available) continue;
      const roll = rollSeasonInjuryForPlayer({
        rootSeed: input.rootSeed,
        gameId: input.gameId,
        playerVersionId: player.playerVersionId,
        franchiseId,
        durabilityRating: input.durabilityByPlayer?.get(player.playerVersionId) ?? 45,
        fatigueBasisPoints: fatigueOf.get(player.playerVersionId) ?? 0,
        recentLoadBasisPoints: loadOf.get(player.playerVersionId) ?? 0,
        targetMinutes,
        recurrenceWindowRoundsRemaining: recurrenceOf.get(player.playerVersionId) ?? 0,
      });
      if (!roll.occurred || roll.injury === null) continue;
      newInjuries.push(roll.injury);
      if (roll.removalClock !== null) {
        removals.push({
          playerVersionId: player.playerVersionId,
          clock: { period: roll.removalClock.period, seconds: roll.removalClock.seconds },
          reason: 'injury',
        });
      }
      if (roll.returnClock !== null && roll.injury.sameGameReturn) {
        returns.push({
          playerVersionId: player.playerVersionId,
          clock: { period: roll.returnClock.period, seconds: roll.returnClock.seconds },
          reason: 'injury-return',
        });
      }
    }
  }
  return { pregame, removals, returns, newInjuries };
}

/** SeasonGame[] records reconstructed from compact summaries alone. */
function partialGamesOf(summaries: readonly SeasonGameSummary[]): SeasonRun['games'] {
  return summaries.map((summary) => ({
    gameId: summary.gameId,
    round: summary.round,
    homeFranchiseId: summary.homeFranchiseId,
    awayFranchiseId: summary.awayFranchiseId,
    status: summary.status,
    homeScore: summary.status === 'final' ? summary.homeScore : null,
    awayScore: summary.status === 'final' ? summary.awayScore : null,
    forfeitLoserFranchiseId: summary.forfeitLoserFranchiseId,
  }));
}

/**
 * Assembles the uncommitted partial-block candidate after an interruption:
 * completed summaries/details, effects, health, partial standings and
 * aggregates (the fold covers the completed block games; the authoritative
 * full fold is recomputed at final assembly), and the exact next game. The
 * pending candidate's standings fold covers the completed games available
 * to this seam — the worker/runner supply the run context without the
 * schedule or prior-block summaries, so a caller that has them can pass
 * `priorSummaries`/`schedule` for a fuller fold.
 */
export function assembleSeasonPendingBlock(input: {
  run: HealthRunView;
  commandId: string;
  blockIndex: number;
  expectedRevision: number;
  expectedStateRevision: number;
  expectedStateDigest: string;
  objectiveId: SeasonObjectiveId | null;
  nextGameId: string;
  summaries: readonly SeasonGameSummary[];
  retainedDetails: readonly SeasonRetainedGameDetail[];
  effects: SeasonEffectsState;
  health: SeasonHealthState;
  rotationDigest: string;
}): SeasonPendingBlockCandidate {
  const run = input.run;
  const games = partialGamesOf(input.summaries);
  return {
    schemaVersion: 1,
    blockVersion: run.versions.blockVersion,
    runId: run.runId,
    commandId: input.commandId,
    blockIndex: input.blockIndex,
    expectedRevision: input.expectedRevision,
    expectedStateRevision: input.expectedStateRevision,
    expectedStateDigest: input.expectedStateDigest,
    objectiveId: input.objectiveId,
    nextGameId: input.nextGameId,
    summaries: [...input.summaries],
    retainedDetails: [...input.retainedDetails],
    effects: input.effects,
    health: input.health,
    standings: reduceSeasonStandings(run.league, games),
    teamAggregates: foldSeasonTeamAggregates(input.summaries),
    playerAggregates: foldSeasonPlayerAggregates(input.summaries),
    rotationDigest: input.rotationDigest,
  };
}

/** Zero team box used on forfeits (official 2-0 result, no statistics). */
function zeroTeamBox(franchiseId: string): SeasonTeamBox {
  return {
    franchiseId,
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    possessions: 0,
  };
}

/**
 * The official 2-0 forfeit summary for a game (`human-interruption-forfeit`):
 * the human franchise loses 2-0 with empty player statistics and zero boxes,
 * mirroring the existing forfeit summary builder. The game identity comes
 * from the run's scheduled games array (the forfeit command layer always
 * holds a full run).
 */
export function seasonForfeitSummaryForGame(
  run: SeasonRun,
  gameId: string,
  humanFranchiseId: string,
): SeasonGameSummary {
  const game = run.games.find((entry) => entry.gameId === gameId);
  if (game === undefined) {
    throw new Error(`season forfeit: game ${gameId} is not in the run schedule`);
  }
  const humanIsHome = game.homeFranchiseId === humanFranchiseId;
  return {
    schemaVersion: 1,
    summaryVersion: SEASON_GAME_SUMMARY_VERSION,
    gameId: game.gameId,
    round: game.round,
    homeFranchiseId: game.homeFranchiseId,
    awayFranchiseId: game.awayFranchiseId,
    status: 'forfeit',
    overtimePeriods: 0,
    homeScore: humanIsHome ? 0 : 2,
    awayScore: humanIsHome ? 2 : 0,
    forfeitLoserFranchiseId: humanFranchiseId,
    homeBox: zeroTeamBox(game.homeFranchiseId),
    awayBox: zeroTeamBox(game.awayFranchiseId),
    homePlayers: [],
    awayPlayers: [],
    injuryEvents: [],
  };
}

/**
 * Advances the pending candidate past a forfeited game in block order:
 * `nextGameId` becomes the next game of the block (stable game ids are
 * sequential in schedule order). The pending's summaries already include
 * the forfeit summary (the caller appends it); standings/aggregates are
 * refreshed at final assembly, so they are left as recorded here. A forfeit
 * of the block's last game completes the block — there is no next game to
 * advance to, which is a typed error the caller must surface.
 */
export function advancePendingAfterForfeit(
  pending: SeasonPendingBlockCandidate,
  forfeitedGameId: string,
): SeasonPendingBlockCandidate {
  const gameNumber = Number.parseInt(forfeitedGameId.slice(1), 10);
  if (!Number.isInteger(gameNumber) || gameNumber < 1) {
    throw new Error(`season forfeit: malformed game id ${forfeitedGameId}`);
  }
  const blockEndNumber = pending.blockIndex >= 8 ? 1230 : (pending.blockIndex + 1) * 150;
  const nextNumber = gameNumber + 1;
  if (nextNumber > blockEndNumber) {
    throw new Error(
      `season forfeit: ${forfeitedGameId} is the last game of block ${String(pending.blockIndex)}; the block is complete and has no next game`,
    );
  }
  return {
    ...pending,
    summaries: [...pending.summaries],
    retainedDetails: [...pending.retainedDetails],
    nextGameId: `s${String(nextNumber).padStart(6, '0')}`,
  };
}
