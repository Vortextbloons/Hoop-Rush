import type {
  SeasonAcceptedBlock,
  SeasonActiveRunIndex,
  SeasonBlockRecap,
  SeasonCampaignState,
  SeasonChallengeState,
  SeasonEvolutionState,
  SeasonCandidateCheckpoint,
  SeasonCheckpointState,
  SeasonCommandActor,
  SeasonEffectsState,
  SeasonFreeAgencyState,
  SeasonGameSummary,
  SeasonHealthState,
  SeasonInfluenceState,
  SeasonInvalidRosterInterruption,
  SeasonObjectiveState,
  SeasonPendingBlockCandidate,
  SeasonRetainedGameDetail,
  SeasonRotation,
  SeasonRun,
  SeasonRunCommand,
  SeasonSponsorGearState,
  SeasonStandings,
  SeasonTeamAggregate,
  SeasonPlayerAggregate,
  SeasonTradeState,
  SeasonTransactionEntry,
} from '@hoop-rush/data-contracts';
import type { StoredSeasonDraft } from '../schemas/season-draft-record.ts';
import type { SeasonWindowOpenResult } from '../season/engine-seam-types.ts';
import type { SeasonRunPlayerSliceEntry } from '../schemas/season-run-record.ts';
export interface CommitSeasonBlockInput {
  runId: string;
  revision: number;
  commandId: string;
  rotationDigest: string;
  checkpointDigest: string;
  completedRounds: number;
  standings: SeasonStandings;
  teamAggregates: SeasonTeamAggregate[];
  playerAggregates: SeasonPlayerAggregate[];
  summaries: SeasonGameSummary[];
  retainedDetails: SeasonRetainedGameDetail[];
  recap: SeasonBlockRecap;
  rotations: SeasonRotation[];
  effects: SeasonEffectsState;
  freeAgency: SeasonFreeAgencyState;
  health: SeasonHealthState;
  transactions: SeasonTransactionEntry[];
  influence: SeasonInfluenceState;
  trade: SeasonTradeState | null;
  objectives?: SeasonObjectiveState | null;
  challenges?: SeasonChallengeState | null;
  campaign?: SeasonCampaignState | null;
  evolution?: SeasonEvolutionState | null;
  sponsors?: SeasonSponsorGearState | null;
  checkpointState: SeasonCheckpointState;
  stateRevision: number;
  stateDigest: string;
  expectedStateRevision: number;
  expectedStateDigest: string;
  window: SeasonWindowOpenResult | null;
}
export interface SeasonRunSnapshot {
  run: SeasonRun;
  summaries: SeasonGameSummary[];
  retainedDetails: SeasonRetainedGameDetail[];
  acceptedBlocks: SeasonAcceptedBlock[];
  effects: SeasonEffectsState;
}
export interface SeasonRunCommandApplication {
  runId: string;
  command: SeasonRunCommand;
  run: SeasonRun;
  effects?: SeasonEffectsState;
  pending: SeasonPendingBlockCandidate | null;
  pendingInterruption?: SeasonInvalidRosterInterruption;
  resultDigest?: string;
  relatedGameIds?: string[];
  transactionIds?: string[];
  actor?: SeasonCommandActor;
}
export {
  SeasonRunCommandStaleStateError,
  SeasonRunCommandDuplicateError,
  SeasonRunCommandRunMismatchError,
  SeasonPendingBlockRejectedError,
} from '@hoop-rush/data-contracts';
export interface SeasonRunRepository {
  loadActiveRunIndex(): Promise<SeasonActiveRunIndex | null>;
  loadActiveRun(): Promise<SeasonRunSnapshot | null>;
  loadBlockSummaries(runId: string, blockIndex: number): Promise<SeasonGameSummary[]>;
  loadRetainedDetails(runId: string): Promise<SeasonRetainedGameDetail[]>;
  loadBlockHistory(runId: string): Promise<SeasonAcceptedBlock[]>;
  commitSeasonBlock(input: CommitSeasonBlockInput): Promise<void>;
  promoteSeasonDraftToRun(
    draft: StoredSeasonDraft,
    run: SeasonRun,
    playerSlice?: SeasonRunPlayerSliceEntry[],
  ): Promise<void>;
  clearSeasonRun(runId: string): Promise<void>;
  forceClearActiveSeasonRun(): Promise<void>;
  savePendingBlock(
    pending: SeasonPendingBlockCandidate,
    interruption: SeasonInvalidRosterInterruption,
  ): Promise<void>;
  loadPendingBlock(runId: string): Promise<SeasonPendingBlockCandidate | null>;
  loadPendingInterruption(runId: string): Promise<SeasonInvalidRosterInterruption | null>;
  discardPendingBlock(runId: string): Promise<void>;
  applySeasonRunCommand(input: SeasonRunCommandApplication): Promise<void>;
  loadSeasonRunPlayerSlice(runId: string): Promise<SeasonRunPlayerSliceEntry[] | null>;
  upsertSeasonRunPlayerSlice(runId: string, entries: SeasonRunPlayerSliceEntry[]): Promise<void>;
}
export type { SeasonCandidateCheckpoint, SeasonWindowOpenResult, SeasonRunPlayerSliceEntry };
