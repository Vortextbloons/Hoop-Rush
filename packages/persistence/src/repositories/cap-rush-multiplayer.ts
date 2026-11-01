import type { z } from 'zod';
import type {
  CapRushMultiplayerCommand,
  CapRushMultiplayerCommandReceipt,
  CapRushMultiplayerReport,
  CapRushMultiplayerRoomSnapshot,
  CapRushMultiplayerState,
  CapRushLeagueGame,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MULTIPLAYER_SAVE_SCHEMA_VERSION,
  CAP_RUSH_MULTIPLAYER_VERSION,
  canonicalJson,
  idSchema,
} from '@hoop-rush/data-contracts';
import type { HoopRushDatabase } from './dexie.ts';
import { commandRowsToAppend, listCompletedHistory, parseRecord } from './support.ts';
import {
  storedCapRushMultiplayerActiveRowSchema,
  storedCapRushMultiplayerCommandRowSchema,
  storedCapRushMultiplayerCompletedRowSchema,
  storedCapRushMultiplayerGameRowSchema,
  storedCapRushMultiplayerHistoryRowSchema,
  type StoredCapRushMultiplayerActiveRow,
  type StoredCapRushMultiplayerCommandRow,
  type StoredCapRushMultiplayerGameRow,
} from '../schemas/cap-rush-multiplayer-record.ts';

export class CapRushMultiplayerLoadError extends Error {
  readonly code: 'unsupported' | 'malformed';
  constructor(code: 'unsupported' | 'malformed', message: string) {
    super(message);
    this.name = 'CapRushMultiplayerLoadError';
    this.code = code;
  }
}

export interface CapRushMultiplayerCheckpointInput {
  readonly snapshot: CapRushMultiplayerRoomSnapshot;
  readonly state: CapRushMultiplayerState;
  readonly commands: readonly CapRushMultiplayerCommand[];
  readonly receipts: readonly CapRushMultiplayerCommandReceipt[];
  readonly games: readonly CapRushLeagueGame[];
  readonly updatedAtIso: string;
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  return parseRecord(
    schema,
    value,
    'stored cap rush multiplayer row',
    () =>
      new CapRushMultiplayerLoadError('malformed', 'stored cap rush multiplayer row is malformed'),
  );
}

export class DexieCapRushMultiplayerRepository {
  private readonly db: HoopRushDatabase;

  constructor(db: HoopRushDatabase) {
    this.db = db;
  }

  async loadActive(roomId: string): Promise<StoredCapRushMultiplayerActiveRow | null> {
    const row: unknown = await this.db.capRushMultiplayerActive.get(idSchema.parse(roomId));
    if (row === undefined) return null;
    if (
      typeof row !== 'object' ||
      row === null ||
      (row as { saveSchemaVersion?: unknown }).saveSchemaVersion !==
        CAP_RUSH_MULTIPLAYER_SAVE_SCHEMA_VERSION
    ) {
      throw new CapRushMultiplayerLoadError(
        'unsupported',
        'this cap rush multiplayer room was saved with another save schema',
      );
    }
    const protocol = (
      row as { snapshot?: { settings?: { versionLocks?: { multiplayerVersion?: unknown } } } }
    ).snapshot?.settings?.versionLocks?.multiplayerVersion;
    if (typeof protocol === 'string' && protocol !== CAP_RUSH_MULTIPLAYER_VERSION)
      throw new CapRushMultiplayerLoadError(
        'unsupported',
        'This room uses the old Cap Rush multiplayer protocol. Leave the lobby and create a new Cap Rush match.',
      );
    return parseOrThrow(storedCapRushMultiplayerActiveRowSchema, row);
  }

  async saveCheckpoint(input: CapRushMultiplayerCheckpointInput): Promise<void> {
    const active = storedCapRushMultiplayerActiveRowSchema.parse({
      saveSchemaVersion: CAP_RUSH_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      roomId: input.snapshot.roomId,
      snapshot: input.snapshot,
      state: input.state,
      commandCursor: input.snapshot.revision,
      updatedAtIso: input.updatedAtIso,
    });
    const commandRows = input.commands.map((command, index) =>
      storedCapRushMultiplayerCommandRowSchema.parse({
        saveSchemaVersion: CAP_RUSH_MULTIPLAYER_SAVE_SCHEMA_VERSION,
        roomId: input.snapshot.roomId,
        ordinal: command.ordinal,
        commandId: command.commandId,
        actorParticipantId: command.actorParticipantId,
        acceptedAtIso: command.acceptedAtIso,
        payload: command.payload,
        receipt:
          input.receipts[index] ??
          ({
            roomId: input.snapshot.roomId,
            commandId: command.commandId,
            ordinal: command.ordinal,
            accepted: true,
            rejectionCode: null,
            revision: input.snapshot.revision,
          } satisfies CapRushMultiplayerCommandReceipt),
        storedAtIso: input.updatedAtIso,
      }),
    );
    const gameRows = input.games.map((game) =>
      storedCapRushMultiplayerGameRowSchema.parse({
        saveSchemaVersion: CAP_RUSH_MULTIPLAYER_SAVE_SCHEMA_VERSION,
        roomId: input.snapshot.roomId,
        gameId: game.gameId,
        slot: game.slot,
        game,
        updatedAtIso: input.updatedAtIso,
      }),
    );
    await this.db.transaction(
      'rw',
      this.db.capRushMultiplayerActive,
      this.db.capRushMultiplayerCommands,
      this.db.capRushMultiplayerGames,
      async () => {
        await this.db.capRushMultiplayerActive.put(active);
        const existing = await this.db.capRushMultiplayerCommands
          .where('roomId')
          .equals(active.roomId)
          .toArray();
        const append = commandRowsToAppend<StoredCapRushMultiplayerCommandRow>({
          existing,
          incoming: commandRows,
          ordinalOf: (row) => row.ordinal,
          identityOf: (row) => row.commandId,
          matches: (stored, incoming) =>
            stored.ordinal === incoming.ordinal &&
            canonicalJson(stored.payload) === canonicalJson(incoming.payload),
          conflict: (kind, row) =>
            new Error(`cap rush multiplayer command ${kind} conflict at ${row.commandId}`),
        });
        if (append.length > 0) await this.db.capRushMultiplayerCommands.bulkPut(append);
        if (gameRows.length > 0) await this.db.capRushMultiplayerGames.bulkPut(gameRows);
      },
    );
  }

  async loadCommands(roomId: string, afterOrdinal = -1): Promise<CapRushMultiplayerCommand[]> {
    const rows = await this.db.capRushMultiplayerCommands
      .where('roomId')
      .equals(roomId)
      .and((row) => row.ordinal > afterOrdinal)
      .toArray();
    return rows
      .map((row) =>
        parseOrThrow<StoredCapRushMultiplayerCommandRow>(
          storedCapRushMultiplayerCommandRowSchema,
          row,
        ),
      )
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((row) => ({
        schemaVersion: 1 as const,
        roomId: row.roomId,
        commandId: row.commandId,
        ordinal: row.ordinal,
        actorParticipantId: row.actorParticipantId,
        expectedRevision: Math.max(0, row.ordinal),
        acceptedAtIso: row.acceptedAtIso,
        payload: row.payload,
      }));
  }

  async loadGames(roomId: string): Promise<StoredCapRushMultiplayerGameRow[]> {
    const rows = await this.db.capRushMultiplayerGames.where('roomId').equals(roomId).toArray();
    return rows.map((row) =>
      parseOrThrow<StoredCapRushMultiplayerGameRow>(storedCapRushMultiplayerGameRowSchema, row),
    );
  }

  async complete(input: {
    readonly snapshot: CapRushMultiplayerRoomSnapshot;
    readonly report: CapRushMultiplayerReport;
    readonly completedAtIso: string;
  }): Promise<void> {
    const completed = storedCapRushMultiplayerCompletedRowSchema.parse({
      saveSchemaVersion: CAP_RUSH_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      roomId: input.snapshot.roomId,
      report: input.report,
      snapshot: input.snapshot,
      completedAtIso: input.completedAtIso,
    });
    const history = storedCapRushMultiplayerHistoryRowSchema.parse({
      saveSchemaVersion: CAP_RUSH_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      recordId: `cap-rush-mp-${input.snapshot.roomId}`,
      roomId: input.snapshot.roomId,
      championTeamId: input.report.championTeamId,
      completedAtIso: input.completedAtIso,
    });
    await this.db.transaction(
      'rw',
      this.db.capRushMultiplayerActive,
      this.db.capRushMultiplayerCommands,
      this.db.capRushMultiplayerCompleted,
      this.db.capRushMultiplayerHistory,
      async () => {
        await this.db.capRushMultiplayerCompleted.put(completed);
        await this.db.capRushMultiplayerHistory.put(history);
        await this.db.capRushMultiplayerActive.delete(input.snapshot.roomId);
        await this.db.capRushMultiplayerCommands
          .where('roomId')
          .equals(input.snapshot.roomId)
          .delete();
      },
    );
  }

  async listHistory(): Promise<
    ReturnType<typeof storedCapRushMultiplayerHistoryRowSchema.parse>[]
  > {
    const rows = await listCompletedHistory(this.db.capRushMultiplayerHistory);
    return rows.map((row) => storedCapRushMultiplayerHistoryRowSchema.parse(row));
  }

  async clearActive(roomId: string): Promise<void> {
    const key = idSchema.parse(roomId);
    await this.db.transaction(
      'rw',
      this.db.capRushMultiplayerActive,
      this.db.capRushMultiplayerCommands,
      async () => {
        await this.db.capRushMultiplayerActive.delete(key);
        await this.db.capRushMultiplayerCommands.where('roomId').equals(key).delete();
      },
    );
  }
}
