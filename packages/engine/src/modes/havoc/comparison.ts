import type {
  HavocComparison,
  HavocDifference,
  HavocGameResult,
  HavocMatchedGame,
  HavocMutationStat,
  HavocMvp,
  HavocSeasonTotals,
  HavocSlotComparison,
  HavocSlotParticipantLine,
  HavocSlotSide,
  HavocStatLine,
  HavocTeamResult,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_COMPARISON_VERSION,
  HAVOC_MUTATION_IDS,
  HAVOC_MVP_INDEX_WEIGHTS,
  HAVOC_MVP_INDEX_VERSION,
  HAVOC_SCHEMA_VERSION,
  POSITIONS,
  havocComparisonSchema,
  havocGameSeed,
} from '@hoop-rush/data-contracts';
import type { CompareHavocSeasonsInput, HavocStoredGame } from './api.ts';

const MVP_WEIGHTS = HAVOC_MVP_INDEX_WEIGHTS;
const MATCHED_GAMES = 82;
const MAX_DIFFERENCES = 5;
const MAX_HIGHLIGHTS = 8;

export function havocHumanTeamOf(result: HavocGameResult): HavocTeamResult {
  return result.humanSide === 'home' ? result.home : result.away;
}

export function havocOpponentTeamOf(result: HavocGameResult): HavocTeamResult {
  return result.humanSide === 'home' ? result.away : result.home;
}

/** Documented production index: 10*points + 12*rebounds + 15*assists + 30*steals + 30*blocks - 10*turnovers. */
export function havocProductionIndex(line: HavocStatLine): number {
  return (
    MVP_WEIGHTS.points * line.points +
    MVP_WEIGHTS.rebounds * line.rebounds.total +
    MVP_WEIGHTS.assists * line.assists +
    MVP_WEIGHTS.steals * line.steals +
    MVP_WEIGHTS.blocks * line.blocks +
    MVP_WEIGHTS.turnovers * line.turnovers
  );
}

/** Season totals from the human perspective; scores may be negative. */
export function havocSeasonTotalsOf(games: readonly HavocStoredGame[]): HavocSeasonTotals {
  let wins = 0;
  let losses = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  let adjustments = 0;
  let largestPointsFor = 0;
  let largestPointsAgainst = 0;
  for (const game of games) {
    const human = havocHumanTeamOf(game.result);
    const opponent = havocOpponentTeamOf(game.result);
    pointsFor += human.points;
    pointsAgainst += opponent.points;
    adjustments += human.adjustments;
    if (human.points > opponent.points) wins += 1;
    else losses += 1;
    largestPointsFor = Math.max(largestPointsFor, human.points);
    largestPointsAgainst = Math.max(largestPointsAgainst, opponent.points);
  }
  const count = games.length;
  return {
    games: count,
    wins,
    losses,
    pointsFor,
    pointsAgainst,
    differential: pointsFor - pointsAgainst,
    averagePointsFor: count === 0 ? 0 : pointsFor / count,
    averagePointsAgainst: count === 0 ? 0 : pointsAgainst / count,
    largestPointsFor,
    largestPointsAgainst,
    adjustments,
  };
}

function alignGames(
  games: readonly HavocStoredGame[],
  variant: 'havoc' | 'normal',
  locked: CompareHavocSeasonsInput['locked'],
): Map<number, HavocStoredGame> {
  if (games.length !== MATCHED_GAMES) {
    throw new Error(
      `havoc comparison: expected ${String(MATCHED_GAMES)} ${variant} games, got ${String(games.length)}`,
    );
  }
  const byNumber = new Map<number, HavocStoredGame>();
  for (const game of games) {
    if (game.gameNumber < 1 || game.gameNumber > MATCHED_GAMES) {
      throw new Error(
        `havoc comparison: ${variant} game number out of range (${String(game.gameNumber)})`,
      );
    }
    if (byNumber.has(game.gameNumber)) {
      throw new Error(`havoc comparison: duplicate ${variant} game ${String(game.gameNumber)}`);
    }
    byNumber.set(game.gameNumber, game);
  }
  for (let gameNumber = 1; gameNumber <= MATCHED_GAMES; gameNumber += 1) {
    const game = byNumber.get(gameNumber);
    if (game === undefined) {
      throw new Error(`havoc comparison: missing ${variant} game ${String(gameNumber)}`);
    }
    const entry = locked.schedule[gameNumber - 1];
    if (entry === undefined) {
      throw new Error(`havoc comparison: no schedule entry for game ${String(gameNumber)}`);
    }
    const result = game.result;
    if (result.gameNumber !== gameNumber) {
      throw new Error(
        `havoc comparison: ${variant} stored game ${String(gameNumber)} carries result game ${String(result.gameNumber)}`,
      );
    }
    if (result.variant !== variant) {
      throw new Error(
        `havoc comparison: game ${String(gameNumber)} ${variant} slot carries variant ${result.variant}`,
      );
    }
    const expectedSeed = havocGameSeed(locked.runSeed, gameNumber);
    if (result.seed !== expectedSeed) {
      throw new Error(
        `havoc comparison: game ${String(gameNumber)} ${variant} seed does not match the shared game seed`,
      );
    }
    const expectedSide = entry.humanHome ? 'home' : 'away';
    if (result.humanSide !== expectedSide) {
      throw new Error(
        `havoc comparison: game ${String(gameNumber)} ${variant} human side ${result.humanSide} != schedule ${expectedSide}`,
      );
    }
  }
  return byNumber;
}

function zeroLine(): HavocStatLine {
  return {
    secondsPlayed: 0,
    minutes: 0,
    points: 0,
    fieldGoals: { made: 0, attempted: 0 },
    threes: { made: 0, attempted: 0 },
    freeThrows: { made: 0, attempted: 0 },
    rebounds: { total: 0, offensive: 0, defensive: 0 },
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    chargedFouls: 0,
    adjustments: 0,
  };
}

function addInto(target: HavocStatLine, source: HavocStatLine): void {
  target.secondsPlayed += source.secondsPlayed;
  target.minutes += source.minutes;
  target.points += source.points;
  target.fieldGoals.made += source.fieldGoals.made;
  target.fieldGoals.attempted += source.fieldGoals.attempted;
  target.threes.made += source.threes.made;
  target.threes.attempted += source.threes.attempted;
  target.freeThrows.made += source.freeThrows.made;
  target.freeThrows.attempted += source.freeThrows.attempted;
  target.rebounds.total += source.rebounds.total;
  target.rebounds.offensive += source.rebounds.offensive;
  target.rebounds.defensive += source.rebounds.defensive;
  target.assists += source.assists;
  target.steals += source.steals;
  target.blocks += source.blocks;
  target.turnovers += source.turnovers;
  target.fouls += source.fouls;
  target.chargedFouls += source.chargedFouls;
  target.adjustments += source.adjustments;
}

interface SlotInstanceAggregate {
  kind: HavocSlotParticipantLine['kind'];
  instanceId: string;
  displayName: string;
  line: HavocStatLine;
}

function slotSide(starterInstanceId: string, games: readonly HavocStoredGame[]): HavocSlotSide {
  const instances = new Map<string, SlotInstanceAggregate>();
  const order: string[] = [];
  for (const game of games) {
    const team = havocHumanTeamOf(game.result);
    for (const line of team.participants) {
      if (line.instanceId !== starterInstanceId && line.ownerInstanceId !== starterInstanceId) {
        continue;
      }
      let aggregate = instances.get(line.instanceId);
      if (aggregate === undefined) {
        aggregate = {
          kind: line.kind,
          instanceId: line.instanceId,
          displayName: line.displayName,
          line: zeroLine(),
        };
        instances.set(line.instanceId, aggregate);
        order.push(line.instanceId);
      }
      addInto(aggregate.line, line);
    }
  }
  if (order.length === 0) {
    throw new Error(`havoc comparison: no participant lines for starter ${starterInstanceId}`);
  }
  if (order.length > 3) {
    throw new Error(
      `havoc comparison: starter ${starterInstanceId} maps to ${String(order.length)} participant identities (max 3)`,
    );
  }
  const lines = order.map((instanceId) => {
    const aggregate = instances.get(instanceId);
    if (aggregate === undefined) {
      throw new Error(`havoc comparison: lost participant aggregate ${instanceId}`);
    }
    return {
      kind: aggregate.kind,
      instanceId: aggregate.instanceId,
      displayName: aggregate.displayName,
      line: aggregate.line,
    };
  });
  const combined = zeroLine();
  for (const line of lines) addInto(combined, line.line);
  return { combined, lines };
}

function statDelta(havoc: HavocStatLine, normal: HavocStatLine): HavocSlotComparison['deltas'] {
  return {
    secondsPlayed: havoc.secondsPlayed - normal.secondsPlayed,
    minutes: havoc.minutes - normal.minutes,
    points: havoc.points - normal.points,
    fieldGoalsMade: havoc.fieldGoals.made - normal.fieldGoals.made,
    fieldGoalAttempts: havoc.fieldGoals.attempted - normal.fieldGoals.attempted,
    threesMade: havoc.threes.made - normal.threes.made,
    threesAttempted: havoc.threes.attempted - normal.threes.attempted,
    freeThrowsMade: havoc.freeThrows.made - normal.freeThrows.made,
    freeThrowsAttempted: havoc.freeThrows.attempted - normal.freeThrows.attempted,
    rebounds: havoc.rebounds.total - normal.rebounds.total,
    offensiveRebounds: havoc.rebounds.offensive - normal.rebounds.offensive,
    defensiveRebounds: havoc.rebounds.defensive - normal.rebounds.defensive,
    assists: havoc.assists - normal.assists,
    steals: havoc.steals - normal.steals,
    blocks: havoc.blocks - normal.blocks,
    turnovers: havoc.turnovers - normal.turnovers,
    fouls: havoc.fouls - normal.fouls,
    adjustments: havoc.adjustments - normal.adjustments,
    productionIndex: havocProductionIndex(havoc) - havocProductionIndex(normal),
  };
}

function buildSlots(
  locked: CompareHavocSeasonsInput['locked'],
  havocGames: readonly HavocStoredGame[],
  normalGames: readonly HavocStoredGame[],
): HavocSlotComparison[] {
  return POSITIONS.map((slot, index) => {
    const starter = locked.human.starters[index];
    if (starter === undefined) {
      throw new Error(`havoc comparison: locked human team has no starter for ${slot}`);
    }
    const havoc = slotSide(starter.instanceId, havocGames);
    const normal = slotSide(starter.instanceId, normalGames);
    const havocIndex = havocProductionIndex(havoc.combined);
    const normalIndex = havocProductionIndex(normal.combined);
    return {
      slot,
      displayName: starter.source.displayName,
      playerId: starter.source.playerId,
      playerVersionId: starter.source.playerVersionId,
      havoc,
      normal,
      deltas: statDelta(havoc.combined, normal.combined),
      productionIndex: {
        havoc: havocIndex,
        normal: normalIndex,
        gain: havocIndex - normalIndex,
      },
    };
  });
}

interface MutationAggregate {
  owners: Set<string>;
  triggers: number;
  pointsDelta: number;
  freeThrowsGranted: number;
  turnoversCancelled: number;
  extraPossessionsEarned: number;
  extraPossessionsUsed: number;
  extraPossessionsExpired: number;
  swapSeconds: number;
  capSeconds: number;
}

function buildMutations(games: readonly HavocStoredGame[]): HavocMutationStat[] {
  const aggregates = new Map<string, MutationAggregate>();
  for (const game of games) {
    for (const rollup of game.result.rollups) {
      let aggregate = aggregates.get(rollup.mutationId);
      if (aggregate === undefined) {
        aggregate = {
          owners: new Set(),
          triggers: 0,
          pointsDelta: 0,
          freeThrowsGranted: 0,
          turnoversCancelled: 0,
          extraPossessionsEarned: 0,
          extraPossessionsUsed: 0,
          extraPossessionsExpired: 0,
          swapSeconds: 0,
          capSeconds: 0,
        };
        aggregates.set(rollup.mutationId, aggregate);
      }
      aggregate.owners.add(rollup.ownerInstanceId);
      aggregate.triggers += rollup.triggers;
      aggregate.pointsDelta += rollup.pointsDelta;
      aggregate.freeThrowsGranted += rollup.freeThrowsGranted;
      aggregate.turnoversCancelled += rollup.turnoversCancelled;
      aggregate.extraPossessionsEarned += rollup.extraPossessionsEarned;
      aggregate.extraPossessionsUsed += rollup.extraPossessionsUsed;
      aggregate.extraPossessionsExpired += rollup.extraPossessionsExpired;
      aggregate.swapSeconds += rollup.swapSeconds;
      aggregate.capSeconds += rollup.capSeconds;
    }
  }
  const stats: HavocMutationStat[] = [];
  for (const mutationId of HAVOC_MUTATION_IDS) {
    const aggregate = aggregates.get(mutationId);
    if (aggregate === undefined) continue;
    stats.push({
      mutationId,
      ownerCount: aggregate.owners.size,
      triggers: aggregate.triggers,
      pointsDelta: aggregate.pointsDelta,
      freeThrowsGranted: aggregate.freeThrowsGranted,
      turnoversCancelled: aggregate.turnoversCancelled,
      extraPossessionsEarned: aggregate.extraPossessionsEarned,
      extraPossessionsUsed: aggregate.extraPossessionsUsed,
      extraPossessionsExpired: aggregate.extraPossessionsExpired,
      swapSeconds: aggregate.swapSeconds,
      capSeconds: aggregate.capSeconds,
    });
  }
  return stats;
}

function selectMvp(slots: readonly HavocSlotComparison[]): HavocMvp {
  let best = slots[0];
  if (best === undefined) {
    throw new Error('havoc comparison: no draft slots to award');
  }
  for (const candidate of slots) {
    const bestIndex = best.productionIndex;
    const candidateIndex = candidate.productionIndex;
    if (candidateIndex.gain > bestIndex.gain) {
      best = candidate;
      continue;
    }
    if (candidateIndex.gain === bestIndex.gain && candidateIndex.havoc > bestIndex.havoc) {
      best = candidate;
    }
  }
  return {
    slot: best.slot,
    playerId: best.playerId,
    playerVersionId: best.playerVersionId,
    displayName: best.displayName,
    havocIndex: best.productionIndex.havoc,
    normalIndex: best.productionIndex.normal,
    gain: best.productionIndex.gain,
  };
}

function differenceOf(game: HavocMatchedGame): HavocDifference {
  const havoc = game.havoc;
  const normal = game.normal;
  return {
    gameNumber: game.gameNumber,
    opponentId: game.opponentId,
    humanScore: havoc.humanScore,
    opponentScore: havoc.opponentScore,
    pointsDelta: havoc.humanScore - normal.humanScore,
    outcome: havoc.outcome,
  };
}

function rankedDifferences(
  differences: readonly HavocDifference[],
  direction: 'positive' | 'negative',
): HavocDifference[] {
  const filtered = differences.filter((difference) =>
    direction === 'positive' ? difference.pointsDelta > 0 : difference.pointsDelta < 0,
  );
  filtered.sort((a, b) => {
    const delta =
      direction === 'positive' ? b.pointsDelta - a.pointsDelta : a.pointsDelta - b.pointsDelta;
    return delta !== 0 ? delta : a.gameNumber - b.gameNumber;
  });
  return filtered.slice(0, MAX_DIFFERENCES);
}

export function compareHavocSeasons(input: CompareHavocSeasonsInput): HavocComparison {
  const { locked, havocGames, normalGames, runId } = input;
  const havocByNumber = alignGames(havocGames, 'havoc', locked);
  const normalByNumber = alignGames(normalGames, 'normal', locked);
  const havoc = havocSeasonTotalsOf(havocGames);
  const normal = havocSeasonTotalsOf(normalGames);
  const games: HavocMatchedGame[] = [];
  for (let gameNumber = 1; gameNumber <= MATCHED_GAMES; gameNumber += 1) {
    const havocGame = havocByNumber.get(gameNumber);
    const normalGame = normalByNumber.get(gameNumber);
    const entry = locked.schedule[gameNumber - 1];
    if (havocGame === undefined || normalGame === undefined || entry === undefined) {
      throw new Error(`havoc comparison: incomplete pairing for game ${String(gameNumber)}`);
    }
    const havocHuman = havocHumanTeamOf(havocGame.result);
    const havocOpponent = havocOpponentTeamOf(havocGame.result);
    const normalHuman = havocHumanTeamOf(normalGame.result);
    const normalOpponent = havocOpponentTeamOf(normalGame.result);
    const havocWin = havocHuman.points > havocOpponent.points;
    const normalWin = normalHuman.points > normalOpponent.points;
    const havocMargin = havocHuman.points - havocOpponent.points;
    const normalMargin = normalHuman.points - normalOpponent.points;
    games.push({
      gameNumber,
      opponentId: entry.opponentId,
      humanHome: entry.humanHome,
      havoc: {
        humanScore: havocHuman.points,
        opponentScore: havocOpponent.points,
        outcome: havocWin ? 'win' : 'loss',
        resultDigest: havocGame.resultDigest,
      },
      normal: {
        humanScore: normalHuman.points,
        opponentScore: normalOpponent.points,
        outcome: normalWin ? 'win' : 'loss',
        resultDigest: normalGame.resultDigest,
      },
      deltas: {
        pointsFor: havocHuman.points - normalHuman.points,
        pointsAgainst: havocOpponent.points - normalOpponent.points,
        margin: havocMargin - normalMargin,
      },
      flips: {
        havocWinNormalLoss: havocWin && !normalWin,
        normalWinHavocLoss: !havocWin && normalWin,
      },
      highlights: havocGame.result.highlights.slice(0, MAX_HIGHLIGHTS),
    });
  }
  const slots = buildSlots(locked, havocGames, normalGames);
  const differences = games.map(differenceOf);
  return havocComparisonSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    comparisonVersion: HAVOC_COMPARISON_VERSION,
    mvpIndexVersion: HAVOC_MVP_INDEX_VERSION,
    runId,
    havoc,
    normal,
    winsGained: havoc.wins - normal.wins,
    differentialDelta: havoc.differential - normal.differential,
    games,
    slots,
    mutations: buildMutations(havocGames),
    mvp: selectMvp(slots),
    mvpIndexWeights: { ...MVP_WEIGHTS },
    largestPositiveDifferences: rankedDifferences(differences, 'positive'),
    largestNegativeDifferences: rankedDifferences(differences, 'negative'),
  });
}
