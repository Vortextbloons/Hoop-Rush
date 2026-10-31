import type {
  CapRushFinalsMvp,
  CapRushPlayoffGamePlan,
  CapRushPlayoffGameSummary,
  CapRushPlayoffParticipant,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_FINALS_MVP_VERSION,
  CAP_RUSH_PLAYOFF_ROUNDS,
  capRushPlayoffGameSeed,
  playerIdSchema,
} from '@hoop-rush/data-contracts';
import { gameScore } from '../../challenge/league-value.ts';

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function capRushFinalsMvpOf(input: {
  readonly games: readonly CapRushPlayoffGameSummary[];
  readonly championTeamId: string;
  readonly userTeamId: string;
}): CapRushFinalsMvp | null {
  const champion = input.championTeamId;
  interface Totals {
    slot: CapRushPlayoffParticipant['slot'];
    playerId: string;
    displayName: string;
    games: number;
    gameScore: number;
    points: number;
    assists: number;
    rebounds: number;
  }
  const totals = new Map<string, Totals>();
  for (const game of input.games) {
    const seenSlots = new Set<string>();
    for (const line of game.finalsLines ?? []) {
      if (line.teamId !== champion) continue;
      const key = `${line.slot}:${line.playerId}`;
      const existing = totals.get(key) ?? {
        slot: line.slot,
        playerId: line.playerId,
        displayName: line.displayName,
        games: 0,
        gameScore: 0,
        points: 0,
        assists: 0,
        rebounds: 0,
      };
      if (!seenSlots.has(key)) {
        existing.games += 1;
        seenSlots.add(key);
      }
      existing.gameScore += gameScore({
        playerId: line.playerId,
        minutes: line.minutes,
        points: line.points,
        fieldGoals: { made: line.fieldGoalsMade, attempted: line.fieldGoalsAttempted },
        threes: { made: line.threesMade, attempted: line.threesAttempted },
        freeThrows: { made: line.freeThrowsMade, attempted: line.freeThrowsAttempted },
        rebounds: {
          total: line.rebounds,
          offensive: line.offensiveRebounds,
          defensive: line.defensiveRebounds,
        },
        assists: line.assists,
        steals: line.steals,
        blocks: line.blocks,
        turnovers: line.turnovers,
        fouls: line.fouls,
      });
      existing.points += line.points;
      existing.assists += line.assists;
      existing.rebounds += line.rebounds;
      totals.set(key, existing);
    }
  }
  const ranked = [...totals.values()].sort((left, right) => {
    if (right.gameScore !== left.gameScore) return right.gameScore - left.gameScore;
    if (right.points !== left.points) return right.points - left.points;
    if (right.assists !== left.assists) return right.assists - left.assists;
    if (right.rebounds !== left.rebounds) return right.rebounds - left.rebounds;
    return compareCodeUnits(left.playerId, right.playerId);
  });
  const winner = ranked[0];
  if (winner === undefined) return null;
  return {
    version: CAP_RUSH_FINALS_MVP_VERSION,
    selectionRule: 'finals-game-score-then-points-assists-rebounds-player-id',
    teamId: champion,
    isUserTeam: champion === input.userTeamId,
    slot: winner.slot,
    playerId: playerIdSchema.parse(winner.playerId),
    displayName: winner.displayName,
    games: winner.games,
    totalGameScore: winner.gameScore,
    totalPoints: winner.points,
    totalAssists: winner.assists,
    totalRebounds: winner.rebounds,
    averageGameScore: winner.gameScore / winner.games,
    averagePoints: winner.points / winner.games,
    averageAssists: winner.assists / winner.games,
    averageRebounds: winner.rebounds / winner.games,
  };
}

interface PlayoffSeriesLike {
  readonly seriesId: string;
  readonly round: number;
  readonly seriesSlot: number;
  readonly games: readonly unknown[];
  readonly highTeamId: string;
  readonly lowTeamId: string;
  readonly highSeed: number;
  readonly lowSeed: number;
}

export function capRushNextPlayoffGamePlan(input: {
  readonly series: PlayoffSeriesLike;
  readonly runSeed: Seed;
  readonly userTeamId: string;
}): CapRushPlayoffGamePlan {
  const { series, userTeamId } = input;
  const ordinal = series.games.length + 1;
  const highHome = [1, 2, 5, 7].includes(ordinal);
  const homeTeamId = highHome ? series.highTeamId : series.lowTeamId;
  const awayTeamId = highHome ? series.lowTeamId : series.highTeamId;
  const homeSeed = highHome ? series.highSeed : series.lowSeed;
  const awaySeed = highHome ? series.lowSeed : series.highSeed;
  const userSide = homeTeamId === userTeamId ? 'home' : awayTeamId === userTeamId ? 'away' : null;
  return {
    seriesId: series.seriesId,
    round: series.round,
    seriesSlot: series.seriesSlot,
    gameOrdinal: ordinal,
    homeTeamId,
    awayTeamId,
    homeSeed,
    awaySeed,
    userSide,
    isFinals: series.round === CAP_RUSH_PLAYOFF_ROUNDS,
    seed: capRushPlayoffGameSeed(input.runSeed, series.round, series.seriesSlot, ordinal),
  };
}
