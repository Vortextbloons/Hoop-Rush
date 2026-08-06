import {
  blockIndexForRound,
  SEASON_GAMES_PER_ROUND,
  SEASON_ROSTER_SIZE,
  SEASON_TEAM_COUNT,
  type SeasonAcceptedBlock,
  type SeasonGame,
  type SeasonGameSummary,
  type SeasonLeague,
  type SeasonRetainedGameDetail,
  type SeasonRoster,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import type { StoredSeasonRunRecord } from '../schemas/season-run-record.ts';
import type { SeasonRunEngineSeam } from './engine-seam-types.ts';

/**
 * Reconciliation audit for a stored Season Run (spec/2.0/07 persistence,
 * M2.3, M2.4). Every check derives from recorded facts and the pure engine
 * helpers behind the `SeasonRunEngineSeam`, so a fresh fold always agrees
 * with the stored checkpoint and a corrupt row or a half-applied block is
 * detected instead of entering app state.
 *
 * Checks:
 * - schedule identity: every summary matches its schedule game, every
 *   completed round is fully covered, and no game is counted twice.
 * - standings reconcile exactly with the finalized game records
 *   (`reduceSeasonStandings` over the reconstructed games).
 * - every stored summary row is accounted for in the aggregates
 *   (`foldSeasonTeamAggregates` / `foldSeasonPlayerAggregates` agree with
 *   the stored tables exactly).
 * - block history chain: revisions are contiguous 0..n-1, per-block
 *   summary counts match the stored rows, completedRounds never regresses
 *   and matches each block boundary, and the checkpoint's cursor facts
 *   (lastCommandId / lastRotationDigest / lastCheckpointDigest) agree with
 *   the last accepted block.
 * - retention policy: retained detail rows cover human-team games only and
 *   reference a stored summary.
 * - M2.4 effects state: exactly 300 player load states and 1,350 pair
 *   states, unique playerVersionIds, unique pairs, canonical a<b pair
 *   ordering, every pair member present in the player states, all
 *   fatigue/recentLoad within 0..10,000, lastCompletedRound within 0..82
 *   and never beyond the checkpoint's completedRounds, sharedPossessions
 *   within 0..10,000,000, and the effects player set exactly equal to the
 *   union of the 30 rosters' players.
 */
export interface SeasonRunAuditFacts {
  league: SeasonLeague;
  rosters: readonly SeasonRoster[];
  schedule: SeasonSchedule;
  humanFranchiseId: string;
  /** Validated current (v3) stored checkpoint row; row-level facts are authoritative. */
  stored: StoredSeasonRunRecord;
  summaries: readonly SeasonGameSummary[];
  retainedDetails: readonly SeasonRetainedGameDetail[];
  acceptedBlocks: readonly SeasonAcceptedBlock[];
}

/** Plain-JSON deep equality; key order is irrelevant. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => deepEqual(value, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key, index) => {
      if (key !== bKeys[index]) return false;
      return deepEqual(a[key], b[key]);
    });
  }
  return false;
}

function sortById<T>(rows: readonly T[], idOf: (row: T) => string): T[] {
  return [...rows].sort((a, b) => (idOf(a) < idOf(b) ? -1 : 1));
}

/** Expected completed rounds at a block boundary (blockRoundRange.toRound). */
function expectedCompletedRoundsAt(blockIndex: number): number {
  return blockIndex === 8 ? 82 : (blockIndex + 1) * 10;
}

/** Audits one stored run and returns the failure list (empty = healthy). */
export function auditSeasonRunState(
  facts: SeasonRunAuditFacts,
  seam: SeasonRunEngineSeam,
): string[] {
  const failures: string[] = [];
  const { stored, summaries, retainedDetails, acceptedBlocks } = facts;

  const scheduleById = new Map(facts.schedule.games.map((game) => [game.gameId, game]));
  const summaryIds = new Set<string>();

  // Schedule identity and round coverage.
  const summariesPerRound = new Map<number, number>();
  for (const summary of summaries) {
    if (summaryIds.has(summary.gameId)) {
      failures.push(`duplicate summary row for game ${summary.gameId}`);
    }
    summaryIds.add(summary.gameId);
    const scheduled = scheduleById.get(summary.gameId);
    if (scheduled === undefined) {
      failures.push(`summary ${summary.gameId} does not exist in the schedule`);
      continue;
    }
    if (
      scheduled.round !== summary.round ||
      scheduled.homeFranchiseId !== summary.homeFranchiseId ||
      scheduled.awayFranchiseId !== summary.awayFranchiseId
    ) {
      failures.push(
        `summary ${summary.gameId} identity does not match its schedule game ` +
          `(round ${String(summary.round)}/${String(scheduled.round)}, ` +
          `${summary.homeFranchiseId}@${summary.awayFranchiseId} vs ` +
          `${scheduled.homeFranchiseId}@${scheduled.awayFranchiseId})`,
      );
    }
    if (summary.round > stored.completedRounds) {
      failures.push(
        `summary ${summary.gameId} round ${String(summary.round)} exceeds completedRounds ` +
          String(stored.completedRounds),
      );
    }
    summariesPerRound.set(summary.round, (summariesPerRound.get(summary.round) ?? 0) + 1);
  }
  if (summaries.length !== stored.completedRounds * SEASON_GAMES_PER_ROUND) {
    failures.push(
      `summary count ${String(summaries.length)} does not match completedRounds ` +
        `${String(stored.completedRounds)} (${String(stored.completedRounds * SEASON_GAMES_PER_ROUND)} expected)`,
    );
  }
  for (let round = 1; round <= stored.completedRounds; round += 1) {
    const count = summariesPerRound.get(round) ?? 0;
    if (count !== SEASON_GAMES_PER_ROUND) {
      failures.push(
        `round ${String(round)} holds ${String(count)} summaries, expected ${String(SEASON_GAMES_PER_ROUND)}`,
      );
    }
  }

  // Reconstruct the finalized games and recompute standings + aggregates.
  let games: readonly SeasonGame[] = [];
  try {
    games = seam.reconstructSeasonGames(facts.schedule, summaries);
  } catch (error) {
    failures.push(`reconstructSeasonGames failed: ${errorMessage(error)}`);
  }
  const played = games.filter((game) => game.status !== 'scheduled');

  try {
    const expectedStandings = seam.reduceSeasonStandings(facts.league, played);
    if (!deepEqual(expectedStandings, stored.standings)) {
      failures.push('stored standings do not reconcile with the finalized game records');
    }
  } catch (error) {
    failures.push(`standings reduction failed: ${errorMessage(error)}`);
  }

  try {
    const expectedTeams = sortById(
      seam.foldSeasonTeamAggregates(facts.league, summaries),
      (row) => row.franchiseId,
    );
    if (
      !deepEqual(
        expectedTeams,
        sortById(stored.teamAggregates, (row) => row.franchiseId),
      )
    ) {
      failures.push('stored team aggregates do not reconcile with the stored summaries');
    }
  } catch (error) {
    failures.push(`team aggregate fold failed: ${errorMessage(error)}`);
  }

  try {
    const expectedPlayers = sortById(
      seam.foldSeasonPlayerAggregates(facts.rosters, summaries),
      (row) => row.playerVersionId,
    );
    if (
      !deepEqual(
        expectedPlayers,
        sortById(stored.playerAggregates, (row) => row.playerVersionId),
      )
    ) {
      failures.push('stored player aggregates do not reconcile with the stored summaries');
    }
  } catch (error) {
    failures.push(`player aggregate fold failed: ${errorMessage(error)}`);
  }

  // Block history chain: revisions, boundaries, digests, command ids.
  const expectedRevision = acceptedBlocks.length;
  if (stored.revision !== expectedRevision) {
    failures.push(
      `stored revision ${String(stored.revision)} does not match accepted-block count ${String(expectedRevision)}`,
    );
  }
  const blockSummaryCounts = new Map<number, number>();
  for (const summary of summaries) {
    const blockIndex = blockIndexForRound(summary.round);
    blockSummaryCounts.set(blockIndex, (blockSummaryCounts.get(blockIndex) ?? 0) + 1);
  }
  let previousCompletedRounds = 0;
  acceptedBlocks.forEach((block, index) => {
    if (block.revision !== index + 1) {
      failures.push(
        `accepted block ${String(block.blockIndex)} carries revision ${String(block.revision)}, expected ${String(index + 1)}`,
      );
    }
    if (block.blockIndex !== block.revision - 1) {
      failures.push(
        `accepted block ${String(block.blockIndex)} does not match revision ${String(block.revision)}`,
      );
    }
    const boundary = expectedCompletedRoundsAt(block.blockIndex);
    if (block.completedRounds !== boundary) {
      failures.push(
        `accepted block ${String(block.blockIndex)} completedRounds ${String(block.completedRounds)} does not match its boundary ${String(boundary)}`,
      );
    }
    if (block.completedRounds < previousCompletedRounds) {
      failures.push('accepted-block completedRounds regresses along the chain');
    }
    previousCompletedRounds = block.completedRounds;
    const storedCount = blockSummaryCounts.get(block.blockIndex) ?? 0;
    if (block.summaryCount !== storedCount) {
      failures.push(
        `accepted block ${String(block.blockIndex)} summaryCount ${String(block.summaryCount)} does not match stored rows (${String(storedCount)})`,
      );
    }
  });

  const last = acceptedBlocks[acceptedBlocks.length - 1];
  if (last === undefined) {
    if (stored.completedRounds !== 0) {
      failures.push(
        `checkpoint completedRounds ${String(stored.completedRounds)} with no accepted block`,
      );
    }
    if (stored.lastCommandId !== null || stored.lastCheckpointDigest !== null) {
      failures.push('checkpoint carries cursor facts with no accepted block');
    }
    if (stored.recap !== null) {
      failures.push('checkpoint carries a recap with no accepted block');
    }
  } else {
    if (stored.completedRounds !== last.completedRounds) {
      failures.push(
        `checkpoint completedRounds ${String(stored.completedRounds)} does not match the last accepted block`,
      );
    }
    if (stored.lastCommandId !== last.commandId) {
      failures.push('checkpoint lastCommandId does not match the last accepted block');
    }
    if (stored.lastRotationDigest !== last.rotationDigest) {
      failures.push('checkpoint lastRotationDigest does not match the last accepted block');
    }
    if (stored.lastCheckpointDigest !== last.checkpointDigest) {
      failures.push('checkpoint lastCheckpointDigest does not match the last accepted block');
    }
    // The snapshot's locked rotations must match the last lock digest.
    const lockedDigest = seam.seasonRotationSetDigest(stored.run.rotations);
    if (lockedDigest !== last.rotationDigest) {
      failures.push(
        `stored rotations digest ${lockedDigest} does not match the last accepted lock ${last.rotationDigest}`,
      );
    }
    const recap = stored.recap;
    if (recap !== null) {
      if (recap.runId !== stored.run.runId || recap.blockIndex !== last.blockIndex) {
        failures.push('checkpoint recap does not describe the last accepted block');
      }
      if (recap.completedRounds !== stored.completedRounds) {
        failures.push('checkpoint recap completedRounds does not match the checkpoint');
      }
    } else {
      failures.push('checkpoint carries no recap after an accepted block');
    }
  }

  // Retention policy: retained details are human-team games with summaries.
  const summaryById = new Map(summaries.map((summary) => [summary.gameId, summary]));
  const detailCountsPerBlock = new Map<number, number>();
  for (const detail of retainedDetails) {
    const summary = summaryById.get(detail.gameId);
    if (summary === undefined) {
      failures.push(`retained detail ${detail.gameId} has no stored summary`);
      continue;
    }
    if (summary.round !== detail.round) {
      failures.push(
        `retained detail ${detail.gameId} round ${String(detail.round)} does not match its summary`,
      );
    }
    if (
      detail.homeFranchiseId !== facts.humanFranchiseId &&
      detail.awayFranchiseId !== facts.humanFranchiseId
    ) {
      failures.push(
        `retained detail ${detail.gameId} does not involve the human franchise ${facts.humanFranchiseId}`,
      );
    }
    if (detail.runId !== stored.run.runId) {
      failures.push(`retained detail ${detail.gameId} runId does not match the checkpoint`);
    }
    const blockIndex = blockIndexForRound(detail.round);
    detailCountsPerBlock.set(blockIndex, (detailCountsPerBlock.get(blockIndex) ?? 0) + 1);
  }
  for (const [blockIndex, count] of detailCountsPerBlock) {
    if (count > 10) {
      failures.push(
        `block ${String(blockIndex)} retains ${String(count)} details, exceeding the 10-game policy`,
      );
    }
  }

  // M2.4 effects state: player load and pair chemistry.
  const { effects } = stored;
  const expectedPlayerCount = SEASON_TEAM_COUNT * SEASON_ROSTER_SIZE;
  const expectedPairCount = (SEASON_TEAM_COUNT * SEASON_ROSTER_SIZE * (SEASON_ROSTER_SIZE - 1)) / 2;
  const rosterIds = seam.seasonRosterPlayerVersionIds(facts.rosters);
  const effectIds = new Set<string>();
  for (const player of effects.playerStates) {
    if (effectIds.has(player.playerVersionId)) {
      failures.push(`duplicate effects player state ${player.playerVersionId}`);
    }
    effectIds.add(player.playerVersionId);
    if (player.fatigueBasisPoints < 0 || player.fatigueBasisPoints > 10_000) {
      failures.push(
        `effects player ${player.playerVersionId} fatigueBasisPoints ${String(player.fatigueBasisPoints)} is outside 0..10000`,
      );
    }
    if (player.recentLoadBasisPoints < 0 || player.recentLoadBasisPoints > 10_000) {
      failures.push(
        `effects player ${player.playerVersionId} recentLoadBasisPoints ${String(player.recentLoadBasisPoints)} is outside 0..10000`,
      );
    }
    if (player.lastCompletedRound < 0 || player.lastCompletedRound > 82) {
      failures.push(
        `effects player ${player.playerVersionId} lastCompletedRound ${String(player.lastCompletedRound)} is outside 0..82`,
      );
    }
    if (player.lastCompletedRound > stored.completedRounds) {
      failures.push(
        `effects player ${player.playerVersionId} lastCompletedRound ${String(player.lastCompletedRound)} exceeds checkpoint completedRounds ${String(stored.completedRounds)}`,
      );
    }
  }
  if (effects.playerStates.length !== expectedPlayerCount) {
    failures.push(
      `effects player state count ${String(effects.playerStates.length)} is not ${String(expectedPlayerCount)}`,
    );
  }
  if (effectIds.size !== rosterIds.length || rosterIds.some((id) => !effectIds.has(id))) {
    failures.push('effects player set does not match the union of the 30 rosters');
  }
  const pairKeys = new Set<string>();
  for (const pair of effects.pairStates) {
    const key = seam.seasonPairKey(pair.a, pair.b);
    if (pairKeys.has(key)) {
      failures.push(`duplicate effects pair ${key}`);
    }
    pairKeys.add(key);
    if (!seam.seasonPairIsCanonical(pair.a, pair.b)) {
      failures.push(`effects pair ${key} is not canonical (a < b)`);
    }
    if (!effectIds.has(pair.a) || !effectIds.has(pair.b)) {
      failures.push(`effects pair ${key} has a member outside the player states`);
    }
    if (pair.sharedPossessions < 0 || pair.sharedPossessions > 10_000_000) {
      failures.push(
        `effects pair ${key} sharedPossessions ${String(pair.sharedPossessions)} is outside 0..10000000`,
      );
    }
  }
  if (effects.pairStates.length !== expectedPairCount) {
    failures.push(
      `effects pair state count ${String(effects.pairStates.length)} is not ${String(expectedPairCount)}`,
    );
  }

  return failures;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
