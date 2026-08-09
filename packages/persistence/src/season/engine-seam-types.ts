import type {
  SeasonAwards,
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
  SeasonPostseasonState,
  SeasonRoster,
  SeasonRotation,
  SeasonRunCompletion,
  SeasonRunStage,
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
 * single place that imports the engine package. The M2.4 effects helpers are
 * pure TypeScript with no engine dependency and live on the seam so the
 * canonical pair convention is never reimplemented.
 */
export interface SeasonRunEngineSeam {
  /**
   * Reassembles the full 1,230-game array: scheduled games come from the
   * schedule artifact, finalized games from the compact summaries.
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
  /**
   * M2.5: the windowIndex opened by an accepted block index (blocks 2/4/5
   * open windows 0/1/2). Canonical engine fact (`WINDOW_BLOCK_INDEX_TO_INDEX`
   * in `engine/season/trades.ts`); the reload audit inverts it, so the rule
   * never diverges from the engine. Declared as a value property because the
   * binding is the engine's exported constant.
   */
  windowBlockIndexToIndex: Readonly<Record<number, number>>;
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
   * M2.5/M2.6: canonical 32-hex digest of the mutable run state facts
   * (`stateRevision`, `stage`, `postseason`, `awards`, `completion`,
   * `checkpointState`, `health`, `influence`, `transactions`, `trade`,
   * `objectives`, `rosters`, `ownership`, `rotations`, `effects`; the
   * stored `stateDigest` excludes itself). The reload audit recomputes the
   * stored digest through this binding, so corrupt or half-applied mutable
   * state is detected. Value property because the binding is the engine's
   * pure function passed by reference.
   */
  seasonRunStateDigest: (facts: SeasonRunStateDigestFacts) => string;
  /**
   * M2.5: the initial run-creation Influence state — every franchise at +2
   * with its recorded `initial-grant` ledger entry, no windows, no rehabs.
   */
  createInitialSeasonInfluenceState(franchiseIds: readonly string[]): SeasonInfluenceState;
}

/**
 * The mutable run-state facts the M2.5/M2.6 state digest covers (M2.6 adds
 * `stage`, the postseason-v2 state, `awards`, and `completion`).
 */
export interface SeasonRunStateDigestFacts {
  stateRevision: number;
  /** M2.6: the explicit run stage. */
  stage: SeasonRunStage;
  /** M2.6: the postseason-v2 state machine. */
  postseason: SeasonPostseasonState;
  /** M2.6: derived season awards; null until postseason qualification. */
  awards: SeasonAwards | null;
  /** M2.6: completion state; null until a champion is decided. */
  completion: SeasonRunCompletion | null;
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
 * Everything the block commit writes when `completeSeasonBlockCommit`
 * produced a trade-window open (M2.5). Mirrors the engine's
 * `SeasonWindowOpenResult` (frozen shape, LEAD ADDENDUM item 3); persistence
 * imports the engine only through the seam, so the structural type lives here
 * and the lead verifies it stays identical at integration.
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
