import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commandIdSchema,
  contentHashSchema,
  DRAFT_DUEL_TAPE_VERSION,
  createInMemoryDraftDuelTransport,
  defaultDraftDuelVersionLocks,
  draftDuelFirstPickerFor,
  playerIdSchema,
  playerVersionIdSchema,
  seedSchema,
  type DraftDuelCommandPayload,
  type DraftDuelMultiplayerTransport,
  type DraftDuelParticipantId,
  type DraftDuelRoomSnapshot,
  type Id,
} from '@hoop-rush/data-contracts';
import { createEngineContext, simulateRecordedGame } from '@hoop-rush/engine';
import { buildLegalSimulationTeam, DEFAULT_ERA_SIM_PROFILE } from '@hoop-rush/test-fixtures';
import type { DraftDuelAssets } from './draft-duel-assets';
import { DraftDuelController } from './draft-duel-controller.svelte';

let transport: DraftDuelMultiplayerTransport;
vi.mock('$lib/draft-duel-transport', () => ({ getDraftDuelTransport: () => transport }));

type ControllerLifecycle = {
  roomId: Id;
  applySnapshot: (snapshot: DraftDuelRoomSnapshot) => void;
  startTimers: () => void;
  maybeProposeOrConfirm: () => void;
  rebuildDraft: () => void;
  ensureGamePipeline: () => Promise<void>;
  persistActive: () => Promise<void>;
  repo: {
    appendCommands: (...args: unknown[]) => Promise<void>;
    saveVerification: (...args: unknown[]) => Promise<void>;
  };
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
    controller.outputs = {
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
    controller.progress = 1;
    controller.assets = {} as DraftDuelAssets;
    const lifecycle = controller as unknown as ControllerLifecycle;
    vi.spyOn(lifecycle, 'rebuildDraft').mockImplementation(() => {});
    vi.spyOn(lifecycle, 'ensureGamePipeline').mockResolvedValue();
    vi.spyOn(lifecycle, 'persistActive').mockResolvedValue();
    vi.spyOn(lifecycle.repo, 'appendCommands').mockResolvedValue();
    vi.spyOn(lifecycle.repo, 'saveVerification').mockResolvedValue();
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
});
