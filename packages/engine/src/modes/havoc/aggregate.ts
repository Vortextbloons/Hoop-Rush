import type {
  HavocGameSummary,
  HavocSeasonAggregate,
  HavocStatLine,
} from '@hoop-rush/data-contracts';
import { HAVOC_MVP_INDEX_WEIGHTS } from '@hoop-rush/data-contracts';

export type HavocProductionLine = Pick<
  HavocStatLine,
  'points' | 'rebounds' | 'assists' | 'steals' | 'blocks' | 'turnovers'
>;

export function zeroHavocSeasonAggregate(): HavocSeasonAggregate {
  return { games: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, adjustments: 0 };
}

export function FoldHavocAggregate(
  aggregate: HavocSeasonAggregate,
  summary: HavocGameSummary,
): HavocSeasonAggregate {
  const win = summary.outcome === 'win';
  return {
    games: aggregate.games + 1,
    wins: aggregate.wins + (win ? 1 : 0),
    losses: aggregate.losses + (win ? 0 : 1),
    pointsFor: aggregate.pointsFor + summary.humanScore,
    pointsAgainst: aggregate.pointsAgainst + summary.opponentScore,
    adjustments: aggregate.adjustments + summary.adjustments,
  };
}

export function zeroHavocStatLine(): HavocStatLine {
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

export function addHavocStatLine(target: HavocStatLine, source: HavocStatLine): void {
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

export function havocProductionIndexOf(line: HavocProductionLine): number {
  return (
    HAVOC_MVP_INDEX_WEIGHTS.points * line.points +
    HAVOC_MVP_INDEX_WEIGHTS.rebounds * line.rebounds.total +
    HAVOC_MVP_INDEX_WEIGHTS.assists * line.assists +
    HAVOC_MVP_INDEX_WEIGHTS.steals * line.steals +
    HAVOC_MVP_INDEX_WEIGHTS.blocks * line.blocks +
    HAVOC_MVP_INDEX_WEIGHTS.turnovers * line.turnovers
  );
}
