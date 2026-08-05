import type {
  SeasonGame,
  SeasonGameSummary,
  SeasonLeague,
  SeasonPlayerAggregate,
  SeasonRoster,
  SeasonRotation,
  SeasonSchedule,
  SeasonStandings,
  SeasonTeamAggregate,
} from '@hoop-rush/data-contracts';

/**
 * Shape of the pure engine helpers the reload reconciliation audit needs
 * (spec/2.0/07 persistence, M2.3). Kept in its own file so the repository,
 * the audit, and the test fixtures depend only on this type; the production
 * binding to `@hoop-rush/engine` lives in `engine-seam.ts`, the single place
 * that imports the engine package.
 */
export interface SeasonRunEngineSeam {
  /**
   * Reassembles the full 1,230-game array: scheduled games come from the
   * schedule artifact, finalized games take their facts from the compact
   * summaries. Games with no summary stay `scheduled`.
   */
  reconstructSeasonGames(
    schedule: SeasonSchedule,
    summaries: readonly SeasonGameSummary[],
  ): SeasonGame[];
  /**
   * Pure fold of every team box over the completed summaries, returning the
   * full 30-row table (zero rows for franchises with no completed games)
   * sorted by franchiseId ascending.
   */
  foldSeasonTeamAggregates(
    league: SeasonLeague,
    summaries: readonly SeasonGameSummary[],
  ): SeasonTeamAggregate[];
  /**
   * Pure fold of every player line over the completed summaries, returning
   * the full 300-row table (zero rows for versions with no completed games)
   * sorted by playerVersionId ascending.
   */
  foldSeasonPlayerAggregates(
    rosters: readonly SeasonRoster[],
    summaries: readonly SeasonGameSummary[],
  ): SeasonPlayerAggregate[];
  /** Pure standings reduction over finalized game records. */
  reduceSeasonStandings(league: SeasonLeague, games: readonly SeasonGame[]): SeasonStandings;
  /** Canonical 32-hex digest of a 30-rotation locked set. */
  seasonRotationSetDigest(rotations: readonly SeasonRotation[]): string;
}
