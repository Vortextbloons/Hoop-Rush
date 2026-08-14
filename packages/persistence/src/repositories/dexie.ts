import Dexie, { type EntityTable, type Table } from 'dexie';
import { CHECKPOINT_SAVE_SCHEMA_VERSION, SAVE_SCHEMA_VERSION } from '@hoop-rush/data-contracts';
import {
  classicDraftRecordSchema,
  type StoredClassicDraft,
} from '../schemas/classic-draft-record.ts';
import {
  activeGameRowSchema,
  activeRunCheckpointSchema,
  checkpointFromRun,
  completedRunIndexSchema,
  runFromCheckpoint,
  storedRunRecordSchema,
  type ActiveGameAppend,
  type ActiveRunCheckpoint,
  type ActiveGameRow,
  type ChallengeRepository,
  type CompletedRunIndex,
  type StoredRunRecord,
} from '../schemas/run-record.ts';
import type { StoredSeasonDraft } from '../schemas/season-draft-record.ts';
import type {
  StoredSeasonAcceptedBlockRow,
  StoredSeasonActiveRunIndex,
  StoredSeasonAlmanacRow,
  StoredSeasonCommandLogRow,
  StoredSeasonCompletedIndex,
  StoredSeasonCompletedRunRow,
  StoredSeasonDetailRow,
  StoredSeasonPendingBlockRow,
  StoredSeasonPlayerSliceRow,
  StoredSeasonPostseasonDetailRow,
  StoredSeasonPostseasonSummaryRow,
  StoredSeasonRunRecord,
  StoredSeasonSummaryRow,
} from '../schemas/season-run-record.ts';

const ACTIVE_RECORD_ID = 'active';
const CLASSIC_DRAFT_RECORD_ID = 'classic-draft';

export class HoopRushDatabase extends Dexie {
  active!: EntityTable<ActiveRunCheckpoint, 'recordId'>;
  activeGames!: Table<ActiveGameRow, [string, number]>;
  completed!: EntityTable<StoredRunRecord, 'recordId'>;
  history!: EntityTable<CompletedRunIndex, 'recordId'>;
  classicDrafts!: EntityTable<StoredClassicDraft, 'recordId'>;
  seasonDrafts!: EntityTable<StoredSeasonDraft, 'recordId'>;

  seasonRuns!: EntityTable<StoredSeasonRunRecord, 'recordId'>;

  seasonRunSummaries!: Table<StoredSeasonSummaryRow, [string, string]>;

  seasonRunDetails!: Table<StoredSeasonDetailRow, [string, string]>;

  seasonRunBlocks!: Table<StoredSeasonAcceptedBlockRow, [string, number]>;

  seasonRunIndex!: EntityTable<StoredSeasonActiveRunIndex, 'recordId'>;

  seasonPendingBlocks!: EntityTable<StoredSeasonPendingBlockRow, 'runId'>;

  seasonPostseasonSummaries!: Table<StoredSeasonPostseasonSummaryRow, [string, string]>;

  seasonPostseasonDetails!: Table<StoredSeasonPostseasonDetailRow, [string, string]>;

  seasonCommandLog!: Table<StoredSeasonCommandLogRow, [string, number]>;

  seasonAlmanacs!: EntityTable<StoredSeasonAlmanacRow, 'runId'>;

  seasonCompletedRuns!: EntityTable<StoredSeasonCompletedRunRow, 'runId'>;

  seasonCompletedIndex!: EntityTable<StoredSeasonCompletedIndex, 'recordId'>;

  seasonRunPlayerSlices!: EntityTable<StoredSeasonPlayerSliceRow, 'runId'>;

  constructor() {
    super('hoop-rush-saves');
    this.version(1).stores({
      active: 'recordId',
      completed: 'recordId',
      history: 'recordId',
    });
    this.version(2)
      .stores({
        active: 'recordId',
        activeGames: '[runId+gameNumber], runId',
        completed: 'recordId',
        history: 'recordId',
      })
      .upgrade(async (tx) => {
        const legacy = await tx.table<StoredRunRecord, string>('active').get(ACTIVE_RECORD_ID);
        if (legacy === undefined) return;
        const validated = storedRunRecordSchema.parse(legacy);
        await tx.table('activeGames').bulkPut(
          validated.run.games.map((result) => ({
            runId: validated.run.runId,
            gameNumber: result.gameNumber,
            result,
            updatedAtIso: validated.updatedAtIso,
          })),
        );
        const { games: _games, schemaVersion: _schemaVersion, ...run } = validated.run;
        await tx.table('active').put({
          recordId: ACTIVE_RECORD_ID,
          saveSchemaVersion: CHECKPOINT_SAVE_SCHEMA_VERSION,
          ...run,
          updatedAtIso: validated.updatedAtIso,
        });
      });
    this.version(3).stores({
      history: 'recordId, completedAtIso',
    });
    this.version(4).stores({
      classicDrafts: 'recordId',
    });

    this.version(5).stores({
      seasonDrafts: 'recordId',
    });

    this.version(6).stores({
      seasonRuns: 'recordId',
      seasonRunSummaries: '[runId+gameId], runId, blockIndex',
      seasonRunDetails: '[runId+gameId], runId',
      seasonRunBlocks: '[runId+blockIndex], runId',
      seasonRunIndex: 'recordId',
    });

    this.version(7).stores({
      seasonPendingBlocks: 'runId',
    });

    this.version(8).stores({
      seasonPostseasonSummaries: '[runId+gameId], runId',
      seasonCommandLog: '[runId+ordinal], runId',
      seasonAlmanacs: 'runId',
      seasonCompletedRuns: 'runId',
      seasonCompletedIndex: 'recordId, completedAtIso',
    });

    this.version(9)
      .stores({
        seasonRuns: 'recordId',

        seasonRunSummaries: '[runId+gameId], [runId+blockIndex], runId, blockIndex',
        seasonRunDetails: '[runId+gameId], runId',
        seasonRunBlocks: '[runId+blockIndex], runId',
        seasonRunIndex: 'recordId',
        seasonPendingBlocks: 'runId',
        seasonPostseasonSummaries: '[runId+gameId], runId',
        seasonCommandLog: '[runId+ordinal], runId',
        seasonAlmanacs: 'runId',
        seasonCompletedRuns: 'runId',
        seasonCompletedIndex: 'recordId, completedAtIso',

        seasonRunPlayerSlices: 'runId',
      })
      .upgrade(async (tx) => {
        await tx.table('seasonRuns').clear();
        await tx.table('seasonRunSummaries').clear();
        await tx.table('seasonRunDetails').clear();
        await tx.table('seasonRunBlocks').clear();
        await tx.table('seasonRunIndex').clear();
        await tx.table('seasonPendingBlocks').clear();
        await tx.table('seasonPostseasonSummaries').clear();
        await tx.table('seasonCommandLog').clear();
        await tx.table('seasonAlmanacs').clear();
        await tx.table('seasonCompletedRuns').clear();
        await tx.table('seasonCompletedIndex').clear();
      });
    this.version(10)
      .stores({
        seasonRuns: 'recordId',
        seasonRunSummaries: '[runId+gameId], [runId+blockIndex], runId, blockIndex',
        seasonRunDetails: '[runId+gameId], runId',
        seasonRunBlocks: '[runId+blockIndex], runId',
        seasonRunIndex: 'recordId',
        seasonPendingBlocks: 'runId',
        seasonPostseasonSummaries: '[runId+gameId], runId',

        seasonPostseasonDetails: '[runId+gameId], runId',
        seasonCommandLog: '[runId+ordinal], runId',
        seasonAlmanacs: 'runId',
        seasonCompletedRuns: 'runId',
        seasonCompletedIndex: 'recordId, completedAtIso',
        seasonRunPlayerSlices: 'runId',
      })
      .upgrade(async (tx) => {
        await tx.table('seasonRuns').clear();
        await tx.table('seasonRunSummaries').clear();
        await tx.table('seasonRunDetails').clear();
        await tx.table('seasonRunBlocks').clear();
        await tx.table('seasonRunIndex').clear();
        await tx.table('seasonPendingBlocks').clear();
        await tx.table('seasonPostseasonSummaries').clear();
        await tx.table('seasonPostseasonDetails').clear();
        await tx.table('seasonCommandLog').clear();
        await tx.table('seasonAlmanacs').clear();
        await tx.table('seasonCompletedRuns').clear();
        await tx.table('seasonCompletedIndex').clear();
        await tx.table('seasonRunPlayerSlices').clear();
      });
  }
}

export class DexieChallengeRepository implements ChallengeRepository {
  private readonly db: HoopRushDatabase;

  constructor(db: HoopRushDatabase = new HoopRushDatabase()) {
    this.db = db;
  }

  async saveActiveRun(record: StoredRunRecord): Promise<void> {
    const checkpoint = checkpointFromRun(record);
    await this.db.transaction('rw', this.db.active, this.db.activeGames, async () => {
      await this.db.activeGames.clear();
      await this.db.active.put(checkpoint);
    });
  }

  async appendActiveGame(input: ActiveGameAppend): Promise<void> {
    const row = activeGameRowSchema.parse({
      runId: input.runId,
      gameNumber: input.gameNumber,
      result: input.result,
    });
    const checkpointUpdate = activeRunCheckpointSchema
      .pick({ status: true, firstLossGameNumber: true, gamesPlayed: true, aggregates: true })
      .parse({ ...input, gamesPlayed: input.gameNumber });
    const updatedAtIso = new Date().toISOString();
    await this.db.transaction('rw', this.db.active, this.db.activeGames, async () => {
      const checkpoint = await this.db.active.get(ACTIVE_RECORD_ID);
      if (checkpoint === undefined) {
        throw new Error('appendActiveGame: no active run checkpoint to update');
      }
      if (checkpoint.runId !== row.runId) {
        throw new Error('appendActiveGame: runId does not match the active checkpoint');
      }
      await this.db.activeGames.put({ ...row, updatedAtIso });
      await this.db.active.put({ ...checkpoint, ...checkpointUpdate, updatedAtIso });
    });
  }

  async loadActiveRun(): Promise<StoredRunRecord | null> {
    const checkpoint = await this.db.active.get(ACTIVE_RECORD_ID);
    if (checkpoint === undefined) return null;
    const validatedCheckpoint = activeRunCheckpointSchema.parse(checkpoint);

    const rows = await this.db.activeGames
      .where('runId')
      .equals(validatedCheckpoint.runId)
      .toArray();
    const results = rows.map((row) => activeGameRowSchema.parse(row).result);
    return storedRunRecordSchema.parse({
      recordId: ACTIVE_RECORD_ID,
      saveSchemaVersion: SAVE_SCHEMA_VERSION,
      run: runFromCheckpoint(validatedCheckpoint, results),
      updatedAtIso: validatedCheckpoint.updatedAtIso,
    });
  }

  async clearActiveRun(): Promise<void> {
    await this.db.transaction('rw', this.db.active, this.db.activeGames, async () => {
      await this.db.active.delete(ACTIVE_RECORD_ID);
      await this.db.activeGames.clear();
    });
  }

  async loadActiveRunCheckpoint(): Promise<ActiveRunCheckpoint | null> {
    const checkpoint = await this.db.active.get(ACTIVE_RECORD_ID);
    if (checkpoint === undefined) return null;
    const validated = activeRunCheckpointSchema.parse(checkpoint);
    if (validated.gamesPlayed === undefined) {
      const gamesPlayed = await this.db.activeGames.where('runId').equals(validated.runId).count();
      return { ...validated, gamesPlayed };
    }
    return validated;
  }

  async promoteActiveToCompleted(
    completed: StoredRunRecord,
    index: CompletedRunIndex,
  ): Promise<void> {
    const validatedRun = storedRunRecordSchema.parse(completed);
    const validatedIndex = completedRunIndexSchema.parse(index);
    if (validatedRun.run.runId !== validatedIndex.runId) {
      throw new Error('promotion runId mismatch');
    }
    if (validatedRun.run.status !== 'finished') {
      throw new Error(`cannot promote a run in status ${validatedRun.run.status}`);
    }
    await this.db.transaction(
      'rw',
      this.db.active,
      this.db.activeGames,
      this.db.completed,
      this.db.history,
      async () => {
        await this.db.active.delete(ACTIVE_RECORD_ID);
        await this.db.activeGames.clear();
        await this.db.completed.put({ ...validatedRun, recordId: validatedIndex.runId });
        await this.db.history.put({ ...validatedIndex, recordId: validatedIndex.runId });
      },
    );
  }

  async listCompletedRuns(): Promise<CompletedRunIndex[]> {
    const rows = await this.db.history.orderBy('completedAtIso').reverse().toArray();
    return rows.map((row) => completedRunIndexSchema.parse(row));
  }

  async loadCompletedRun(runId: string): Promise<StoredRunRecord | null> {
    const record = await this.db.completed.get(runId);
    if (record === undefined) return null;
    return storedRunRecordSchema.parse(record);
  }

  async clearHistory(): Promise<void> {
    await this.db.transaction('rw', this.db.completed, this.db.history, async () => {
      await this.db.completed.clear();
      await this.db.history.clear();
    });
  }

  async saveClassicDraft(record: StoredClassicDraft): Promise<void> {
    const validated = classicDraftRecordSchema.parse(record);
    await this.db.classicDrafts.put({
      ...validated,
      updatedAtIso: new Date().toISOString(),
    });
  }

  async loadClassicDraft(): Promise<StoredClassicDraft | null> {
    const record = await this.db.classicDrafts.get(CLASSIC_DRAFT_RECORD_ID);
    if (record === undefined) return null;
    return classicDraftRecordSchema.parse(record);
  }

  async clearClassicDraft(): Promise<void> {
    await this.db.classicDrafts.delete(CLASSIC_DRAFT_RECORD_ID);
  }

  async promoteClassicDraftToRun(record: StoredRunRecord, draftId: string): Promise<void> {
    const validatedRun = storedRunRecordSchema.parse(record);
    const checkpoint = checkpointFromRun(validatedRun);
    await this.db.transaction(
      'rw',
      this.db.active,
      this.db.activeGames,
      this.db.classicDrafts,
      async () => {
        const storedDraft = await this.db.classicDrafts.get(CLASSIC_DRAFT_RECORD_ID);
        if (storedDraft !== undefined && storedDraft.draft.draftId !== draftId) {
          throw new Error('promoteClassicDraftToRun: draftId mismatch');
        }
        await this.db.activeGames.clear();
        await this.db.active.put(checkpoint);
        await this.db.classicDrafts.delete(CLASSIC_DRAFT_RECORD_ID);
      },
    );
  }
}
