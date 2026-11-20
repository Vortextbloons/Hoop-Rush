import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  PlayerProfile,
  ProfileBinding,
  ProfileGame,
  ProfileSelection,
} from '@hoop-rush/data-contracts';
import { SAVE_SCHEMA_VERSION } from '@hoop-rush/data-contracts';
import { challengeRunProgressDigest, evaluateRunAchievements } from '@hoop-rush/engine';
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
import type { PromoteActiveToCompletedExpectation } from '@hoop-rush/data-contracts';
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
  StoredHavocActiveRun,
  StoredHavocLockedInputs,
  StoredHavocCommandRow,
  StoredHavocCompletedRun,
  StoredHavocGameRow,
  StoredHavocHistoryRow,
  StoredHavocRetainedTape,
} from '../schemas/havoc-record.ts';
import type {
  StoredHavocMultiplayerActive,
  StoredHavocMultiplayerCommandRow,
  StoredHavocMultiplayerCompleted,
  StoredHavocMultiplayerHistoryIndex,
  StoredHavocMultiplayerResultRow,
} from '../schemas/havoc-multiplayer-record.ts';
import {
  type StoredCapRushCommandRow,
  type StoredCapRushDraftProgressRow,
  type StoredCapRushGameRow,
  type StoredCapRushHistoryRow,
  type StoredCapRushLeagueAggregateRow,
  type StoredCapRushLeagueGameRow,
  type StoredCapRushLeagueScoreRow,
  type StoredCapRushLegacyDraftRow,
  type StoredCapRushLockedInputsRow,
  type StoredCapRushPlaybackCursorRow,
  type StoredCapRushPlaybackEvidenceRow,
  type StoredCapRushPlayoffGameRow,
  type StoredCapRushReportRow,
} from '../schemas/cap-rush-record.ts';
import type {
  StoredCapRushMultiplayerActiveRow,
  StoredCapRushMultiplayerCommandRow,
  StoredCapRushMultiplayerCompletedRow,
  StoredCapRushMultiplayerGameRow,
  StoredCapRushMultiplayerHistoryRow,
} from '../schemas/cap-rush-multiplayer-record.ts';
import type {
  StoredFullCourtDraft,
  StoredFullCourtDraftCommand,
} from '../schemas/full-court-draft-record.ts';
import type {
  StoredFullCourtSeasonCheckpoint,
  StoredFullCourtSeasonScore,
} from '../schemas/full-court-season-record.ts';
import type { StoredFullCourtPlayoffs } from '../schemas/full-court-playoff-record.ts';
import { getParsedRecord, listCompletedHistory } from './support.ts';
import { DexieProfileRepository } from './profile.ts';
const ACTIVE_RECORD_ID = 'active';
const CLASSIC_DRAFT_RECORD_ID = 'classic-draft';

export const HOOP_RUSH_DATABASE_NAME = 'hoop-rush-saves-v2';

/**
 * Database version 15. Only databases opened before the Cap Rush save split
 * still use this shape; it must not change, because Dexie upgrades a version-15
 * database in place instead of clearing it.
 */
export const HOOP_RUSH_DATABASE_STORES_V15: Record<string, string> = {
  active: 'recordId',
  activeGames: '[runId+gameNumber], runId',
  completed: 'recordId',
  history: 'recordId, completedAtIso',
  classicDrafts: 'recordId',
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
  havocActiveRuns: 'recordId',
  havocCommands: 'commandId, runId',
  havocGames: '[runId+variant+gameNumber], runId, [runId+variant]',
  havocRetainedTapes: '[runId+gameNumber], runId',
  havocCompletedRuns: 'runId',
  havocHistory: 'runId, updatedAtIso',
  havocMultiplayerActive: 'roomId',
  havocMultiplayerCommands: '[roomId+ordinal], roomId',
  havocMultiplayerResults: '[roomId+gameNumber], roomId',
  havocMultiplayerCompleted: 'roomId',
  havocMultiplayerHistory: 'recordId, completedAtIso',
  profiles: 'id',
  profileBindings: 'id',
  profileGames: 'id',
  profileSelection: 'id',
  archivedProfiles: 'id',
  havocLockedInputs: 'runId',
  capRushActive: 'recordId',
  capRushCommands: 'commandId, runId',
  capRushGames: '[runId+gameNumber], runId',
  capRushHistory: 'runId, completedAtIso',
  capRushReports: 'runId',
  capRushPlayoffGames: '[runId+gameId], runId',
  capRushLeagueGames: '[runId+gameId], runId',
  capRushLeagueAggregates: 'runId',
  capRushPlaybackEvidence: '[runId+gameKey], runId',
  capRushPlaybackCursors: '[runId+gameKey], runId',
  capRushMultiplayerActive: 'roomId',
  capRushMultiplayerCommands: '[roomId+ordinal], roomId',
  capRushMultiplayerGames: '[roomId+gameId], roomId',
  capRushMultiplayerCompleted: 'roomId',
  capRushMultiplayerHistory: 'recordId, completedAtIso',
};

/**
 * Version 16 adds Cap Rush's immutable locked-input
 * record and the compact league score rows; opening a version-15 database only
 * creates these tables and keeps every existing record.
 */
export const HOOP_RUSH_DATABASE_STORES_V16: Record<string, string> = {
  ...HOOP_RUSH_DATABASE_STORES_V15,
  capRushLockedInputs: 'runId',
  capRushLeagueResults: '[runId+gameId], runId',
};

/**
 * Version 17 adds the Full Court draft and its command receipts; opening a
 * version-16 database only creates these tables and keeps every existing record.
 */
export const HOOP_RUSH_DATABASE_STORES_V17: Record<string, string> = {
  ...HOOP_RUSH_DATABASE_STORES_V16,
  fullCourtDrafts: 'runId',
  fullCourtDraftCommands: '[runId+commandId], runId',
};

/**
 * Version 18 adds the Full Court season checkpoint and compact score rows;
 * opening a version-17 database only creates these tables and keeps every
 * existing record.
 */
export const HOOP_RUSH_DATABASE_STORES_V18: Record<string, string> = {
  ...HOOP_RUSH_DATABASE_STORES_V17,
  fullCourtSeasonCheckpoints: 'runId',
  fullCourtSeasonScores: '[runId+gameId], runId',
};

export const HOOP_RUSH_DATABASE_STORES: Record<string, string> = {
  ...HOOP_RUSH_DATABASE_STORES_V18,
  fullCourtPlayoffs: 'runId',
};

export class HoopRushDatabase extends Dexie {
  profiles!: EntityTable<PlayerProfile, 'id'>;
  archivedProfiles!: EntityTable<PlayerProfile, 'id'>;
  profileBindings!: EntityTable<ProfileBinding, 'id'>;
  profileGames!: EntityTable<ProfileGame, 'id'>;
  profileSelection!: EntityTable<ProfileSelection, 'id'>;
  active!: EntityTable<ActiveRunCheckpoint, 'recordId'>;
  activeGames!: Table<ActiveGameRow, [string, number]>;
  completed!: EntityTable<StoredRunRecord, 'recordId'>;
  history!: EntityTable<CompletedRunIndex, 'recordId'>;
  classicDrafts!: EntityTable<StoredClassicDraft, 'recordId'>;
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
  havocLockedInputs!: EntityTable<StoredHavocLockedInputs, 'runId'>;
  havocActiveRuns!: EntityTable<StoredHavocActiveRun, 'recordId'>;
  havocCommands!: EntityTable<StoredHavocCommandRow, 'commandId'>;
  havocGames!: Table<StoredHavocGameRow, [string, string, number]>;
  havocRetainedTapes!: Table<StoredHavocRetainedTape, [string, number]>;
  havocCompletedRuns!: EntityTable<StoredHavocCompletedRun, 'runId'>;
  havocHistory!: EntityTable<StoredHavocHistoryRow, 'runId'>;
  havocMultiplayerActive!: EntityTable<StoredHavocMultiplayerActive, 'roomId'>;
  havocMultiplayerCommands!: Table<StoredHavocMultiplayerCommandRow, [string, number]>;
  havocMultiplayerResults!: Table<StoredHavocMultiplayerResultRow, [string, number]>;
  havocMultiplayerCompleted!: EntityTable<StoredHavocMultiplayerCompleted, 'roomId'>;
  havocMultiplayerHistory!: EntityTable<StoredHavocMultiplayerHistoryIndex, 'recordId'>;
  capRushActive!: EntityTable<
    StoredCapRushLegacyDraftRow | StoredCapRushDraftProgressRow,
    'recordId'
  >;
  capRushCommands!: EntityTable<StoredCapRushCommandRow, 'commandId'>;
  capRushGames!: Table<StoredCapRushGameRow, [string, number]>;
  capRushHistory!: EntityTable<StoredCapRushHistoryRow, 'runId'>;
  capRushReports!: EntityTable<StoredCapRushReportRow, 'runId'>;
  capRushPlayoffGames!: Table<StoredCapRushPlayoffGameRow, [string, string]>;
  capRushLeagueGames!: Table<StoredCapRushLeagueGameRow, [string, string]>;
  capRushLockedInputs!: EntityTable<StoredCapRushLockedInputsRow, 'runId'>;
  capRushLeagueResults!: Table<StoredCapRushLeagueScoreRow, [string, string]>;
  capRushLeagueAggregates!: EntityTable<StoredCapRushLeagueAggregateRow, 'runId'>;
  capRushPlaybackEvidence!: Table<StoredCapRushPlaybackEvidenceRow, [string, string]>;
  capRushPlaybackCursors!: Table<StoredCapRushPlaybackCursorRow, [string, string]>;
  capRushMultiplayerActive!: EntityTable<StoredCapRushMultiplayerActiveRow, 'roomId'>;
  capRushMultiplayerCommands!: Table<StoredCapRushMultiplayerCommandRow, [string, number]>;
  capRushMultiplayerGames!: Table<StoredCapRushMultiplayerGameRow, [string, string]>;
  capRushMultiplayerCompleted!: EntityTable<StoredCapRushMultiplayerCompletedRow, 'roomId'>;
  capRushMultiplayerHistory!: EntityTable<StoredCapRushMultiplayerHistoryRow, 'recordId'>;
  fullCourtDrafts!: EntityTable<StoredFullCourtDraft, 'runId'>;
  fullCourtDraftCommands!: Table<StoredFullCourtDraftCommand, [string, string]>;
  fullCourtSeasonCheckpoints!: EntityTable<StoredFullCourtSeasonCheckpoint, 'runId'>;
  fullCourtSeasonScores!: Table<StoredFullCourtSeasonScore, [string, string]>;
  fullCourtPlayoffs!: EntityTable<StoredFullCourtPlayoffs, 'runId'>;
  constructor(name = HOOP_RUSH_DATABASE_NAME) {
    super(name);
    // Versions below 15 are unsupported and reset. Versions 15 through 18 keep
    // every record and only gain the tables and indexes added after them.
    this.version(15)
      .stores(HOOP_RUSH_DATABASE_STORES_V15)
      .upgrade((transaction) =>
        Dexie.Promise.all(
          Object.keys(HOOP_RUSH_DATABASE_STORES_V15)
            .filter((name) => transaction.storeNames.includes(name))
            .map((name) => transaction.table(name).clear()),
        ),
      );
    this.version(16).stores(HOOP_RUSH_DATABASE_STORES_V16);
    this.version(17).stores(HOOP_RUSH_DATABASE_STORES_V17);
    this.version(18).stores(HOOP_RUSH_DATABASE_STORES_V18);
    this.version(19).stores(HOOP_RUSH_DATABASE_STORES);
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
    await this.appendActiveGames([input]);
  }
  /**
   * Commits an ordered run of accepted games and the checkpoint they advance in
   * one transaction. Inputs must start at the next unplayed game so a batch can
   * never leave a gap or overwrite an earlier result.
   */
  async appendActiveGames(inputs: readonly ActiveGameAppend[]): Promise<void> {
    if (inputs.length === 0) return;
    const rows = inputs.map((input) =>
      activeGameRowSchema.parse({
        runId: input.runId,
        gameNumber: input.gameNumber,
        result: input.result,
      }),
    );
    const lastInput = inputs[inputs.length - 1];
    if (lastInput === undefined) return;
    const checkpointUpdate = activeRunCheckpointSchema
      .pick({ status: true, firstLossGameNumber: true, gamesPlayed: true, aggregates: true })
      .parse({ ...lastInput, gamesPlayed: lastInput.gameNumber });
    const updatedAtIso = new Date().toISOString();
    await this.db.transaction(
      'rw',
      [
        this.db.active,
        this.db.activeGames,
        this.db.profileBindings,
        this.db.profileGames,
        this.db.profiles,
        this.db.archivedProfiles,
      ],
      async () => {
        const checkpoint = await this.db.active.get(ACTIVE_RECORD_ID);
        if (checkpoint === undefined) {
          throw new Error('appendActiveGames: no active run checkpoint to update');
        }
        const { runId, gamesPlayed } = activeRunCheckpointSchema
          .pick({ recordId: true, saveSchemaVersion: true, runId: true, gamesPlayed: true })
          .parse(checkpoint);
        for (const row of rows) {
          if (row.runId !== runId) {
            throw new Error('appendActiveGames: runId does not match the active checkpoint');
          }
        }
        let expectedGameNumber = gamesPlayed + 1;
        for (const row of rows) {
          if (row.gameNumber !== expectedGameNumber) {
            throw new Error(
              `appendActiveGames: game ${String(row.gameNumber)} is out of order; expected ${String(expectedGameNumber)}`,
            );
          }
          expectedGameNumber += 1;
        }
        await this.db.activeGames.bulkPut(rows.map((row) => ({ ...row, updatedAtIso })));
        await this.db.active.put({ ...checkpoint, ...checkpointUpdate, updatedAtIso });
        const bindingId = `challenge:${runId}`;
        if (await this.db.profileBindings.get(bindingId)) {
          const profiles = new DexieProfileRepository(this.db);
          for (const row of rows) {
            await profiles.recordGame(bindingId, String(row.gameNumber), {
              won: row.result.winner === 'home',
              multiplayer: false,
              players: row.result.home.players,
            });
          }
        }
      },
    );
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
      [
        this.db.active,
        this.db.activeGames,
        this.db.completed,
        this.db.history,
        this.db.profileBindings,
        this.db.profileGames,
        this.db.profiles,
        this.db.archivedProfiles,
      ],
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
        const storedGamesPlayed = validatedCheckpoint.gamesPlayed;
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
        const bindingId = `challenge:${storedRun.runId}`;
        if (await this.db.profileBindings.get(bindingId)) {
          await new DexieProfileRepository(this.db).awardAchievements(
            bindingId,
            'season',
            evaluateRunAchievements(storedRun),
          );
        }
      },
    );
  }
  async listCompletedRuns(limit?: number): Promise<CompletedRunIndex[]> {
    const rows = await listCompletedHistory(this.db.history, 'completedAtIso', limit);
    return rows.map((row) => completedRunIndexSchema.parse(row));
  }
  async loadCompletedRun(runId: string): Promise<StoredRunRecord | null> {
    return getParsedRecord(this.db.completed, runId, (record) =>
      storedRunRecordSchema.parse(record),
    );
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
    return getParsedRecord(this.db.classicDrafts, CLASSIC_DRAFT_RECORD_ID, (record) =>
      classicDraftRecordSchema.parse(record),
    );
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
