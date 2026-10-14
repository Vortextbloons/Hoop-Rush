import { describe, expect, it } from 'vitest';
import {
  HAVOC_MULTIPLAYER_CODE_TTL_MS,
  HAVOC_MULTIPLAYER_PICK_TIMEOUT_MS,
  HAVOC_MULTIPLAYER_ROOM_RETENTION_MS,
  HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
  HAVOC_MULTIPLAYER_SERIES_GAMES,
  HAVOC_MULTIPLAYER_TURNS,
  commandIdSchema,
  contentHashSchema,
  createInMemoryHavocMultiplayerTransport,
  defaultHavocMultiplayerVersionLocks,
  havocDigestSchema,
  havocMultiplayerFirstPickerFor,
  havocMultiplayerHomeForGame,
  havocMultiplayerHomeWinnerFor,
  havocMultiplayerSeriesSnapshotSchema,
  seasonKeySchema,
  seedSchema,
  type HavocDraftCard,
  type HavocMultiplayerCommandPayload,
  type HavocMultiplayerCommandReceipt,
  type HavocMultiplayerParticipantId,
  type HavocMultiplayerRoomSnapshot,
  type HavocMultiplayerTransientEvent,
  type Id,
  type InMemoryHavocMultiplayerTransport,
} from './index.ts';

function locks() {
  return defaultHavocMultiplayerVersionLocks({
    catalogHash: contentHashSchema.parse('a'.repeat(64)),
    profileHash: contentHashSchema.parse('b'.repeat(64)),
  });
}

function otherParticipant(
  participantId: HavocMultiplayerParticipantId,
): HavocMultiplayerParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}

async function createAndJoin(transport: InMemoryHavocMultiplayerTransport) {
  const created = await transport.create({ versions: locks() });
  const joined = await transport.join(created.code);
  return { created, joined, roomId: created.snapshot.roomId };
}

async function snapshot(
  transport: InMemoryHavocMultiplayerTransport,
  roomId: Id,
): Promise<HavocMultiplayerRoomSnapshot> {
  return (await transport.resume(roomId)).snapshot;
}

async function submit(
  transport: InMemoryHavocMultiplayerTransport,
  roomId: Id,
  commandId: string,
  actor: HavocMultiplayerParticipantId,
  payload: HavocMultiplayerCommandPayload,
  expectedRevision?: number,
): Promise<HavocMultiplayerCommandReceipt> {
  return transport.submitCommand({
    schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
    roomId,
    commandId: commandIdSchema.parse(commandId),
    actorParticipantId: actor,
    expectedRevision,
    payload,
  });
}

function requireDraft(snapshot: HavocMultiplayerRoomSnapshot) {
  const draft = snapshot.draft;
  if (!draft) throw new Error('room has no draft state');
  return draft;
}

function requireOffer(snapshot: HavocMultiplayerRoomSnapshot) {
  const offer = requireDraft(snapshot).offer;
  if (!offer) throw new Error('draft has no active offer');
  return offer;
}

function requireDeadline(snapshot: HavocMultiplayerRoomSnapshot) {
  const deadline = snapshot.deadline;
  if (!deadline) throw new Error('room has no deadline');
  return deadline;
}

function claimKeyOf(card: HavocDraftCard) {
  return {
    playerId: card.source.playerId,
    seasonKey: seasonKeySchema.parse(card.source.seasonKey ?? '1999-00'),
  };
}

async function startDraft(
  transport: InMemoryHavocMultiplayerTransport,
  roomId: Id,
): Promise<HavocMultiplayerRoomSnapshot> {
  const started = await submit(transport, roomId, 'start', 'p1', { kind: 'start' });
  expect(started.accepted).toBe(true);
  return snapshot(transport, roomId);
}

async function pickFirstCard(
  transport: InMemoryHavocMultiplayerTransport,
  roomId: Id,
  commandId: string,
): Promise<HavocMultiplayerCommandReceipt> {
  const current = await snapshot(transport, roomId);
  const draft = requireDraft(current);
  const offer = requireOffer(current);
  const card = offer.cards[0];
  if (!card || draft.activeParticipantId === null) throw new Error('draft flow has no first card');
  return submit(transport, roomId, commandId, draft.activeParticipantId, {
    kind: 'pick',
    turnOrdinal: draft.turnOrdinal,
    offerId: offer.offerId,
    cardId: card.cardId,
    claimKey: claimKeyOf(card),
  });
}

async function playDraft(
  transport: InMemoryHavocMultiplayerTransport,
  roomId: Id,
  prefix: string,
): Promise<string[]> {
  const claimed: string[] = [];
  for (let turn = 0; turn < HAVOC_MULTIPLAYER_TURNS; turn += 1) {
    const current = await snapshot(transport, roomId);
    const draft = requireDraft(current);
    expect(draft.turnOrdinal).toBe(turn);
    expect(draft.activeParticipantId).toBe(
      turn % 2 === 0 ? draft.firstPicker : otherParticipant(draft.firstPicker),
    );
    const offer = requireOffer(current);
    const card = offer.cards[0];
    if (!card || draft.activeParticipantId === null) {
      throw new Error('draft flow has no first card');
    }
    claimed.push(card.source.playerId);
    const pick = await submit(
      transport,
      roomId,
      `${prefix}pick-${String(turn)}`,
      draft.activeParticipantId,
      {
        kind: 'pick',
        turnOrdinal: turn,
        offerId: offer.offerId,
        cardId: card.cardId,
        claimKey: claimKeyOf(card),
      },
    );
    expect(pick.accepted).toBe(true);
  }
  return claimed;
}

const GAME_DIGESTS = {
  inputDigest: havocDigestSchema.parse('a'.repeat(32)),
  resultDigest: havocDigestSchema.parse('b'.repeat(32)),
  tapeDigest: havocDigestSchema.parse('c'.repeat(32)),
};

async function proposeAndConfirm(
  transport: InMemoryHavocMultiplayerTransport,
  roomId: Id,
  gameNumber: number,
  winner: HavocMultiplayerParticipantId,
): Promise<void> {
  const proposal = await submit(transport, roomId, `propose-g${String(gameNumber)}`, 'p1', {
    kind: 'propose-result',
    gameNumber,
    winner,
    ...GAME_DIGESTS,
  });
  expect(proposal.accepted).toBe(true);
  const p2Confirm = await submit(transport, roomId, `confirm-p2-g${String(gameNumber)}`, 'p2', {
    kind: 'confirm-result',
    gameNumber,
    verified: true,
    ...GAME_DIGESTS,
  });
  expect(p2Confirm.accepted).toBe(true);
  const p1Confirm = await submit(transport, roomId, `confirm-p1-g${String(gameNumber)}`, 'p1', {
    kind: 'confirm-result',
    gameNumber,
    verified: true,
    ...GAME_DIGESTS,
  });
  expect(p1Confirm.accepted).toBe(true);
}

async function playGame(
  transport: InMemoryHavocMultiplayerTransport,
  roomId: Id,
  gameNumber: number,
  winner: HavocMultiplayerParticipantId,
): Promise<void> {
  const p1Ready = await submit(transport, roomId, `ready-p1-g${String(gameNumber)}`, 'p1', {
    kind: 'ready-next-game',
    gameNumber,
  });
  expect(p1Ready.accepted).toBe(true);
  const p2Ready = await submit(transport, roomId, `ready-p2-g${String(gameNumber)}`, 'p2', {
    kind: 'ready-next-game',
    gameNumber,
  });
  expect(p2Ready.accepted).toBe(true);
  const broadcast = await submit(transport, roomId, `broadcast-g${String(gameNumber)}`, 'p1', {
    kind: 'broadcast-start',
    gameNumber,
  });
  expect(broadcast.accepted).toBe(true);
  await proposeAndConfirm(transport, roomId, gameNumber, winner);
}

async function playChampionship(
  transport: InMemoryHavocMultiplayerTransport,
  roomId: Id,
): Promise<void> {
  await startDraft(transport, roomId);
  await playDraft(transport, roomId, 'champ-');
  for (let gameNumber = 1; gameNumber <= 4; gameNumber += 1) {
    await playGame(transport, roomId, gameNumber, 'p1');
  }
}

describe('in-memory Havoc multiplayer transport', () => {
  it('derives first picker and home side from root seed bytes like the server mirror', () => {
    expect(havocMultiplayerFirstPickerFor('0123456789abcdef0123456789abcdef')).toBe('p2');
    expect(havocMultiplayerHomeWinnerFor('0123456789abcdef0123456789abcdef')).toBe('p2');
    expect(havocMultiplayerFirstPickerFor('aabbccddeeff00112233445566778899')).toBe('p1');
    expect(havocMultiplayerHomeWinnerFor('aabbccddeeff00112233445566778899')).toBe('p2');
    expect(
      [1, 2, 3, 4, 5, 6, 7].map((gameNumber) => havocMultiplayerHomeForGame('p1', gameNumber)),
    ).toEqual(['p1', 'p1', 'p2', 'p2', 'p1', 'p2', 'p1']);
    expect(
      [1, 2, 3, 4, 5, 6, 7].map((gameNumber) => havocMultiplayerHomeForGame('p2', gameNumber)),
    ).toEqual(['p2', 'p2', 'p1', 'p1', 'p2', 'p1', 'p2']);
    expect(() => havocMultiplayerHomeForGame('p1', 0)).toThrow();
    expect(() => havocMultiplayerHomeForGame('p1', HAVOC_MULTIPLAYER_SERIES_GAMES + 1)).toThrow();
  });

  it('starts only from the host with both seats online', async () => {
    const transport = createInMemoryHavocMultiplayerTransport({ seed: 'start-rules' });
    const created = await transport.create({ versions: locks() });
    const roomId = created.snapshot.roomId;
    expect(created.membership.participantId).toBe('p1');

    const absent = await submit(transport, roomId, 'start-absent', 'p1', { kind: 'start' });
    expect(absent.rejectionCode).toBe('invalid-phase');
    expect((await snapshot(transport, roomId)).phase).toBe('lobby');

    const joined = await transport.join(created.code);
    expect(joined.membership.participantId).toBe('p2');
    const guest = await submit(transport, roomId, 'start-guest', 'p2', { kind: 'start' });
    expect(guest.rejectionCode).toBe('not-a-member');

    const started = await submit(transport, roomId, 'start-host', 'p1', { kind: 'start' });
    expect(started.accepted).toBe(true);
    const current = await snapshot(transport, roomId);
    expect(current.phase).toBe('drafting');
    expect(current.members.map((member) => member.online)).toEqual([true, true]);
  });

  it('joins two clients and plays a strict alternating pick flow with rejections', async () => {
    const transport = createInMemoryHavocMultiplayerTransport({ seed: 'draft-flow' });
    const { created, joined, roomId } = await createAndJoin(transport);
    expect(joined.snapshot.roomId).toBe(roomId);
    expect((await transport.preview(created.code)).roomId).toBe(roomId);
    await expect(transport.preview('9999')).rejects.toThrow('invalid-code');
    await expect(transport.resume('missing-room')).rejects.toThrow('authorization');

    const started = await startDraft(transport, roomId);
    const draft = requireDraft(started);
    expect(draft.rootSeed).toMatch(/^[0-9a-f]{32}$/);
    expect(draft.firstPicker).toBe(havocMultiplayerFirstPickerFor(draft.rootSeed));
    expect(started.series?.games[0]?.homeParticipantId).toBe(
      havocMultiplayerHomeWinnerFor(draft.rootSeed),
    );
    expect(started.deadline?.cursor).toBe('t0');
    expect(started.deadline?.participantId).toBe(draft.firstPicker);
    const offer = requireOffer(started);
    const firstCard = offer.cards[0];
    if (!firstCard) throw new Error('offer has no first card');

    const wrongActor = await submit(
      transport,
      roomId,
      'pick-wrong-actor',
      otherParticipant(draft.firstPicker),
      {
        kind: 'pick',
        turnOrdinal: 0,
        offerId: offer.offerId,
        cardId: firstCard.cardId,
        claimKey: claimKeyOf(firstCard),
      },
    );
    expect(wrongActor.rejectionCode).toBe('wrong-turn');

    const wrongTurn = await submit(transport, roomId, 'pick-wrong-turn', draft.firstPicker, {
      kind: 'pick',
      turnOrdinal: 1,
      offerId: offer.offerId,
      cardId: firstCard.cardId,
      claimKey: claimKeyOf(firstCard),
    });
    expect(wrongTurn.rejectionCode).toBe('wrong-turn');

    const wrongOffer = await submit(transport, roomId, 'pick-wrong-offer', draft.firstPicker, {
      kind: 'pick',
      turnOrdinal: 0,
      offerId: `hvo-${'f'.repeat(32)}`,
      cardId: firstCard.cardId,
      claimKey: claimKeyOf(firstCard),
    });
    expect(wrongOffer.rejectionCode).toBe('offer-mismatch');

    const unknownCard = await submit(transport, roomId, 'pick-unknown-card', draft.firstPicker, {
      kind: 'pick',
      turnOrdinal: 0,
      offerId: offer.offerId,
      cardId: `hvc-${'f'.repeat(32)}`,
      claimKey: claimKeyOf(firstCard),
    });
    expect(unknownCard.rejectionCode).toBe('card-unavailable');

    const stale = await submit(
      transport,
      roomId,
      'pick-stale',
      draft.firstPicker,
      {
        kind: 'pick',
        turnOrdinal: 0,
        offerId: offer.offerId,
        cardId: firstCard.cardId,
        claimKey: claimKeyOf(firstCard),
      },
      0,
    );
    expect(stale.rejectionCode).toBe('stale-revision');

    const pick = await submit(
      transport,
      roomId,
      'pick-0',
      draft.firstPicker,
      {
        kind: 'pick',
        turnOrdinal: 0,
        offerId: offer.offerId,
        cardId: firstCard.cardId,
        claimKey: claimKeyOf(firstCard),
      },
      started.revision,
    );
    expect(pick.accepted).toBe(true);

    const current = await snapshot(transport, roomId);
    expect(current.deadline?.cursor).toBe('t1');
    expect(current.deadline?.participantId).toBe(otherParticipant(draft.firstPicker));
    const nextDraft = requireDraft(current);
    expect(nextDraft.turnOrdinal).toBe(1);
    expect(nextDraft.picks).toHaveLength(1);
    expect(nextDraft.picks[0]?.claimKey.playerId).toBe(firstCard.source.playerId);
    expect(nextDraft.claimedPlayerIds).toEqual([firstCard.source.playerId]);
  });

  it('accepts an identical duplicate command idempotently and rejects changed payloads', async () => {
    const transport = createInMemoryHavocMultiplayerTransport({ seed: 'duplicate' });
    const { roomId } = await createAndJoin(transport);
    const first = await submit(transport, roomId, 'ready-dup', 'p1', { kind: 'ready' });
    expect(first.accepted).toBe(true);

    const duplicate = await submit(transport, roomId, 'ready-dup', 'p1', { kind: 'ready' });
    expect(duplicate.accepted).toBe(true);
    expect(duplicate.revision).toBe(first.revision);

    const changed = await submit(transport, roomId, 'ready-dup', 'p1', { kind: 'start' });
    expect(changed.rejectionCode).toBe('command-conflict');

    const otherActor = await submit(transport, roomId, 'ready-dup', 'p2', { kind: 'ready' });
    expect(otherActor.rejectionCode).toBe('not-a-member');

    const unknown = await transport.submitCommand({
      schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      roomId,
      commandId: commandIdSchema.parse('unknown-command'),
      actorParticipantId: 'p1',
      payload: { kind: 'nope' } as unknown as HavocMultiplayerCommandPayload,
    });
    expect(unknown.rejectionCode).toBe('unknown-command');
  });

  it('rejects re-claiming a person even through a different season card', async () => {
    const transport = createInMemoryHavocMultiplayerTransport({ seed: 'claims' });
    const { roomId } = await createAndJoin(transport);
    const started = await startDraft(transport, roomId);
    const draft = requireDraft(started);
    const offer = requireOffer(started);
    const firstCard = offer.cards[1];
    if (!firstCard) throw new Error('offer is missing its second card');
    const firstPick = await submit(transport, roomId, 'claim-pick-0', draft.firstPicker, {
      kind: 'pick',
      turnOrdinal: 0,
      offerId: offer.offerId,
      cardId: firstCard.cardId,
      claimKey: claimKeyOf(firstCard),
    });
    expect(firstPick.accepted).toBe(true);

    const next = await snapshot(transport, roomId);
    const nextDraft = requireDraft(next);
    const nextOffer = requireOffer(next);
    const secondCard = nextOffer.cards[0];
    if (!secondCard || nextDraft.activeParticipantId === null) {
      throw new Error('next offer is missing its first card');
    }
    expect(secondCard.source.playerId).toBe(firstCard.source.playerId);
    expect(secondCard.source.seasonKey).not.toBe(firstCard.source.seasonKey);

    const duplicate = await submit(
      transport,
      roomId,
      'claim-pick-1',
      nextDraft.activeParticipantId,
      {
        kind: 'pick',
        turnOrdinal: 1,
        offerId: nextOffer.offerId,
        cardId: secondCard.cardId,
        claimKey: claimKeyOf(secondCard),
      },
    );
    expect(duplicate.rejectionCode).toBe('claim-taken');
  });

  it('allows one reroll per participant and keeps the deadline', async () => {
    const transport = createInMemoryHavocMultiplayerTransport({ seed: 'reroll' });
    const { roomId } = await createAndJoin(transport);
    const started = await startDraft(transport, roomId);
    const draft = requireDraft(started);
    const offer = requireOffer(started);
    const deadline = requireDeadline(started);

    const guest = await submit(
      transport,
      roomId,
      'reroll-guest',
      otherParticipant(draft.firstPicker),
      { kind: 'reroll', turnOrdinal: 0, offerId: offer.offerId },
    );
    expect(guest.rejectionCode).toBe('wrong-turn');

    const mismatched = await submit(transport, roomId, 'reroll-offer', draft.firstPicker, {
      kind: 'reroll',
      turnOrdinal: 0,
      offerId: `hvo-${'f'.repeat(32)}`,
    });
    expect(mismatched.rejectionCode).toBe('offer-mismatch');

    const reroll = await submit(transport, roomId, 'reroll-first', draft.firstPicker, {
      kind: 'reroll',
      turnOrdinal: 0,
      offerId: offer.offerId,
    });
    expect(reroll.accepted).toBe(true);

    const after = await snapshot(transport, roomId);
    const rerolledDraft = requireDraft(after);
    expect(rerolledDraft.offer?.offerId).not.toBe(offer.offerId);
    expect(rerolledDraft.offer?.offerIndex).toBe(1);
    expect(rerolledDraft.rerollsUsed[draft.firstPicker]).toBe(1);
    expect(after.deadline?.cursor).toBe(deadline.cursor);
    expect(after.deadline?.at).toBe(deadline.at);
    expect(after.deadline?.fallback).toBeNull();

    const rerolledOffer = rerolledDraft.offer;
    if (!rerolledOffer) throw new Error('rerolled draft has no offer');
    const again = await submit(transport, roomId, 'reroll-again', draft.firstPicker, {
      kind: 'reroll',
      turnOrdinal: 0,
      offerId: rerolledOffer.offerId,
    });
    expect(again.rejectionCode).toBe('reroll-unavailable');

    const pick = await pickFirstCard(transport, roomId, 'reroll-pick');
    expect(pick.accepted).toBe(true);
  });

  it('commits a fallback and resolves an overdue deadline with an injectable clock', async () => {
    let now = 1_000_000;
    const transport = createInMemoryHavocMultiplayerTransport({
      seed: 'deadline',
      clock: () => now,
    });
    const { roomId } = await createAndJoin(transport);
    const started = await startDraft(transport, roomId);
    const draft = requireDraft(started);
    const offer = requireOffer(started);
    const deadline = requireDeadline(started);
    const card = offer.cards[0];
    if (!card) throw new Error('offer has no first card');

    expect(await transport.resolveTimeout(roomId)).toBeNull();

    now += HAVOC_MULTIPLAYER_PICK_TIMEOUT_MS + 1;
    const stored = await transport.commitFallback(
      roomId,
      deadline.cursor,
      { kind: 'timeout-pick', turnOrdinal: 0, offerId: offer.offerId, cardId: card.cardId },
      started.revision,
    );
    expect(stored.stored).toBe(true);

    const receipt = await transport.resolveTimeout(roomId);
    expect(receipt?.accepted).toBe(true);
    expect(receipt?.commandId).toBe(`timeout-${deadline.cursor}`);

    const after = await snapshot(transport, roomId);
    expect(after.deadline?.cursor).toBe('t1');
    expect(after.deadline?.participantId).toBe(otherParticipant(draft.firstPicker));
    expect(requireDraft(after).picks[0]?.claimKey.playerId).toBe(card.source.playerId);
    expect(await transport.resolveTimeout(roomId)).toBeNull();
  });

  it('invalidates a committed fallback on reroll while keeping the deadline', async () => {
    let now = 3_000_000;
    const transport = createInMemoryHavocMultiplayerTransport({
      seed: 'reroll-fallback',
      clock: () => now,
    });
    const { roomId } = await createAndJoin(transport);
    const started = await startDraft(transport, roomId);
    const draft = requireDraft(started);
    const offer = requireOffer(started);
    const deadline = requireDeadline(started);
    const card = offer.cards[0];
    if (!card) throw new Error('offer has no first card');

    const stored = await transport.commitFallback(roomId, deadline.cursor, {
      kind: 'timeout-pick',
      turnOrdinal: 0,
      offerId: offer.offerId,
      cardId: card.cardId,
    });
    expect(stored.stored).toBe(true);

    const reroll = await submit(transport, roomId, 'reroll-with-fallback', draft.firstPicker, {
      kind: 'reroll',
      turnOrdinal: 0,
      offerId: offer.offerId,
    });
    expect(reroll.accepted).toBe(true);

    const after = await snapshot(transport, roomId);
    expect(after.deadline?.fallback).toBeNull();
    expect(after.deadline?.cursor).toBe(deadline.cursor);
    now += HAVOC_MULTIPLAYER_PICK_TIMEOUT_MS + 1;
    expect(await transport.resolveTimeout(roomId)).toBeNull();

    const nextOffer = requireOffer(after);
    const nextCard = nextOffer.cards[0];
    const nextDeadline = requireDeadline(after);
    if (!nextCard) throw new Error('rerolled offer has no first card');
    const recommitted = await transport.commitFallback(roomId, nextDeadline.cursor, {
      kind: 'timeout-pick',
      turnOrdinal: 0,
      offerId: nextOffer.offerId,
      cardId: nextCard.cardId,
    });
    expect(recommitted.stored).toBe(true);
    const receipt = await transport.resolveTimeout(roomId);
    expect(receipt?.accepted).toBe(true);
  });

  it('plays a full draft and advances the series to a championship at four wins', async () => {
    const transport = createInMemoryHavocMultiplayerTransport({ seed: 'series' });
    const { created, roomId } = await createAndJoin(transport);
    await startDraft(transport, roomId);
    const claimed = await playDraft(transport, roomId, 'series-');
    let current = await snapshot(transport, roomId);
    expect(current.phase).toBe('lineup-showdown');
    expect(current.draft?.status).toBe('complete');
    expect(current.draft?.picks).toHaveLength(HAVOC_MULTIPLAYER_TURNS);
    expect(current.draft?.claimedPlayerIds).toEqual(claimed);
    expect(current.deadline).toBeNull();
    expect(current.series?.games).toHaveLength(HAVOC_MULTIPLAYER_SERIES_GAMES);
    expect(current.series?.games.map((game) => game.status)).toEqual(
      Array.from({ length: HAVOC_MULTIPLAYER_SERIES_GAMES }, () => 'scheduled'),
    );

    const earlyBroadcast = await submit(transport, roomId, 'series-early-broadcast', 'p1', {
      kind: 'broadcast-start',
      gameNumber: 1,
    });
    expect(earlyBroadcast.rejectionCode).toBe('invalid-phase');

    const p1Ready = await submit(transport, roomId, 'series-ready-p1-g1', 'p1', {
      kind: 'ready-next-game',
      gameNumber: 1,
    });
    expect(p1Ready.accepted).toBe(true);
    const wrongGame = await submit(transport, roomId, 'series-ready-wrong-game', 'p2', {
      kind: 'ready-next-game',
      gameNumber: 2,
    });
    expect(wrongGame.rejectionCode).toBe('wrong-turn');
    const notReady = await submit(transport, roomId, 'series-broadcast-not-ready', 'p1', {
      kind: 'broadcast-start',
      gameNumber: 1,
    });
    expect(notReady.rejectionCode).toBe('deadline-passed');
    const p2Ready = await submit(transport, roomId, 'series-ready-p2-g1', 'p2', {
      kind: 'ready-next-game',
      gameNumber: 1,
    });
    expect(p2Ready.accepted).toBe(true);
    const broadcast = await submit(transport, roomId, 'series-broadcast-g1', 'p1', {
      kind: 'broadcast-start',
      gameNumber: 1,
    });
    expect(broadcast.accepted).toBe(true);

    current = await snapshot(transport, roomId);
    expect(current.phase).toBe('broadcasting');
    expect(current.broadcast?.gameNumber).toBe(1);
    expect(current.series?.games[0]?.status).toBe('broadcast');

    await proposeAndConfirm(transport, roomId, 1, 'p1');
    current = await snapshot(transport, roomId);
    expect(current.phase).toBe('preparing-game');
    expect(current.broadcast).toBeNull();
    expect(current.series?.wins).toEqual({ p1: 1, p2: 0 });
    expect(current.series?.games[0]?.status).toBe('verified');

    for (let gameNumber = 2; gameNumber <= 4; gameNumber += 1) {
      await playGame(transport, roomId, gameNumber, 'p1');
    }
    current = await snapshot(transport, roomId);
    expect(current.phase).toBe('championship');
    expect(current.series?.champion).toBe('p1');
    expect(current.series?.wins).toEqual({ p1: 4, p2: 0 });
    expect(current.series?.games).toHaveLength(4);
    expect(current.series?.games.every((game) => game.status === 'verified')).toBe(true);
    expect(havocMultiplayerSeriesSnapshotSchema.safeParse(current.series).success).toBe(true);

    const homeWinner = havocMultiplayerHomeWinnerFor(requireDraft(current).rootSeed);
    expect(current.series?.games[0]?.homeParticipantId).toBe(homeWinner);
    expect(current.series?.games[2]?.homeParticipantId).toBe(otherParticipant(homeWinner));
    expect(current.series?.games[3]?.homeParticipantId).toBe(otherParticipant(homeWinner));

    const gameFive = await submit(transport, roomId, 'series-ready-g5', 'p1', {
      kind: 'ready-next-game',
      gameNumber: 5,
    });
    expect(gameFive.rejectionCode).toBe('invalid-phase');
    await expect(transport.join(created.code)).rejects.toThrow('room-full');
  });

  it('fails the room when confirmations disagree', async () => {
    const transport = createInMemoryHavocMultiplayerTransport({ seed: 'mismatch' });
    const { roomId } = await createAndJoin(transport);
    await startDraft(transport, roomId);
    await playDraft(transport, roomId, 'mismatch-');
    expect(await transport.fail(roomId)).toEqual({ failed: false, phase: 'lineup-showdown' });

    await submit(transport, roomId, 'mismatch-ready-p1', 'p1', {
      kind: 'ready-next-game',
      gameNumber: 1,
    });
    await submit(transport, roomId, 'mismatch-ready-p2', 'p2', {
      kind: 'ready-next-game',
      gameNumber: 1,
    });
    const broadcast = await submit(transport, roomId, 'mismatch-broadcast', 'p1', {
      kind: 'broadcast-start',
      gameNumber: 1,
    });
    expect(broadcast.accepted).toBe(true);

    const first = {
      inputDigest: havocDigestSchema.parse('1'.repeat(32)),
      resultDigest: havocDigestSchema.parse('2'.repeat(32)),
      tapeDigest: havocDigestSchema.parse('3'.repeat(32)),
    };
    const second = {
      inputDigest: havocDigestSchema.parse('4'.repeat(32)),
      resultDigest: havocDigestSchema.parse('5'.repeat(32)),
      tapeDigest: havocDigestSchema.parse('6'.repeat(32)),
    };
    const p1Proposal = await submit(transport, roomId, 'mismatch-propose-p1', 'p1', {
      kind: 'propose-result',
      gameNumber: 1,
      winner: 'p1',
      ...first,
    });
    expect(p1Proposal.accepted).toBe(true);
    const p2Proposal = await submit(transport, roomId, 'mismatch-propose-p2', 'p2', {
      kind: 'propose-result',
      gameNumber: 1,
      winner: 'p2',
      ...second,
    });
    expect(p2Proposal.accepted).toBe(true);
    const p2Confirm = await submit(transport, roomId, 'mismatch-confirm-p2', 'p2', {
      kind: 'confirm-result',
      gameNumber: 1,
      verified: true,
      ...second,
    });
    expect(p2Confirm.accepted).toBe(true);
    expect((await snapshot(transport, roomId)).phase).toBe('game-results');

    const p1Confirm = await submit(transport, roomId, 'mismatch-confirm-p1', 'p1', {
      kind: 'confirm-result',
      gameNumber: 1,
      verified: true,
      ...first,
    });
    expect(p1Confirm.accepted).toBe(true);
    const current = await snapshot(transport, roomId);
    expect(current.phase).toBe('integrity-failed');
    expect(current.series?.games[0]?.status).toBe('mismatch');
    expect(await transport.fail(roomId)).toEqual({ failed: true, phase: 'integrity-failed' });

    const blocked = await submit(transport, roomId, 'mismatch-after-fail', 'p1', {
      kind: 'ready-next-game',
      gameNumber: 1,
    });
    expect(blocked.rejectionCode).toBe('invalid-phase');
  });

  it('rematches into a successor room with a fresh seed and fresh draft', async () => {
    const transport = createInMemoryHavocMultiplayerTransport({ seed: 'rematch' });
    const { roomId } = await createAndJoin(transport);
    const parent = await startDraft(transport, roomId);
    const parentSeed = requireDraft(parent).rootSeed;
    const early = await submit(transport, roomId, 'rematch-early', 'p1', {
      kind: 'rematch-request',
    });
    expect(early.rejectionCode).toBe('invalid-phase');

    const claimed = await playDraft(transport, roomId, 'rematch-');
    for (let gameNumber = 1; gameNumber <= 4; gameNumber += 1) {
      await playGame(transport, roomId, gameNumber, 'p1');
    }
    let current = await snapshot(transport, roomId);
    expect(current.phase).toBe('championship');

    const fresh = await transport.create({ versions: locks() });
    await expect(transport.rematch(fresh.snapshot.roomId)).rejects.toThrow('phase');

    const requested = await submit(transport, roomId, 'rematch-request', 'p1', {
      kind: 'rematch-request',
    });
    expect(requested.accepted).toBe(true);
    const alone = await submit(transport, roomId, 'rematch-confirm-alone', 'p1', {
      kind: 'rematch-confirm',
    });
    expect(alone.rejectionCode).toBe('command-conflict');
    const confirmed = await submit(transport, roomId, 'rematch-confirm', 'p2', {
      kind: 'rematch-confirm',
    });
    expect(confirmed.accepted).toBe(true);

    current = await snapshot(transport, roomId);
    const successorId = current.successorRoomId;
    if (!successorId) throw new Error('rematch did not create a successor room');
    expect(successorId).not.toBe(roomId);

    const rematch = await transport.rematch(roomId);
    expect(rematch.snapshot.roomId).toBe(successorId);
    expect(rematch.snapshot.phase).toBe('lobby');
    expect(rematch.snapshot.draft).toBeNull();
    expect(rematch.snapshot.series).toBeNull();

    const joined = await transport.join(rematch.code);
    expect(joined.membership.participantId).toBe('p2');
    const successor = await startDraft(transport, successorId);
    const successorDraft = requireDraft(successor);
    expect(successorDraft.rootSeed).not.toBe(parentSeed);
    expect(successorDraft.picks).toEqual([]);
    expect(successorDraft.claimedPlayerIds).toEqual([]);

    const successorOffer = requireOffer(successor);
    const successorCard = successorOffer.cards[0];
    if (!successorCard) throw new Error('successor offer has no first card');
    expect(claimed[0]).toBe(successorCard.source.playerId);
    const reclaimed = await submit(
      transport,
      successorId,
      'successor-pick-0',
      successorDraft.firstPicker,
      {
        kind: 'pick',
        turnOrdinal: 0,
        offerId: successorOffer.offerId,
        cardId: successorCard.cardId,
        claimKey: claimKeyOf(successorCard),
      },
    );
    expect(reclaimed.accepted).toBe(true);
  });

  it('issues a 64-hex verification challenge and completes with two matching receipts', async () => {
    const transport = createInMemoryHavocMultiplayerTransport({ seed: 'verification' });
    const { roomId } = await createAndJoin(transport);
    await playChampionship(transport, roomId);
    expect((await snapshot(transport, roomId)).phase).toBe('championship');

    const challenge = contentHashSchema.parse(await transport.verificationChallenge(roomId));
    expect(challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge).toBe(await transport.verificationChallenge(roomId));

    const receiptDigest = contentHashSchema.parse('e'.repeat(64));
    const receipt = {
      receiptId: 'receipt-1',
      challenge,
      receiptDigest,
      resultDigest: GAME_DIGESTS.resultDigest,
      commandIds: [commandIdSchema.parse('confirm-p1-g4')],
      gameSeeds: [seedSchema.parse('d'.repeat(32))],
    };
    expect((await transport.complete(roomId, receiptDigest)).completed).toBe(false);
    await expect(transport.submitVerification(roomId, receipt, 0)).rejects.toMatchObject({
      rejectionCode: 'stale-revision',
    });
    await expect(
      transport.submitVerification(roomId, {
        ...receipt,
        challenge: contentHashSchema.parse('f'.repeat(64)),
      }),
    ).rejects.toMatchObject({ rejectionCode: 'invalid-receipt' });

    const submitted = await transport.submitVerification(roomId, receipt);
    expect(submitted.receiptId).toBe(receiptDigest);
    expect((await transport.complete(roomId, receiptDigest)).completed).toBe(false);
    await transport.submitVerification(roomId, {
      ...receipt,
      receiptId: 'receipt-2',
      receiptDigest: contentHashSchema.parse('f'.repeat(64)),
    });
    const completed = await transport.complete(roomId, receiptDigest);
    expect(completed.completed).toBe(true);
    expect(completed.phase).toBe('championship');
  });

  it('delivers transient events only to subscribers of the owning room', async () => {
    const transport = createInMemoryHavocMultiplayerTransport({ seed: 'transient' });
    const roomA = await transport.create({ versions: locks() });
    const roomB = await transport.create({ versions: locks() });
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
      participantId: 'p1' as const,
      turnOrdinal: 0,
      offerId: `hvo-${'a'.repeat(32)}`,
      cardId: `hvc-${'b'.repeat(32)}`,
      sentAtMs: 1,
    };
    expect(await transport.publishTransient(roomA.snapshot.roomId, event)).toBe(true);
    expect(receivedA).toEqual(['consideration']);
    expect(receivedB).toEqual([]);

    expect(await transport.publishTransient('missing-room', event)).toBe(false);
    expect(
      await transport.publishTransient(roomA.snapshot.roomId, {
        kind: 'nope',
      } as unknown as HavocMultiplayerTransientEvent),
    ).toBe(false);

    const reaction = {
      kind: 'reaction' as const,
      participantId: 'p2' as const,
      turnOrdinal: 0,
      reaction: 'hype' as const,
      sentAtMs: 2,
    };
    expect(await transport.publishTransient(roomA.snapshot.roomId, reaction)).toBe(true);
    expect(receivedA).toEqual(['consideration', 'reaction']);

    subscriptionA.unsubscribe();
    expect(await transport.publishTransient(roomA.snapshot.roomId, event)).toBe(true);
    expect(receivedA).toEqual(['consideration', 'reaction']);
  });

  it('refetches commands after a revision', async () => {
    const transport = createInMemoryHavocMultiplayerTransport({ seed: 'refetch' });
    const { roomId } = await createAndJoin(transport);
    await startDraft(transport, roomId);
    const afterStart = await snapshot(transport, roomId);
    const pick = await pickFirstCard(transport, roomId, 'refetch-pick-0');
    expect(pick.accepted).toBe(true);
    const afterPick = await snapshot(transport, roomId);

    const all = await transport.refetch(roomId, 0);
    expect(all.map((command) => command.commandId)).toEqual([
      commandIdSchema.parse('start'),
      commandIdSchema.parse('refetch-pick-0'),
    ]);
    expect(await transport.refetch(roomId, afterStart.revision)).toHaveLength(1);
    expect(await transport.refetch(roomId, afterPick.revision)).toHaveLength(0);
  });

  it('manages seats: idempotent join, resume, leave, and guest removal', async () => {
    const transport = createInMemoryHavocMultiplayerTransport({ seed: 'seats' });
    const created = await transport.create({ versions: locks() });
    const roomId = created.snapshot.roomId;
    const firstJoin = await transport.join(created.code);
    const secondJoin = await transport.join(created.code);
    expect(secondJoin.membership).toEqual(firstJoin.membership);

    const resumed = await transport.resume(roomId);
    expect(resumed.membership.participantId).toBe('p1');
    expect(resumed.membership.code).toBe(created.code);

    await transport.leave(roomId, 'p2');
    expect(
      (await snapshot(transport, roomId)).members.find((member) => member.participantId === 'p2')
        ?.online,
    ).toBe(false);

    const removed = await transport.removeGuest(roomId, 'p2');
    expect(removed.code).not.toBe(created.code);
    await expect(transport.preview(created.code)).rejects.toThrow('invalid-code');
    expect((await transport.preview(removed.code)).roomId).toBe(roomId);
    await expect(transport.removeGuest(roomId, 'p1')).rejects.toThrow('membership');
    const afterRemoval = await snapshot(transport, roomId);
    expect(afterRemoval.members.find((member) => member.participantId === 'p2')?.online).toBe(
      false,
    );
  });

  it('expires codes and rooms on the expiry tick', async () => {
    let now = 5_000_000;
    const transport = createInMemoryHavocMultiplayerTransport({
      seed: 'expiry',
      clock: () => now,
    });
    const created = await transport.create({ versions: locks() });
    const roomId = created.snapshot.roomId;
    expect((await transport.preview(created.code)).phase).toBe('lobby');

    now += HAVOC_MULTIPLAYER_CODE_TTL_MS + 1;
    expect(await transport.expireRooms()).toEqual([]);
    await expect(transport.preview(created.code)).rejects.toThrow('invalid-code');

    now += HAVOC_MULTIPLAYER_ROOM_RETENTION_MS - HAVOC_MULTIPLAYER_CODE_TTL_MS - 1;
    const expired = await transport.expireRooms();
    expect(expired).toHaveLength(1);
    expect(expired[0]?.phase).toBe('expired');
    expect((await snapshot(transport, roomId)).phase).toBe('expired');
    const rejected = await submit(transport, roomId, 'after-expiry', 'p1', { kind: 'ready' });
    expect(rejected.rejectionCode).toBe('expired');
  });

  it('produces identical snapshots for the same seed and command script', async () => {
    async function script(transport: InMemoryHavocMultiplayerTransport) {
      const { created, roomId } = await createAndJoin(transport);
      await startDraft(transport, roomId);
      await pickFirstCard(transport, roomId, 'det-pick-0');
      await pickFirstCard(transport, roomId, 'det-pick-1');
      const beforeReroll = await snapshot(transport, roomId);
      const draft = requireDraft(beforeReroll);
      const offer = requireOffer(beforeReroll);
      if (draft.activeParticipantId === null) throw new Error('draft has no active participant');
      const reroll = await submit(transport, roomId, 'det-reroll', draft.activeParticipantId, {
        kind: 'reroll',
        turnOrdinal: draft.turnOrdinal,
        offerId: offer.offerId,
      });
      expect(reroll.accepted).toBe(true);
      await pickFirstCard(transport, roomId, 'det-pick-2');
      return { created, snapshot: await snapshot(transport, roomId) };
    }

    const clock = () => 9_000_000;
    const left = await script(
      createInMemoryHavocMultiplayerTransport({ seed: 'deterministic', clock }),
    );
    const right = await script(
      createInMemoryHavocMultiplayerTransport({ seed: 'deterministic', clock }),
    );
    expect(left.created.code).toBe(right.created.code);
    expect(left.created.snapshot).toEqual(right.created.snapshot);
    expect(left.snapshot).toEqual(right.snapshot);
  });
});
