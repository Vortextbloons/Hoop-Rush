import { describe, expect, it } from 'vitest';
import {
  createInMemoryDraftDuelTransport,
  commandIdSchema,
  contentHashSchema,
  defaultDraftDuelVersionLocks,
  draftDuelFirstPickerFor,
  draftDuelHomeForGameFor,
  draftDuelHomeWinnerFor,
  playerIdSchema,
  playerVersionIdSchema,
  type DraftDuelCommandPayload,
  type DraftDuelCommandReceipt,
  type DraftDuelParticipantId,
  type DraftDuelRoomSnapshot,
  type Id,
  type InMemoryDraftDuelTransport,
} from './index.ts';

function locks() {
  return defaultDraftDuelVersionLocks({ catalogHash: contentHashSchema.parse('a'.repeat(64)) });
}

function playerVersion(letter: string) {
  return playerVersionIdSchema.parse(`pv-${letter.repeat(32)}`);
}

function otherParticipant(participantId: DraftDuelParticipantId): DraftDuelParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}

function pickerFor(first: DraftDuelParticipantId, ordinal: number): DraftDuelParticipantId {
  return ordinal % 2 === 0 ? first : otherParticipant(first);
}

async function createAndJoin(transport: InMemoryDraftDuelTransport) {
  const created = await transport.create({
    fairness: 'fair',
    presentation: 'ratings',
    versions: locks(),
  });
  const joined = await transport.join(created.code);
  return { created, joined, roomId: created.snapshot.roomId };
}

async function snapshot(
  transport: InMemoryDraftDuelTransport,
  roomId: Id,
): Promise<DraftDuelRoomSnapshot> {
  return (await transport.resume(roomId)).snapshot;
}

async function submit(
  transport: InMemoryDraftDuelTransport,
  roomId: Id,
  commandId: string,
  actor: DraftDuelParticipantId,
  payload: DraftDuelCommandPayload,
): Promise<DraftDuelCommandReceipt> {
  return transport.submitCommand({
    schemaVersion: 1,
    roomId,
    commandId: commandIdSchema.parse(commandId),
    actorParticipantId: actor,
    payload,
  });
}

async function readyBothAndStart(transport: InMemoryDraftDuelTransport, roomId: Id) {
  await submit(transport, roomId, 'ready-p1', 'p1', { kind: 'ready', ready: true });
  await submit(transport, roomId, 'ready-p2', 'p2', { kind: 'ready', ready: true });
  const started = await submit(transport, roomId, 'start', 'p1', { kind: 'start' });
  expect(started.accepted).toBe(true);
  return snapshot(transport, roomId);
}

function proposePayload(
  gameNumber: number,
  winner: DraftDuelParticipantId,
): DraftDuelCommandPayload {
  return {
    kind: 'propose-result',
    gameNumber,
    resultDigest: contentHashSchema.parse('d'.repeat(64)),
    tapeDigest: contentHashSchema.parse('e'.repeat(64)),
    inputDigest: contentHashSchema.parse('f'.repeat(64)),
    winner,
  };
}

async function playGame(
  transport: InMemoryDraftDuelTransport,
  roomId: Id,
  gameNumber: number,
  winner: DraftDuelParticipantId,
) {
  await submit(transport, roomId, `ready-1-g${String(gameNumber)}`, 'p1', {
    kind: 'ready-next-game',
    gameNumber,
    ready: true,
  });
  await submit(transport, roomId, `ready-2-g${String(gameNumber)}`, 'p2', {
    kind: 'ready-next-game',
    gameNumber,
    ready: true,
  });
  const broadcast = await submit(transport, roomId, `broadcast-g${String(gameNumber)}`, 'p1', {
    kind: 'broadcast-start',
    gameNumber,
  });
  expect(broadcast.accepted).toBe(true);
  const proposal = await submit(
    transport,
    roomId,
    `propose-g${String(gameNumber)}`,
    'p1',
    proposePayload(gameNumber, winner),
  );
  expect(proposal.accepted).toBe(true);
  await submit(transport, roomId, `confirm-2-g${String(gameNumber)}`, 'p2', {
    kind: 'confirm-result',
    gameNumber,
    resultDigest: contentHashSchema.parse('d'.repeat(64)),
    verified: true,
  });
  const finalConfirm = await submit(transport, roomId, `confirm-1-g${String(gameNumber)}`, 'p1', {
    kind: 'confirm-result',
    gameNumber,
    resultDigest: contentHashSchema.parse('d'.repeat(64)),
    verified: true,
  });
  expect(finalConfirm.accepted).toBe(true);
}

async function playDraft(
  transport: InMemoryDraftDuelTransport,
  roomId: Id,
  first: DraftDuelParticipantId,
  prefix: string,
): Promise<string[]> {
  const claimed: string[] = [];
  for (let ordinal = 0; ordinal < 10; ordinal += 1) {
    const playerId = `${prefix}player-${String(ordinal)}`;
    claimed.push(playerId);
    const pick = await submit(
      transport,
      roomId,
      `${prefix}pick-${String(ordinal)}`,
      pickerFor(first, ordinal),
      {
        kind: 'pick',
        pickOrdinal: ordinal,
        playerId: playerIdSchema.parse(playerId),
        playerVersionId: playerVersion(ordinal % 2 === 0 ? 'a' : 'b'),
      },
    );
    expect(pick.accepted).toBe(true);
  }
  return claimed;
}

describe('in-memory Draft Duel transport', () => {
  it('derives first picker and home winner like the engine seed draws', () => {
    expect(draftDuelFirstPickerFor('0123456789abcdef0123456789abcdef')).toBe('p1');
    expect(draftDuelHomeWinnerFor('0123456789abcdef0123456789abcdef')).toBe('p2');
    expect(draftDuelFirstPickerFor('aabbccddeeff00112233445566778899')).toBe('p2');
    expect(draftDuelHomeWinnerFor('aabbccddeeff00112233445566778899')).toBe('p1');
  });

  it('joins two clients and plays a strict alternating pick flow', async () => {
    const transport = createInMemoryDraftDuelTransport({ seed: 'draft-duel-flow' });
    const { created, joined, roomId } = await createAndJoin(transport);
    expect(created.membership.participantId).toBe('p1');
    expect(joined.membership.participantId).toBe('p2');
    expect((await transport.preview(created.code)).roomId).toBe(roomId);
    await expect(transport.preview('9999')).rejects.toThrow('invalid-code');

    let current = await snapshot(transport, roomId);
    expect(current.members.map((member) => member.online)).toEqual([true, true]);

    current = await readyBothAndStart(transport, roomId);
    expect(current.phase).toBe('drafting');
    const rootSeed = current.rootSeed;
    if (!rootSeed) throw new Error('draft duel room is missing a root seed');
    const first = draftDuelFirstPickerFor(rootSeed);
    expect(draftDuelHomeWinnerFor(rootSeed)).toBe(current.series?.homeWinner);
    expect(current.deadline?.participantId).toBe(first);

    const wrongTurn = await submit(transport, roomId, 'pick-wrong-turn', otherParticipant(first), {
      kind: 'pick',
      pickOrdinal: 0,
      playerId: playerIdSchema.parse('player-0'),
      playerVersionId: playerVersion('a'),
    });
    expect(wrongTurn.rejectionCode).toBe('turn');

    const wrongOrdinal = await submit(transport, roomId, 'pick-wrong-ordinal', first, {
      kind: 'pick',
      pickOrdinal: 1,
      playerId: playerIdSchema.parse('player-0'),
      playerVersionId: playerVersion('a'),
    });
    expect(wrongOrdinal.rejectionCode).toBe('turn');

    const pick = await submit(transport, roomId, 'pick-0', first, {
      kind: 'pick',
      pickOrdinal: 0,
      playerId: playerIdSchema.parse('player-0'),
      playerVersionId: playerVersion('a'),
    });
    expect(pick.accepted).toBe(true);

    current = await snapshot(transport, roomId);
    expect(current.deadline?.pickOrdinal).toBe(1);
    expect(current.deadline?.participantId).toBe(otherParticipant(first));
    expect(current.commandCount).toBe(4);
  });

  it('accepts an identical duplicate command idempotently and rejects a changed payload', async () => {
    const transport = createInMemoryDraftDuelTransport({ seed: 'draft-duel-duplicate' });
    const { roomId } = await createAndJoin(transport);
    const first = await submit(transport, roomId, 'ready-dup', 'p1', {
      kind: 'ready',
      ready: true,
    });
    expect(first.accepted).toBe(true);

    const duplicate = await submit(transport, roomId, 'ready-dup', 'p1', {
      kind: 'ready',
      ready: true,
    });
    expect(duplicate.accepted).toBe(true);
    expect(duplicate.ordinal).toBe(first.ordinal);

    const changed = await submit(transport, roomId, 'ready-dup', 'p1', {
      kind: 'ready',
      ready: false,
    });
    expect(changed.accepted).toBe(false);
    expect(changed.rejectionCode).toBe('duplicate-command');

    const otherActor = await submit(transport, roomId, 'ready-dup', 'p2', {
      kind: 'ready',
      ready: true,
    });
    expect(otherActor.rejectionCode).toBe('membership');
  });

  it('rejects re-claiming a player already claimed in the draft', async () => {
    const transport = createInMemoryDraftDuelTransport({ seed: 'draft-duel-claims' });
    const { roomId } = await createAndJoin(transport);
    const current = await readyBothAndStart(transport, roomId);
    const rootSeed = current.rootSeed;
    if (!rootSeed) throw new Error('draft duel room is missing a root seed');
    const first = draftDuelFirstPickerFor(rootSeed);

    const pick = await submit(transport, roomId, 'claim-0', first, {
      kind: 'pick',
      pickOrdinal: 0,
      playerId: playerIdSchema.parse('shared-player'),
      playerVersionId: playerVersion('a'),
    });
    expect(pick.accepted).toBe(true);

    const duplicateClaim = await submit(transport, roomId, 'claim-1', otherParticipant(first), {
      kind: 'pick',
      pickOrdinal: 1,
      playerId: playerIdSchema.parse('shared-player'),
      playerVersionId: playerVersion('b'),
    });
    expect(duplicateClaim.rejectionCode).toBe('claim-taken');
  });

  it('commits a fallback and resolves an overdue deadline with an injectable clock', async () => {
    let now = 1_000_000;
    const transport = createInMemoryDraftDuelTransport({
      seed: 'draft-duel-deadline',
      clock: () => now,
    });
    const { roomId } = await createAndJoin(transport);
    const current = await readyBothAndStart(transport, roomId);
    const rootSeed = current.rootSeed;
    const deadline = current.deadline;
    if (!rootSeed || !deadline) throw new Error('draft duel room is missing a deadline');
    const first = draftDuelFirstPickerFor(rootSeed);

    expect(await transport.resolveTimeout(roomId)).toBeNull();

    now += 61_000;
    const stored = await transport.commitFallback(
      roomId,
      deadline.cursor,
      {
        kind: 'timeout-autopick',
        pickOrdinal: 0,
        playerId: playerIdSchema.parse('fallback-0'),
        playerVersionId: playerVersion('c'),
        seedPath: `rootSeed/timeout/${first}/0`,
      },
      current.revision,
    );
    expect(stored.stored).toBe(true);

    const receipt = await transport.resolveTimeout(roomId);
    expect(receipt?.accepted).toBe(true);
    expect(receipt?.commandId).toBe(`timeout-${deadline.cursor}-0`);

    const after = await snapshot(transport, roomId);
    expect(after.deadline?.cursor).toBe('t1');
    expect(after.deadline?.pickOrdinal).toBe(1);
    expect(after.deadline?.participantId).toBe(otherParticipant(first));
    expect(await transport.resolveTimeout(roomId)).toBeNull();
  });

  it('delivers transient events only to subscribers of the owning room', async () => {
    const transport = createInMemoryDraftDuelTransport({ seed: 'draft-duel-transient' });
    const roomA = await transport.create({
      fairness: 'fair',
      presentation: 'ratings',
      versions: locks(),
    });
    const roomB = await transport.create({
      fairness: 'unfair',
      presentation: 'ball-knowledge',
      versions: locks(),
    });
    const receivedA: string[] = [];
    const receivedB: string[] = [];
    const subscriptionA = transport.subscribeTransient(roomA.snapshot.roomId, (event) => {
      receivedA.push(event.kind);
    });
    transport.subscribeTransient(roomB.snapshot.roomId, (event) => {
      receivedB.push(event.kind);
    });

    const event = {
      kind: 'consideration' as const,
      roomId: roomA.snapshot.roomId,
      participantId: 'p1' as const,
      pickOrdinal: 0,
      playerId: playerIdSchema.parse('player-0'),
      playerVersionId: playerVersion('a'),
      sentAtMs: 1,
    };
    expect(await transport.publishTransient(roomA.snapshot.roomId, event)).toBe(true);
    expect(receivedA).toEqual(['consideration']);
    expect(receivedB).toEqual([]);

    expect(
      await transport.publishTransient(roomA.snapshot.roomId, {
        ...event,
        roomId: roomB.snapshot.roomId,
      }),
    ).toBe(false);
    expect(receivedA).toEqual(['consideration']);

    expect(
      await transport.publishTransient(roomA.snapshot.roomId, {
        kind: 'nope',
      } as unknown as typeof event),
    ).toBe(false);

    subscriptionA.unsubscribe();
    expect(await transport.publishTransient(roomA.snapshot.roomId, event)).toBe(true);
    expect(receivedA).toEqual(['consideration']);
  });

  it('rematches into a successor room with a fresh seed and no carry-over claims', async () => {
    const transport = createInMemoryDraftDuelTransport({ seed: 'draft-duel-rematch' });
    const { roomId } = await createAndJoin(transport);
    let current = await readyBothAndStart(transport, roomId);
    const parentSeed = current.rootSeed;
    if (!parentSeed) throw new Error('draft duel room is missing a root seed');
    const first = draftDuelFirstPickerFor(parentSeed);

    const claimedInParent = await playDraft(transport, roomId, first, '');
    current = await snapshot(transport, roomId);
    expect(current.phase).toBe('lineup-showdown');

    for (let gameNumber = 1; gameNumber <= 4; gameNumber += 1) {
      await playGame(transport, roomId, gameNumber, 'p1');
    }
    current = await snapshot(transport, roomId);
    expect(current.phase).toBe('championship');
    expect(current.series?.champion).toBe('p1');
    expect(current.series?.p1Wins).toBe(4);
    expect(current.series?.games).toHaveLength(4);
    expect(current.codeActive).toBe(false);

    const fresh = await transport.create({
      fairness: 'fair',
      presentation: 'ratings',
      versions: locks(),
    });
    await expect(transport.rematch(fresh.snapshot.roomId)).rejects.toThrow('phase');

    const rematch = await transport.rematch(roomId);
    const successorId = rematch.snapshot.roomId;
    expect(successorId).not.toBe(roomId);
    expect(rematch.snapshot.rootSeed).not.toBe(parentSeed);
    expect(rematch.snapshot.phase).toBe('lobby');
    expect(rematch.snapshot.series).toBeNull();
    expect((await snapshot(transport, roomId)).successorRoomId).toBe(successorId);

    await transport.join(rematch.code);
    const successor = await readyBothAndStart(transport, successorId);
    const successorRootSeed = successor.rootSeed;
    if (!successorRootSeed) throw new Error('successor room is missing a root seed');
    const successorFirst = draftDuelFirstPickerFor(successorRootSeed);
    const firstClaimed = claimedInParent[0];
    const secondClaimed = claimedInParent[1];
    if (!firstClaimed || !secondClaimed) {
      throw new Error('draft flow did not claim the expected players');
    }
    const firstPick = await submit(transport, successorId, 'successor-pick-0', successorFirst, {
      kind: 'pick',
      pickOrdinal: 0,
      playerId: playerIdSchema.parse(firstClaimed),
      playerVersionId: playerVersion('a'),
    });
    expect(firstPick.accepted).toBe(true);
    const secondPick = await submit(
      transport,
      successorId,
      'successor-pick-1',
      otherParticipant(successorFirst),
      {
        kind: 'pick',
        pickOrdinal: 1,
        playerId: playerIdSchema.parse(secondClaimed),
        playerVersionId: playerVersion('b'),
      },
    );
    expect(secondPick.accepted).toBe(true);
  });

  it('maps home court with the engine 2-2-1-1-1 pattern', () => {
    expect(
      [1, 2, 3, 4, 5, 6, 7].map((gameNumber) => draftDuelHomeForGameFor('p1', gameNumber)),
    ).toEqual(['p1', 'p1', 'p2', 'p2', 'p1', 'p2', 'p1']);
    expect(
      [1, 2, 3, 4, 5, 6, 7].map((gameNumber) => draftDuelHomeForGameFor('p2', gameNumber)),
    ).toEqual(['p2', 'p2', 'p1', 'p1', 'p2', 'p1', 'p2']);
    expect(() => draftDuelHomeForGameFor('p1', 0)).toThrow();
    expect(() => draftDuelHomeForGameFor('p1', 8)).toThrow();
  });

  it('labels game 6 home/away opposite to the home-winner seat', async () => {
    const transport = createInMemoryDraftDuelTransport({ seed: 'draft-duel-game-six' });
    const { roomId } = await createAndJoin(transport);
    const started = await readyBothAndStart(transport, roomId);
    const rootSeed = started.rootSeed;
    if (!rootSeed) throw new Error('draft duel room is missing a root seed');
    await playDraft(transport, roomId, draftDuelFirstPickerFor(rootSeed), '');
    const homeWinner = draftDuelHomeWinnerFor(rootSeed);
    const awaySeat = otherParticipant(homeWinner);
    const scheduledWinners: DraftDuelParticipantId[] = [
      homeWinner,
      awaySeat,
      homeWinner,
      awaySeat,
      homeWinner,
      awaySeat,
    ];
    for (let gameNumber = 1; gameNumber <= scheduledWinners.length; gameNumber += 1) {
      const winner = scheduledWinners[gameNumber - 1];
      if (!winner) throw new Error('missing scheduled winner');
      await playGame(transport, roomId, gameNumber, winner);
    }
    const current = await snapshot(transport, roomId);
    const gameSix = current.series?.games.find((game) => game.gameNumber === 6);
    if (!gameSix) throw new Error('game 6 was not recorded');
    expect(gameSix.homeParticipantId).toBe(awaySeat);
    expect(gameSix.awayParticipantId).toBe(homeWinner);
    expect(gameSix.winner).toBe(awaySeat);
    expect(current.series?.p1Wins).toBe(3);
    expect(current.series?.p2Wins).toBe(3);
    expect(current.series?.currentGameNumber).toBe(7);
  });

  it('auto-starts after 60 seconds of idleness and readies the absent seat', async () => {
    let now = 7_000_000;
    const transport = createInMemoryDraftDuelTransport({
      seed: 'draft-duel-auto-start',
      clock: () => now,
    });
    const { roomId } = await createAndJoin(transport);
    const started = await readyBothAndStart(transport, roomId);
    const rootSeed = started.rootSeed;
    if (!rootSeed) throw new Error('draft duel room is missing a root seed');
    await playDraft(transport, roomId, draftDuelFirstPickerFor(rootSeed), '');

    await submit(transport, roomId, 'auto-ready-p1', 'p1', {
      kind: 'ready-next-game',
      gameNumber: 1,
      ready: true,
    });
    const afterReady = await snapshot(transport, roomId);
    expect(afterReady.phase).toBe('preparing-game');
    expect(afterReady.members.map((member) => member.nextGameReady)).toEqual([1, null]);

    const manual = await submit(transport, roomId, 'auto-bs-manual', 'p2', {
      kind: 'broadcast-start',
      gameNumber: 1,
    });
    expect(manual.rejectionCode).toBe('not-ready');

    const early = await submit(transport, roomId, 'auto-bs-early', 'p2', {
      kind: 'broadcast-start',
      gameNumber: 1,
      auto: true,
    });
    expect(early.rejectionCode).toBe('not-ready');

    now += 60_001;
    const auto = await submit(transport, roomId, 'auto-bs-ok', 'p2', {
      kind: 'broadcast-start',
      gameNumber: 1,
      auto: true,
    });
    expect(auto.accepted).toBe(true);

    const broadcasting = await snapshot(transport, roomId);
    expect(broadcasting.phase).toBe('broadcasting');
    expect(broadcasting.broadcast?.gameNumber).toBe(1);
    expect(broadcasting.members.map((member) => member.nextGameReady)).toEqual([null, null]);

    const commands = await transport.refetch(roomId, 0);
    const p2ReadyCommands = commands.filter(
      (command) =>
        command.payload.kind === 'ready-next-game' && command.actorParticipantId === 'p2',
    );
    expect(p2ReadyCommands).toHaveLength(0);
  });
});
