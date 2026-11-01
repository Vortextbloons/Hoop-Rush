import { afterEach, describe, expect, test } from 'bun:test';
import {
  CAP_RUSH_MULTIPLAYER_MARKET_VERSION,
  CAP_RUSH_MULTIPLAYER_PRICING_VERSION,
  CAP_RUSH_MULTIPLAYER_RULES_VERSION,
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  CAP_RUSH_MULTIPLAYER_SEED_DERIVATION_VERSION,
  CAP_RUSH_MULTIPLAYER_VERSION,
  capRushMultiplayerRoomSnapshotSchema,
  capRushMultiplayerVersionLocksSchema,
  commandIdSchema,
  idSchema,
  seedSchema,
  type CapRushMultiplayerCommand,
  type CapRushMultiplayerCommandReceipt,
  type CapRushMultiplayerSettings,
} from '@hoop-rush/data-contracts';
import { createCapRushMultiplayerState } from '@hoop-rush/engine';
import type { StoredCapRushMultiplayerActiveRow } from '../schemas/cap-rush-multiplayer-record.ts';
import {
  DexieCapRushMultiplayerRepository,
  CapRushMultiplayerLoadError,
} from './cap-rush-multiplayer.ts';
import {
  resetIndexedDb,
  restoreIndexedDb,
  testDatabaseName,
  TestDatabase,
} from '../testing/repo-test-support.ts';

const ROOM = idSchema.parse('crm-test');
const ROOT = seedSchema.parse('abc123def4567890');
const AT = '2026-11-01T00:00:00.000Z';

function settings(): CapRushMultiplayerSettings {
  return {
    schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
    variant: 'clash',
    versionLocks: capRushMultiplayerVersionLocksSchema.parse({
      schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
      multiplayerVersion: CAP_RUSH_MULTIPLAYER_VERSION,
      rulesVersion: CAP_RUSH_MULTIPLAYER_RULES_VERSION,
      marketVersion: CAP_RUSH_MULTIPLAYER_MARKET_VERSION,
      pricingVersion: CAP_RUSH_MULTIPLAYER_PRICING_VERSION,
      seedDerivationVersion: CAP_RUSH_MULTIPLAYER_SEED_DERIVATION_VERSION,
      engineVersion: 'test-engine-v1',
      profileVersion: 'test-profile-v1',
      dataVersion: 'data-v1',
      catalogVersion: 'catalog-v1',
      catalogHash: 'a'.repeat(64),
      bracketHash: 'b'.repeat(64),
      profileHash: 'c'.repeat(64),
    }),
  };
}

function snapshot(revision: number) {
  return capRushMultiplayerRoomSnapshotSchema.parse({
    roomId: ROOM,
    code: '1234',
    codeActive: true,
    settings: settings(),
    phase: 'lobby',
    revision,
    commandCount: revision,
    members: [
      {
        participantId: 'p1',
        displayName: 'Host',
        online: true,
        ready: true,
        lastSeenAt: AT,
      },
      {
        participantId: 'p2',
        displayName: 'Guest',
        online: true,
        ready: true,
        lastSeenAt: AT,
      },
    ],
    rootSeed: ROOT,
    state: createCapRushMultiplayerState(ROOT),
    deadline: null,
    resultDigest: null,
    confirmedDigest: null,
    successorRoomId: null,
    expiresAt: AT,
    createdAt: AT,
  });
}

function command(): CapRushMultiplayerCommand {
  return {
    schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
    roomId: ROOM,
    commandId: commandIdSchema.parse('crm-cmd-1'),
    ordinal: 0,
    actorParticipantId: 'p1',
    expectedRevision: 0,
    acceptedAtIso: AT,
    payload: { kind: 'ready', ready: true },
  };
}

function receipt(): CapRushMultiplayerCommandReceipt {
  return {
    roomId: ROOM,
    commandId: commandIdSchema.parse('crm-cmd-1'),
    ordinal: 0,
    accepted: true,
    rejectionCode: null,
    revision: 1,
  };
}

describe('cap rush multiplayer persistence', () => {
  afterEach(() => {
    restoreIndexedDb();
  });

  test('saves an active checkpoint, dedupes commands, and clears the room', async () => {
    resetIndexedDb();
    const db = new TestDatabase(testDatabaseName('cap-rush-mp'));
    const repository = new DexieCapRushMultiplayerRepository(db);
    try {
      await repository.saveCheckpoint({
        snapshot: snapshot(1),
        state: createCapRushMultiplayerState(ROOT),
        commands: [command()],
        receipts: [receipt()],
        games: [],
        updatedAtIso: AT,
      });
      const active = await repository.loadActive(ROOM);
      expect(active).not.toBeNull();
      expect(active?.state.phase).toBe('lobby');
      expect(active?.commandCursor).toBe(1);
      expect(await repository.loadCommands(ROOM)).toHaveLength(1);

      await repository.saveCheckpoint({
        snapshot: snapshot(1),
        state: createCapRushMultiplayerState(ROOT),
        commands: [command()],
        receipts: [receipt()],
        games: [],
        updatedAtIso: AT,
      });
      expect(await repository.loadCommands(ROOM)).toHaveLength(1);

      await repository.saveCheckpoint({
        snapshot: snapshot(0),
        state: createCapRushMultiplayerState(ROOT),
        commands: [],
        receipts: [],
        games: [],
        updatedAtIso: AT,
      });
      expect((await repository.loadActive(ROOM))?.snapshot.revision).toBe(1);

      await repository.clearActive(ROOM);
      expect(await repository.loadActive(ROOM)).toBeNull();
      expect(await repository.loadCommands(ROOM)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  test('rejects a record saved with another schema version', async () => {
    resetIndexedDb();
    const db = new TestDatabase(testDatabaseName('cap-rush-mp'));
    const repository = new DexieCapRushMultiplayerRepository(db);
    try {
      await db.capRushMultiplayerActive.put({
        saveSchemaVersion: 99,
        roomId: ROOM,
        snapshot: snapshot(1),
        state: createCapRushMultiplayerState(ROOT),
        commandCursor: 1,
        updatedAtIso: AT,
      } as unknown as StoredCapRushMultiplayerActiveRow);
      await expect(repository.loadActive(ROOM)).rejects.toBeInstanceOf(CapRushMultiplayerLoadError);
    } finally {
      db.close();
    }
  });
});
