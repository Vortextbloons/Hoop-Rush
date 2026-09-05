import {
  type SeasonLeaderCategory,
  type SeasonLeaderEntry,
  type SeasonPlayerAggregate,
  type SeasonTeamAggregate,
} from '@hoop-rush/data-contracts';
import { deriveSeasonLeaders } from '@hoop-rush/engine';
export const LEADER_CATEGORIES: readonly SeasonLeaderCategory[] = [
  'points',
  'rebounds',
  'assists',
  'steals',
  'blocks',
  'threePointersMade',
];
export function engineOrderLeaderTables(
  playerAggregates: readonly SeasonPlayerAggregate[],
  teamAggregates: readonly SeasonTeamAggregate[],
): Record<SeasonLeaderCategory, SeasonLeaderEntry[]> {
  return deriveSeasonLeaders(teamAggregates, playerAggregates).categories;
}
