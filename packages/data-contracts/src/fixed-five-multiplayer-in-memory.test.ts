import { describe, expect, it } from 'vitest';
import {
  commandIdSchema,
  contentHashSchema,
  createInMemoryFixedFiveTransport,
  defaultFixedFiveVersionLocks,
  franchiseIdSchema,
  idSchema,
  playerIdSchema,
} from './index.ts';

describe('in-memory Fixed-Five duel broadcast', () => {
  const DIGEST_A = contentHashSchema.parse('a'.repeat(64));
  const DIGEST_B = contentHashSchema.parse('b'.repeat(64));

  async function duelRoom(clock?: () => number) {
    const transport = createInMemoryFixedFiveTransport({
      seed: 'duel-broadcast',
      ...(clock ? { clock } : {}),
    });
    const created = await transport.create({
      mode: 'duel',
      sourceMode: 'classic',
      variant: 'ratings',
      versions: defaultFixedFiveVersionLocks({}),
    });
    await transport.join(created.code);
    return { transport, created };
  }

  async function submit(
    transport: ReturnType<typeof createInMemoryFixedFiveTransport>,
    snapshot: { roomId: string; revision: number },
    id: string,
    actor: 'p1' | 'p2',
    payload: Parameters<typeof transport.submitCommand>[0]['payload'],
  ) {
    const receipt = await transport.submitCommand({
      schemaVersion: 1,
      roomId: idSchema.parse(snapshot.roomId),
      commandId: commandIdSchema.parse(id),
      actorParticipantId: actor,
      payload,
      expectedRevision: snapshot.revision,
    });
    return { receipt, snapshot: (await transport.resume(snapshot.roomId)).snapshot };
  }

  async function completeDraft(
    transport: ReturnType<typeof createInMemoryFixedFiveTransport>,
    created: Awaited<ReturnType<typeof duelRoom>>['created'],
  ) {
    let snapshot = (await transport.resume(created.snapshot.roomId)).snapshot;
    ({ snapshot } = await submit(transport, snapshot, 'duel-start', 'p1', { kind: 'start' }));
    for (let index = 0; index < 10; index += 1) {
      ({ snapshot } = await submit(
        transport,
        snapshot,
        `duel-pick-${String(index)}`,
        index % 2 === 0 ? 'p1' : 'p2',
        {
          kind: 'duel-claim',
          playerId: playerIdSchema.parse(`duel-player-${String(index)}`),
          slotIndex: index % 5,
          franchiseId: franchiseIdSchema.parse('lakers'),
          eraId: '1990s',
        },
      ));
    }
    return snapshot;
  }

  async function playGame(
    transport: ReturnType<typeof createInMemoryFixedFiveTransport>,
    snapshot: Awaited<ReturnType<typeof completeDraft>>,
    gameNumber: number,
    digest = DIGEST_A,
  ) {
    ({ snapshot } = await submit(transport, snapshot, `ready-p1-${String(gameNumber)}`, 'p1', {
      kind: 'ready-next-game',
      gameNumber,
      ready: true,
    }));
    ({ snapshot } = await submit(transport, snapshot, `ready-p2-${String(gameNumber)}`, 'p2', {
      kind: 'ready-next-game',
      gameNumber,
      ready: true,
    }));
    ({ snapshot } = await submit(transport, snapshot, `broadcast-${String(gameNumber)}`, 'p1', {
      kind: 'broadcast-start',
      gameNumber,
    }));
    ({ snapshot } = await submit(transport, snapshot, `propose-p1-${String(gameNumber)}`, 'p1', {
      kind: 'propose-game-result',
      gameNumber,
      winner: 'p1',
      resultDigest: digest,
      tapeDigest: digest,
      inputDigest: digest,
    }));
    ({ snapshot } = await submit(transport, snapshot, `propose-p2-${String(gameNumber)}`, 'p2', {
      kind: 'propose-game-result',
      gameNumber,
      winner: 'p1',
      resultDigest: digest,
      tapeDigest: digest,
      inputDigest: digest,
    }));
    ({ snapshot } = await submit(transport, snapshot, `confirm-p1-${String(gameNumber)}`, 'p1', {
      kind: 'confirm-game-result',
      gameNumber,
      resultDigest: digest,
      verified: true,
    }));
    ({ snapshot } = await submit(transport, snapshot, `confirm-p2-${String(gameNumber)}`, 'p2', {
      kind: 'confirm-game-result',
      gameNumber,
      resultDigest: digest,
      verified: true,
    }));
    return snapshot;
  }

  it('starts the series after ten picks and advances games on matching digests', async () => {
    const { transport, created } = await duelRoom();
    let snapshot = await completeDraft(transport, created);
    expect(snapshot.phase).toBe('preparing-game');
    expect(snapshot.series).toEqual({
      games: [],
      p1Wins: 0,
      p2Wins: 0,
      currentGameNumber: 1,
      champion: null,
    });
    expect(snapshot.members.map((member) => member.nextGameReady)).toEqual([null, null]);

    snapshot = await playGame(transport, snapshot, 1);
    expect(snapshot.phase).toBe('preparing-game');
    expect(snapshot.series?.p1Wins).toBe(1);
    expect(snapshot.series?.currentGameNumber).toBe(2);
    expect(snapshot.broadcast).toBeNull();
    expect(snapshot.series?.games).toEqual([
      { gameNumber: 1, homeParticipantId: 'p1', awayParticipantId: 'p2', winner: 'p1' },
    ]);
  });

  it('broadcasts with a ten second server timestamp', async () => {
    const { transport, created } = await duelRoom();
    let snapshot = await completeDraft(transport, created);
    ({ snapshot } = await submit(transport, snapshot, 'ready-1-p1', 'p1', {
      kind: 'ready-next-game',
      gameNumber: 1,
      ready: true,
    }));
    ({ snapshot } = await submit(transport, snapshot, 'ready-1-p2', 'p2', {
      kind: 'ready-next-game',
      gameNumber: 1,
      ready: true,
    }));
    ({ snapshot } = await submit(transport, snapshot, 'broadcast-1', 'p1', {
      kind: 'broadcast-start',
      gameNumber: 1,
    }));
    expect(snapshot.phase).toBe('broadcasting');
    expect(snapshot.broadcast?.gameNumber).toBe(1);
    expect(snapshot.broadcast?.durationMs).toBe(10_000);
    expect(Number.isNaN(Date.parse(snapshot.broadcast?.startedAtIso ?? ''))).toBe(false);
    expect(snapshot.members.map((member) => member.nextGameReady)).toEqual([null, null]);
  });

  it('rejects an early broadcast and a missing ready', async () => {
    const { transport, created } = await duelRoom();
    let snapshot = await completeDraft(transport, created);
    const early = await submit(transport, snapshot, 'early-broadcast', 'p1', {
      kind: 'broadcast-start',
      gameNumber: 1,
    });
    expect(early.receipt.accepted).toBe(false);
    expect(early.receipt.rejectionCode).toBe('not-ready');
    ({ snapshot } = await submit(transport, snapshot, 'ready-only-p1', 'p1', {
      kind: 'ready-next-game',
      gameNumber: 1,
      ready: true,
    }));
    const half = await submit(transport, snapshot, 'half-broadcast', 'p1', {
      kind: 'broadcast-start',
      gameNumber: 1,
    });
    expect(half.receipt.accepted).toBe(false);
    expect(half.receipt.rejectionCode).toBe('not-ready');
    const readyInGameResults = await submit(transport, snapshot, 'ready-wrong-phase', 'p1', {
      kind: 'ready-next-game',
      gameNumber: 1,
      ready: false,
    });
    expect(readyInGameResults.receipt.accepted).toBe(true);
  });

  it('auto-starts a broadcast after sixty idle seconds and clinches at four wins', async () => {
    let now = Date.now();
    const clock = () => now;
    const { transport, created } = await duelRoom(clock);
    let snapshot = await completeDraft(transport, created);
    now += 61_000;
    ({ snapshot } = await submit(transport, snapshot, 'auto-broadcast', 'p1', {
      kind: 'broadcast-start',
      gameNumber: 1,
      auto: true,
    }));
    expect(snapshot.phase).toBe('broadcasting');
    now += 61_000;
    ({ snapshot } = await submit(transport, snapshot, 'auto-propose-p1', 'p1', {
      kind: 'propose-game-result',
      gameNumber: 1,
      winner: 'p1',
      resultDigest: DIGEST_A,
      tapeDigest: DIGEST_A,
      inputDigest: DIGEST_A,
    }));
    ({ snapshot } = await submit(transport, snapshot, 'auto-propose-p2', 'p2', {
      kind: 'propose-game-result',
      gameNumber: 1,
      winner: 'p1',
      resultDigest: DIGEST_A,
      tapeDigest: DIGEST_A,
      inputDigest: DIGEST_A,
    }));
    ({ snapshot } = await submit(transport, snapshot, 'auto-confirm-p1', 'p1', {
      kind: 'confirm-game-result',
      gameNumber: 1,
      resultDigest: DIGEST_A,
      verified: true,
    }));
    ({ snapshot } = await submit(transport, snapshot, 'auto-confirm-p2', 'p2', {
      kind: 'confirm-game-result',
      gameNumber: 1,
      resultDigest: DIGEST_A,
      verified: true,
    }));
    for (let gameNumber = 2; gameNumber <= 4; gameNumber += 1) {
      now += 61_000;
      ({ snapshot } = await submit(
        transport,
        snapshot,
        `auto-broadcast-${String(gameNumber)}`,
        'p1',
        { kind: 'broadcast-start', gameNumber, auto: true },
      ));
      ({ snapshot } = await submit(
        transport,
        snapshot,
        `auto-propose-a-${String(gameNumber)}`,
        'p1',
        {
          kind: 'propose-game-result',
          gameNumber,
          winner: 'p1',
          resultDigest: DIGEST_A,
          tapeDigest: DIGEST_A,
          inputDigest: DIGEST_A,
        },
      ));
      ({ snapshot } = await submit(
        transport,
        snapshot,
        `auto-propose-b-${String(gameNumber)}`,
        'p2',
        {
          kind: 'propose-game-result',
          gameNumber,
          winner: 'p1',
          resultDigest: DIGEST_A,
          tapeDigest: DIGEST_A,
          inputDigest: DIGEST_A,
        },
      ));
      ({ snapshot } = await submit(
        transport,
        snapshot,
        `auto-confirm-a-${String(gameNumber)}`,
        'p1',
        { kind: 'confirm-game-result', gameNumber, resultDigest: DIGEST_A, verified: true },
      ));
      ({ snapshot } = await submit(
        transport,
        snapshot,
        `auto-confirm-b-${String(gameNumber)}`,
        'p2',
        { kind: 'confirm-game-result', gameNumber, resultDigest: DIGEST_A, verified: true },
      ));
    }
    expect(snapshot.series?.p1Wins).toBe(4);
    expect(snapshot.series?.champion).toBe('p1');
    expect(snapshot.series?.currentGameNumber).toBeNull();
    expect(snapshot.phase).toBe('awaiting-confirmation');
  });

  it('records a mismatch denial and fails the room', async () => {
    const { transport, created } = await duelRoom();
    let snapshot = await completeDraft(transport, created);
    ({ snapshot } = await submit(transport, snapshot, 'mm-ready-p1', 'p1', {
      kind: 'ready-next-game',
      gameNumber: 1,
      ready: true,
    }));
    ({ snapshot } = await submit(transport, snapshot, 'mm-ready-p2', 'p2', {
      kind: 'ready-next-game',
      gameNumber: 1,
      ready: true,
    }));
    ({ snapshot } = await submit(transport, snapshot, 'mm-broadcast', 'p1', {
      kind: 'broadcast-start',
      gameNumber: 1,
    }));
    ({ snapshot } = await submit(transport, snapshot, 'mm-propose-p1', 'p1', {
      kind: 'propose-game-result',
      gameNumber: 1,
      winner: 'p1',
      resultDigest: DIGEST_A,
      tapeDigest: DIGEST_A,
      inputDigest: DIGEST_A,
    }));
    ({ snapshot } = await submit(transport, snapshot, 'mm-propose-p2', 'p2', {
      kind: 'propose-game-result',
      gameNumber: 1,
      winner: 'p1',
      resultDigest: DIGEST_B,
      tapeDigest: DIGEST_B,
      inputDigest: DIGEST_B,
    }));
    ({ snapshot } = await submit(transport, snapshot, 'mm-confirm-p1', 'p1', {
      kind: 'confirm-game-result',
      gameNumber: 1,
      resultDigest: DIGEST_A,
      verified: true,
    }));
    ({ snapshot } = await submit(transport, snapshot, 'mm-confirm-p2', 'p2', {
      kind: 'confirm-game-result',
      gameNumber: 1,
      resultDigest: DIGEST_A,
      verified: false,
    }));
    expect(snapshot.phase).toBe('game-results');
    const failed = await transport.fail(snapshot.roomId);
    expect(failed.failed).toBe(true);
    expect(failed.phase).toBe('integrity-failed');
  });
});

describe('in-memory Fixed-Five sandbox deadlines', () => {
  it('advances a seeded snake deadline and rejects canonical duplicates', async () => {
    const transport = createInMemoryFixedFiveTransport({ seed: 'sandbox-snake-test' });
    const created = await transport.create({
      mode: 'sandbox-shared-82',
      sourceMode: 'sandbox',
      variant: 'ratings',
      versions: defaultFixedFiveVersionLocks({}),
    });
    let snapshot = created.snapshot;
    const start = await transport.submitCommand({
      schemaVersion: 1,
      roomId: snapshot.roomId,
      commandId: commandIdSchema.parse('start-sandbox-snake'),
      actorParticipantId: 'p1',
      payload: { kind: 'start' },
      expectedRevision: snapshot.revision,
    });
    expect(start.accepted).toBe(true);
    snapshot = (await transport.resume(snapshot.roomId)).snapshot;

    const rootSeed = snapshot.rootSeed;
    if (!rootSeed) throw new Error('sandbox snake test is missing a root seed');
    const first: 'p1' | 'p2' = Number.parseInt(rootSeed.slice(0, 2), 16) % 2 === 0 ? 'p1' : 'p2';
    const other: 'p1' | 'p2' = first === 'p1' ? 'p2' : 'p1';
    const expectedOrder: Array<'p1' | 'p2'> = [
      first,
      other,
      other,
      first,
      first,
      other,
      other,
      first,
      first,
      other,
    ];
    const counts = { p1: 0, p2: 0 };
    const observed: Array<'p1' | 'p2'> = [];

    for (let i = 0; i < expectedOrder.length; i += 1) {
      const deadline = snapshot.deadline;
      const actor = expectedOrder[i];
      if (!deadline || !actor) throw new Error('sandbox snake test is missing a deadline');
      expect(deadline.participantId).toBe(actor);
      observed.push(actor);
      const playerId = playerIdSchema.parse(`sandbox-player-${String(i)}`);
      const receipt = await transport.submitCommand({
        schemaVersion: 1,
        roomId: snapshot.roomId,
        commandId: commandIdSchema.parse(`sandbox-pick-${String(i)}`),
        actorParticipantId: actor,
        payload: {
          kind: 'sandbox-place',
          playerId,
          slotIndex: counts[actor],
        },
        expectedRevision: snapshot.revision,
      });
      expect(receipt.accepted).toBe(true);
      counts[actor] += 1;
      snapshot = (await transport.resume(snapshot.roomId)).snapshot;
      if (i === 0) {
        const nextDeadline = snapshot.deadline;
        if (!nextDeadline) throw new Error('sandbox snake test ended before the second pick');
        const duplicate = await transport.submitCommand({
          schemaVersion: 1,
          roomId: snapshot.roomId,
          commandId: commandIdSchema.parse('sandbox-duplicate-variant'),
          actorParticipantId: nextDeadline.participantId,
          payload: {
            kind: 'sandbox-place',
            playerId,
            slotIndex: 0,
          },
          expectedRevision: snapshot.revision,
        });
        expect(duplicate.accepted).toBe(false);
        expect(duplicate.rejectionCode).toBe('illegal-move');
      }
    }

    expect(observed).toEqual(expectedOrder);
    expect(snapshot.deadline).toBeNull();
  });

  it('accepts v4 snake displacement and off-turn repositions without moving the clock', async () => {
    const transport = createInMemoryFixedFiveTransport({ seed: 'sandbox-snake-reposition' });
    const created = await transport.create({
      mode: 'sandbox-shared-82',
      sourceMode: 'sandbox',
      variant: 'ratings',
      versions: defaultFixedFiveVersionLocks({}),
    });
    let snapshot = created.snapshot;
    const started = await transport.submitCommand({
      schemaVersion: 1,
      roomId: snapshot.roomId,
      commandId: commandIdSchema.parse('start-snake-reposition'),
      actorParticipantId: 'p1',
      payload: { kind: 'start' },
      expectedRevision: snapshot.revision,
    });
    expect(started.accepted).toBe(true);
    snapshot = (await transport.resume(snapshot.roomId)).snapshot;

    const place = async (index: number, slotIndex: number) => {
      const deadline = snapshot.deadline;
      if (!deadline) throw new Error('snake reposition test is missing a deadline');
      const receipt = await transport.submitCommand({
        schemaVersion: 1,
        roomId: snapshot.roomId,
        commandId: commandIdSchema.parse(`snake-reposition-place-${String(index)}`),
        actorParticipantId: deadline.participantId,
        payload: {
          kind: 'sandbox-place',
          playerId: playerIdSchema.parse(`snake-reposition-${String(index)}`),
          slotIndex,
        },
        expectedRevision: snapshot.revision,
      });
      snapshot = (await transport.resume(snapshot.roomId)).snapshot;
      return receipt;
    };

    expect((await place(0, 0)).accepted).toBe(true);
    expect((await place(1, 0)).accepted).toBe(true);
    expect((await place(2, 1)).accepted).toBe(true);
    const displaced = await place(3, 0);
    expect(displaced.accepted).toBe(true);

    const before = snapshot.deadline;
    if (!before) throw new Error('snake reposition test lost its deadline');
    const offTurn = before.participantId === 'p1' ? 'p2' : 'p1';
    const move = await transport.submitCommand({
      schemaVersion: 1,
      roomId: snapshot.roomId,
      commandId: commandIdSchema.parse('snake-reposition-move'),
      actorParticipantId: offTurn,
      payload: {
        kind: 'sandbox-reposition',
        playerId: playerIdSchema.parse('snake-reposition-1'),
        slotIndex: 2,
      },
      expectedRevision: snapshot.revision,
    });
    expect(move.accepted).toBe(true);
    snapshot = (await transport.resume(snapshot.roomId)).snapshot;
    expect(snapshot.deadline?.cursor).toBe(before.cursor);
    expect(snapshot.deadline?.pickOrdinal).toBe(before.pickOrdinal);
    expect(snapshot.deadline?.participantId).toBe(before.participantId);
  });
});
