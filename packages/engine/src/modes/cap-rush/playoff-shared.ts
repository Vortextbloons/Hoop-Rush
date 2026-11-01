import type {
  CapRushFinalsMvp,
  CapRushPlayoffGamePlan,
  CapRushPlayoffGameSummary,
  CapRushPlayoffParticipant,
  HavocBattleResult,
  HavocParticipantLine,
  HavocTeamInput,
  Position,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_FINALS_MVP_VERSION,
  CAP_RUSH_PLAYOFF_ROUNDS,
  capRushPlayoffGameSeed,
  playerIdSchema,
} from '@hoop-rush/data-contracts';
import { gameScore } from '../../challenge/league-value.ts';
import { capRushBoxOf } from './league-simulation.ts';

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

function ownerSlotMapsOf(team: HavocTeamInput): {
  readonly slotByInstance: Map<string, Position>;
  readonly starterBySlot: Map<Position, HavocTeamInput['starters'][number]>;
} {
  const slotByInstance = new Map<string, Position>();
  const starterBySlot = new Map<Position, HavocTeamInput['starters'][number]>();
  for (const starter of team.starters) {
    slotByInstance.set(starter.instanceId, starter.slot);
    starterBySlot.set(starter.slot, starter);
  }
  for (const replacement of team.replacements) {
    slotByInstance.set(replacement.instanceId, replacement.slot);
  }
  for (const clone of team.clones) {
    slotByInstance.set(clone.instanceId, clone.slot);
  }
  return { slotByInstance, starterBySlot };
}

function participantGroupOf(
  line: HavocParticipantLine,
  maps: ReturnType<typeof ownerSlotMapsOf>,
): Position | null {
  const ownerId = line.ownerInstanceId ?? line.instanceId;
  return maps.slotByInstance.get(ownerId) ?? null;
}

function finalsLinesOf(input: {
  readonly team: HavocTeamInput;
  readonly resultParticipants: readonly HavocParticipantLine[];
}): CapRushPlayoffParticipant[] {
  const maps = ownerSlotMapsOf(input.team);
  return input.resultParticipants.flatMap((line) => {
    const slot = participantGroupOf(line, maps);
    if (slot === null) return [];
    const starter = maps.starterBySlot.get(slot);
    if (starter === undefined) return [];
    return [
      {
        teamId: input.team.teamId,
        slot,
        playerId: playerIdSchema.parse(starter.source.playerId),
        displayName: starter.source.displayName,
        kind: line.kind,
        minutes: line.minutes,
        points: line.points,
        rebounds: line.rebounds.total,
        offensiveRebounds: line.rebounds.offensive,
        defensiveRebounds: line.rebounds.defensive,
        assists: line.assists,
        steals: line.steals,
        blocks: line.blocks,
        turnovers: line.turnovers,
        fouls: line.fouls,
        fieldGoalsMade: line.fieldGoals.made,
        fieldGoalsAttempted: line.fieldGoals.attempted,
        freeThrowsMade: line.freeThrows.made,
        freeThrowsAttempted: line.freeThrows.attempted,
        threesMade: line.threes.made,
        threesAttempted: line.threes.attempted,
        adjustments: line.adjustments,
      },
    ];
  });
}

export function capRushPlayoffSummaryOf(input: {
  readonly plan: CapRushPlayoffGamePlan;
  readonly result: HavocBattleResult;
  readonly inputDigest: string;
  readonly resultDigest: string;
  readonly userSide: 'home' | 'away' | null;
  readonly homeTeam: HavocTeamInput;
  readonly awayTeam: HavocTeamInput;
}): CapRushPlayoffGameSummary {
  const { plan, result } = input;
  return {
    gameId: `crp-${String(plan.round)}-${String(plan.seriesSlot)}-${String(plan.gameOrdinal)}`,
    seriesId: plan.seriesId,
    round: plan.round,
    seriesSlot: plan.seriesSlot,
    gameOrdinal: plan.gameOrdinal,
    seed: plan.seed,
    homeTeamId: plan.homeTeamId,
    awayTeamId: plan.awayTeamId,
    homeSeed: plan.homeSeed,
    awaySeed: plan.awaySeed,
    userSide: input.userSide,
    homePoints: result.home.points,
    awayPoints: result.away.points,
    winnerTeamId: result.home.points > result.away.points ? plan.homeTeamId : plan.awayTeamId,
    overtimePeriods: result.overtimePeriods,
    inputDigest: input.inputDigest,
    resultDigest: input.resultDigest,
    box: capRushBoxOf(result.home, result.away, result.overtimePeriods),
    ...(plan.round === CAP_RUSH_PLAYOFF_ROUNDS
      ? {
          finalsLines: [
            ...finalsLinesOf({
              team: input.homeTeam,
              resultParticipants: result.home.participants,
            }),
            ...finalsLinesOf({
              team: input.awayTeam,
              resultParticipants: result.away.participants,
            }),
          ],
        }
      : {}),
  };
}
