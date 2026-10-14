import Dexie, { type EntityTable, type Table } from 'dexie';
import { SAVE_SCHEMA_VERSION } from '@hoop-rush/data-contracts';
import { challengeRunProgressDigest } from '@hoop-rush/engine';
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
import type {
  StoredFixedFiveActive,
  StoredFixedFiveCommandRow,
  StoredFixedFiveCompleted,
  StoredFixedFiveHistoryIndex,
  StoredFixedFivePendingResult,
} from '../schemas/fixed-five-record.ts';
import type {
  StoredDraftDuelActive,
  StoredDraftDuelCommandRow,
  StoredDraftDuelCompleted,
  StoredDraftDuelHistoryIndex,
  StoredDraftDuelResultRow,
} from '../schemas/draft-duel-record.ts';
import type {
  StoredCollectionCommandRow,
  StoredCollectionLedgerRow,
  StoredCollectionOwnershipRow,
  StoredCollectionPullRow,
  StoredCollectionStateRow,
} from '../schemas/collection-record.ts';
import type {
  StoredCollectionGameCommandRow,
  StoredCollectionGameRow,
  StoredCollectionPlayStateRow,
} from '../schemas/collection-record.ts';
import type {
  StoredHavocActiveRun,
  StoredHavocCommandRow,
  StoredHavocCompletedRun,
  StoredHavocGameRow,
  StoredHavocHistoryRow,
  StoredHavocRetainedTape,
} from '../schemas/havoc-record.ts';
import { listCompletedHistory } from './support.ts';
const ACTIVE_RECORD_ID = 'active';
const CLASSIC_DRAFT_RECORD_ID = 'classic-draft';

export const HOOP_RUSH_DATABASE_NAME = 'hoop-rush-saves-v2';

export const HOOP_RUSH_DATABASE_STORES: Record<string, string> = {
  active: 'recordId',
  activeGames: '[runId+gameNumber], runId',
  completed: 'recordId',
  history: 'recordId, completedAtIso',
  classicDrafts: 'recordId',
  seasonDrafts: 'recordId',
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
  fixedFiveActive: 'roomId',
  fixedFiveCommands: '[roomId+ordinal], roomId',
  fixedFivePendingResults: 'roomId',
  fixedFiveCompleted: 'roomId',
  fixedFiveHistory: 'recordId, completedAtIso',
  draftDuelActive: 'roomId',
  draftDuelCommands: '[roomId+ordinal], roomId',
  draftDuelResults: '[roomId+gameNumber], roomId',
  draftDuelCompleted: 'roomId',
  draftDuelHistory: 'recordId, completedAtIso',
  collectionState: 'collectionId',
  collectionOwnership: '[collectionId+cardId], collectionId',
  collectionPulls: '[collectionId+pullSequence], collectionId',
  collectionLedger: '[collectionId+transactionId], collectionId',
  collectionCommands: '[collectionId+commandId], collectionId',
  collectionPlayState: 'collectionId',
  collectionGames: '[collectionId+gameId], collectionId',
  collectionGameCommands: '[collectionId+commandId], collectionId',
  havocActiveRuns: 'recordId',
  havocCommands: 'commandId, runId',
  havocGames: '[runId+variant+gameNumber], runId, [runId+variant]',
  havocRetainedTapes: '[runId+gameNumber], runId',
  havocCompletedRuns: 'runId',
  havocHistory: 'runId, updatedAtIso',
};
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
  fixedFiveActive!: EntityTable<StoredFixedFiveActive, 'roomId'>;
  fixedFiveCommands!: Table<StoredFixedFiveCommandRow, [string, number]>;
  fixedFivePendingResults!: EntityTable<StoredFixedFivePendingResult, 'roomId'>;
  fixedFiveCompleted!: EntityTable<StoredFixedFiveCompleted, 'roomId'>;
  fixedFiveHistory!: EntityTable<StoredFixedFiveHistoryIndex, 'recordId'>;
  draftDuelActive!: EntityTable<StoredDraftDuelActive, 'roomId'>;
  draftDuelCommands!: Table<StoredDraftDuelCommandRow, [string, number]>;
  draftDuelResults!: Table<StoredDraftDuelResultRow, [string, number]>;
  draftDuelCompleted!: EntityTable<StoredDraftDuelCompleted, 'roomId'>;
  draftDuelHistory!: EntityTable<StoredDraftDuelHistoryIndex, 'recordId'>;
  collectionState!: EntityTable<StoredCollectionStateRow, 'collectionId'>;
  collectionOwnership!: Table<StoredCollectionOwnershipRow, [string, string]>;
  collectionPulls!: Table<StoredCollectionPullRow, [string, number]>;
  collectionLedger!: Table<StoredCollectionLedgerRow, [string, string]>;
  collectionCommands!: Table<StoredCollectionCommandRow, [string, string]>;
  collectionPlayState!: EntityTable<StoredCollectionPlayStateRow, 'collectionId'>;
  collectionGames!: Table<StoredCollectionGameRow, [string, string]>;
  collectionGameCommands!: Table<StoredCollectionGameCommandRow, [string, string]>;
  havocActiveRuns!: EntityTable<StoredHavocActiveRun, 'recordId'>;
  havocCommands!: EntityTable<StoredHavocCommandRow, 'commandId'>;
  havocGames!: Table<StoredHavocGameRow, [string, string, number]>;
  havocRetainedTapes!: Table<StoredHavocRetainedTape, [string, number]>;
  havocCompletedRuns!: EntityTable<StoredHavocCompletedRun, 'runId'>;
  havocHistory!: EntityTable<StoredHavocHistoryRow, 'runId'>;
  constructor(name = HOOP_RUSH_DATABASE_NAME) {
    super(name);
    this.version(1).stores(HOOP_RUSH_DATABASE_STORES);
  }
}
export class DexieChallengeRepository {
  private readonly db: HoopRushDatabase;
  constructor(db: HoopRushDatabase) {
    this.db = db;
  }
  async saveActiveRun(record: StoredRunRecord): Promise<void> {
    const validated = storedRunRecordSchema.parse(record);
    const games = validated.run.games;
    const baseCheckpoint = checkpointFromRun({
      ...validated,
      run: { ...validated.run, games: [] },
    });
    const checkpoint = activeRunCheckpointSchema.parse({
      ...baseCheckpoint,
      gamesPlayed: games.length,
      updatedAtIso: validated.updatedAtIso,
    });
    const gameRows: ActiveGameRow[] = games.map((result) =>
      activeGameRowSchema.parse({
        runId: validated.run.runId,
        gameNumber: result.gameNumber,
        result,
        updatedAtIso: validated.updatedAtIso,
      }),
    );
    await this.db.transaction('rw', this.db.active, this.db.activeGames, async () => {
      await this.db.activeGames.clear();
      await this.db.active.put(checkpoint);
      if (gameRows.length > 0) await this.db.activeGames.bulkPut(gameRows);
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
      .sortBy('gameNumber');
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
    expected: PromoteActiveToCompletedExpectation,
  ): Promise<void> {
    const validatedRun = storedRunRecordSchema.parse(completed);
    const validatedIndex = completedRunIndexSchema.parse(index);
    if (validatedRun.run.runId !== validatedIndex.runId) {
      throw new Error('promotion runId mismatch');
    }
    if (validatedRun.run.status !== 'finished') {
      throw new Error(`cannot promote a run in status ${validatedRun.run.status}`);
    }
    if (validatedRun.run.games.length !== expected.expectedGamesPlayed) {
      throw new Error('promotion gamesPlayed does not match the completed run');
    }
    if (challengeRunProgressDigest(validatedRun.run) !== expected.expectedRunDigest) {
      throw new Error('promotion digest does not match the completed run');
    }
    await this.db.transaction(
      'rw',
      this.db.active,
      this.db.activeGames,
      this.db.completed,
      this.db.history,
      async () => {
        const checkpoint = await this.db.active.get(ACTIVE_RECORD_ID);
        if (checkpoint === undefined) {
          throw new Error('promoteActiveToCompleted: no active run checkpoint to promote');
        }
        const validatedCheckpoint = activeRunCheckpointSchema.parse(checkpoint);
        if (validatedCheckpoint.runId !== validatedRun.run.runId) {
          throw new Error('promoteActiveToCompleted: runId does not match the active checkpoint');
        }
        const rows = await this.db.activeGames
          .where('runId')
          .equals(validatedCheckpoint.runId)
          .sortBy('gameNumber');
        const storedGamesPlayed = validatedCheckpoint.gamesPlayed ?? rows.length;
        const storedRun = runFromCheckpoint(
          validatedCheckpoint,
          rows.map((row) => activeGameRowSchema.parse(row).result),
        );
        if (
          storedGamesPlayed !== expected.expectedGamesPlayed ||
          storedRun.games.length !== expected.expectedGamesPlayed ||
          challengeRunProgressDigest(storedRun) !== expected.expectedRunDigest
        ) {
          throw new Error(
            'promoteActiveToCompleted: the active run moved before the promotion could apply',
          );
        }
        await this.db.active.delete(ACTIVE_RECORD_ID);
        await this.db.activeGames.clear();
        await this.db.completed.put({ ...validatedRun, recordId: validatedIndex.runId });
        await this.db.history.put({ ...validatedIndex, recordId: validatedIndex.runId });
      },
    );
  }
  async listCompletedRuns(): Promise<CompletedRunIndex[]> {
    const rows = await listCompletedHistory(this.db.history);
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
export type ChallengeRepository = DexieChallengeRepository;
export interface PromoteActiveToCompletedExpectation {
  expectedGamesPlayed: number;
  expectedRunDigest: string;
}
