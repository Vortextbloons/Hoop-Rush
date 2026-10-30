import {
  draftDuelGameOutputSchema,
  draftDuelPartiallyVerifiedSchema,
  type DraftDuelCommand,
  type DraftDuelGameOutput,
  type DraftDuelPartiallyVerified,
} from '@hoop-rush/data-contracts';
import {
  DRAFT_DUEL_SAVE_SCHEMA_VERSION,
  draftDuelCompletionRecapSchema,
  storedDraftDuelActiveSchema,
  storedDraftDuelCommandRowSchema,
  storedDraftDuelCompletedSchema,
  storedDraftDuelHistoryIndexSchema,
  storedDraftDuelResultRowSchema,
  type DraftDuelActiveState,
  type DraftDuelCompletionRecap,
  type StoredDraftDuelActive,
  type StoredDraftDuelCompleted,
  type StoredDraftDuelHistoryIndex,
  type StoredDraftDuelResultRow,
} from '../schemas/draft-duel-record.ts';
import { HoopRushDatabase } from './dexie.ts';
import { DexieProfileRepository } from './profile.ts';
import {
  commandReceiptMatches,
  commandRowsToAppend,
  deleteWhereEquals,
  listCompletedHistory,
  putResultPreservingVerified,
  rowsWhereEquals,
} from './support.ts';
export class DexieDraftDuelRepository {
  private readonly db: HoopRushDatabase;
  constructor(db: HoopRushDatabase) {
    this.db = db;
  }
  async saveActive(state: DraftDuelActiveState): Promise<void> {
    const record: StoredDraftDuelActive = storedDraftDuelActiveSchema.parse({
      ...state,
      saveSchemaVersion: DRAFT_DUEL_SAVE_SCHEMA_VERSION,
      updatedAtIso: new Date().toISOString(),
    });
    await this.db.draftDuelActive.put(record);
  }
  async loadActive(roomId: string): Promise<StoredDraftDuelActive | null> {
    const record = await this.db.draftDuelActive.get(roomId);
    if (record === undefined) return null;
    return storedDraftDuelActiveSchema.parse(record);
  }
  async deleteActive(roomId: string): Promise<void> {
    await this.db.draftDuelActive.delete(roomId);
  }
  async appendCommands(roomId: string, commands: readonly DraftDuelCommand[]): Promise<void> {
    if (commands.length === 0) return;
    const updatedAtIso = new Date().toISOString();
    const rows = commands
      .map((command) => {
        if (command.roomId !== roomId) {
          throw new Error(
            `appendCommands: command ${String(command.commandId)} does not belong to room ${roomId}`,
          );
        }
        return storedDraftDuelCommandRowSchema.parse({
          saveSchemaVersion: DRAFT_DUEL_SAVE_SCHEMA_VERSION,
          roomId,
          ordinal: command.ordinal,
          command,
          updatedAtIso,
        });
      })
      .sort((a, b) => a.ordinal - b.ordinal);
    await this.db.transaction('rw', this.db.draftDuelCommands, async () => {
      const existingRows = await rowsWhereEquals(this.db.draftDuelCommands, 'roomId', roomId);
      const append = commandRowsToAppend({
        existing: existingRows.map((row) => storedDraftDuelCommandRowSchema.parse(row)),
        incoming: rows,
        ordinalOf: (row) => row.ordinal,
        matches: (stored, incoming) => commandReceiptMatches(stored.command, incoming.command),
        conflict: (_kind, row) =>
          new Error(
            `appendCommands: conflicting command at ordinal ${String(row.ordinal)} in room ${roomId}`,
          ),
      });
      for (const row of append) await this.db.draftDuelCommands.put(row);
    });
  }
  async loadCommands(roomId: string): Promise<DraftDuelCommand[]> {
    const rows = await this.db.draftDuelCommands.where('roomId').equals(roomId).sortBy('ordinal');
    return rows.map((row) => storedDraftDuelCommandRowSchema.parse(row).command);
  }
  async saveResult(output: DraftDuelGameOutput): Promise<void> {
    const validated = draftDuelGameOutputSchema.parse(output);
    const key: [string, number] = [validated.roomId, validated.gameNumber];
    await this.db.transaction('rw', this.db.draftDuelResults, async () => {
      await putResultPreservingVerified({
        table: this.db.draftDuelResults,
        key,
        parse: (row) => storedDraftDuelResultRowSchema.parse(row),
        build: (verified) =>
          storedDraftDuelResultRowSchema.parse({
            saveSchemaVersion: DRAFT_DUEL_SAVE_SCHEMA_VERSION,
            roomId: validated.roomId,
            gameNumber: validated.gameNumber,
            output: validated,
            verified,
            storedAtIso: new Date().toISOString(),
          }),
      });
    });
  }
  async loadResults(roomId: string): Promise<StoredDraftDuelResultRow[]> {
    const rows = await this.db.draftDuelResults.where('roomId').equals(roomId).sortBy('gameNumber');
    return rows.map((row) => storedDraftDuelResultRowSchema.parse(row));
  }
  async saveVerification(
    roomId: string,
    entries: readonly DraftDuelPartiallyVerified[],
  ): Promise<void> {
    const verification = draftDuelPartiallyVerifiedSchema.array().parse(entries);
    await this.db.transaction(
      'rw',
      [this.db.draftDuelActive, this.db.draftDuelResults],
      async () => {
        const active = await this.db.draftDuelActive.get(roomId);
        if (active !== undefined) {
          const parsed = storedDraftDuelActiveSchema.parse(active);
          await this.db.draftDuelActive.put({
            ...parsed,
            verification,
            updatedAtIso: new Date().toISOString(),
          });
        }
        for (const entry of verification) {
          const row = await this.db.draftDuelResults.get([roomId, entry.gameNumber]);
          if (row === undefined) continue;
          const parsedRow = storedDraftDuelResultRowSchema.parse(row);
          const verified = entry.status === 'verified';
          if (parsedRow.verified === verified) continue;
          await this.db.draftDuelResults.put({ ...parsedRow, verified });
        }
      },
    );
  }
  async complete(recap: DraftDuelCompletionRecap): Promise<void> {
    const validated = draftDuelCompletionRecapSchema.parse(recap);
    const completedAtIso = new Date().toISOString();
    const completed: StoredDraftDuelCompleted = storedDraftDuelCompletedSchema.parse({
      saveSchemaVersion: DRAFT_DUEL_SAVE_SCHEMA_VERSION,
      roomId: validated.roomId,
      champion: validated.champion,
      series: validated.series,
      mvp: validated.mvp,
      standouts: validated.standouts,
      games: validated.games,
      completedAtIso,
    });
    const index: StoredDraftDuelHistoryIndex = storedDraftDuelHistoryIndexSchema.parse({
      saveSchemaVersion: DRAFT_DUEL_SAVE_SCHEMA_VERSION,
      recordId: `dd-${validated.roomId}`,
      roomId: validated.roomId,
      champion: validated.champion,
      gameCount: validated.games,
      completedAtIso,
    });
    await this.db.transaction(
      'rw',
      [
        this.db.draftDuelActive,
        this.db.draftDuelCommands,
        this.db.draftDuelCompleted,
        this.db.draftDuelHistory,
        this.db.draftDuelResults,
        this.db.profileBindings,
        this.db.profileGames,
        this.db.profiles,
        this.db.archivedProfiles,
      ],
      async () => {
        const active = await this.db.draftDuelActive.get(validated.roomId);
        const bindingId = `draft-duel:${validated.roomId}`;
        if (active && (await this.db.profileBindings.get(bindingId))) {
          const participant = storedDraftDuelActiveSchema.parse(active).localParticipantId;
          const profileRepo = new DexieProfileRepository(this.db);
          for (const game of validated.series.games) {
            const row = await this.db.draftDuelResults.get([validated.roomId, game.gameNumber]);
            const output = row ? storedDraftDuelResultRowSchema.parse(row).output : null;
            const side = game.homeParticipantId === participant ? 'home' : 'away';
            await profileRepo.recordGame(bindingId, String(game.gameNumber), {
              won: game.winner === participant,
              multiplayer: true,
              players: output?.result[side].players ?? [],
            });
          }
          await profileRepo.recordMatch(bindingId, validated.champion === participant);
        }
        await this.db.draftDuelCompleted.put(completed);
        await this.db.draftDuelHistory.put(index);
        await this.db.draftDuelActive.delete(validated.roomId);
        await deleteWhereEquals(this.db.draftDuelCommands, 'roomId', validated.roomId);
      },
    );
  }
  async loadCompleted(roomId: string): Promise<StoredDraftDuelCompleted | null> {
    const record = await this.db.draftDuelCompleted.get(roomId);
    if (record === undefined) return null;
    return storedDraftDuelCompletedSchema.parse(record);
  }
  async listHistory(): Promise<StoredDraftDuelHistoryIndex[]> {
    return listCompletedHistory(this.db.draftDuelHistory);
  }
  async deleteCompleted(roomId: string): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.draftDuelCompleted,
      this.db.draftDuelHistory,
      this.db.draftDuelResults,
      async () => {
        await this.db.draftDuelCompleted.delete(roomId);
        await this.db.draftDuelHistory.delete(`dd-${roomId}`);
        await deleteWhereEquals(this.db.draftDuelResults, 'roomId', roomId);
      },
    );
  }
}
export type DraftDuelRepository = DexieDraftDuelRepository;
