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
