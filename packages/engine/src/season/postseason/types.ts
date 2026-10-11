import type { SeasonLeague, SeasonStandings } from '@hoop-rush/data-contracts';
export interface SeasonPostseasonGameFacts {
  gameId: string;
  status: 'final' | 'forfeit';
  winnerFranchiseId: string;
  loserFranchiseId: string;
  homeScore: number | null;
  awayScore: number | null;
}
export interface SeasonPostseasonRankingsInput {
  league: SeasonLeague;
  standings: SeasonStandings;
  seed: string;
}
export interface SeasonPostseasonRankings {
  east: readonly string[];
  west: readonly string[];
}
export type SeasonPostseasonRankingsFn = (
  input: SeasonPostseasonRankingsInput,
) => SeasonPostseasonRankings;
