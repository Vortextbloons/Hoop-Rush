import Dexie, { type EntityTable, type Table, type Transaction } from 'dexie';
import type {
  PlayerProfile,
  ProfileBinding,
  ProfileGame,
  ProfileSelection,
} from '@hoop-rush/data-contracts';
import { CAP_RUSH_SAVE_SCHEMA_VERSION, SAVE_SCHEMA_VERSION } from '@hoop-rush/data-contracts';
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
  CAP_RUSH_ACTIVE_DRAFT_RECORD_ID,
  capRushPlaybackGameKey,
  type StoredCapRushCommandRow,
  type StoredCapRushDraftRow,
  type StoredCapRushGameRow,
  type StoredCapRushHistoryRow,
  type StoredCapRushLeagueGameRow,
  type StoredCapRushPlaybackCursorRow,
  type StoredCapRushPlaybackEvidenceRow,
  type StoredCapRushPlayoffGameRow,
  type StoredCapRushReportRow,
} from '../schemas/cap-rush-record.ts';
import { listCompletedHistory } from './support.ts';
import { DexieProfileRepository } from './profile.ts';
const ACTIVE_RECORD_ID = 'active';
const CLASSIC_DRAFT_RECORD_ID = 'classic-draft';

export const HOOP_RUSH_DATABASE_NAME = 'hoop-rush-saves-v2';

export const HOOP_RUSH_DATABASE_STORES: Record<string, string> = {
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
};

export const HOOP_RUSH_DATABASE_V2_STORES: Record<string, string> = {
  havocMultiplayerActive: 'roomId',
  havocMultiplayerCommands: '[roomId+ordinal], roomId',
  havocMultiplayerResults: '[roomId+gameNumber], roomId',
  havocMultiplayerCompleted: 'roomId',
  havocMultiplayerHistory: 'recordId, completedAtIso',
};

const COLLECTION_STORE_PREFIX = 'collection';
const SEASON_LEGACY_STORE_PREFIX = 'season';

export const HOOP_RUSH_DATABASE_V3_STORES: Record<string, string> = Object.fromEntries(
  Object.entries({ ...HOOP_RUSH_DATABASE_STORES, ...HOOP_RUSH_DATABASE_V2_STORES }).filter(
    ([name]) =>
      !name.startsWith(COLLECTION_STORE_PREFIX) && !name.startsWith(SEASON_LEGACY_STORE_PREFIX),
  ),
);
export const HOOP_RUSH_DATABASE_V4_STORES: Record<string, string> = {
  ...HOOP_RUSH_DATABASE_V3_STORES,
  profiles: 'id',
  profileBindings: 'id',
  profileGames: 'id',
  profileSelection: 'id',
};
export const HOOP_RUSH_DATABASE_V5_STORES: Record<string, string> = {
  ...HOOP_RUSH_DATABASE_V4_STORES,
  archivedProfiles: 'id',
};
export const HOOP_RUSH_DATABASE_V6_STORES: Record<string, string> = {
  ...HOOP_RUSH_DATABASE_V5_STORES,
  havocLockedInputs: 'runId',
};
export const HOOP_RUSH_DATABASE_V7_STORES: Record<string, string> = {
  ...HOOP_RUSH_DATABASE_V6_STORES,
  capRushActive: 'recordId',
  capRushCommands: 'commandId, runId',
};
export const HOOP_RUSH_DATABASE_V8_STORES: Record<string, string> = {
  ...HOOP_RUSH_DATABASE_V7_STORES,
  capRushGames: '[runId+gameNumber], runId',
  capRushHistory: 'runId, completedAtIso',
  capRushReports: 'runId',
};
export const HOOP_RUSH_DATABASE_V9_STORES: Record<string, string> = {
  ...HOOP_RUSH_DATABASE_V8_STORES,
  capRushPlayoffGames: '[runId+gameId], runId',
};
export const HOOP_RUSH_DATABASE_V10_STORES: Record<string, string> = {
  ...HOOP_RUSH_DATABASE_V9_STORES,
  capRushLeagueGames: '[runId+gameId], runId',
};
export const HOOP_RUSH_DATABASE_V11_STORES: Record<string, string> = Object.fromEntries(
  Object.entries(HOOP_RUSH_DATABASE_V10_STORES).filter(
    ([name]) => !name.startsWith(SEASON_LEGACY_STORE_PREFIX),
  ),
);
export const HOOP_RUSH_DATABASE_V13_STORES: Record<string, string> = {
  ...HOOP_RUSH_DATABASE_V11_STORES,
  capRushPlaybackEvidence: '[runId+gameKey], runId',
  capRushPlaybackCursors: '[runId+gameKey], runId',
};

async function migrateActiveCapRushPlayback(tx: Transaction): Promise<void> {
  const active: unknown = await tx.table('capRushActive').get(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID);
  const runId =
    typeof active === 'object' && active !== null && 'runId' in active
      ? (active as { runId?: unknown }).runId
      : undefined;
  if (typeof runId !== 'string') return;
  const evidence = tx.table('capRushPlaybackEvidence');
  const cursors = tx.table('capRushPlaybackCursors');
  const moveRows = async (
    tableName: 'capRushGames' | 'capRushPlayoffGames',
    gameOf: (row: Record<string, unknown>) => number | string | undefined,
  ): Promise<void> => {
    const table = tx.table(tableName);
    const rows: unknown[] = await table.where('runId').equals(runId).toArray();
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const record = row as Record<string, unknown>;
      const game = record.game;
      if (typeof game !== 'object' || game === null) continue;
      const playback = (game as { playback?: unknown }).playback;
      if (typeof playback !== 'object' || playback === null) continue;
      const gameId = gameOf(record);
      if (gameId === undefined) continue;
      const gameKey = capRushPlaybackGameKey(gameId);
      const updatedAtIso =
        typeof record.updatedAtIso === 'string' ? record.updatedAtIso : new Date().toISOString();
      const playbackRecord = playback as Record<string, unknown>;
      const cursor = typeof playbackRecord.cursor === 'number' ? playbackRecord.cursor : 0;
      const tape = playbackRecord.tape as { events?: unknown[]; scoring?: unknown[] } | undefined;
      const total = (tape?.events?.length ?? 0) + (tape?.scoring?.length ?? 0);
      await evidence.put({
        saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
        runId,
        gameKey,
        playback: { ...playbackRecord, cursor: 0 },
        updatedAtIso,
      });
      await cursors.put({
        saveSchemaVersion: CAP_RUSH_SAVE_SCHEMA_VERSION,
        runId,
        gameKey,
        cursor,
        total,
        updatedAtIso,
      });
      const { playback: _removed, ...gameWithoutPlayback } = game as Record<string, unknown>;
      await table.put({ ...record, game: gameWithoutPlayback });
    }
  };
  await moveRows('capRushGames', (row) =>
    typeof row.gameNumber === 'number' ? row.gameNumber : undefined,
  );
  await moveRows('capRushPlayoffGames', (row) =>
    typeof row.gameId === 'string' ? row.gameId : undefined,
  );
}
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
  capRushActive!: EntityTable<StoredCapRushDraftRow, 'recordId'>;
  capRushCommands!: EntityTable<StoredCapRushCommandRow, 'commandId'>;
  capRushGames!: Table<StoredCapRushGameRow, [string, number]>;
  capRushHistory!: EntityTable<StoredCapRushHistoryRow, 'runId'>;
  capRushReports!: EntityTable<StoredCapRushReportRow, 'runId'>;
  capRushPlayoffGames!: Table<StoredCapRushPlayoffGameRow, [string, string]>;
  capRushLeagueGames!: Table<StoredCapRushLeagueGameRow, [string, string]>;
  capRushPlaybackEvidence!: Table<StoredCapRushPlaybackEvidenceRow, [string, string]>;
  capRushPlaybackCursors!: Table<StoredCapRushPlaybackCursorRow, [string, string]>;
  constructor(name = HOOP_RUSH_DATABASE_NAME) {
    super(name);
    this.version(1).stores(HOOP_RUSH_DATABASE_STORES);
    this.version(2).stores(HOOP_RUSH_DATABASE_V2_STORES);
    this.version(3).stores(HOOP_RUSH_DATABASE_V3_STORES);
    this.version(4).stores(HOOP_RUSH_DATABASE_V4_STORES);
    this.version(5).stores(HOOP_RUSH_DATABASE_V5_STORES);
    this.version(6).stores(HOOP_RUSH_DATABASE_V6_STORES);
    this.version(7).stores(HOOP_RUSH_DATABASE_V7_STORES);
    this.version(8).stores(HOOP_RUSH_DATABASE_V8_STORES);
    this.version(9).stores(HOOP_RUSH_DATABASE_V9_STORES);
    this.version(10).stores(HOOP_RUSH_DATABASE_V10_STORES);
    this.version(11).stores(HOOP_RUSH_DATABASE_V11_STORES);
    this.version(12).stores(HOOP_RUSH_DATABASE_V11_STORES);
    this.version(13)
      .stores(HOOP_RUSH_DATABASE_V13_STORES)
      .upgrade((tx) => migrateActiveCapRushPlayback(tx));
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
          throw new Error('appendActiveGame: no active run checkpoint to update');
        }
        if (checkpoint.runId !== row.runId) {
          throw new Error('appendActiveGame: runId does not match the active checkpoint');
        }
        await this.db.activeGames.put({ ...row, updatedAtIso });
        await this.db.active.put({ ...checkpoint, ...checkpointUpdate, updatedAtIso });
        const bindingId = `challenge:${row.runId}`;
        if (await this.db.profileBindings.get(bindingId)) {
          await new DexieProfileRepository(this.db).recordGame(bindingId, String(row.gameNumber), {
            won: row.result.winner === 'home',
            multiplayer: false,
            players: row.result.home.players,
          });
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
