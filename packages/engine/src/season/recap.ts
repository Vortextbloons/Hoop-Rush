import {
  SEASON_HEALTH_VERSION,
  SEASON_RECAP_VERSION,
  franchiseIdSchema,
  seasonGameIdSchema,
  type FranchiseId,
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
export interface SeasonBlockRecapInput {
  runId: string;
  blockIndex: number;
  completedRounds: number;
  humanFranchiseId: string | null;
  summaries: readonly SeasonGameSummary[];
  standingsBefore: SeasonStandings;
  standingsAfter: SeasonStandings;
  playerAggregates: readonly SeasonPlayerAggregate[];
  schedule: SeasonSchedule;
  rosterPlayerIds: ReadonlyMap<string, string>;
  rotations?: unknown;
  health?: SeasonHealthState;
  objective?: {
    objectiveId: SeasonObjectiveId | null;
    success: boolean | null;
    evaluation: SeasonObjectiveEvaluation;
  } | null;
  transactions?: readonly SeasonTransactionEntry[];
  influence?: SeasonInfluenceState;
  freeAgency?: SeasonFreeAgencyState;
}
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
    franchiseId: franchiseIdSchema.parse(franchiseId),
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
function chronologicallyOrdered(summaries: readonly SeasonGameSummary[]): SeasonGameSummary[] {
  return [...summaries].sort(
    (a, b) => a.round - b.round || (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0),
  );
}
function streaksOf(summaries: readonly SeasonGameSummary[]): SeasonStreak[] {
  const results = chronologicallyOrdered(summaries);
  const current = new Map<
    string,
    {
      kind: 'wins' | 'losses';
      length: number;
    }
  >();
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
    .map(([franchiseId, streak]) => ({
      franchiseId: franchiseIdSchema.parse(franchiseId),
      kind: streak.kind,
      length: streak.length,
    }))
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
): {
  games: number;
  winsA: number;
  winsB: number;
} {
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
    const parsedGameId = seasonGameIdSchema.safeParse(record.gameId);
    const occurrenceRound = parsedGameId.success ? (roundOfGame.get(parsedGameId.data) ?? 0) : 0;
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
export function blockFreeAgencyEvidenceOf(input: {
  blockIndex: number;
  humanFranchiseId: string | null;
  freeAgency: SeasonFreeAgencyState | undefined;
}): {
  windowIndex: number | null;
  signings: Array<{
    franchiseId: FranchiseId;
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
    humanDelta = freeAgency.seasonSpend[franchiseIdSchema.parse(input.humanFranchiseId)] ?? 0;
  }
  return {
    windowIndex: resolvedWindow?.windowIndex ?? null,
    signings: (resolvedWindow?.signings ?? []).map((signing) => ({
      franchiseId: franchiseIdSchema.parse(signing.franchiseId),
      playerVersionId: signing.playerVersionId,
      band: signing.band,
      influenceCost: signing.influenceCost,
    })),
    influenceDelta: -humanDelta,
    seasonSignings:
      input.humanFranchiseId === null
        ? 0
        : (freeAgency.signingCounts[franchiseIdSchema.parse(input.humanFranchiseId)] ?? 0),
    seasonSpend: humanDelta,
  };
}
export function blockTradeEvidenceOf(input: {
  blockIndex: number;
  humanFranchiseId: string | null;
  transactions: readonly SeasonTransactionEntry[] | undefined;
  influence: SeasonInfluenceState | undefined;
}): {
  tradesAccepted: number;
  influenceDelta: number;
} {
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
export function humanInfluenceBalanceAtBlockEnd(
  influence: SeasonInfluenceState,
  humanFranchiseId: string | null,
  blockIndex: number,
): number {
  if (humanFranchiseId === null) return 0;
  const current = influence.balances[franchiseIdSchema.parse(humanFranchiseId)] ?? 0;
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
