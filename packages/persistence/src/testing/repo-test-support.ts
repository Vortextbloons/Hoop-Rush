import Dexie, { type EntityTable, type Table } from 'dexie';
import { IDBFactory } from 'fake-indexeddb';
import type { StoredClassicDraft } from '../schemas/classic-draft-record.ts';
import type { StoredSeasonDraft } from '../schemas/season-draft-record.ts';
import type { StoredSeasonAcceptedBlockRow, StoredSeasonActiveRunIndex, StoredSeasonAlmanacRow, StoredSeasonCommandLogRow, StoredSeasonCompletedIndex, StoredSeasonCompletedRunRow, StoredSeasonDetailRow, StoredSeasonPendingBlockRow, StoredSeasonPlayerSliceRow, StoredSeasonPostseasonDetailRow, StoredSeasonPostseasonSummaryRow, StoredSeasonRunRecord, StoredSeasonSummaryRow, } from '../schemas/season-run-record.ts';
import type { StoredSeasonRoomState } from '../schemas/season-room-state.ts';
import type { ActiveGameRow, ActiveRunCheckpoint, CompletedRunIndex, StoredRunRecord, } from '../schemas/run-record.ts';
export class TestDatabase extends Dexie {
    active!: EntityTable<ActiveRunCheckpoint, 'recordId'>;
    activeGames!: Table<ActiveGameRow, [
        string,
        number
    ]>;
    completed!: EntityTable<StoredRunRecord, 'recordId'>;
    history!: EntityTable<CompletedRunIndex, 'recordId'>;
    classicDrafts!: EntityTable<StoredClassicDraft, 'recordId'>;
    seasonDrafts!: EntityTable<StoredSeasonDraft, 'recordId'>;
    seasonRuns!: EntityTable<StoredSeasonRunRecord, 'recordId'>;
    seasonRunSummaries!: Table<StoredSeasonSummaryRow, [
        string,
        string
    ]>;
    seasonRunDetails!: Table<StoredSeasonDetailRow, [
        string,
        string
    ]>;
    seasonRunBlocks!: Table<StoredSeasonAcceptedBlockRow, [
        string,
        number
    ]>;
    seasonRunIndex!: EntityTable<StoredSeasonActiveRunIndex, 'recordId'>;
    seasonPendingBlocks!: EntityTable<StoredSeasonPendingBlockRow, 'runId'>;
    seasonPostseasonSummaries!: Table<StoredSeasonPostseasonSummaryRow, [
        string,
        string
    ]>;
    seasonPostseasonDetails!: Table<StoredSeasonPostseasonDetailRow, [
        string,
        string
    ]>;
    seasonCommandLog!: Table<StoredSeasonCommandLogRow, [
        string,
        number
    ]>;
    seasonAlmanacs!: EntityTable<StoredSeasonAlmanacRow, 'runId'>;
    seasonCompletedRuns!: EntityTable<StoredSeasonCompletedRunRow, 'runId'>;
    seasonCompletedIndex!: EntityTable<StoredSeasonCompletedIndex, 'recordId'>;
    seasonRunPlayerSlices!: EntityTable<StoredSeasonPlayerSliceRow, 'runId'>;
    seasonRoomStates!: EntityTable<StoredSeasonRoomState, 'roomId'>;
    constructor(name: string) {
        super(name);
        this.version(1).stores({ active: 'recordId', completed: 'recordId', history: 'recordId' });
        this.version(2).stores({
            active: 'recordId',
            activeGames: '[runId+gameNumber], runId',
            completed: 'recordId',
            history: 'recordId',
        });
        this.version(3).stores({ history: 'recordId, completedAtIso' });
        this.version(4).stores({ classicDrafts: 'recordId' });
        this.version(5).stores({ seasonDrafts: 'recordId' });
        this.version(6).stores({
            seasonRuns: 'recordId',
            seasonRunSummaries: '[runId+gameId], runId, blockIndex',
            seasonRunDetails: '[runId+gameId], runId',
            seasonRunBlocks: '[runId+blockIndex], runId',
            seasonRunIndex: 'recordId',
        });
        this.version(7).stores({ seasonPendingBlocks: 'runId' });
        this.version(8).stores({
            seasonPostseasonSummaries: '[runId+gameId], runId',
            seasonCommandLog: '[runId+ordinal], runId',
            seasonAlmanacs: 'runId',
            seasonCompletedRuns: 'runId',
            seasonCompletedIndex: 'recordId, completedAtIso',
        });
        this.version(9).stores({
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
        });
        this.version(10).stores({
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
        });
        this.version(11).stores({
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
        });
        this.version(12).stores({
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
            seasonRoomStates: 'roomId',
        });
        this.version(13).stores({
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
            seasonRoomStates: 'roomId',
        });
    }
}
let previousFactory: IDBFactory | null = null;
export function resetIndexedDb(): void {
    if (previousFactory === null) {
        previousFactory = globalThis.indexedDB;
    }
    const factory = new IDBFactory();
    globalThis.indexedDB = factory;
    Dexie.dependencies.indexedDB = factory;
}
export function restoreIndexedDb(): void {
    if (previousFactory !== null) {
        globalThis.indexedDB = previousFactory;
        Dexie.dependencies.indexedDB = previousFactory;
        previousFactory = null;
    }
}
let databaseNameCounter = 0;
export function testDatabaseName(filePrefix: string): string {
    databaseNameCounter += 1;
    return `test-${filePrefix}-${String(databaseNameCounter)}`;
}
