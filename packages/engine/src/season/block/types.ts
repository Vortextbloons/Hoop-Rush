import type {
  EraSimulationProfile,
  Position,
  SeasonBlockRunContext,
  SeasonCampaignState,
  SeasonChallengeDeal,
  SeasonChallengeState,
  SeasonDraftCatalog,
  SeasonEffectsState,
  SeasonFreeAgencyState,
  SeasonGamePlayerInput,
  SeasonGameSummary,
  SeasonHealthState,
  SeasonInfluenceState,
  SeasonInvalidRosterInterruption,
  SeasonObjectiveId,
  SeasonObjectiveState,
  SeasonPlayerAggregate,
  SeasonRetainedGameDetail,
  SeasonRoster,
  SeasonRotation,
  SeasonSchedule,
  SeasonScheduleGame,
  SeasonStandings,
  SeasonSubmitBlockCommand,
  SeasonTeamAggregate,
  SeasonTransactionEntry,
} from '@hoop-rush/data-contracts';

export interface SeasonBlockSimulationInput {
  command: SeasonSubmitBlockCommand;
  run: SeasonBlockRunContext;
  expanded: ReadonlyMap<string, SeasonGamePlayerInput>;
  schedule: SeasonSchedule;
  catalog: SeasonDraftCatalog;
  profile: EraSimulationProfile;
  humanFranchiseId: string | null;
  participantFranchiseIds?: readonly string[] | null;
  rosterPlayerIds: ReadonlyMap<string, string>;
  priorSummaries: readonly SeasonGameSummary[];
  priorStandings?: SeasonStandings;
  priorTeamAggregates?: readonly SeasonTeamAggregate[];
  priorPlayerAggregates?: readonly SeasonPlayerAggregate[];
  effects: SeasonEffectsState;
  health: SeasonHealthState;
  objectiveId: SeasonObjectiveId | null;
  objectiveIds?: ReadonlyMap<string, SeasonObjectiveId | null> | null;
  challengeDeal?: SeasonChallengeDeal | null;
  challengeDealsByFranchise?: ReadonlyMap<string, SeasonChallengeDeal | null> | null;
  challengeState?: SeasonChallengeState | null;
  campaignOpportunityId?: string | null;
  campaignOpportunityIds?: ReadonlyMap<string, string | null> | null;
  influence?: SeasonInfluenceState;
  transactions?: SeasonTransactionEntry[];
  freeAgency?: SeasonFreeAgencyState;
  objectives?: SeasonObjectiveState;
  campaignState?: SeasonCampaignState;
  collectedTipAvailability?: {
    gameId: string;
    availableCount: number;
  }[];
}
export interface SeasonSubmitBlockCommandInput extends SeasonBlockSimulationInput {
  acceptedCommandIds: readonly string[];
  objectives?: SeasonObjectiveState;
}

export interface SeasonBlockSimulationOptions {
  cancelAfterGames?: number;
}
export interface SeasonBlockGameSimulationOptions {
  skipRecoveryTick?: boolean;
  gameNumberById?: Map<string, number>;
  rotationByFranchise?: Map<string, SeasonRotation>;
  rosterByFranchise?: Map<string, SeasonRoster>;
  staminaByVersion?: Map<string, number>;
  durabilityByVersion?: Map<string, number>;
  positions?: Map<string, readonly Position[]>;
}

export type SeasonBlockGameOutcome =
  | {
      summary: SeasonGameSummary;
      retainedDetail: SeasonRetainedGameDetail | null;
      effects: SeasonEffectsState;
      health: SeasonHealthState;
    }
  | {
      interruption: SeasonInvalidRosterInterruption;
    };
export interface SimulateSeasonBlockGameArgs {
  input: SeasonBlockSimulationInput;
  game: SeasonScheduleGame;
  effects: SeasonEffectsState;
  health: SeasonHealthState;
  options?: SeasonBlockGameSimulationOptions;
}

export interface AssembleSeasonBlockCandidateArgs {
  input: SeasonBlockSimulationInput;
  summaries: readonly SeasonGameSummary[];
  retainedDetails: readonly SeasonRetainedGameDetail[];
  effects: SeasonEffectsState;
  health: SeasonHealthState;
}
