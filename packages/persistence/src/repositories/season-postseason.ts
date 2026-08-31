import type {
  SeasonAlmanac,
  SeasonCommandLog,
  SeasonCommandLogEntry,
  SeasonEffectsState,
  SeasonPostseasonSummary,
  SeasonReplayExport,
  SeasonRun,
  SeasonRunCommand,
} from '@hoop-rush/data-contracts';
import type {
  SeasonCompletedRunIndexEntry,
  SeasonCompletedSeason,
  SeasonPostseasonDetail,
} from '../schemas/season-run-record.ts';
export interface CommitPostseasonAdvancementInput {
  runId: string;
  run: SeasonRun;
  summaries: SeasonPostseasonSummary[];
  details?: SeasonPostseasonDetail[];
  effects?: SeasonEffectsState;
  command: SeasonRunCommand;
  preStateRevision: number;
  preStateDigest: string;
  resultDigest: string;
  relatedGameIds: string[];
  transactionIds: string[];
}
export interface PromoteChampionInput {
  runId: string;
  run: SeasonRun;
  almanac: SeasonAlmanac;
  commandLog: SeasonCommandLog;
  postseasonSummaries: SeasonPostseasonSummary[];
}
export type { SeasonCommandLogEntry };
export class SeasonPostseasonIntegrityError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`season postseason integrity failure: ${reason}`);
    this.name = 'SeasonPostseasonIntegrityError';
    this.reason = reason;
  }
}
export interface SeasonPostseasonRepository {
  commitPostseasonAdvancement(input: CommitPostseasonAdvancementInput): Promise<void>;
  loadPostseasonSummaries(runId: string): Promise<SeasonPostseasonSummary[]>;
  loadPostseasonSummary(runId: string, gameId: string): Promise<SeasonPostseasonSummary | null>;
  loadPostseasonDetails(runId: string): Promise<SeasonPostseasonDetail[]>;
  loadCommandLog(runId: string): Promise<SeasonCommandLog | null>;
  promoteChampionToCompleted(input: PromoteChampionInput): Promise<void>;
  loadCompletedSeason(runId: string): Promise<SeasonCompletedSeason | null>;
  listCompletedSeasonRuns(): Promise<SeasonCompletedRunIndexEntry[]>;
  deleteCompletedSeason(runId: string): Promise<void>;
  buildReplayExport(runId: string, gameId: string): Promise<SeasonReplayExport | null>;
}
export type { SeasonCompletedSeason, SeasonCompletedRunIndexEntry, SeasonPostseasonDetail };
