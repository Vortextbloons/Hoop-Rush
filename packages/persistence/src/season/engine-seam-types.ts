import type {
  SeasonAwards,
  SeasonCheckpointState,
  SeasonEffectsState,
  SeasonFreeAgencyState,
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

export interface SeasonRunEngineSeam {
  reconstructSeasonGames(
    schedule: SeasonSchedule,
    summaries: readonly SeasonGameSummary[],
  ): SeasonGame[];

  foldSeasonTeamAggregates(
    league: SeasonLeague,
    summaries: readonly SeasonGameSummary[],
  ): SeasonTeamAggregate[];

  foldSeasonPlayerAggregates(
    rosters: readonly SeasonRoster[],
    summaries: readonly SeasonGameSummary[],
  ): SeasonPlayerAggregate[];

  reduceSeasonStandings(league: SeasonLeague, games: readonly SeasonGame[]): SeasonStandings;

  windowBlockIndexToIndex: Readonly<Record<number, number>>;

  seasonRotationSetDigest(rotations: readonly SeasonRotation[]): string;

  seasonRosterPlayerVersionIds(rosters: readonly SeasonRoster[]): string[];

  seasonRotationPlayerVersionIds(rotations: readonly SeasonRotation[]): string[];

  zeroSeasonEffectsState(rosters: readonly SeasonRoster[]): SeasonEffectsState;

  seasonPairKey(a: string, b: string): string;

  seasonPairIsCanonical(a: string, b: string): boolean;

  seasonRunStateDigest: (facts: SeasonRunStateDigestFacts) => string;

  createInitialSeasonInfluenceState(franchiseIds: readonly string[]): SeasonInfluenceState;
}

export interface SeasonRunStateDigestFacts {
  stateRevision: number;

  stage: SeasonRunStage;

  postseason: SeasonPostseasonState;

  awards: SeasonAwards | null;

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

  freeAgency: SeasonFreeAgencyState;
}

export interface SeasonWindowOpenResult {
  trade: SeasonTradeState;
  influence: SeasonInfluenceState;
  transactions: SeasonTransactionEntry[];
  rosters: SeasonRoster[];
  ownership: SeasonOwnership[];
  rotations: SeasonRotation[];
  effects: SeasonEffectsState;

  health: SeasonHealthState;
  stateRevision: number;
  stateDigest: string;
}
