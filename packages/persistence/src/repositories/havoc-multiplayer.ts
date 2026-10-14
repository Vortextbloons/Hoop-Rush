import {
  HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
  havocMultiplayerCommandSchema,
  havocMultiplayerVerificationReceiptSchema,
  type HavocMultiplayerCommand,
  type HavocMultiplayerVerificationReceipt,
} from '@hoop-rush/data-contracts';
import {
  havocMultiplayerCompletionRecapSchema,
  havocMultiplayerGameOutputSchema,
  storedHavocMultiplayerActiveSchema,
  storedHavocMultiplayerCommandRowSchema,
  storedHavocMultiplayerCompletedSchema,
  storedHavocMultiplayerHistoryIndexSchema,
  storedHavocMultiplayerResultRowSchema,
  type HavocMultiplayerActiveState,
  type HavocMultiplayerCommandEntry,
  type HavocMultiplayerCompletionRecap,
  type HavocMultiplayerGameOutput,
  type StoredHavocMultiplayerActive,
  type StoredHavocMultiplayerCommandRow,
  type StoredHavocMultiplayerCompleted,
  type StoredHavocMultiplayerHistoryIndex,
  type StoredHavocMultiplayerResultRow,
} from '../schemas/havoc-multiplayer-record.ts';
import { HoopRushDatabase } from './dexie.ts';
import {
  commandReceiptMatches,
  deleteWhereEquals,
  listCompletedHistory,
  rowsWhereEquals,
} from './support.ts';

function commandRowMatches(
  stored: StoredHavocMultiplayerCommandRow,
  incoming: StoredHavocMultiplayerCommandRow,
): boolean {
  return commandReceiptMatches(
    {
      commandId: stored.commandId,
      actorParticipantId: stored.actorParticipantId,
      payload: stored.payload,
    },
    {
      commandId: incoming.commandId,
      actorParticipantId: incoming.actorParticipantId,
      payload: incoming.payload,
    },
  );
}

export class DexieHavocMultiplayerRepository {
  private readonly db: HoopRushDatabase;
  constructor(db: HoopRushDatabase) {
    this.db = db;
  }
  async saveActive(state: HavocMultiplayerActiveState): Promise<void> {
    const record: StoredHavocMultiplayerActive = storedHavocMultiplayerActiveSchema.parse({
      ...state,
      saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      updatedAtIso: new Date().toISOString(),
    });
    await this.db.havocMultiplayerActive.put(record);
  }
  async loadActive(roomId: string): Promise<StoredHavocMultiplayerActive | null> {
    const record = await this.db.havocMultiplayerActive.get(roomId);
    if (record === undefined) return null;
    return storedHavocMultiplayerActiveSchema.parse(record);
  }
  async deleteActive(roomId: string): Promise<void> {
    await this.db.havocMultiplayerActive.delete(roomId);
  }
  async appendCommands(
    roomId: string,
    entries: readonly HavocMultiplayerCommandEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const storedAtIso = new Date().toISOString();
    const rows = entries
      .map((entry) => {
        if (entry.command.roomId !== roomId) {
          throw new Error(
            `appendCommands: command ${String(entry.command.commandId)} does not belong to room ${roomId}`,
          );
        }
        return storedHavocMultiplayerCommandRowSchema.parse({
          saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
          roomId,
          ordinal: entry.ordinal,
          commandId: entry.command.commandId,
          actorParticipantId: entry.command.actorParticipantId,
          payload: entry.command.payload,
          storedAtIso,
        });
      })
      .sort((a, b) => a.ordinal - b.ordinal);
    await this.db.transaction('rw', this.db.havocMultiplayerCommands, async () => {
      const existingRows = await rowsWhereEquals(
        this.db.havocMultiplayerCommands,
        'roomId',
        roomId,
      );
      const byOrdinal = new Map<number, StoredHavocMultiplayerCommandRow>();
      const byCommandId = new Map<string, StoredHavocMultiplayerCommandRow>();
      for (const existing of existingRows) {
        const parsed = storedHavocMultiplayerCommandRowSchema.parse(existing);
        byOrdinal.set(parsed.ordinal, parsed);
        byCommandId.set(parsed.commandId, parsed);
      }
      for (const row of rows) {
        const sameCommand = byCommandId.get(row.commandId);
        if (sameCommand !== undefined) {
          if (commandRowMatches(sameCommand, row)) continue;
          throw new Error(
            `appendCommands: conflicting command ${String(row.commandId)} in room ${roomId}`,
          );
        }
        const sameOrdinal = byOrdinal.get(row.ordinal);
        if (sameOrdinal !== undefined) {
          if (commandRowMatches(sameOrdinal, row)) continue;
          throw new Error(
            `appendCommands: conflicting command at ordinal ${String(row.ordinal)} in room ${roomId}`,
          );
        }
        await this.db.havocMultiplayerCommands.put(row);
        byOrdinal.set(row.ordinal, row);
        byCommandId.set(row.commandId, row);
      }
    });
  }
  async loadCommands(roomId: string): Promise<HavocMultiplayerCommand[]> {
    const rows = await this.db.havocMultiplayerCommands
      .where('roomId')
      .equals(roomId)
      .sortBy('ordinal');
    return rows.map((row) => {
      const parsed = storedHavocMultiplayerCommandRowSchema.parse(row);
      return havocMultiplayerCommandSchema.parse({
        schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
        commandId: parsed.commandId,
        roomId: parsed.roomId,
        actorParticipantId: parsed.actorParticipantId,
        payload: parsed.payload,
      });
    });
  }
  async saveResult(output: HavocMultiplayerGameOutput): Promise<void> {
    const validated = havocMultiplayerGameOutputSchema.parse(output);
    const key: [string, number] = [validated.roomId, validated.gameNumber];
    await this.db.transaction('rw', this.db.havocMultiplayerResults, async () => {
      const existing = await this.db.havocMultiplayerResults.get(key);
      const verified =
        existing === undefined
          ? false
          : storedHavocMultiplayerResultRowSchema.parse(existing).verified;
      const row: StoredHavocMultiplayerResultRow = storedHavocMultiplayerResultRowSchema.parse({
        saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
        roomId: validated.roomId,
        gameNumber: validated.gameNumber,
        winner: validated.winner,
        result: validated.result,
        tape: validated.tape,
        inputDigest: validated.inputDigest,
        resultDigest: validated.resultDigest,
        tapeDigest: validated.tapeDigest,
        verified,
        storedAtIso: new Date().toISOString(),
      });
      await this.db.havocMultiplayerResults.put(row);
    });
  }
  async loadResults(roomId: string): Promise<StoredHavocMultiplayerResultRow[]> {
    const rows = await this.db.havocMultiplayerResults
      .where('roomId')
      .equals(roomId)
      .sortBy('gameNumber');
    return rows.map((row) => storedHavocMultiplayerResultRowSchema.parse(row));
  }
  async saveVerification(
    roomId: string,
    entries: readonly HavocMultiplayerVerificationReceipt[],
  ): Promise<void> {
    const verification = havocMultiplayerVerificationReceiptSchema.array().parse(entries);
    await this.db.transaction(
      'rw',
      this.db.havocMultiplayerActive,
      this.db.havocMultiplayerResults,
      async () => {
        const active = await this.db.havocMultiplayerActive.get(roomId);
        if (active !== undefined) {
          const parsed = storedHavocMultiplayerActiveSchema.parse(active);
          await this.db.havocMultiplayerActive.put({
            ...parsed,
            verification,
            updatedAtIso: new Date().toISOString(),
          });
        }
        const verifiedDigests = new Set(verification.map((entry) => entry.resultDigest));
        const rows = await rowsWhereEquals(this.db.havocMultiplayerResults, 'roomId', roomId);
        for (const row of rows) {
          const parsedRow = storedHavocMultiplayerResultRowSchema.parse(row);
          const verified = verifiedDigests.has(parsedRow.resultDigest);
          if (parsedRow.verified === verified) continue;
          await this.db.havocMultiplayerResults.put({ ...parsedRow, verified });
        }
      },
    );
  }
  async complete(recap: HavocMultiplayerCompletionRecap): Promise<void> {
    const validated = havocMultiplayerCompletionRecapSchema.parse(recap);
    const completedAtIso = new Date().toISOString();
    const completed: StoredHavocMultiplayerCompleted = storedHavocMultiplayerCompletedSchema.parse({
      saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      roomId: validated.roomId,
      champion: validated.champion,
      series: validated.series,
      mvp: validated.mvp,
      games: validated.games,
      completedAtIso,
    });
    const index: StoredHavocMultiplayerHistoryIndex =
      storedHavocMultiplayerHistoryIndexSchema.parse({
        saveSchemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
        recordId: `hvm-${validated.roomId}`,
        roomId: validated.roomId,
        championParticipantId: validated.champion,
        wins: validated.series.wins[validated.champion],
        completedAtIso,
      });
    await this.db.transaction(
      'rw',
      this.db.havocMultiplayerActive,
      this.db.havocMultiplayerCommands,
      this.db.havocMultiplayerCompleted,
      this.db.havocMultiplayerHistory,
      async () => {
        await this.db.havocMultiplayerCompleted.put(completed);
        await this.db.havocMultiplayerHistory.put(index);
        await this.db.havocMultiplayerActive.delete(validated.roomId);
        await deleteWhereEquals(this.db.havocMultiplayerCommands, 'roomId', validated.roomId);
      },
    );
  }
  async loadCompleted(roomId: string): Promise<StoredHavocMultiplayerCompleted | null> {
    const record = await this.db.havocMultiplayerCompleted.get(roomId);
    if (record === undefined) return null;
    return storedHavocMultiplayerCompletedSchema.parse(record);
  }
  async listHistory(): Promise<StoredHavocMultiplayerHistoryIndex[]> {
    return listCompletedHistory(this.db.havocMultiplayerHistory);
  }
  async deleteCompleted(roomId: string): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.havocMultiplayerCompleted,
      this.db.havocMultiplayerHistory,
      this.db.havocMultiplayerResults,
      async () => {
        await this.db.havocMultiplayerCompleted.delete(roomId);
        await this.db.havocMultiplayerHistory.delete(`hvm-${roomId}`);
        await deleteWhereEquals(this.db.havocMultiplayerResults, 'roomId', roomId);
      },
    );
  }
}
export type HavocMultiplayerRepository = DexieHavocMultiplayerRepository;
