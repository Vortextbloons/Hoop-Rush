import type {
  SeasonEffectsState,
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
 * (spec/2.0/07 persistence, M2.3, M2.4). Kept in its own file so the
 * repository, the audit, and the test fixtures depend only on this type; the
 * production binding to `@hoop-rush/engine` lives in `engine-seam.ts`, the
 * single place that imports the engine package. The M2.4 effects helpers
 * (zero-state construction, roster id sets, canonical pair facts) are pure
 * TypeScript with no engine dependency; they live on the seam so the audit
 * and the repository never reimplement the canonical pair convention.
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
  /**
   * Sorted unique player-version ids across every roster (300 for a 30-team
   * league). The audit requires the effects player set to equal this set.
   */
  seasonRosterPlayerVersionIds(rosters: readonly SeasonRoster[]): string[];
  /**
   * Zero effects state for a league: one fresh load state per rostered
   * version and the 1,350 canonical zero-shared-possession pairs. Used to
   * seed the checkpoint at draft promotion.
   */
  zeroSeasonEffectsState(rosters: readonly SeasonRoster[]): SeasonEffectsState;
  /**
   * Canonical pair key ('a\u0000b' with a < b) matching the stored-effects
   * duplicate-detection convention.
   */
  seasonPairKey(a: string, b: string): string;
  /** True when `a < b` (canonical pair ordering). */
  seasonPairIsCanonical(a: string, b: string): boolean;
}
