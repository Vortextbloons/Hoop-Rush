import {
  seasonCommandLogDigest,
  seasonReplayExportDigest,
  seasonReplayExportSchema,
  type SeasonReplayExport,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import type { SeasonRunEngineSeam } from '../season/engine-seam-types.ts';
import {
  seasonCompletedSeasonSchema,
  storedSeasonAlmanacRowSchema,
  storedSeasonCompletedIndexSchema,
  storedSeasonCompletedRunRowSchema,
  storedSeasonSummaryRowSchema,
  type SeasonCompletedRunIndexEntry,
  type SeasonCompletedSeason,
} from '../schemas/season-run-record.ts';
import type { HoopRushDatabase } from './dexie.ts';
import type { SeasonPostseasonOps } from './season-postseason-ops.ts';
import { SeasonRunLoadError, deleteRunRows } from './season-run-shared.ts';
export class SeasonCompletedOps {
  private readonly db: HoopRushDatabase;
  private readonly schedule: SeasonSchedule | null;
  private readonly seam: SeasonRunEngineSeam;
  private readonly postseason: SeasonPostseasonOps;
  constructor(
    db: HoopRushDatabase,
    schedule: SeasonSchedule | null,
    seam: SeasonRunEngineSeam,
    postseason: SeasonPostseasonOps,
  ) {
    this.db = db;
    this.schedule = schedule;
    this.seam = seam;
    this.postseason = postseason;
  }
  async loadCompletedSeason(runId: string): Promise<SeasonCompletedSeason | null> {
    const schedule = this.schedule;
    if (schedule === null) {
      throw new SeasonRunLoadError(
        [
          'loadCompletedSeason requires the schedule artifact for game reconstruction; ' +
            'pass it to the DexieSeasonRunRepository constructor',
        ],
        'Season Run schedule not supplied',
      );
    }
    const [completedRow, almanacRow, indexRow] = await Promise.all([
      this.db.seasonCompletedRuns.get(runId),
      this.db.seasonAlmanacs.get(runId),
      this.db.seasonCompletedIndex.get(runId),
    ]);
    if (completedRow === undefined || almanacRow === undefined || indexRow === undefined) {
      return null;
    }
    const completed = storedSeasonCompletedRunRowSchema.parse(completedRow);
    const almanac = storedSeasonAlmanacRowSchema.parse(almanacRow).almanac;
    const index = storedSeasonCompletedIndexSchema.parse(indexRow);
    if (index.runId !== runId || almanac.runId !== runId) {
      throw new SeasonRunLoadError(
        ['completed-season rows disagree about the runId'],
        'corrupt stored completed Season Run',
      );
    }
    const summaryRows = await this.db.seasonRunSummaries.where('runId').equals(runId).toArray();
    const summaries = summaryRows
      .map((row) => storedSeasonSummaryRowSchema.parse(row).summary)
      .sort((a, b) => (a.gameId < b.gameId ? -1 : 1));
    const postseasonSummaries = await this.postseason.loadPostseasonSummaries(runId);
    const commandLog = await this.postseason.loadCommandLog(runId);
    if (commandLog === null) {
      throw new SeasonRunLoadError(
        ['completed season has no command log'],
        'corrupt stored completed Season Run',
      );
    }
    if (
      commandLog.entries.length === 0 ||
      almanac.commandLogDigest !== seasonCommandLogDigest(commandLog.entries)
    ) {
      throw new SeasonRunLoadError(
        ['completed season command log does not reconcile with the almanac'],
        'corrupt stored completed Season Run',
      );
    }
    const games = this.seam.reconstructSeasonGames(schedule, summaries);
    return seasonCompletedSeasonSchema.parse({
      run: { ...completed.run, games },
      almanac,
      commandLog,
      summaries,
      postseasonSummaries,
    });
  }
  async deleteCompletedSeason(runId: string): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.seasonRunSummaries,
        this.db.seasonRunDetails,
        this.db.seasonRunBlocks,
        this.db.seasonPendingBlocks,
        this.db.seasonPostseasonSummaries,
        this.db.seasonPostseasonDetails,
        this.db.seasonCommandLog,
        this.db.seasonAlmanacs,
        this.db.seasonCompletedRuns,
        this.db.seasonCompletedIndex,
        this.db.seasonRunPlayerSlices,
      ],
      async () => {
        await deleteRunRows(this.db, runId);
      },
    );
  }
  async listCompletedSeasonRuns(): Promise<SeasonCompletedRunIndexEntry[]> {
    const rows = await this.db.seasonCompletedIndex.orderBy('completedAtIso').reverse().toArray();
    return rows.map((row) => storedSeasonCompletedIndexSchema.parse(row));
  }
  async buildReplayExport(runId: string, gameId: string): Promise<SeasonReplayExport | null> {
    const summary = await this.postseason.loadPostseasonSummary(runId, gameId);
    if (summary === null) return null;
    const facts = {
      schemaVersion: 1,
      replayExportVersion: 'replay-export-v3',
      runId,
      gameId,
      summary,
    };
    const digest = seasonReplayExportDigest(facts as SeasonReplayExport);
    return seasonReplayExportSchema.parse({ ...facts, digest });
  }
}
