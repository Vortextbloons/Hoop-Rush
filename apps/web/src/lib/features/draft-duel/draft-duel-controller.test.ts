import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commandIdSchema,
  contentHashSchema,
  DRAFT_DUEL_BROADCAST_MS,
  DRAFT_DUEL_TAPE_VERSION,
  createInMemoryDraftDuelTransport,
  defaultDraftDuelVersionLocks,
  draftDuelFirstPickerFor,
  playerIdSchema,
  playerVersionIdSchema,
  seedSchema,
  type DraftDuelCommandPayload,
  type DraftDuelDraft,
  type DraftDuelGameOutput,
  type DraftDuelMultiplayerTransport,
  type DraftDuelParticipantId,
  type DraftDuelRoomSnapshot,
  type DraftDuelTransientEvent,
  type Id,
} from '@hoop-rush/data-contracts';
import { createEngineContext, simulateRecordedGame } from '@hoop-rush/engine';
import * as engine from '@hoop-rush/engine';
import { buildLegalSimulationTeam, DEFAULT_ERA_SIM_PROFILE } from '@hoop-rush/test-fixtures';
import type { DraftDuelAssets } from './draft-duel-assets';
import { DraftDuelController } from './draft-duel-controller.svelte';
import { createDraftDuelSession, type DraftDuelSession } from './draft-duel-session';

type SessionLifecycle = {
  roomId: Id;
  participantId: DraftDuelParticipantId | null;
  snapshot: DraftDuelRoomSnapshot | null;
  draft: DraftDuelDraft | null;
  outputs: Record<number, DraftDuelGameOutput>;
  assets: DraftDuelAssets | null;
  progress: number;
  publish: () => void;
  applySnapshot: (snapshot: DraftDuelRoomSnapshot) => void;
  startTimers: () => void;
  maybeProposeOrConfirm: () => void;
  rebuildDraft: () => void;
  ensureGamePipeline: () => Promise<void>;
  persistActive: () => Promise<void>;
  resolveDeadline: (cursor: string, pickOrdinal: number) => Promise<void>;
  syncFromServer: () => Promise<void>;
  deps: {
    repository: {
      appendCommands: (...args: unknown[]) => Promise<void>;
      saveVerification: (...args: unknown[]) => Promise<void>;
    };
  };
};

function emitTransient(session: DraftDuelSession, event: DraftDuelTransientEvent): void {
  (session as unknown as { emitTransient: (event: DraftDuelTransientEvent) => void }).emitTransient(
    event,
  );
}

describe('Draft Duel ready check progression', () => {
  let session: DraftDuelSession;
  let controller: DraftDuelController;
  let transport: DraftDuelMultiplayerTransport;
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
    session = createDraftDuelSession({ transport });
    controller = new DraftDuelController(session);
    const lifecycle = session as unknown as SessionLifecycle;
    lifecycle.participantId = 'p1';
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
    vi.restoreAllMocks();
  });

  function isolateSync() {
    const lifecycle = session as unknown as SessionLifecycle;
    lifecycle.assets = {} as DraftDuelAssets;
    vi.spyOn(lifecycle, 'rebuildDraft').mockImplementation(() => {});
    vi.spyOn(lifecycle, 'ensureGamePipeline').mockResolvedValue();
    vi.spyOn(lifecycle, 'persistActive').mockResolvedValue();
    vi.spyOn(lifecycle.deps.repository, 'appendCommands').mockResolvedValue();
    return lifecycle;
  }

  it('refreshes accepted commands without a realtime notification', async () => {
    isolateSync();
    unsubscribe();
    await controller.readyForNextGame();
    expect(controller.phase).toBe('preparing-game');
    expect(controller.localReady).toBe(true);
  });

  it.each(['p1', 'p2'] as const)(
    'creates one successor when %s confirms the rematch',
    async (confirmingSeat) => {
      const lifecycle = isolateSync();
      const digest = contentHashSchema.parse('b'.repeat(64));
      for (let gameNumber = 1; gameNumber <= 4; gameNumber++) {
        await submit('p1', { kind: 'ready-next-game', gameNumber, ready: true });
        await submit('p2', { kind: 'ready-next-game', gameNumber, ready: true });
        await submit('p1', { kind: 'broadcast-start', gameNumber });
        for (const actor of ['p1', 'p2'] as const) {
          await submit(actor, {
            kind: 'propose-result',
            gameNumber,
            winner: 'p1',
            resultDigest: digest,
            tapeDigest: digest,
            inputDigest: digest,
          });
        }
        for (const actor of ['p1', 'p2'] as const) {
          await submit(actor, {
            kind: 'confirm-result',
            gameNumber,
            resultDigest: digest,
            verified: true,
          });
        }
      }
      expect(controller.myRematchRequested).toBe(false);
      expect(controller.rivalRematchRequested).toBe(false);
      await controller.requestRematch();
      expect(controller.myRematchRequested).toBe(true);
      await submit('p2', { kind: 'rematch-request' });
      if (confirmingSeat === 'p1') await controller.confirmRematch();
      else {
        await submit('p2', { kind: 'rematch-confirm' });
        await lifecycle.syncFromServer();
      }
      const successor = controller.successorRoomId;
      expect(successor).not.toBeNull();
      expect(controller.error).toBeNull();
      expect(await controller.followRematch()).toBe(successor);
      expect((await transport.rematch(roomId)).snapshot.roomId).toBe(successor);
    },
  );

  it('does not roll back to an older room snapshot', () => {
    const lifecycle = session as unknown as SessionLifecycle;
    const current = controller.snapshot;
    if (!current) throw new Error('Missing snapshot');
    lifecycle.applySnapshot({ ...current, revision: current.revision - 1, phase: 'lobby' });
    expect(controller.phase).toBe('lineup-showdown');
  });

  function stubManualRaf(): () => void {
    const scheduled: FrameRequestCallback[] = [];
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        scheduled.push(callback);
        return scheduled.length;
      }),
    );
    return () => {
      const frame = scheduled.at(-1);
      if (frame) frame(Date.now());
    };
  }

  function applyBroadcastSnapshot(startedAtMs: number): void {
    const lifecycle = session as unknown as SessionLifecycle;
    const current = controller.snapshot;
    if (!current) throw new Error('Missing snapshot');
    lifecycle.applySnapshot({
      ...current,
      revision: current.revision + 1,
      phase: 'broadcasting',
      broadcast: {
        gameNumber: 1,
        startedAtIso: new Date(startedAtMs).toISOString(),
        durationMs: DRAFT_DUEL_BROADCAST_MS,
      },
    });
  }

  it('resumes broadcast progress from wall clock when attaching mid-broadcast', () => {
    const tick = stubManualRaf();
    applyBroadcastSnapshot(Date.now() - DRAFT_DUEL_BROADCAST_MS / 2);
    tick();
    expect(controller.progress).toBeCloseTo(0.5, 5);
  });

  it('advances broadcast playback uniformly at a fixed rate', () => {
    const tick = stubManualRaf();
    applyBroadcastSnapshot(Date.now());
    tick();
    expect(controller.progress).toBe(0);

    for (let frame = 0; frame < 4; frame++) {
      vi.advanceTimersByTime(1000);
      tick();
    }
    expect(controller.progress).toBeCloseTo(0.5, 5);
  });

  it.each([false, true])(
    'resolves an opponent timeout with transient failure=%s',
    async (failFirst) => {
      unsubscribe();
      const lifecycle = isolateSync();
      const created = await transport.create({
        fairness: 'unfair',
        presentation: 'ratings',
        versions: defaultDraftDuelVersionLocks({
          catalogHash: contentHashSchema.parse('a'.repeat(64)),
        }),
      });
      roomId = created.snapshot.roomId;
      lifecycle.roomId = roomId;
      await transport.join(created.code);
      await submit('p1', { kind: 'ready', ready: true });
      await submit('p2', { kind: 'ready', ready: true });
      await submit('p1', { kind: 'start' });
      const started = (await transport.resume(roomId)).snapshot;
      const deadline = started.deadline;
      if (!deadline) throw new Error('Missing deadline');
      lifecycle.snapshot = null;
      lifecycle.applySnapshot(started);
      lifecycle.participantId = deadline.participantId === 'p1' ? 'p2' : 'p1';
      lifecycle.draft = { status: 'drafting', pickOrdinal: 0 } as NonNullable<
        typeof lifecycle.draft
      >;
      vi.spyOn(engine, 'draftDuelTimeoutPick').mockReturnValue({
        pickOrdinal: 0,
        playerId: playerIdSchema.parse('timeout-player'),
        playerVersionId: playerVersionIdSchema.parse(`pv-${'1'.repeat(32)}`),
        slotIndex: 0,
        seedPath: 'draft-duel/timeout/0',
      });
      vi.setSystemTime(new Date(deadline.deadlineAt));
      if (failFirst)
        vi.spyOn(transport, 'commitFallback').mockRejectedValueOnce(new Error('network'));
      await lifecycle.resolveDeadline(deadline.cursor, 0);
      if (failFirst) {
        expect(
          (await transport.refetch(roomId, -1)).filter(
            (c) => c.payload.kind === 'timeout-autopick',
          ),
        ).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(5000);
      }
      const commands = await transport.refetch(roomId, -1);
      const timeout = commands.filter((command) => command.payload.kind === 'timeout-autopick');
      expect(timeout).toHaveLength(1);
      expect(timeout[0]?.actorParticipantId).toBe(deadline.participantId);
    },
  );

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

  async function prepareSecondGame() {
    const digest = contentHashSchema.parse('b'.repeat(64));
    await controller.readyForNextGame();
    await submit('p2', { kind: 'ready-next-game', gameNumber: 1, ready: true });
    await controller.startBroadcast();
    for (const actor of ['p1', 'p2'] as const) {
      await submit(actor, {
        kind: 'propose-result',
        gameNumber: 1,
        winner: 'p1',
        resultDigest: digest,
        tapeDigest: digest,
        inputDigest: digest,
      });
    }
    for (const actor of ['p1', 'p2'] as const) {
      await submit(actor, {
        kind: 'confirm-result',
        gameNumber: 1,
        resultDigest: digest,
        verified: true,
      });
    }
    await controller.readyForNextGame();
    await submit('p2', { kind: 'ready-next-game', gameNumber: 2, ready: true });
    await controller.startBroadcast();
    const seed = seedSchema.parse('a'.repeat(16));
    const recorded = simulateRecordedGame(
      {
        schemaVersion: 2,
        seed,
        gameNumber: 2,
        dataVersion: 'fixture',
        profile: DEFAULT_ERA_SIM_PROFILE,
        home: buildLegalSimulationTeam({ teamId: 'p1' }),
        away: buildLegalSimulationTeam({ teamId: 'p2' }),
      },
      createEngineContext(),
    );
    const lifecycle = session as unknown as SessionLifecycle;
    lifecycle.outputs = {
      2: {
        schemaVersion: DRAFT_DUEL_TAPE_VERSION,
        roomId,
        gameNumber: 2,
        homeParticipantId: 'p1',
        awayParticipantId: 'p2',
        seed,
        result: recorded.result,
        tape: recorded.tape,
        resultDigest: digest,
        tapeDigest: digest,
        inputDigest: digest,
      },
    };
    lifecycle.progress = 1;
    lifecycle.assets = {} as DraftDuelAssets;
    vi.spyOn(lifecycle, 'rebuildDraft').mockImplementation(() => {});
    vi.spyOn(lifecycle, 'ensureGamePipeline').mockResolvedValue();
    vi.spyOn(lifecycle, 'persistActive').mockResolvedValue();
    vi.spyOn(lifecycle.deps.repository, 'appendCommands').mockResolvedValue();
    vi.spyOn(lifecycle.deps.repository, 'saveVerification').mockResolvedValue();
    await submit('p2', {
      kind: 'propose-result',
      gameNumber: 2,
      winner: recorded.result.winner === 'home' ? 'p1' : 'p2',
      resultDigest: digest,
      tapeDigest: digest,
      inputDigest: digest,
    });
    return { lifecycle, digest };
  }

  it('submits Game 2 confirmation after publishing its result while the opponent result is already present', async () => {
    const { lifecycle, digest } = await prepareSecondGame();
    lifecycle.maybeProposeOrConfirm();
    await vi.waitFor(async () => {
      const commands = await transport.refetch(roomId, -1);
      expect(
        commands.some(
          (command) =>
            command.actorParticipantId === 'p1' &&
            command.payload.kind === 'confirm-result' &&
            command.payload.gameNumber === 2,
        ),
      ).toBe(true);
    });
    await submit('p2', {
      kind: 'confirm-result',
      gameNumber: 2,
      resultDigest: digest,
      verified: true,
    });
    expect(controller.phase).toBe('preparing-game');
    expect(controller.currentGameNumber).toBe(3);
    await controller.readyForNextGame();
    expect(controller.localReady).toBe(true);
  });

  it('holds the Game 2 results screen until continue is approved', async () => {
    const { lifecycle, digest } = await prepareSecondGame();
    session.advancePlayback(DRAFT_DUEL_BROADCAST_MS);
    lifecycle.maybeProposeOrConfirm();
    await vi.waitFor(async () => {
      const commands = await transport.refetch(roomId, -1);
      expect(
        commands.some(
          (command) =>
            command.actorParticipantId === 'p1' &&
            command.payload.kind === 'propose-result' &&
            command.payload.gameNumber === 2,
        ),
      ).toBe(true);
    });
    const held = await transport.refetch(roomId, -1);
    expect(
      held.some(
        (command) =>
          command.actorParticipantId === 'p1' &&
          command.payload.kind === 'confirm-result' &&
          command.payload.gameNumber === 2,
      ),
    ).toBe(false);
    expect(controller.awaitingContinue).toBe(true);

    controller.continueAfterGame();
    await vi.waitFor(async () => {
      const commands = await transport.refetch(roomId, -1);
      expect(
        commands.some(
          (command) =>
            command.actorParticipantId === 'p1' &&
            command.payload.kind === 'confirm-result' &&
            command.payload.gameNumber === 2,
        ),
      ).toBe(true);
    });
    await submit('p2', {
      kind: 'confirm-result',
      gameNumber: 2,
      resultDigest: digest,
      verified: true,
    });
    expect(controller.phase).toBe('preparing-game');
    expect(controller.currentGameNumber).toBe(3);
    expect(controller.awaitingContinue).toBe(false);
  });

  it('auto-continues from the Game 2 results screen after the hold window', async () => {
    const { lifecycle, digest } = await prepareSecondGame();
    session.advancePlayback(DRAFT_DUEL_BROADCAST_MS);
    lifecycle.maybeProposeOrConfirm();
    await vi.waitFor(async () => {
      const commands = await transport.refetch(roomId, -1);
      expect(
        commands.some(
          (command) =>
            command.actorParticipantId === 'p1' &&
            command.payload.kind === 'propose-result' &&
            command.payload.gameNumber === 2,
        ),
      ).toBe(true);
    });
    expect(controller.awaitingContinue).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(async () => {
      const commands = await transport.refetch(roomId, -1);
      expect(
        commands.some(
          (command) =>
            command.actorParticipantId === 'p1' &&
            command.payload.kind === 'confirm-result' &&
            command.payload.gameNumber === 2,
        ),
      ).toBe(true);
    });
    await submit('p2', {
      kind: 'confirm-result',
      gameNumber: 2,
      resultDigest: digest,
      verified: true,
    });
    expect(controller.phase).toBe('preparing-game');
  });

  it.each([
    ['propose-result', 'network'],
    ['confirm-result', 'network'],
    ['propose-result', 'rejection'],
    ['confirm-result', 'rejection'],
  ] as const)(
    'retries Game 2 %s after %s failure without marking it verified',
    async (kind, failure) => {
      const { lifecycle } = await prepareSecondGame();
      const originalSubmit = transport.submitCommand.bind(transport);
      let failed = false;
      vi.spyOn(transport, 'submitCommand').mockImplementation(async (command) => {
        if (!failed && command.payload.kind === kind) {
          failed = true;
          if (failure === 'rejection') {
            return {
              roomId,
              commandId: command.commandId,
              ordinal: 0,
              accepted: false,
              rejectionCode: 'not-ready',
              revision: 0,
            };
          }
          throw new Error('temporary result failure');
        }
        return originalSubmit(command);
      });
      lifecycle.maybeProposeOrConfirm();
      await vi.advanceTimersByTimeAsync(0);
      expect(failed).toBe(true);
      expect(
        controller.verification.some(
          (entry) => entry.gameNumber === 2 && entry.status === 'verified',
        ),
      ).toBe(false);
      await vi.advanceTimersByTimeAsync(5000);
      const commands = await transport.refetch(roomId, -1);
      expect(
        commands.filter(
          (command) =>
            command.actorParticipantId === 'p1' &&
            command.payload.kind === kind &&
            command.payload.gameNumber === 2,
        ),
      ).toHaveLength(1);
      expect(controller.verification.find((entry) => entry.gameNumber === 2)?.status).toBe(
        'verified',
      );
    },
  );

  it('displays an opponent consideration and clears it after two seconds', () => {
    const lifecycle = session as unknown as SessionLifecycle;
    const playerVersionId = playerVersionIdSchema.parse(`pv-${'7'.repeat(32)}`);
    lifecycle.assets = {
      catalog: {
        byVersionId: new Map([
          [playerVersionId, { card: { displayName: 'Considered Cal', seasonKey: '1999-lal' } }],
        ]),
      },
    } as unknown as DraftDuelAssets;
    lifecycle.publish();
    expect(controller.consideration).toBeNull();

    emitTransient(session, {
      kind: 'consideration',
      roomId,
      participantId: 'p2',
      pickOrdinal: 0,
      playerId: playerIdSchema.parse('dd-considered'),
      playerVersionId,
      sentAtMs: Date.now(),
    });
    expect(controller.consideration?.displayName).toBe('Considered Cal');
    expect(controller.consideration?.seasonKey).toBe('1999-lal');

    vi.advanceTimersByTime(2000);
    expect(controller.consideration).toBeNull();
  });

  it('gates outgoing and incoming reactions while muted', async () => {
    const lifecycle = session as unknown as SessionLifecycle;
    lifecycle.draft = { status: 'drafting', pickOrdinal: 0 } as NonNullable<typeof lifecycle.draft>;
    const publish = vi.spyOn(transport, 'publishTransient').mockResolvedValue(true);

    await controller.react('hype');
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[1]).toMatchObject({
      kind: 'reaction',
      participantId: 'p1',
      reaction: 'hype',
    });

    controller.setMuted(true);
    await controller.react('clap');
    expect(publish).toHaveBeenCalledTimes(1);

    emitTransient(session, {
      kind: 'reaction',
      roomId,
      participantId: 'p2',
      pickOrdinal: 0,
      reaction: 'cold',
      sentAtMs: Date.now(),
    });
    expect(controller.reaction).toBeNull();

    controller.setMuted(false);
    emitTransient(session, {
      kind: 'reaction',
      roomId,
      participantId: 'p2',
      pickOrdinal: 0,
      reaction: 'wow',
      sentAtMs: Date.now(),
    });
    expect(controller.reaction?.reaction).toBe('wow');
  });
});
