import type {
  SeasonCheckpointState,
  SeasonEffectsState,
  SeasonGame,
  SeasonGameSummary,
  SeasonHealthState,
  SeasonInfluenceState,
  SeasonLeague,
  SeasonObjectiveState,
  SeasonOwnership,
  SeasonPlayerAggregate,
  SeasonRoster,
  SeasonRotation,
  SeasonSchedule,
  SeasonStandings,
  SeasonTeamAggregate,
  SeasonTradeState,
  SeasonTransactionEntry,
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
  /**
   * M2.5: canonical 32-hex digest of the mutable run state facts
   * (`stateRevision`, `checkpointState`, `health`, `influence`,
   * `transactions`, `trade`, `objectives`, `rosters`, `ownership`,
   * `rotations`, `effects`; the stored `stateDigest` is excluded from its
   * own computation). The reload audit recomputes the stored digest through
   * this binding, so corrupt or half-applied mutable state is detected.
   */
  seasonRunStateDigest(facts: SeasonRunStateDigestFacts): string;
  /**
   * M2.5: the initial run-creation Influence state — every franchise at +2
   * with its recorded `initial-grant` ledger entry (blockIndex/commandId
   * null), no windows, no rehabs. Used to seed the checkpoint at draft
   * promotion.
   */
  createInitialSeasonInfluenceState(franchiseIds: readonly string[]): SeasonInfluenceState;
}

/** The mutable run-state facts the M2.5 state digest covers. */
export interface SeasonRunStateDigestFacts {
  stateRevision: number;
  checkpointState: SeasonCheckpointState | null;
  health: SeasonHealthState;
  influence: SeasonInfluenceState;
  transactions: readonly SeasonTransactionEntry[];
  trade: SeasonTradeState | null;
  objectives: SeasonObjectiveState;
  rosters: readonly SeasonRoster[];
  ownership: readonly SeasonOwnership[];
  rotations: readonly SeasonRotation[];
  effects: SeasonEffectsState;
}

/**
 * Everything the block commit writes when the engine's
 * `completeSeasonBlockCommit` produced a trade-window open (M2.5). Mirrors
 * the engine's `SeasonWindowOpenResult` in `engine/season/trades.ts`
 * (frozen shape, LEAD ADDENDUM item 3); persistence imports the engine only
 * through the seam, so the structural type lives here and the lead verifies
 * it stays identical to the engine export at integration.
 */
export interface SeasonWindowOpenResult {
  trade: SeasonTradeState;
  influence: SeasonInfluenceState;
  transactions: SeasonTransactionEntry[];
  rosters: SeasonRoster[];
  ownership: SeasonOwnership[];
  rotations: SeasonRotation[];
  effects: SeasonEffectsState;
  stateRevision: number;
  stateDigest: string;
}
