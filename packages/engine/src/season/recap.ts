import {
  SEASON_HEALTH_VERSION,
  SEASON_RECAP_VERSION,
  seasonDigestHex,
  type SeasonBlockInjuryEvidence,
  type SeasonBlockRecap,
  type SeasonCompactInjuryEvent,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonInfluenceState,
  type SeasonNotablePerformance,
  type SeasonObjectiveEvaluation,
  type SeasonObjectiveId,
  type SeasonPlayerAggregate,
  type SeasonRecordMovement,
  type SeasonSchedule,
  type SeasonStandings,
  type SeasonStreak,
  type SeasonTransactionEntry,
  type SeasonUpcomingHumanGame,
  type SeasonVersionSpotlight,
  type SeasonFreeAgencyBand,
  type SeasonFreeAgencyState,
} from '@hoop-rush/data-contracts';
import { blockRoundRange } from '@hoop-rush/data-contracts';
import { provisionalStandingOrder } from './aggregates.ts';
import { canonicalJson } from './checkpoint.ts';

/**
 * Block recap construction (spec/2.0/02 recap, spec/2.0/11 block recap,
 * M2.3, season-recap-v1; M2.5 season-recap-v3). Every claim derives from
 * saved league facts: game summaries, standings, aggregates, and the
 * schedule. M2.5 adds the block-level injury evidence (counted from the
 * block's compact injury events and the post-block health state), the
 * evaluated objective evidence, the trade evidence (block-level accepted
 * trades and the human Influence delta), and the human Influence balance.
 *
 * The `summaries` input is the full ordered summary list through
 * completedRounds (block summaries are the last chunk); streaks need prior
 * results, and the digest must not depend on how the runner chunks them.
 *
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

export interface SeasonBlockRecapInput {
  runId: string;
  /** 0-based block index of this recap. */
  blockIndex: number;
  /** Rounds completed when this recap is built. */
  completedRounds: number;
  /** The human franchise (retained details); null in a pure AI/CLI context. */
  humanFranchiseId: string | null;
  /** All summaries through completedRounds, in stable schedule order. */
  summaries: readonly SeasonGameSummary[];
  standingsBefore: SeasonStandings;
  standingsAfter: SeasonStandings;
  /** Player aggregates through completedRounds (block-visible). */
  playerAggregates: readonly SeasonPlayerAggregate[];
  schedule: SeasonSchedule;
  /** playerVersionId -> person playerId (derived from run rosters/catalog). */
  rosterPlayerIds: ReadonlyMap<string, string>;
  /** Reserved for later milestones; M2.3 recaps do not consume rotations. */
  rotations?: unknown;
  /**
   * M2.5: the post-block health state (injury evidence). Absent in fixture-
   * driven recaps: the health-derived counts report zero.
   */
  health?: SeasonHealthState;
  /**
   * M2.5: the locked objective evaluated at block assembly (null for the
   * final two-game block and for fixture-driven recaps without an objective).
   */
  objective?: {
    objectiveId: SeasonObjectiveId | null;
    success: boolean | null;
    evaluation: SeasonObjectiveEvaluation;
  } | null;
  /** M2.5: the post-block transaction entries (trade evidence). */
  transactions?: readonly SeasonTransactionEntry[];
  /** M2.5: the post-block Influence state (delta + human balance). */
  influence?: SeasonInfluenceState;
  /**
   * M2.6.5: the post-block free-agency state (free-agency evidence). Absent
   * in fixture-driven recaps: the evidence reports zero signings.
   */
  freeAgency?: SeasonFreeAgencyState;
}

/** Team games in a block (150 in blocks 0-7, 30 in the final block). */
export function seasonBlockGameCount(blockIndex: number): number {
  return blockIndex >= 8 ? 30 : 150;
}

function blockSummariesOf(
  summaries: readonly SeasonGameSummary[],
  blockIndex: number,
): SeasonGameSummary[] {
  const count = seasonBlockGameCount(blockIndex);
  return summaries.slice(Math.max(0, summaries.length - count), summaries.length);
}

/** Winner franchise of a summary (scores are never tied on finals). */
function winnerOf(summary: SeasonGameSummary): string {
  if (summary.status === 'forfeit') {
    const loser = summary.forfeitLoserFranchiseId;
    if (loser === null) {
      throw new Error(`forfeit summary ${summary.gameId} does not name the losing team`);
    }
    return loser === summary.homeFranchiseId ? summary.awayFranchiseId : summary.homeFranchiseId;
  }
  return summary.homeScore > summary.awayScore ? summary.homeFranchiseId : summary.awayFranchiseId;
}

function positionOf(standings: SeasonStandings, franchiseId: string): number {
  const order = provisionalStandingOrder(standings);
  return order.indexOf(franchiseId) + 1;
}

function movementOf(
  standingsBefore: SeasonStandings,
  standingsAfter: SeasonStandings,
  franchiseId: string,
): SeasonRecordMovement {
  const before = standingsBefore.rows.find((row) => row.franchiseId === franchiseId);
  const after = standingsAfter.rows.find((row) => row.franchiseId === franchiseId);
  if (before === undefined || after === undefined) {
    throw new Error(`recap: no standings row for ${franchiseId}`);
  }
  return {
    franchiseId,
    winsBefore: before.wins,
    lossesBefore: before.losses,
    winsAfter: after.wins,
    lossesAfter: after.losses,
    positionBefore: positionOf(standingsBefore, franchiseId),
    positionAfter: positionOf(standingsAfter, franchiseId),
  };
}

function notableLines(
  blockSummaries: readonly SeasonGameSummary[],
  humanFranchiseId: string | null,
): SeasonNotablePerformance[] {
  const lines: SeasonNotablePerformance[] = [];
  for (const summary of blockSummaries) {
    if (summary.status === 'forfeit') continue;
    for (const side of ['home', 'away'] as const) {
      const franchiseId = summary[`${side}FranchiseId`];
      for (const line of side === 'home' ? summary.homePlayers : summary.awayPlayers) {
        lines.push({
          playerVersionId: line.playerVersionId,
          franchiseId,
          gameId: summary.gameId,
          points: line.points,
          rebounds: line.offensiveRebounds + line.defensiveRebounds,
          assists: line.assists,
          humanTeam: humanFranchiseId === franchiseId,
        });
      }
    }
  }
  return lines.sort(
    (a, b) =>
      (b.humanTeam ? 1 : 0) - (a.humanTeam ? 1 : 0) ||
      b.points - a.points ||
      b.rebounds - a.rebounds ||
      b.assists - a.assists ||
      (a.playerVersionId < b.playerVersionId ? -1 : 1),
  );
}

/** Canonical chronological order for streak derivation: (round, gameId). */
function chronologicallyOrdered(summaries: readonly SeasonGameSummary[]): SeasonGameSummary[] {
  return [...summaries].sort(
    (a, b) => a.round - b.round || (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0),
  );
}

/** Current win/loss streaks (length >= 2) from ordered game results. */
function streaksOf(summaries: readonly SeasonGameSummary[]): SeasonStreak[] {
  const results = chronologicallyOrdered(summaries);
  const current = new Map<string, { kind: 'wins' | 'losses'; length: number }>();
  for (const summary of results) {
    const winner = winnerOf(summary);
    for (const franchiseId of [summary.homeFranchiseId, summary.awayFranchiseId]) {
      const won = franchiseId === winner;
      const previous = current.get(franchiseId);
      const kind: 'wins' | 'losses' = won ? 'wins' : 'losses';
      if (previous === undefined || previous.kind !== kind) {
        current.set(franchiseId, { kind, length: 1 });
      } else {
        previous.length += 1;
      }
    }
  }
  return [...current.entries()]
    .filter(([, streak]) => streak.length >= 2)
    .map(([franchiseId, streak]) => ({ franchiseId, kind: streak.kind, length: streak.length }))
    .sort(
      (a, b) =>
        b.length - a.length ||
        (a.franchiseId < b.franchiseId ? -1 : a.franchiseId > b.franchiseId ? 1 : 0) ||
        (a.kind === b.kind ? 0 : a.kind === 'wins' ? -1 : 1),
    )
    .slice(0, 10);
}

function headToHead(
  blockSummaries: readonly SeasonGameSummary[],
  franchiseA: string,
  franchiseB: string,
): { games: number; winsA: number; winsB: number } {
  let games = 0;
  let winsA = 0;
  let winsB = 0;
  for (const summary of blockSummaries) {
    const home = summary.homeFranchiseId;
    const away = summary.awayFranchiseId;
    if (home === franchiseA && away === franchiseB) {
      games += 1;
      if (winnerOf(summary) === franchiseA) winsA += 1;
      else winsB += 1;
    } else if (home === franchiseB && away === franchiseA) {
      games += 1;
      if (winnerOf(summary) === franchiseB) winsB += 1;
      else winsA += 1;
    }
  }
  return { games, winsA, winsB };
}

/**
 * Version-versus-version spotlights: pairs of distinct playerVersionIds of
 * the same person, both with >= 1 game in the block, ranked by head-to-head
 * meetings first, then combined points, then canonical version order.
 */
function versionSpotlightsOf(input: SeasonBlockRecapInput): SeasonVersionSpotlight[] {
  const blockSummaries = blockSummariesOf(input.summaries, input.blockIndex);
  const playedInBlock = new Set<string>();
  for (const summary of blockSummaries) {
    for (const side of ['home', 'away'] as const) {
      for (const line of side === 'home' ? summary.homePlayers : summary.awayPlayers) {
        playedInBlock.add(line.playerVersionId);
      }
    }
  }
  const versionsOfPerson = new Map<string, string[]>();
  for (const [playerVersionId, playerId] of input.rosterPlayerIds) {
    if (!playedInBlock.has(playerVersionId)) continue;
    const versions = versionsOfPerson.get(playerId) ?? [];
    versions.push(playerVersionId);
    versionsOfPerson.set(playerId, versions);
  }
  const aggregateOf = new Map(
    input.playerAggregates.map((player) => [player.playerVersionId, player]),
  );
  const franchiseOf = (playerVersionId: string): string | null =>
    aggregateOf.get(playerVersionId)?.franchiseId ?? null;

  const pairs: SeasonVersionSpotlight[] = [];
  for (const versions of versionsOfPerson.values()) {
    const sorted = [...versions].sort();
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const versionA = sorted[i];
        const versionB = sorted[j];
        if (versionA === undefined || versionB === undefined) continue;
        const franchiseA = franchiseOf(versionA);
        const franchiseB = franchiseOf(versionB);
        if (franchiseA === null || franchiseB === null) continue;
        const aggregateA = aggregateOf.get(versionA);
        const aggregateB = aggregateOf.get(versionB);
        if (aggregateA === undefined || aggregateB === undefined) continue;
        const meeting = headToHead(blockSummaries, franchiseA, franchiseB);
        pairs.push({
          versionA,
          versionB,
          sameTeam: franchiseA === franchiseB,
          gamesPlayedA: aggregateA.gamesPlayed,
          gamesPlayedB: aggregateB.gamesPlayed,
          pointsA: aggregateA.points,
          pointsB: aggregateB.points,
          reboundsA: aggregateA.offensiveRebounds + aggregateA.defensiveRebounds,
          reboundsB: aggregateB.offensiveRebounds + aggregateB.defensiveRebounds,
          assistsA: aggregateA.assists,
          assistsB: aggregateB.assists,
          headToHeadGames: meeting.games,
          headToHeadWinsA: meeting.winsA,
          headToHeadWinsB: meeting.winsB,
        });
      }
    }
  }
  return pairs
    .sort(
      (a, b) =>
        b.headToHeadGames - a.headToHeadGames ||
        b.pointsA + b.pointsB - (a.pointsA + a.pointsB) ||
        (a.versionA < b.versionA ? -1 : a.versionA > b.versionA ? 1 : 0) ||
        (a.versionB < b.versionB ? -1 : 1),
    )
    .slice(0, 5);
}

/** The human team's games in the next block (empty at season end). */
function upcomingHumanGamesOf(input: SeasonBlockRecapInput): SeasonUpcomingHumanGame[] {
  if (input.humanFranchiseId === null || input.blockIndex >= 8) return [];
  const { fromRound, toRound } = blockRoundRange(input.blockIndex + 1);
  return input.schedule.games
    .filter(
      (game) =>
        game.round >= fromRound &&
        game.round <= toRound &&
        (game.homeFranchiseId === input.humanFranchiseId ||
          game.awayFranchiseId === input.humanFranchiseId),
    )
    .map((game) => ({
      gameId: game.gameId,
      round: game.round,
      homeFranchiseId: game.homeFranchiseId,
      awayFranchiseId: game.awayFranchiseId,
      humanIsHome: game.homeFranchiseId === input.humanFranchiseId,
      opponentFranchiseId:
        game.homeFranchiseId === input.humanFranchiseId
          ? game.awayFranchiseId
          : game.homeFranchiseId,
    }))
    .sort((a, b) => a.round - b.round || (a.gameId < b.gameId ? -1 : 1))
    .slice(0, 10);
}

/**
 * M2.5 block-level injury evidence, counted from the block's compact injury
 * events and the post-block health state: `injuries` is the total compact
 * event count of the block's summaries (one event per rolled record),
 * `bySeverity` the severity split, `sameGameReturns` the events whose
 * same-game return actually applied, `seasonEnding` the season-ending
 * events, `returnedThisBlock` the health records whose actual return round
 * falls inside the block, `activeAtBlockEnd` the health records still
 * active at the block end (occurrence at or before the block's last round),
 * and `humanTeamInjuries` the compact events of the human franchise's
 * games (bounded).
 */
export function blockInjuryEvidenceOf(input: {
  blockSummaries: readonly SeasonGameSummary[];
  health: SeasonHealthState;
  blockIndex: number;
  humanFranchiseId: string | null;
}): SeasonBlockInjuryEvidence {
  const { blockSummaries, health, blockIndex, humanFranchiseId } = input;
  const { fromRound, toRound } = blockRoundRange(blockIndex);
  const roundOfGame = new Map(blockSummaries.map((summary) => [summary.gameId, summary.round]));
  const bySeverity: SeasonBlockInjuryEvidence['bySeverity'] = {
    minor: 0,
    moderate: 0,
    major: 0,
    'season-ending': 0,
  };
  let sameGameReturns = 0;
  let seasonEnding = 0;
  const humanTeamInjuries: SeasonCompactInjuryEvent[] = [];
  for (const summary of blockSummaries) {
    const humanSide =
      humanFranchiseId === null
        ? null
        : summary.homeFranchiseId === humanFranchiseId
          ? 'home'
          : summary.awayFranchiseId === humanFranchiseId
            ? 'away'
            : null;
    for (const event of summary.injuryEvents) {
      bySeverity[event.severity] += 1;
      if (event.returned) sameGameReturns += 1;
      if (event.severity === 'season-ending') seasonEnding += 1;
      if (humanSide !== null && event.side === humanSide && humanTeamInjuries.length < 40) {
        humanTeamInjuries.push(event);
      }
    }
  }
  const returnedThisBlock = health.injuries.filter(
    (record) =>
      record.actualReturnRound !== null &&
      record.actualReturnRound >= fromRound &&
      record.actualReturnRound <= toRound,
  ).length;
  const activeAtBlockEnd = health.injuries.filter((record) => {
    if (record.missedGamesRemaining <= 0) return false;
    const occurrenceRound = roundOfGame.get(record.gameId) ?? 0;
    return occurrenceRound <= toRound;
  }).length;
  return {
    injuries: blockSummaries.reduce((sum, summary) => sum + summary.injuryEvents.length, 0),
    bySeverity,
    sameGameReturns,
    seasonEnding,
    returnedThisBlock,
    activeAtBlockEnd,
    humanTeamInjuries,
  };
}

/**
 * M2.6.5 block-level free-agency evidence (season-recap-v4): the window
 * resolved this block (if any), its signings, the human franchise's
 * Influence delta from free agency this block, and the human franchise's
 * season signing/spend counts. A block itself signs nothing (windows open
 * after the commit), so fixture-driven blocks report zero.
 */
export function blockFreeAgencyEvidenceOf(input: {
  blockIndex: number;
  humanFranchiseId: string | null;
  freeAgency: SeasonFreeAgencyState | undefined;
}): {
  windowIndex: number | null;
  signings: Array<{
    franchiseId: string;
    playerVersionId: string;
    band: SeasonFreeAgencyBand;
    influenceCost: number;
  }>;
  influenceDelta: number;
  seasonSignings: number;
  seasonSpend: number;
} {
  const freeAgency = input.freeAgency;
  if (freeAgency === undefined) {
    return {
      windowIndex: null,
      signings: [],
      influenceDelta: 0,
      seasonSignings: 0,
      seasonSpend: 0,
    };
  }
  const resolvedWindow = freeAgency.windows.find(
    (window) => window.blockIndex === input.blockIndex && window.status === 'resolved',
  );
  let humanDelta = 0;
  if (input.humanFranchiseId !== null) {
    humanDelta = freeAgency.seasonSpend[input.humanFranchiseId] ?? 0;
  }
  return {
    windowIndex: resolvedWindow?.windowIndex ?? null,
    signings: (resolvedWindow?.signings ?? []).map((signing) => ({
      franchiseId: signing.franchiseId,
      playerVersionId: signing.playerVersionId,
      band: signing.band,
      influenceCost: signing.influenceCost,
    })),
    influenceDelta: -humanDelta,
    seasonSignings:
      input.humanFranchiseId === null ? 0 : (freeAgency.signingCounts[input.humanFranchiseId] ?? 0),
    seasonSpend: humanDelta,
  };
}

/**
 * M2.5 block-level trade evidence: accepted trades with this blockIndex
 * recorded in the post-block transactions, and the human franchise's
 * Influence ledger delta for this block. A block itself accepts no trades
 * (windows open after the commit), so fixture-driven blocks report zero.
 */
export function blockTradeEvidenceOf(input: {
  blockIndex: number;
  humanFranchiseId: string | null;
  transactions: readonly SeasonTransactionEntry[] | undefined;
  influence: SeasonInfluenceState | undefined;
}): { tradesAccepted: number; influenceDelta: number } {
  const tradesAccepted =
    input.transactions?.filter(
      (entry) => entry.type === 'trade' && entry.blockIndex === input.blockIndex,
    ).length ?? 0;
  let influenceDelta = 0;
  if (input.humanFranchiseId !== null && input.influence !== undefined) {
    influenceDelta = input.influence.ledger
      .filter(
        (entry) =>
          entry.franchiseId === input.humanFranchiseId && entry.blockIndex === input.blockIndex,
      )
      .reduce((sum, entry) => sum + entry.appliedDelta, 0);
  }
  return { tradesAccepted, influenceDelta };
}

/**
 * The human Influence balance at a block's end, reconstructed from the
 * append-only ledger: the current balance minus every later ledger entry
 * (LEAD DECISION: the recap shows the human balance only; the ledger is the
 * authoritative source).
 */
export function humanInfluenceBalanceAtBlockEnd(
  influence: SeasonInfluenceState,
  humanFranchiseId: string | null,
  blockIndex: number,
): number {
  if (humanFranchiseId === null) return 0;
  const current = influence.balances[humanFranchiseId] ?? 0;
  const laterDelta = influence.ledger
    .filter(
      (entry) =>
        entry.franchiseId === humanFranchiseId &&
        entry.blockIndex !== null &&
        entry.blockIndex > blockIndex,
    )
    .reduce((sum, entry) => sum + entry.appliedDelta, 0);
  return current - laterDelta;
}

/**
 * Builds the block recap from saved league facts only. Every array is
 * canonically sorted so serialization (and therefore the checkpoint digest)
 * never depends on internal build order.
 */
export function buildSeasonBlockRecap(input: SeasonBlockRecapInput): SeasonBlockRecap {
  const humanRecord =
    input.humanFranchiseId === null
      ? null
      : movementOf(input.standingsBefore, input.standingsAfter, input.humanFranchiseId);
  const standingsMovement = input.standingsAfter.rows
    .map((row) => movementOf(input.standingsBefore, input.standingsAfter, row.franchiseId))
    .sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1));
  const notablePerformances = notableLines(
    blockSummariesOf(input.summaries, input.blockIndex),
    input.humanFranchiseId,
  ).slice(0, 10);
  const streaks = streaksOf(input.summaries);
  const versionSpotlights = versionSpotlightsOf(input);
  const upcomingHumanGames = upcomingHumanGamesOf(input);
  const blockSummaries = blockSummariesOf(input.summaries, input.blockIndex);
  const objective = input.objective ?? null;
  const tradeEvidence = blockTradeEvidenceOf({
    blockIndex: input.blockIndex,
    humanFranchiseId: input.humanFranchiseId,
    transactions: input.transactions,
    influence: input.influence,
  });
  const freeAgencyEvidence = blockFreeAgencyEvidenceOf({
    blockIndex: input.blockIndex,
    humanFranchiseId: input.humanFranchiseId,
    freeAgency: input.freeAgency,
  });
  return {
    schemaVersion: 1,
    recapVersion: SEASON_RECAP_VERSION,
    runId: input.runId,
    blockIndex: input.blockIndex,
    completedRounds: input.completedRounds,
    humanRecord,
    standingsMovement,
    notablePerformances,
    streaks,
    versionSpotlights,
    upcomingHumanGames,
    injuryEvidence: blockInjuryEvidenceOf({
      blockSummaries,
      health: input.health ?? {
        schemaVersion: 1,
        healthVersion: SEASON_HEALTH_VERSION,
        injuries: [],
      },
      blockIndex: input.blockIndex,
      humanFranchiseId: input.humanFranchiseId,
    }),
    objectiveEvidence:
      objective !== null && objective.objectiveId !== null
        ? {
            objectiveId: objective.objectiveId,
            success: objective.success === true,
            evaluationFacts: objective.evaluation.facts,
          }
        : null,
    tradeEvidence,
    freeAgencyEvidence,
    influenceBalance: {
      humanBalance:
        input.influence === undefined
          ? 0
          : humanInfluenceBalanceAtBlockEnd(
              input.influence,
              input.humanFranchiseId,
              input.blockIndex,
            ),
    },
  };
}

/** Canonical per-array sort for recap serialization (digest-stable). */
export function seasonBlockRecapCanonical(recap: SeasonBlockRecap): string {
  return canonicalJson({
    schemaVersion: recap.schemaVersion,
    recapVersion: recap.recapVersion,
    runId: recap.runId,
    blockIndex: recap.blockIndex,
    completedRounds: recap.completedRounds,
    humanRecord: recap.humanRecord,
    standingsMovement: [...recap.standingsMovement].sort((a, b) =>
      a.franchiseId < b.franchiseId ? -1 : 1,
    ),
    notablePerformances: [...recap.notablePerformances].sort(
      (a, b) =>
        (a.playerVersionId < b.playerVersionId
          ? -1
          : a.playerVersionId > b.playerVersionId
            ? 1
            : 0) || (a.gameId < b.gameId ? -1 : 1),
    ),
    streaks: [...recap.streaks].sort(
      (a, b) =>
        (a.franchiseId < b.franchiseId ? -1 : a.franchiseId > b.franchiseId ? 1 : 0) ||
        (a.kind === b.kind ? 0 : a.kind === 'wins' ? -1 : 1),
    ),
    versionSpotlights: [...recap.versionSpotlights].sort(
      (a, b) =>
        (a.versionA < b.versionA ? -1 : a.versionA > b.versionA ? 1 : 0) ||
        (a.versionB < b.versionB ? -1 : 1),
    ),
    upcomingHumanGames: [...recap.upcomingHumanGames].sort((a, b) =>
      a.gameId < b.gameId ? -1 : 1,
    ),
    freeAgencyEvidence: {
      ...recap.freeAgencyEvidence,
      signings: [...recap.freeAgencyEvidence.signings].sort(
        (a, b) =>
          (a.franchiseId < b.franchiseId ? -1 : a.franchiseId > b.franchiseId ? 1 : 0) ||
          (a.playerVersionId < b.playerVersionId ? -1 : 1),
      ),
    },
  });
}

/** Canonical digest of a recap (used by checkpoint digests and audits). */
export function seasonBlockRecapDigest(recap: SeasonBlockRecap): string {
  return seasonDigestHex(seasonBlockRecapCanonical(recap));
}

/**
 * Audits a recap against the saved facts it must derive from: standings
 * movement and provisional positions, notable lines (every performance must
 * exist in a block summary with matching statistics), streaks from ordered
 * results, version spotlights (same person, distinct versions, both played
 * in the block, aggregates and head-to-head facts exact), and upcoming human
 * games from the schedule. Returns failure strings; empty means valid.
 */
export function auditSeasonBlockRecap(
  recap: SeasonBlockRecap,
  input: SeasonBlockRecapInput,
): string[] {
  const failures: string[] = [];
  if (recap.runId !== input.runId) failures.push('recap runId does not match the input');
  if (recap.blockIndex !== input.blockIndex) failures.push('recap blockIndex does not match');
  if (recap.completedRounds !== input.completedRounds) {
    failures.push('recap completedRounds does not match');
  }

  for (const movement of [
    ...recap.standingsMovement,
    ...(recap.humanRecord ? [recap.humanRecord] : []),
  ]) {
    const expected = movementOf(input.standingsBefore, input.standingsAfter, movement.franchiseId);
    if (JSON.stringify(movement) !== JSON.stringify(expected)) {
      failures.push(`recap movement for ${movement.franchiseId} does not match the standings`);
    }
  }

  // Notable performances exist in the block summaries with matching lines.
  const blockSummaries = blockSummariesOf(input.summaries, input.blockIndex);
  const lineByKey = new Map<string, SeasonNotablePerformance>();
  for (const summary of blockSummaries) {
    if (summary.status === 'forfeit') continue;
    for (const side of ['home', 'away'] as const) {
      const franchiseId = summary[`${side}FranchiseId`];
      for (const line of side === 'home' ? summary.homePlayers : summary.awayPlayers) {
        lineByKey.set(`${summary.gameId}\u0000${line.playerVersionId}`, {
          playerVersionId: line.playerVersionId,
          franchiseId,
          gameId: summary.gameId,
          points: line.points,
          rebounds: line.offensiveRebounds + line.defensiveRebounds,
          assists: line.assists,
          humanTeam: input.humanFranchiseId === franchiseId,
        });
      }
    }
  }
  for (const performance of recap.notablePerformances) {
    const saved = lineByKey.get(`${performance.gameId}\u0000${performance.playerVersionId}`);
    if (saved === undefined) {
      failures.push(
        `notable performance ${performance.playerVersionId} in ${performance.gameId} does not exist in the block summaries`,
      );
    } else if (JSON.stringify(saved) !== JSON.stringify(performance)) {
      failures.push(
        `notable performance ${performance.playerVersionId} facts do not match the summary`,
      );
    }
  }

  const expectedStreaks = streaksOf(input.summaries);
  if (JSON.stringify(recap.streaks) !== JSON.stringify(expectedStreaks)) {
    failures.push('recap streaks do not match the ordered game results');
  }

  const playedInBlock = new Set<string>();
  for (const summary of blockSummaries) {
    for (const side of ['home', 'away'] as const) {
      for (const line of side === 'home' ? summary.homePlayers : summary.awayPlayers) {
        playedInBlock.add(line.playerVersionId);
      }
    }
  }
  const aggregateOf = new Map(
    input.playerAggregates.map((player) => [player.playerVersionId, player]),
  );
  for (const spotlight of recap.versionSpotlights) {
    const personA = input.rosterPlayerIds.get(spotlight.versionA);
    const personB = input.rosterPlayerIds.get(spotlight.versionB);
    if (personA === undefined || personB === undefined || personA !== personB) {
      failures.push(
        `version spotlight ${spotlight.versionA}/${spotlight.versionB} is not a same-person pair`,
      );
      continue;
    }
    if (!playedInBlock.has(spotlight.versionA) || !playedInBlock.has(spotlight.versionB)) {
      failures.push('version spotlight references a version with no block game');
    }
    const aggregateA = aggregateOf.get(spotlight.versionA);
    const aggregateB = aggregateOf.get(spotlight.versionB);
    if (aggregateA === undefined || aggregateB === undefined) {
      failures.push('version spotlight references a version without an aggregate');
      continue;
    }
    const franchiseA = aggregateA.franchiseId;
    const franchiseB = aggregateB.franchiseId;
    if (spotlight.sameTeam !== (franchiseA === franchiseB)) {
      failures.push(
        `version spotlight ${spotlight.versionA}/${spotlight.versionB} sameTeam mismatch`,
      );
    }
    if (
      spotlight.gamesPlayedA !== aggregateA.gamesPlayed ||
      spotlight.gamesPlayedB !== aggregateB.gamesPlayed ||
      spotlight.pointsA !== aggregateA.points ||
      spotlight.pointsB !== aggregateB.points ||
      spotlight.reboundsA !== aggregateA.offensiveRebounds + aggregateA.defensiveRebounds ||
      spotlight.reboundsB !== aggregateB.offensiveRebounds + aggregateB.defensiveRebounds ||
      spotlight.assistsA !== aggregateA.assists ||
      spotlight.assistsB !== aggregateB.assists
    ) {
      failures.push(
        `version spotlight ${spotlight.versionA}/${spotlight.versionB} aggregate facts mismatch`,
      );
    }
    const meeting = headToHead(blockSummaries, franchiseA, franchiseB);
    if (
      spotlight.headToHeadGames !== meeting.games ||
      spotlight.headToHeadWinsA !== meeting.winsA ||
      spotlight.headToHeadWinsB !== meeting.winsB
    ) {
      failures.push(
        `version spotlight ${spotlight.versionA}/${spotlight.versionB} head-to-head facts mismatch`,
      );
    }
  }

  const expectedUpcoming = upcomingHumanGamesOf(input);
  if (JSON.stringify(recap.upcomingHumanGames) !== JSON.stringify(expectedUpcoming)) {
    failures.push('recap upcoming human games do not match the schedule');
  }

  // M2.6.5: free-agency evidence must match the recorded post-block state.
  const expectedFreeAgency = blockFreeAgencyEvidenceOf({
    blockIndex: input.blockIndex,
    humanFranchiseId: input.humanFranchiseId,
    freeAgency: input.freeAgency,
  });
  if (JSON.stringify(recap.freeAgencyEvidence) !== JSON.stringify(expectedFreeAgency)) {
    failures.push('recap free-agency evidence does not match the recorded state');
  }
  return failures;
}
