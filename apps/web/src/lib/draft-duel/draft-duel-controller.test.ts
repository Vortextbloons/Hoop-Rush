import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commandIdSchema,
  contentHashSchema,
  createInMemoryDraftDuelTransport,
  defaultDraftDuelVersionLocks,
  draftDuelFirstPickerFor,
  playerIdSchema,
  playerVersionIdSchema,
  type DraftDuelCommandPayload,
  type DraftDuelMultiplayerTransport,
  type DraftDuelParticipantId,
  type DraftDuelRoomSnapshot,
  type Id,
} from '@hoop-rush/data-contracts';
import { DraftDuelController } from './draft-duel-controller.svelte';

let transport: DraftDuelMultiplayerTransport;
vi.mock('$lib/draft-duel-transport', () => ({ getDraftDuelTransport: () => transport }));

type ControllerLifecycle = {
  roomId: Id;
  applySnapshot: (snapshot: DraftDuelRoomSnapshot) => void;
  startTimers: () => void;
};

describe('Draft Duel ready check progression', () => {
  let controller: DraftDuelController;
  let unsubscribe: () => void;
  let roomId: Id;
  let commandNumber: number;

  async function submit(actor: DraftDuelParticipantId, payload: DraftDuelCommandPayload) {
    const receipt = await transport.submitCommand({
      schemaVersion: 1,
      roomId,
      commandId: commandIdSchema.parse(`ready-test-${String(commandNumber++)}`),
      actorParticipantId: actor,
      payload,
    });
    expect(receipt.accepted).toBe(true);
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    transport = createInMemoryDraftDuelTransport({ seed: 'ready-check', clock: () => Date.now() });
    commandNumber = 0;
    const created = await transport.create({
      fairness: 'unfair',
      presentation: 'ratings',
      versions: defaultDraftDuelVersionLocks({
        catalogHash: contentHashSchema.parse('a'.repeat(64)),
      }),
    });
    roomId = created.snapshot.roomId;
    await transport.join(created.code);
    await submit('p1', { kind: 'ready', ready: true });
    await submit('p2', { kind: 'ready', ready: true });
    await submit('p1', { kind: 'start' });
    const started = (await transport.resume(roomId)).snapshot;
    if (!started.rootSeed) throw new Error('Draft seed is missing');
    const first = draftDuelFirstPickerFor(started.rootSeed);
    for (let ordinal = 0; ordinal < 10; ordinal++) {
      await submit(ordinal % 2 === 0 ? first : first === 'p1' ? 'p2' : 'p1', {
        kind: 'pick',
        pickOrdinal: ordinal,
        playerId: playerIdSchema.parse(`ready-player-${String(ordinal)}`),
        playerVersionId: playerVersionIdSchema.parse(`pv-${String(ordinal).padStart(32, '0')}`),
      });
    }
    controller = new DraftDuelController();
    controller.participantId = 'p1';
    const lifecycle = controller as unknown as ControllerLifecycle;
    lifecycle.roomId = roomId;
    lifecycle.applySnapshot((await transport.resume(roomId)).snapshot);
    unsubscribe = transport.subscribe(roomId, (snapshot) => {
      lifecycle.applySnapshot(snapshot);
    }).unsubscribe;
    lifecycle.startTimers();
  });

  afterEach(() => {
    unsubscribe();
    controller.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(['local', 'opponent'])('starts Game 1 when %s readies first', async (first) => {
    if (first === 'local') {
      await controller.readyForNextGame();
      await submit('p2', { kind: 'ready-next-game', gameNumber: 1, ready: true });
    } else {
      await submit('p2', { kind: 'ready-next-game', gameNumber: 1, ready: true });
      await controller.readyForNextGame();
    }
    expect(controller.phase).toBe('preparing-game');
    expect(controller.localReady).toBe(true);
    expect(controller.opponentReady).toBe(true);

    await vi.advanceTimersByTimeAsync(250);

    expect(controller.phase).toBe('broadcasting');
    expect(controller.currentBroadcast?.gameNumber).toBe(1);
  });

  it('waits for the opponent until the 60-second fallback', async () => {
    await controller.readyForNextGame();
    await vi.advanceTimersByTimeAsync(59_750);
    expect(controller.phase).toBe('preparing-game');

    await vi.advanceTimersByTimeAsync(250);

    expect(controller.phase).toBe('broadcasting');
    expect(controller.currentBroadcast?.gameNumber).toBe(1);
  });

  it('does not start while only the opponent is ready', async () => {
    await submit('p2', { kind: 'ready-next-game', gameNumber: 1, ready: true });

    await vi.advanceTimersByTimeAsync(250);

    expect(controller.phase).toBe('preparing-game');
    expect(controller.localReady).toBe(false);
    expect(controller.currentBroadcast).toBeNull();
  });

  it('retries starting after a transient command failure', async () => {
    await controller.readyForNextGame();
    await submit('p2', { kind: 'ready-next-game', gameNumber: 1, ready: true });
    vi.spyOn(transport, 'submitCommand').mockRejectedValueOnce(new Error('temporary failure'));

    await vi.advanceTimersByTimeAsync(250);
    expect(controller.phase).toBe('preparing-game');
    await vi.advanceTimersByTimeAsync(5000);

    expect(controller.phase).toBe('broadcasting');
  });
});
