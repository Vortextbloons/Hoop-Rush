import { FIXED_FIVE_ROOM_SCHEMA_VERSION, type FixedFiveCommand, type FixedFiveCompetitionRun, type FixedFiveRoomSnapshot, } from '@hoop-rush/data-contracts';
import { storedFixedFiveActiveSchema, storedFixedFiveCommandRowSchema, storedFixedFiveCompletedSchema, storedFixedFiveHistoryIndexSchema, storedFixedFivePendingResultSchema, type StoredFixedFiveActive, type StoredFixedFiveCompleted, type StoredFixedFiveHistoryIndex, type StoredFixedFivePendingResult, } from '../schemas/fixed-five-record.ts';
import type { HoopRushDatabase } from './dexie.ts';
export class DexieFixedFiveRepository {
    private readonly db: HoopRushDatabase;
    constructor(db: HoopRushDatabase) {
        this.db = db;
    }
    async saveActiveSnapshot(snapshot: FixedFiveRoomSnapshot, commandCursor: number): Promise<void> {
        const record: StoredFixedFiveActive = storedFixedFiveActiveSchema.parse({
            roomId: snapshot.roomId,
            saveSchemaVersion: FIXED_FIVE_ROOM_SCHEMA_VERSION,
            snapshot,
            commandCursor,
            updatedAtIso: new Date().toISOString(),
        });
        await this.db.fixedFiveActive.put(record);
    }
    async loadActive(roomId: string): Promise<StoredFixedFiveActive | null> {
        const record = await this.db.fixedFiveActive.get(roomId);
        if (!record)
            return null;
        return storedFixedFiveActiveSchema.parse(record);
    }
    async appendCommand(command: FixedFiveCommand): Promise<void> {
        const row = storedFixedFiveCommandRowSchema.parse({
            roomId: command.roomId,
            ordinal: command.ordinal,
            command,
            updatedAtIso: new Date().toISOString(),
        });
        await this.db.transaction('rw', this.db.fixedFiveActive, this.db.fixedFiveCommands, async () => {
            await this.db.fixedFiveCommands.put(row);
            const active = await this.db.fixedFiveActive.get(command.roomId);
            if (active) {
                await this.db.fixedFiveActive.put({
                    ...active,
                    commandCursor: Math.max(active.commandCursor, command.ordinal + 1),
                    updatedAtIso: new Date().toISOString(),
                });
            }
        });
    }
    async listCommands(roomId: string): Promise<FixedFiveCommand[]> {
        const rows = await this.db.fixedFiveCommands.where('roomId').equals(roomId).sortBy('ordinal');
        return rows.map((row) => storedFixedFiveCommandRowSchema.parse(row).command);
    }
    async savePendingResult(roomId: string, run: FixedFiveCompetitionRun, proposer: 'p1' | 'p2'): Promise<void> {
        const record: StoredFixedFivePendingResult = storedFixedFivePendingResultSchema.parse({
            roomId,
            saveSchemaVersion: FIXED_FIVE_ROOM_SCHEMA_VERSION,
            run,
            proposer,
            updatedAtIso: new Date().toISOString(),
        });
        await this.db.fixedFivePendingResults.put(record);
    }
    async loadPendingResult(roomId: string): Promise<StoredFixedFivePendingResult | null> {
        const record = await this.db.fixedFivePendingResults.get(roomId);
        if (!record)
            return null;
        return storedFixedFivePendingResultSchema.parse(record);
    }
    async clearPendingResult(roomId: string): Promise<void> {
        await this.db.fixedFivePendingResults.delete(roomId);
    }
    async promoteToCompleted(roomId: string, run: FixedFiveCompetitionRun): Promise<void> {
        const completedAtIso = new Date().toISOString();
        const completed: StoredFixedFiveCompleted = storedFixedFiveCompletedSchema.parse({
            roomId,
            saveSchemaVersion: FIXED_FIVE_ROOM_SCHEMA_VERSION,
            run,
            completedAtIso,
        });
        const index: StoredFixedFiveHistoryIndex = storedFixedFiveHistoryIndexSchema.parse({
            recordId: roomId,
            runId: run.runId,
            roomId,
            mode: run.mode,
            competition: run.competition,
            winner: run.result.competition === 'shared-82'
                ? (run.result.ranking[0] ?? 'p1')
                : run.result.winner,
            completedAtIso,
        });
        await this.db.transaction('rw', this.db.fixedFiveActive, this.db.fixedFiveCommands, this.db.fixedFivePendingResults, this.db.fixedFiveCompleted, this.db.fixedFiveHistory, async () => {
            await this.db.fixedFiveCompleted.put(completed);
            await this.db.fixedFiveHistory.put(index);
            await this.db.fixedFivePendingResults.delete(roomId);
            await this.db.fixedFiveActive.delete(roomId);
            await this.db.fixedFiveCommands.where('roomId').equals(roomId).delete();
        });
    }
    async loadCompleted(roomId: string): Promise<StoredFixedFiveCompleted | null> {
        const record = await this.db.fixedFiveCompleted.get(roomId);
        if (!record)
            return null;
        return storedFixedFiveCompletedSchema.parse(record);
    }
    async listHistory(): Promise<StoredFixedFiveHistoryIndex[]> {
        const rows = await this.db.fixedFiveHistory.orderBy('completedAtIso').reverse().toArray();
        return rows.map((row) => storedFixedFiveHistoryIndexSchema.parse(row));
    }
}
