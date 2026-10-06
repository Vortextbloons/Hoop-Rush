import type {
  SeasonAcceptedBlock,
  SeasonActiveRunIndex,
  SeasonCommandLog,
  SeasonGameSummary,
  SeasonInvalidRosterInterruption,
  SeasonPendingBlockCandidate,
  SeasonPostseasonSummary,
  SeasonReplayExport,
  SeasonRetainedGameDetail,
  SeasonRun,
  SeasonSchedule,
} from '@hoop-rush/data-contracts';
import type { StoredSeasonDraft } from '../schemas/season-draft-record.ts';
import type {
  SeasonCompletedRunIndexEntry,
  SeasonCompletedSeason,
  SeasonPostseasonDetail,
  SeasonRunPlayerSliceEntry,
} from '../schemas/season-run-record.ts';
import type { SeasonRunEngineSeam } from '../season/engine-seam-types.ts';
import { seasonRunEngineSeam } from '../season/engine-seam.ts';
import { HoopRushDatabase } from './dexie.ts';
import { SeasonCompletedOps } from './season-completed-ops.ts';
import { SeasonPostseasonOps } from './season-postseason-ops.ts';
import { SeasonRunOps } from './season-run-ops.ts';
import type {
  CommitSeasonBlockInput,
  SeasonRunCommandApplication,
  SeasonRunRepository,
  SeasonRunSnapshot,
} from './season-run.ts';
import type {
  CommitPostseasonAdvancementInput,
  PromoteChampionInput,
  SeasonPostseasonRepository,
} from './season-postseason.ts';
export { SeasonRunLoadError } from './season-run-shared.ts';
interface SeasonRunRepositoryOptions {
  schedule?: SeasonSchedule;
  seam?: SeasonRunEngineSeam;
}
export class DexieSeasonRunRepository implements SeasonRunRepository, SeasonPostseasonRepository {
  private readonly run: SeasonRunOps;
  private readonly postseason: SeasonPostseasonOps;
  private readonly completed: SeasonCompletedOps;
  constructor(
    db: HoopRushDatabase = new HoopRushDatabase(),
    options: SeasonRunRepositoryOptions = {},
  ) {
    const schedule = options.schedule ?? null;
    const seam = options.seam ?? seasonRunEngineSeam;
    this.run = new SeasonRunOps(db, schedule, seam);
    this.postseason = new SeasonPostseasonOps(db, seam);
    this.completed = new SeasonCompletedOps(db, schedule, seam, this.postseason);
  }
  loadActiveRunIndex(): Promise<SeasonActiveRunIndex | null> {
    return this.run.loadActiveRunIndex();
  }
  loadActiveRun(): Promise<SeasonRunSnapshot | null> {
    return this.run.loadActiveRun();
  }
  loadActiveRunWithSchedule(schedule: SeasonSchedule): Promise<SeasonRunSnapshot | null> {
    return this.run.loadActiveRunWithSchedule(schedule);
  }
  loadBlockSummaries(runId: string, blockIndex: number): Promise<SeasonGameSummary[]> {
    return this.run.loadBlockSummaries(runId, blockIndex);
  }
  loadRetainedDetails(runId: string): Promise<SeasonRetainedGameDetail[]> {
    return this.run.loadRetainedDetails(runId);
  }
  loadBlockHistory(runId: string): Promise<SeasonAcceptedBlock[]> {
    return this.run.loadBlockHistory(runId);
  }
  commitSeasonBlock(input: CommitSeasonBlockInput): Promise<void> {
    return this.run.commitSeasonBlock(input);
  }
  savePendingBlock(
    pending: SeasonPendingBlockCandidate,
    interruption: SeasonInvalidRosterInterruption,
  ): Promise<void> {
    return this.run.savePendingBlock(pending, interruption);
  }
  loadPendingBlock(runId: string): Promise<SeasonPendingBlockCandidate | null> {
    return this.run.loadPendingBlock(runId);
  }
  loadPendingInterruption(runId: string): Promise<SeasonInvalidRosterInterruption | null> {
    return this.run.loadPendingInterruption(runId);
  }
  discardPendingBlock(runId: string): Promise<void> {
    return this.run.discardPendingBlock(runId);
  }
  applySeasonRunCommand(input: SeasonRunCommandApplication): Promise<void> {
    return this.run.applySeasonRunCommand(input);
  }
  promoteSeasonDraftToRun(
    draft: StoredSeasonDraft,
    run: SeasonRun,
    playerSlice?: SeasonRunPlayerSliceEntry[],
  ): Promise<void> {
    return this.run.promoteSeasonDraftToRun(draft, run, playerSlice);
  }
  loadSeasonRunPlayerSlice(runId: string): Promise<SeasonRunPlayerSliceEntry[] | null> {
    return this.run.loadSeasonRunPlayerSlice(runId);
  }
  upsertSeasonRunPlayerSlice(runId: string, entries: SeasonRunPlayerSliceEntry[]): Promise<void> {
    return this.run.upsertSeasonRunPlayerSlice(runId, entries);
  }
  clearSeasonRun(runId: string): Promise<void> {
    return this.run.clearSeasonRun(runId);
  }
  forceClearActiveSeasonRun(): Promise<void> {
    return this.run.forceClearActiveSeasonRun();
  }
  commitPostseasonAdvancement(input: CommitPostseasonAdvancementInput): Promise<void> {
    return this.postseason.commitPostseasonAdvancement(input);
  }
  loadPostseasonSummaries(runId: string): Promise<SeasonPostseasonSummary[]> {
    return this.postseason.loadPostseasonSummaries(runId);
  }
  loadPostseasonSummary(runId: string, gameId: string): Promise<SeasonPostseasonSummary | null> {
    return this.postseason.loadPostseasonSummary(runId, gameId);
  }
  loadPostseasonDetails(runId: string): Promise<SeasonPostseasonDetail[]> {
    return this.postseason.loadPostseasonDetails(runId);
  }
  loadCommandLog(runId: string): Promise<SeasonCommandLog | null> {
    return this.postseason.loadCommandLog(runId);
  }
  promoteChampionToCompleted(input: PromoteChampionInput): Promise<void> {
    return this.postseason.promoteChampionToCompleted(input);
  }
  loadCompletedSeason(runId: string): Promise<SeasonCompletedSeason | null> {
    return this.completed.loadCompletedSeason(runId);
  }
  deleteCompletedSeason(runId: string): Promise<void> {
    return this.completed.deleteCompletedSeason(runId);
  }
  listCompletedSeasonRuns(): Promise<SeasonCompletedRunIndexEntry[]> {
    return this.completed.listCompletedSeasonRuns();
  }
  buildReplayExport(runId: string, gameId: string): Promise<SeasonReplayExport | null> {
    return this.completed.buildReplayExport(runId, gameId);
  }
}
export function loadActiveRunWithSchedule(
  schedule: SeasonSchedule,
  db: HoopRushDatabase = new HoopRushDatabase(),
): Promise<SeasonRunSnapshot | null> {
  return new DexieSeasonRunRepository(db, { schedule }).loadActiveRun();
}
