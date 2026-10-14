import { describe, expect, it } from 'vitest';
import { seedSchema } from './ids.ts';
import type { Position } from './positions.ts';
import { POSITIONS } from './positions.ts';
import { REQUIRED_RATING_KEYS } from './simulation.ts';
import { HAVOC_TENDENCY_FIELDS } from './havoc-mutations.ts';
import { seedFromString } from './season-hash.ts';
import { HAVOC_MUTATION_CATALOG_VERSION, HAVOC_RULES_VERSION } from './havoc-versions.ts';
import {
  HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
  HAVOC_MULTIPLAYER_SERIES_GAMES,
  HAVOC_MULTIPLAYER_TURNS,
  HAVOC_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
} from './havoc-multiplayer-versions.ts';
import {
  defaultHavocMultiplayerVersionLocks,
  havocMultiplayerBroadcastSchema,
  havocMultiplayerCommandPayloadSchema,
  havocMultiplayerCommandReceiptSchema,
  havocMultiplayerCommandSchema,
  havocMultiplayerDeadlineSchema,
  havocMultiplayerDraftStateSchema,
  havocMultiplayerRoomSnapshotSchema,
  havocMultiplayerSeriesSnapshotSchema,
  havocMultiplayerTransientEventSchema,
  havocMultiplayerVerificationReceiptSchema,
} from './havoc-multiplayer.ts';
import {
  havocMultiplayerFirstPickerSeed,
  havocMultiplayerGameSeed,
  havocMultiplayerHomeCourtSeed,
  havocMultiplayerOfferSeed,
  havocMultiplayerRerollSeed,
  havocMultiplayerTimeoutSeed,
} from './havoc-multiplayer-seeds.ts';
import {
  havocMultiplayerWorkerRequestSchema,
  havocMultiplayerWorkerResponseSchema,
} from './havoc-multiplayer-worker.ts';

type ParticipantId = 'p1' | 'p2';

const digest32 = (value: number): string => value.toString(16).padStart(32, '0');
const SEED = seedSchema.parse(seedFromString('havoc-multiplayer-test'));

function ratings(): Record<string, number> {
  return Object.fromEntries(REQUIRED_RATING_KEYS.map((key) => [key, 70]));
}

function tendencies(): Record<string, number> {
  return Object.fromEntries(HAVOC_TENDENCY_FIELDS.map((key) => [key, 50]));
}

function effectiveProfile() {
  return {
    ratings: ratings(),
    tendencies: tendencies(),
    physical: {
      baselineHeightInches: 78,
      baselineHeightSource: 'source',
      heightInches: 78,
      weightLbs: 200,
      wingspanDeltaInches: 0,
      reachUnits: 0,
    },
    authoritativeChannels: [],
  };
}

function draftCard(offerId: string, cardIndex: number, playerNumber: number, slot: Position) {
  return {
    cardId: `hvc-${digest32(playerNumber)}`,
    offerId,
    cardIndex,
    slot,
    tier: 1,
    source: {
      playerId: `player-${String(playerNumber)}`,
      playerVersionId: null,
      displayName: `Player ${String(playerNumber)}`,
      franchiseId: null,
      eraId: null,
      seasonKey: '1999-00',
      positions: [slot],
      originalOverall: 80,
      overallSource: 'catalog',
      profile: { ratings: ratings(), tendencies: tendencies() },
      physical: { heightInches: 78, weightLbs: 200 },
    },
    mutations: [{ mutationId: 'sniper-gene' }],
    effective: effectiveProfile(),
    nickname: `Nick ${String(playerNumber)}`,
  };
}

function draftOffer(turnOrdinal: number, slot: Position, playerBase: number) {
  const offerId = `hvo-${digest32(turnOrdinal + 1)}`;
  return {
    offerId,
    offerIndex: turnOrdinal,
    round: Math.floor(turnOrdinal / 2) + 1,
    slot,
    cards: [0, 1, 2].map((cardIndex) =>
      draftCard(offerId, cardIndex, playerBase + cardIndex, slot),
    ),
  };
}

function completeDraftState() {
  const picks = Array.from({ length: HAVOC_MULTIPLAYER_TURNS }, (_, turnOrdinal) => {
    const slot = POSITIONS[Math.floor(turnOrdinal / 2)] ?? 'PG';
    const offer = draftOffer(turnOrdinal, slot, 1 + turnOrdinal * 3);
    const card = offer.cards[0];
    if (card === undefined) {
      throw new Error('draft offer is missing its first card');
    }
    return {
      turnOrdinal,
      participantId: turnOrdinal % 2 === 0 ? 'p1' : 'p2',
      slot,
      claimKey: { playerId: card.source.playerId, seasonKey: card.source.seasonKey },
      card,
    };
  });
  return {
    schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
    revision: 10,
    rootSeed: SEED,
    firstPicker: 'p1',
    turnOrdinal: HAVOC_MULTIPLAYER_TURNS,
    activeParticipantId: null,
    offer: null,
    rerollsUsed: { p1: 0, p2: 0 },
    picks,
    claimedPlayerIds: picks.map((pick) => pick.claimKey.playerId),
    status: 'complete',
  };
}

function draftingState() {
  return {
    schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
    revision: 0,
    rootSeed: SEED,
    firstPicker: 'p1',
    turnOrdinal: 0,
    activeParticipantId: 'p1',
    offer: draftOffer(0, 'PG', 1),
    rerollsUsed: { p1: 0, p2: 0 },
    picks: [],
    claimedPlayerIds: [],
    status: 'drafting',
  };
}

type SeriesGameStatus = 'scheduled' | 'ready' | 'broadcast' | 'proposed' | 'verified' | 'mismatch';

function seriesGame(
  gameNumber: number,
  home: ParticipantId,
  status: SeriesGameStatus,
  winner: ParticipantId | null,
) {
  const decided = status === 'proposed' || status === 'verified' || status === 'mismatch';
  return {
    gameNumber,
    homeParticipantId: home,
    awayParticipantId: home === 'p1' ? 'p2' : 'p1',
    status,
    winner,
    inputDigest: decided ? 'a'.repeat(32) : null,
    resultDigest: decided ? 'b'.repeat(32) : null,
    tapeDigest: decided ? 'c'.repeat(32) : null,
  };
}

function championshipSeries() {
  return {
    wins: { p1: 4, p2: 1 },
    games: [
      seriesGame(1, 'p1', 'verified', 'p1'),
      seriesGame(2, 'p1', 'verified', 'p1'),
      seriesGame(3, 'p2', 'verified', 'p2'),
      seriesGame(4, 'p2', 'verified', 'p1'),
      seriesGame(5, 'p1', 'verified', 'p1'),
    ],
    champion: 'p1',
  };
}

describe('havoc multiplayer commands', () => {
  const offerId = `hvo-${digest32(1)}`;
  const cardId = `hvc-${digest32(1)}`;
  const digests = {
    inputDigest: 'a'.repeat(32),
    resultDigest: 'b'.repeat(32),
    tapeDigest: 'c'.repeat(32),
  };
  const payloads = [
    { kind: 'ready' },
    { kind: 'start' },
    {
      kind: 'pick',
      turnOrdinal: 0,
      offerId,
      cardId,
      claimKey: { playerId: 'player-1', seasonKey: '1999-00' },
    },
    { kind: 'reroll', turnOrdinal: 0, offerId },
    { kind: 'timeout-pick', turnOrdinal: 0, offerId, cardId },
    { kind: 'ready-next-game', gameNumber: 1 },
    { kind: 'broadcast-start', gameNumber: 1 },
    { kind: 'broadcast-start', gameNumber: 1, auto: true },
    { kind: 'propose-result', gameNumber: 1, winner: 'p1', ...digests },
    { kind: 'confirm-result', gameNumber: 1, verified: true, ...digests },
    { kind: 'rematch-request' },
    { kind: 'rematch-confirm' },
    { kind: 'leave' },
  ];

  it('round-trips every command payload kind', () => {
    for (const payload of payloads) {
      const parsed = havocMultiplayerCommandPayloadSchema.safeParse(payload);
      expect(parsed.success, JSON.stringify(payload)).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toEqual(payload);
      }
    }
  });

  it('rejects malformed payloads', () => {
    expect(
      havocMultiplayerCommandPayloadSchema.safeParse({
        kind: 'pick',
        turnOrdinal: 0,
        offerId,
        cardId,
      }).success,
    ).toBe(false);
    expect(
      havocMultiplayerCommandPayloadSchema.safeParse({
        kind: 'pick',
        turnOrdinal: HAVOC_MULTIPLAYER_TURNS,
        offerId,
        cardId,
        claimKey: { playerId: 'player-1', seasonKey: '1999-00' },
      }).success,
    ).toBe(false);
    expect(
      havocMultiplayerCommandPayloadSchema.safeParse({
        kind: 'propose-result',
        gameNumber: 1,
        winner: 'p1',
        ...digests,
        inputDigest: 'a'.repeat(64),
      }).success,
    ).toBe(false);
    expect(
      havocMultiplayerCommandPayloadSchema.safeParse({ kind: 'ready-next-game', gameNumber: 8 })
        .success,
    ).toBe(false);
    expect(havocMultiplayerCommandPayloadSchema.safeParse({ kind: 'unknown' }).success).toBe(false);
  });

  it('validates command envelopes and receipts', () => {
    const command = {
      schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      commandId: 'command-1',
      roomId: 'room-1',
      actorParticipantId: 'p1',
      payload: { kind: 'ready' },
    };
    expect(havocMultiplayerCommandSchema.safeParse(command).success).toBe(true);
    expect(
      havocMultiplayerCommandSchema.safeParse({ ...command, expectedRevision: 3 }).success,
    ).toBe(true);
    expect(
      havocMultiplayerCommandSchema.safeParse({ ...command, expectedRevision: -1 }).success,
    ).toBe(false);
    expect(havocMultiplayerCommandSchema.safeParse({ ...command, schemaVersion: 2 }).success).toBe(
      false,
    );
    expect(
      havocMultiplayerCommandSchema.safeParse({ ...command, actorParticipantId: 'p3' }).success,
    ).toBe(false);

    const receipt = {
      roomId: 'room-1',
      commandId: 'command-1',
      accepted: true,
      rejectionCode: null,
      revision: 1,
    };
    expect(havocMultiplayerCommandReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(
      havocMultiplayerCommandReceiptSchema.safeParse({
        ...receipt,
        accepted: false,
        rejectionCode: 'claim-taken',
      }).success,
    ).toBe(true);
    expect(
      havocMultiplayerCommandReceiptSchema.safeParse({ ...receipt, accepted: false }).success,
    ).toBe(false);
    expect(
      havocMultiplayerCommandReceiptSchema.safeParse({
        ...receipt,
        rejectionCode: 'claim-taken',
      }).success,
    ).toBe(false);
    expect(
      havocMultiplayerCommandReceiptSchema.safeParse({
        ...receipt,
        accepted: false,
        rejectionCode: 'not-a-code',
      }).success,
    ).toBe(false);
  });
});

describe('havoc multiplayer draft state', () => {
  it('accepts drafting and complete states', () => {
    expect(havocMultiplayerDraftStateSchema.safeParse(draftingState()).success).toBe(true);
    expect(havocMultiplayerDraftStateSchema.safeParse(completeDraftState()).success).toBe(true);
    expect(
      havocMultiplayerDraftStateSchema.safeParse({
        ...completeDraftState(),
        rerollsUsed: { p1: 1, p2: 1 },
      }).success,
    ).toBe(true);
  });

  it('rejects non-sequential turns and mismatched claim keys', () => {
    const state = completeDraftState();
    const reordered = state.picks.map((pick, index) =>
      index === 2 ? { ...pick, turnOrdinal: 1 } : pick,
    );
    expect(havocMultiplayerDraftStateSchema.safeParse({ ...state, picks: reordered }).success).toBe(
      false,
    );
    const swappedClaim = state.picks.map((pick, index) =>
      index === 1 ? { ...pick, claimKey: { ...pick.claimKey, playerId: 'player-999' } } : pick,
    );
    expect(
      havocMultiplayerDraftStateSchema.safeParse({ ...state, picks: swappedClaim }).success,
    ).toBe(false);
  });

  it('rejects duplicate claimed players', () => {
    const state = completeDraftState();
    const first = state.picks[0];
    if (first === undefined) return;
    const picks = state.picks.map((pick, index) =>
      index === 1 ? { ...first, turnOrdinal: 1, participantId: 'p2' } : pick,
    );
    const claimedPlayerIds = [...state.claimedPlayerIds];
    claimedPlayerIds[1] = claimedPlayerIds[0] ?? '';
    expect(
      havocMultiplayerDraftStateSchema.safeParse({ ...state, picks, claimedPlayerIds }).success,
    ).toBe(false);
  });

  it('rejects a pick whose slot does not match its turn', () => {
    const state = completeDraftState();
    const picks = state.picks.map((pick, index) => {
      if (index !== 2) return pick;
      const wrongSlot = POSITIONS[3] ?? 'PF';
      const card = draftCard(pick.card.offerId, 0, 99, wrongSlot);
      return {
        ...pick,
        slot: wrongSlot,
        card,
        claimKey: { playerId: card.source.playerId, seasonKey: card.source.seasonKey },
      };
    });
    const claimedPlayerIds = picks.map((pick) => pick.claimKey.playerId);
    expect(
      havocMultiplayerDraftStateSchema.safeParse({ ...state, picks, claimedPlayerIds }).success,
    ).toBe(false);
  });

  it('enforces the reroll budget and phase consistency', () => {
    const complete = completeDraftState();
    const drafting = draftingState();
    expect(
      havocMultiplayerDraftStateSchema.safeParse({
        ...complete,
        rerollsUsed: { p1: 2, p2: 0 },
      }).success,
    ).toBe(false);
    expect(
      havocMultiplayerDraftStateSchema.safeParse({ ...drafting, activeParticipantId: 'p2' })
        .success,
    ).toBe(false);
    expect(havocMultiplayerDraftStateSchema.safeParse({ ...drafting, offer: null }).success).toBe(
      false,
    );
    expect(
      havocMultiplayerDraftStateSchema.safeParse({ ...complete, offer: drafting.offer }).success,
    ).toBe(false);
    expect(
      havocMultiplayerDraftStateSchema.safeParse({ ...complete, turnOrdinal: 9 }).success,
    ).toBe(false);
    expect(
      havocMultiplayerDraftStateSchema.safeParse({
        ...complete,
        picks: complete.picks.slice(0, 9),
        claimedPlayerIds: complete.claimedPlayerIds.slice(0, 9),
      }).success,
    ).toBe(false);
  });
});

describe('havoc multiplayer series snapshot', () => {
  it('accepts a 4-1 championship', () => {
    const parsed = havocMultiplayerSeriesSnapshotSchema.safeParse(championshipSeries());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.champion).toBe('p1');
    }
  });

  it('caps wins at four and crowns champions only at four wins', () => {
    const series = championshipSeries();
    expect(
      havocMultiplayerSeriesSnapshotSchema.safeParse({ ...series, wins: { p1: 5, p2: 0 } }).success,
    ).toBe(false);
    expect(
      havocMultiplayerSeriesSnapshotSchema.safeParse({ ...series, champion: null }).success,
    ).toBe(false);
    expect(
      havocMultiplayerSeriesSnapshotSchema.safeParse({
        ...series,
        wins: { p1: 3, p2: 1 },
      }).success,
    ).toBe(false);
  });

  it('rejects games after a championship', () => {
    const series = championshipSeries();
    expect(
      havocMultiplayerSeriesSnapshotSchema.safeParse({
        ...series,
        games: [...series.games, seriesGame(6, 'p2', 'scheduled', null)],
      }).success,
    ).toBe(false);
  });

  it('enforces the home court pattern and per-game status invariants', () => {
    const series = championshipSeries();
    const wrongHome = series.games.map((game, index) =>
      index === 2 ? { ...game, homeParticipantId: 'p1', awayParticipantId: 'p2' } : game,
    );
    expect(
      havocMultiplayerSeriesSnapshotSchema.safeParse({ ...series, games: wrongHome }).success,
    ).toBe(false);
    const missingWinner = series.games.map((game, index) =>
      index === 0 ? { ...game, winner: null } : game,
    );
    expect(
      havocMultiplayerSeriesSnapshotSchema.safeParse({ ...series, games: missingWinner }).success,
    ).toBe(false);
    const missingDigest = series.games.map((game, index) =>
      index === 0 ? { ...game, resultDigest: null } : game,
    );
    expect(
      havocMultiplayerSeriesSnapshotSchema.safeParse({ ...series, games: missingDigest }).success,
    ).toBe(false);
    expect(
      havocMultiplayerSeriesSnapshotSchema.safeParse({
        ...series,
        games: [...series.games, seriesGame(6, 'p2', 'scheduled', 'p1')],
      }).success,
    ).toBe(false);
  });
});

describe('havoc multiplayer verification receipts', () => {
  const receipt = {
    receiptId: 'receipt-1',
    challenge: 'a'.repeat(64),
    receiptDigest: 'b'.repeat(64),
    resultDigest: 'c'.repeat(32),
    commandIds: ['command-1'],
    gameSeeds: [SEED],
  };

  it('separates 32-hex result digests from 64-hex receipt hashes', () => {
    expect(havocMultiplayerVerificationReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(
      havocMultiplayerVerificationReceiptSchema.safeParse({
        ...receipt,
        resultDigest: 'c'.repeat(64),
      }).success,
    ).toBe(false);
    expect(
      havocMultiplayerVerificationReceiptSchema.safeParse({ ...receipt, challenge: 'a'.repeat(32) })
        .success,
    ).toBe(false);
    expect(
      havocMultiplayerVerificationReceiptSchema.safeParse({
        ...receipt,
        receiptDigest: 'b'.repeat(32),
      }).success,
    ).toBe(false);
  });
});

describe('havoc multiplayer room snapshots', () => {
  const locks = defaultHavocMultiplayerVersionLocks({
    catalogHash: 'a'.repeat(64),
    profileHash: 'b'.repeat(64),
  });

  it('accepts PostgREST offset datetimes for deadlines and broadcasts', () => {
    const postgrestTimestamp = '2026-10-14T14:31:00.123456+00:00';
    expect(
      havocMultiplayerDeadlineSchema.parse({
        at: postgrestTimestamp,
        cursor: 't0',
        participantId: 'p1',
        fallback: null,
      }).at,
    ).toBe(postgrestTimestamp);
    expect(
      havocMultiplayerBroadcastSchema.parse({
        gameNumber: 1,
        durationMs: 8000,
        startedAt: postgrestTimestamp,
      }).startedAt,
    ).toBe(postgrestTimestamp);
  });

  it('defaults the version locks', () => {
    expect(locks.schemaVersion).toBe(HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION);
    expect(locks.engineVersion).toBe('unknown');
    expect(locks.rulesVersion).toBe(HAVOC_RULES_VERSION);
    expect(locks.mutationCatalogVersion).toBe(HAVOC_MUTATION_CATALOG_VERSION);
  });

  it('parses a lobby snapshot with members and a deadline', () => {
    const snapshot = {
      roomId: 'room-1',
      code: '1234',
      phase: 'lobby',
      revision: 0,
      settings: { schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION, versions: locks },
      members: [
        {
          participantId: 'p1',
          displayName: 'Host',
          online: true,
          ready: false,
          nextGameReady: null,
        },
        {
          participantId: 'p2',
          displayName: 'Guest',
          online: true,
          ready: false,
          nextGameReady: 1,
        },
      ],
      draft: null,
      series: null,
      broadcast: null,
      deadline: {
        at: new Date(0).toISOString(),
        cursor: 't0',
        participantId: 'p1',
        fallback: {
          kind: 'timeout-pick',
          turnOrdinal: 0,
          offerId: `hvo-${digest32(1)}`,
          cardId: `hvc-${digest32(1)}`,
        },
      },
      successorRoomId: null,
    };
    expect(havocMultiplayerRoomSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(havocMultiplayerRoomSnapshotSchema.safeParse({ ...snapshot, code: '12' }).success).toBe(
      false,
    );
    expect(
      havocMultiplayerRoomSnapshotSchema.safeParse({
        ...snapshot,
        members: snapshot.members.slice(0, 1),
      }).success,
    ).toBe(false);
    expect(
      havocMultiplayerRoomSnapshotSchema.safeParse({
        ...snapshot,
        deadline: { ...snapshot.deadline, at: 'not-a-date' },
      }).success,
    ).toBe(false);
  });

  it('parses transient events', () => {
    expect(
      havocMultiplayerTransientEventSchema.safeParse({
        kind: 'consideration',
        participantId: 'p1',
        turnOrdinal: 0,
        offerId: `hvo-${digest32(1)}`,
        cardId: `hvc-${digest32(1)}`,
        sentAtMs: 0,
      }).success,
    ).toBe(true);
    expect(
      havocMultiplayerTransientEventSchema.safeParse({
        kind: 'reaction',
        participantId: 'p2',
        turnOrdinal: 3,
        reaction: 'hype',
        sentAtMs: 10,
      }).success,
    ).toBe(true);
    expect(
      havocMultiplayerTransientEventSchema.safeParse({
        kind: 'reaction',
        participantId: 'p2',
        turnOrdinal: 3,
        reaction: 'hype',
      }).success,
    ).toBe(false);
  });
});

describe('havoc multiplayer worker wire', () => {
  it('validates request and response envelopes', () => {
    const request = {
      schemaVersion: HAVOC_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
      kind: 'havoc-multiplayer-game',
      requestId: 'request-1',
      roomId: 'room-1',
      gameNumber: 1,
      input: {},
    };
    expect(havocMultiplayerWorkerRequestSchema.safeParse(request).success).toBe(false);
    expect(
      havocMultiplayerWorkerRequestSchema.safeParse({ ...request, schemaVersion: 2 }).success,
    ).toBe(false);
    expect(
      havocMultiplayerWorkerRequestSchema.safeParse({ ...request, gameNumber: 8 }).success,
    ).toBe(false);

    expect(
      havocMultiplayerWorkerResponseSchema.safeParse({
        schemaVersion: HAVOC_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
        kind: 'havoc-multiplayer-error',
        requestId: 'request-1',
        code: 'internal',
        message: 'boom',
      }).success,
    ).toBe(true);
    expect(
      havocMultiplayerWorkerResponseSchema.safeParse({
        schemaVersion: HAVOC_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
        kind: 'havoc-multiplayer-error',
        requestId: 'request-1',
        code: 'internal',
      }).success,
    ).toBe(false);
    expect(
      havocMultiplayerWorkerResponseSchema.safeParse({
        schemaVersion: HAVOC_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
        kind: 'havoc-multiplayer-game',
        requestId: 'request-1',
        output: {
          result: {},
          tape: {},
          inputDigest: 'a'.repeat(32),
          resultDigest: 'b'.repeat(32),
          tapeDigest: 'c'.repeat(32),
        },
      }).success,
    ).toBe(false);
  });
});

describe('havoc multiplayer seeds', () => {
  it('derives stable, distinct streams', () => {
    expect(havocMultiplayerFirstPickerSeed(SEED)).toBe(havocMultiplayerFirstPickerSeed(SEED));
    expect(havocMultiplayerFirstPickerSeed(SEED)).not.toBe(havocMultiplayerHomeCourtSeed(SEED));
    expect(havocMultiplayerOfferSeed(SEED, 'p1', 0, 'players')).toBe(
      havocMultiplayerOfferSeed(SEED, 'p1', 0, 'players'),
    );
    expect(havocMultiplayerOfferSeed(SEED, 'p1', 0, 'players')).not.toBe(
      havocMultiplayerOfferSeed(SEED, 'p2', 0, 'players'),
    );
    expect(havocMultiplayerOfferSeed(SEED, 'p1', 0, 'players')).not.toBe(
      havocMultiplayerOfferSeed(SEED, 'p1', 1, 'players'),
    );
    expect(havocMultiplayerOfferSeed(SEED, 'p1', 0, 'players')).not.toBe(
      havocMultiplayerOfferSeed(SEED, 'p1', 0, 'tier'),
    );
    expect(havocMultiplayerRerollSeed(SEED, 'p1', 0)).not.toBe(
      havocMultiplayerOfferSeed(SEED, 'p1', 0, 'players'),
    );
    expect(havocMultiplayerTimeoutSeed(SEED, 0, 0)).not.toBe(
      havocMultiplayerTimeoutSeed(SEED, 0, 1),
    );
    expect(havocMultiplayerGameSeed(SEED, 1)).not.toBe(havocMultiplayerGameSeed(SEED, 2));
    expect(havocMultiplayerGameSeed(SEED, 1)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('rejects out-of-range seed inputs', () => {
    expect(() =>
      havocMultiplayerOfferSeed(SEED, 'p1', HAVOC_MULTIPLAYER_TURNS, 'players'),
    ).toThrow();
    expect(() => havocMultiplayerOfferSeed(SEED, 'p1', -1, 'players')).toThrow();
    expect(() =>
      havocMultiplayerOfferSeed(SEED, 'p3' as unknown as ParticipantId, 0, 'players'),
    ).toThrow();
    expect(() => havocMultiplayerRerollSeed(SEED, 'p1', 1.5)).toThrow();
    expect(() => havocMultiplayerTimeoutSeed(SEED, 0, -1)).toThrow();
    expect(() => havocMultiplayerGameSeed(SEED, 0)).toThrow();
    expect(() => havocMultiplayerGameSeed(SEED, HAVOC_MULTIPLAYER_SERIES_GAMES + 1)).toThrow();
  });
});
