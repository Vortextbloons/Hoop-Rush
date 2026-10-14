import { describe, expect, it } from 'vitest';
import {
  DRAFT_DUEL_AUTOPICK_VERSION,
  contentHashSchema,
  createInMemoryDraftDuelTransport,
  defaultDraftDuelVersionLocks,
  draftDuelRoomSnapshotSchema,
  playerIdSchema,
  type DraftDuelRoomSnapshot,
} from '@hoop-rush/data-contracts';
import {
  DRAFT_DUEL_SAVE_SCHEMA_VERSION,
  storedDraftDuelCompletedSchema,
  type StoredDraftDuelCompleted,
} from '@hoop-rush/persistence';
import { DraftDuelController } from './draft-duel-controller.svelte.js';
import { createDraftDuelSession } from './draft-duel-session';

type SessionInternals = {
  applySnapshot: (snapshot: DraftDuelRoomSnapshot) => void;
  outputs: Record<number, never>;
  completedRecap: StoredDraftDuelCompleted | null;
};

function championshipSnapshot(): DraftDuelRoomSnapshot {
  return draftDuelRoomSnapshotSchema.parse({
    roomId: 'dd-recap-room',
    code: null,
    codeActive: false,
    settings: {
      schemaVersion: 1,
      fairness: 'fair',
      presentation: 'ratings',
      timerPolicyVersion: DRAFT_DUEL_AUTOPICK_VERSION,
      versions: defaultDraftDuelVersionLocks({
        catalogHash: contentHashSchema.parse('a'.repeat(64)),
      }),
    },
    phase: 'championship',
    revision: 12,
    commandCount: 12,
    rootSeed: 'a'.repeat(16),
    members: [
      {
        participantId: 'p1',
        online: true,
        ready: true,
        nextGameReady: null,
        locked: true,
        lastSeenAt: null,
      },
      {
        participantId: 'p2',
        online: true,
        ready: true,
        nextGameReady: null,
        locked: true,
        lastSeenAt: null,
      },
    ],
    deadline: null,
    series: {
      homeWinner: 'p1',
      games: [
        { gameNumber: 1, homeParticipantId: 'p1', awayParticipantId: 'p2', winner: 'p1' },
        { gameNumber: 2, homeParticipantId: 'p1', awayParticipantId: 'p2', winner: 'p1' },
        { gameNumber: 3, homeParticipantId: 'p2', awayParticipantId: 'p1', winner: 'p1' },
        { gameNumber: 4, homeParticipantId: 'p2', awayParticipantId: 'p1', winner: 'p1' },
      ],
      p1Wins: 4,
      p2Wins: 0,
      currentGameNumber: null,
      champion: 'p1',
    },
    broadcast: null,
    resultDigest: null,
    confirmedDigest: null,
    successorRoomId: null,
    expiresAt: '2026-10-12T00:00:00.000Z',
    createdAt: '2026-10-10T00:00:00.000Z',
  });
}

function storedRecap(): StoredDraftDuelCompleted {
  return storedDraftDuelCompletedSchema.parse({
    saveSchemaVersion: DRAFT_DUEL_SAVE_SCHEMA_VERSION,
    roomId: 'dd-recap-room',
    champion: 'p1',
    series: championshipSnapshot().series,
    mvp: {
      participantId: 'p1',
      playerId: playerIdSchema.parse('dd-a'),
      playerVersionId: 'pv-00000000000000000000000000000001',
      displayName: 'Alpha Ace',
      games: 4,
      points: 134,
      rebounds: 20,
      assists: 15,
      gameScoreSum: 150.5,
    },
    standouts: [
      {
        participantId: 'p1',
        playerId: playerIdSchema.parse('dd-a'),
        displayName: 'Alpha Ace',
        gameNumber: 1,
        points: 30,
        rebounds: 4,
        assists: 3,
      },
      {
        participantId: 'p2',
        playerId: playerIdSchema.parse('dd-v'),
        displayName: 'Vet Vic',
        gameNumber: 3,
        points: 35,
        rebounds: 5,
        assists: 3,
      },
    ],
    games: 4,
    completedAtIso: '2026-10-10T12:30:00.000Z',
  });
}

describe('Draft Duel championship recap fallback', () => {
  it('serves the stored MVP and standouts when the device has no game outputs', () => {
    const session = createDraftDuelSession({ transport: createInMemoryDraftDuelTransport() });
    const internals = session as unknown as SessionInternals;
    internals.applySnapshot(championshipSnapshot());
    internals.outputs = {};
    internals.completedRecap = storedRecap();
    const controller = new DraftDuelController(session);

    expect(controller.seriesMvp?.displayName).toBe('Alpha Ace');
    expect(controller.seriesMvp?.points).toBe(134);
    expect(controller.seriesStandouts).toHaveLength(2);
    expect(controller.seriesStandouts[1]?.displayName).toBe('Vet Vic');

    controller.dispose();
  });

  it('reports no MVP or standouts while nothing is restored yet', () => {
    const session = createDraftDuelSession({ transport: createInMemoryDraftDuelTransport() });
    const internals = session as unknown as SessionInternals;
    internals.applySnapshot(championshipSnapshot());
    internals.outputs = {};
    const controller = new DraftDuelController(session);

    expect(controller.seriesMvp).toBeNull();
    expect(controller.seriesStandouts).toEqual([]);

    controller.dispose();
  });
});
