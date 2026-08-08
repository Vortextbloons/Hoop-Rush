import {
  blockIndexForRound,
  SEASON_GAMES_PER_ROUND,
  SEASON_INFLUENCE_CAP,
  SEASON_ENDING_MISSED_GAMES_SENTINEL,
  SEASON_ROSTER_SIZE,
  SEASON_TEAM_COUNT,
  type SeasonAcceptedBlock,
  type SeasonGame,
  type SeasonGameSummary,
  type SeasonLeague,
  type SeasonPendingBlockCandidate,
  type SeasonRetainedGameDetail,
  type SeasonRoster,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import type { StoredSeasonRunRecord } from '../schemas/season-run-record.ts';
import type { SeasonRunEngineSeam } from './engine-seam-types.ts';

/**
 * Reconciliation audit for a stored Season Run (spec/2.0/07 persistence,
 * M2.3, M2.4, M2.5). Every check derives from recorded facts and the pure
 * engine helpers behind the `SeasonRunEngineSeam`, so a fresh fold always
 * agrees with the stored checkpoint and a corrupt row or a half-applied
 * block is detected instead of entering app state.
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
 * - M2.5 health state: every injury references a known player-version id
 *   (union of the rosters) and a league franchise, its occurrence game
 *   exists in the schedule, season-ending injuries carry the sentinel
 *   `missedGamesRemaining`, non-eligible injuries never resolve a same-game
 *   return, and a positive recurrence window implies an actual return.
 * - M2.5 Influence reconciliation: every ledger entry reconciles
 *   (`balanceAfter === balanceBefore + appliedDelta`, walking each
 *   franchise's entries in order), the stored balances equal the ledger
 *   recomputation, applied deltas equal requested deltas except for
 *   cap-applied grants (0 applied above the +8 cap), and every rehab state
 *   references a recorded injury.
 * - M2.5 transaction chain: `appliedAtStateRevision` is monotonic
 *   non-decreasing and never beyond the stored stateRevision.
 * - M2.5 state chain: accepted-block `stateRevision` is strictly increasing
 *   (at least +1 per commit) and never beyond the stored stateRevision, the
 *   stored `stateDigest` recomputes exactly through
 *   `seam.seasonRunStateDigest`, and `checkpointState` matches the last
 *   accepted block exactly (null when no block was accepted).
 * - M2.5 effects-with-trade divergence rule (LEAD DECISION, documented):
 *   `run.effects` may differ from the checkpoint's effects only for blocks
 *   where a trade window opened. Accepted blocks do not persist their
 *   effects, so the checkable form is the state chain: when no window ever
 *   opened (`trade === null`) and no command applied after the last commit
 *   (`stored.stateRevision === lastBlock.stateRevision`), the stored facts
 *   (including effects) must be byte-identical to the facts the last
 *   checkpoint digested — i.e. the last accepted block's `stateDigest`
 *   recomputes over the stored facts. A window open is the only legal
 *   divergence point.
 * - M2.5 trade state: at most three windows, in windowIndex order, opened
 *   by the accepted blocks 2/4/5 (matching windowIndex 0/1/2) and never by
 *   an unaccepted block, offer ids unique per window with matching
 *   windowIndex, and closed windows carry no open offers (expiry at close).
 * - M2.5 pending-block consistency: a pending candidate for an already
 *   committed blockIndex is an error (the commit deletes the pending row in
 *   the same transaction, so a leftover row means a bug).
 */
export interface SeasonRunAuditFacts {
  league: SeasonLeague;
  rosters: readonly SeasonRoster[];
  schedule: SeasonSchedule;
  humanFranchiseId: string;
  /** Validated current (v4) stored checkpoint row; row-level facts are authoritative. */
  stored: StoredSeasonRunRecord;
  summaries: readonly SeasonGameSummary[];
  retainedDetails: readonly SeasonRetainedGameDetail[];
  acceptedBlocks: readonly SeasonAcceptedBlock[];
  /** M2.5: the run's pending candidate row, or null when none is stored. */
  pending: SeasonPendingBlockCandidate | null;
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
  let previousStateRevision = -1;
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
    // M2.5: the run state chain — every committed block bumps the state
    // revision by at least one, so the chain is strictly increasing.
    if (block.stateRevision <= previousStateRevision) {
      failures.push(
        `accepted block ${String(block.blockIndex)} stateRevision ${String(block.stateRevision)} does not advance the state chain (previous ${String(previousStateRevision)})`,
      );
    }
    previousStateRevision = block.stateRevision;
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
    if (stored.checkpointState !== null) {
      failures.push('checkpoint carries checkpointState with no accepted block');
    }
  } else {
    // Commands can advance the state chain before the first block commits,
    // so stateRevision may be > 0 here; checkpointState stays null (checked
    // above) and the stored digest recomputes over the mutable facts below.
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

  // M2.5 health state: recorded injuries are run-scoped facts.
  const { health } = stored;
  const healthRosterIds = seam.seasonRosterPlayerVersionIds(facts.rosters);
  const healthRosterIdSet = new Set(healthRosterIds);
  const leagueFranchiseIds = new Set(facts.league.teams.map((team) => team.franchiseId));
  const healthInjuryIds = new Set<string>();
  for (const injury of health.injuries) {
    if (healthInjuryIds.has(injury.injuryId)) {
      failures.push(`duplicate injury record ${injury.injuryId}`);
    }
    healthInjuryIds.add(injury.injuryId);
    if (!healthRosterIdSet.has(injury.playerVersionId)) {
      failures.push(
        `injury ${injury.injuryId} references player ${injury.playerVersionId} outside the 30 rosters`,
      );
    }
    if (!leagueFranchiseIds.has(injury.franchiseId)) {
      failures.push(
        `injury ${injury.injuryId} references franchise ${injury.franchiseId} outside the league`,
      );
    }
    if (scheduleById.get(injury.gameId) === undefined) {
      failures.push(`injury ${injury.injuryId} occurrence game ${injury.gameId} is not scheduled`);
    }
    if (
      injury.seasonEnding &&
      injury.missedGamesRemaining !== SEASON_ENDING_MISSED_GAMES_SENTINEL
    ) {
      failures.push(
        `season-ending injury ${injury.injuryId} must carry the missed-games sentinel ${String(SEASON_ENDING_MISSED_GAMES_SENTINEL)}`,
      );
    }
    if (!injury.sameGameReturn && injury.sameGameReturned !== null) {
      failures.push(
        `injury ${injury.injuryId} resolved a same-game return without the eligibility roll`,
      );
    }
    if (injury.recurrenceWindowRoundsRemaining > 0 && injury.actualReturnRound === null) {
      failures.push(
        `injury ${injury.injuryId} carries a recurrence window without an actual return`,
      );
    }
  }

  // M2.5 Influence reconciliation: balances recompute from the append-only
  // ledger, entry by entry (balanceAfter === balanceBefore + appliedDelta).
  const { influence } = stored;
  const balancesFromLedger = new Map<string, number>();
  for (const entry of influence.ledger) {
    const before = balancesFromLedger.get(entry.franchiseId) ?? 0;
    if (entry.balanceAfter !== before + entry.appliedDelta) {
      failures.push(
        `influence ledger entry ${entry.entryId} does not reconcile ` +
          `(balanceBefore ${String(before)} + appliedDelta ${String(entry.appliedDelta)} != balanceAfter ${String(entry.balanceAfter)})`,
      );
    }
    if (entry.appliedDelta !== entry.requestedDelta) {
      // The only legal divergence is a cap-applied grant: requested above
      // the +8 cap applies 0. Spends are never clamped (floor is validated).
      if (
        entry.appliedDelta !== 0 ||
        entry.requestedDelta <= 0 ||
        before + entry.requestedDelta <= SEASON_INFLUENCE_CAP
      ) {
        failures.push(
          `influence ledger entry ${entry.entryId} appliedDelta ${String(entry.appliedDelta)} does not match requestedDelta ${String(entry.requestedDelta)}`,
        );
      }
    }
    balancesFromLedger.set(entry.franchiseId, entry.balanceAfter);
  }
  for (const franchiseId of leagueFranchiseIds) {
    const storedBalance = influence.balances[franchiseId];
    const ledgerBalance = balancesFromLedger.get(franchiseId) ?? 0;
    if (storedBalance === undefined) {
      failures.push(`influence balances miss franchise ${franchiseId}`);
    } else if (storedBalance !== ledgerBalance) {
      failures.push(
        `influence balance for ${franchiseId} is ${String(storedBalance)}, ledger recomputes ${String(ledgerBalance)}`,
      );
    }
  }
  for (const rehabInjuryId of Object.keys(influence.rehabs)) {
    if (!healthInjuryIds.has(rehabInjuryId)) {
      failures.push(`influence rehab state references unknown injury ${rehabInjuryId}`);
    }
  }
  for (const [franchiseId, windowStates] of Object.entries(influence.windows)) {
    if (!leagueFranchiseIds.has(franchiseId)) {
      failures.push(`influence windows reference unknown franchise ${franchiseId}`);
    }
    const seen = new Set<number>();
    for (const windowState of windowStates) {
      if (seen.has(windowState.windowIndex)) {
        failures.push(
          `influence window spend ${franchiseId}/${String(windowState.windowIndex)} recorded twice`,
        );
      }
      seen.add(windowState.windowIndex);
      if (windowState.windowIndex < 0 || windowState.windowIndex > 2) {
        failures.push(
          `influence window spend ${franchiseId} carries out-of-range windowIndex ${String(windowState.windowIndex)}`,
        );
      }
    }
  }

  // M2.5 transaction chain: append-only entries with monotonic revisions.
  const { transactions } = stored;
  let previousAppliedAt = -1;
  const transactionIds = new Set<string>();
  for (const entry of transactions) {
    if (transactionIds.has(entry.transactionId)) {
      failures.push(`duplicate transaction entry ${entry.transactionId}`);
    }
    transactionIds.add(entry.transactionId);
    if (entry.appliedAtStateRevision < previousAppliedAt) {
      failures.push(
        `transaction ${entry.transactionId} appliedAtStateRevision ${String(entry.appliedAtStateRevision)} regresses along the log`,
      );
    }
    previousAppliedAt = entry.appliedAtStateRevision;
    if (entry.appliedAtStateRevision > stored.stateRevision) {
      failures.push(
        `transaction ${entry.transactionId} appliedAtStateRevision ${String(entry.appliedAtStateRevision)} exceeds the stored stateRevision ${String(stored.stateRevision)}`,
      );
    }
  }

  // M2.5 state chain: revision monotonicity, checkpointState consistency,
  // and the canonical state digest recomputation. The digest facts are
  // byte-identical for both checks below, so the digest is computed once
  // and reused; a failure is reported per check exactly as before.
  let recomputedDigest: string | null = null;
  let digestFailure: string | null = null;
  try {
    recomputedDigest = seam.seasonRunStateDigest({
      stateRevision: stored.stateRevision,
      checkpointState: stored.checkpointState,
      health: stored.health,
      influence: stored.influence,
      transactions: stored.transactions,
      trade: stored.trade,
      objectives: stored.objectives,
      rosters: stored.run.rosters,
      ownership: stored.run.ownership,
      rotations: stored.run.rotations,
      effects: stored.effects,
    });
  } catch (error) {
    digestFailure = `state digest recomputation failed: ${errorMessage(error)}`;
  }
  if (last !== undefined) {
    if (stored.stateRevision < last.stateRevision) {
      failures.push(
        `stored stateRevision ${String(stored.stateRevision)} regresses behind the last accepted block ${String(last.stateRevision)}`,
      );
    }
    const expectedCheckpointState = {
      runId: stored.run.runId,
      blockIndex: last.blockIndex,
      completedRounds: last.completedRounds,
      revision: last.revision,
      commandId: last.commandId,
      rotationDigest: last.rotationDigest,
      checkpointDigest: last.checkpointDigest,
    };
    if (!deepEqual(stored.checkpointState, expectedCheckpointState)) {
      failures.push('checkpointState does not match the last accepted block');
    }
    // Effects-with-trade divergence rule (documented): when no trade window
    // ever opened and no command applied after the last commit, the stored
    // facts (effects included) must be byte-identical to what the last
    // accepted block digested.
    if (stored.trade === null && stored.stateRevision === last.stateRevision) {
      if (digestFailure !== null) {
        failures.push(digestFailure);
      } else if (recomputedDigest !== last.stateDigest) {
        failures.push(
          'run.effects diverged from the last checkpoint effects without a trade window ' +
            '(last block stateDigest does not recompute over the stored facts)',
        );
      }
    }
  }
  if (digestFailure !== null) {
    failures.push(digestFailure);
  } else if (recomputedDigest !== stored.stateDigest) {
    failures.push('stored stateDigest does not recompute over the stored mutable state');
  }

  // M2.5 trade state validity.
  const { trade } = stored;
  // Inverse of the engine's `WINDOW_BLOCK_INDEX_TO_INDEX` (block → window):
  // window index → expected block. Derived from the seam's canonical map so
  // this rule stays in the engine and can never diverge.
  const windowBlockIndexByIndex: Record<number, number> = {};
  for (const [blockIndex, windowIndex] of Object.entries(seam.windowBlockIndexToIndex)) {
    windowBlockIndexByIndex[windowIndex] = Number(blockIndex);
  }
  if (trade !== null) {
    if (trade.windows.length === 0) {
      failures.push('trade state holds no windows');
    }
    if (trade.windows.length > 3) {
      failures.push(`trade state holds ${String(trade.windows.length)} windows, max 3`);
    }
    const lastAcceptedBlockIndex = last?.blockIndex ?? -1;
    trade.windows.forEach((window, index) => {
      const expectedWindowIndex = index;
      const expectedBlockIndex = windowBlockIndexByIndex[expectedWindowIndex];
      if (window.windowIndex !== expectedWindowIndex) {
        failures.push(
          `trade window at position ${String(index)} carries windowIndex ${String(window.windowIndex)}, expected ${String(expectedWindowIndex)}`,
        );
      }
      if (window.blockIndex !== expectedBlockIndex) {
        failures.push(
          `trade window ${String(window.windowIndex)} opened by block ${String(window.blockIndex)}, expected block ${String(expectedBlockIndex)}`,
        );
      }
      if (window.blockIndex > lastAcceptedBlockIndex) {
        failures.push(
          `trade window ${String(window.windowIndex)} opened by block ${String(window.blockIndex)} that is not accepted`,
        );
      }
      const offerIds = new Set<string>();
      for (const offer of window.offers) {
        if (offerIds.has(offer.offerId)) {
          failures.push(
            `duplicate trade offer ${offer.offerId} in window ${String(window.windowIndex)}`,
          );
        }
        offerIds.add(offer.offerId);
        if (offer.windowIndex !== window.windowIndex) {
          failures.push(
            `trade offer ${offer.offerId} windowIndex ${String(offer.windowIndex)} does not match its window`,
          );
        }
      }
      if (window.status === 'closed' && window.offers.some((offer) => offer.status === 'open')) {
        failures.push(
          `closed trade window ${String(window.windowIndex)} still carries open offers`,
        );
      }
    });
  }

  // M2.5 pending-block consistency: a pending row for a committed block is a
  // bug (the commit deletes it in the same transaction).
  const pending = facts.pending;
  if (pending !== null) {
    if (pending.runId !== stored.run.runId) {
      failures.push(`pending block runId ${pending.runId} does not match the checkpoint`);
    }
    if (pending.blockIndex < acceptedBlocks.length) {
      failures.push(`pending block ${String(pending.blockIndex)} was already committed`);
    }
  }

  return failures;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
