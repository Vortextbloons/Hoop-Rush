import {
  buildEraSimulationProfile,
  buildFixtureBracket,
  buildManifest,
  buildSimulationPlayer,
} from '@hoop-rush/test-fixtures';
import {
  createEngineContext,
  shared82GameEvents,
  verifyFixedFiveCompetition,
} from '@hoop-rush/engine';
import type { FixedFiveCompetitionRun, Position } from '@hoop-rush/data-contracts';
import { afterEach, assert, describe, expect, it, vi } from 'vitest';
import {
  commandIdSchema,
  contentHashSchema,
  defaultFixedFiveVersionLocks,
  franchiseIdSchema,
  playerIdSchema,
  type FixedFiveCommand,
  type FixedFiveCommandPayload,
  type FixedFiveCommandReceipt,
  type FixedFiveMultiplayerTransport,
  type FixedFiveRoomMode,
  type FixedFiveRoomSnapshot,
  type FixedFiveRoomMembership,
  type FixedFiveSourceMode,
  type FixedFiveWorkerTeam,
  type Id,
} from '@hoop-rush/data-contracts';
import { createInMemoryFixedFiveTransport } from './in-memory-transport.ts';
import {
  FixedFiveRoomSession,
  type FixedFiveRoomRepositoryPort,
  type FixedFiveRoomSessionDeps,
  type FixedFiveRoomSessionSnapshot,
  type FixedFiveRunnerEvent,
  type FixedFiveRunnerPort,
  type FixedFiveSessionAssets,
} from './session.ts';
import type { FixedFiveCandidate } from '@hoop-rush/engine';

class FakeRunner implements FixedFiveRunnerPort {
  readonly events: FixedFiveRunnerEvent[] = [];
  readonly sharedRuns: Parameters<FixedFiveRunnerPort['runShared82']>[0][] = [];
  readonly duelRuns: Parameters<FixedFiveRunnerPort['runDuel']>[0][] = [];
  readonly duelGameRuns: Parameters<FixedFiveRunnerPort['runDuelGame']>[0][] = [];
  disposed = false;
  private readonly onEvent: (event: FixedFiveRunnerEvent) => void;
  constructor(onEvent: (event: FixedFiveRunnerEvent) => void) {
    this.onEvent = onEvent;
  }
  runShared82(input: Parameters<FixedFiveRunnerPort['runShared82']>[0]): void {
    this.sharedRuns.push(input);
  }
  runDuel(input: Parameters<FixedFiveRunnerPort['runDuel']>[0]): void {
    this.duelRuns.push(input);
  }
  runDuelGame(input: Parameters<FixedFiveRunnerPort['runDuelGame']>[0]): void {
    this.duelGameRuns.push(input);
  }
  readonly verifications: Parameters<FixedFiveRunnerPort['verify']>[0][] = [];
  verify(input: Parameters<FixedFiveRunnerPort['verify']>[0]): void {
    this.verifications.push(input);
  }
  dispose(): void {
    this.disposed = true;
  }
  emit(event: FixedFiveRunnerEvent): void {
    this.events.push(event);
    this.onEvent(event);
  }
}

interface FakeRepository extends FixedFiveRoomRepositoryPort {
  rows: Map<number, FixedFiveCommand>;
  snapshotCursor: number;
  pending: FixedFiveCompetitionRun | null;
}

function createFakeRepository(): FakeRepository {
  const rows = new Map<number, FixedFiveCommand>();
  const repository: FakeRepository = {
    rows,
    snapshotCursor: -1,
    pending: null,
    listCommands: () => Promise.resolve([...rows.values()].sort((a, b) => a.ordinal - b.ordinal)),
    appendCommand: (command) => {
      rows.set(command.ordinal, command);
      return Promise.resolve();
    },
    saveActiveSnapshot: (_snapshot, commandCursor) => {
      repository.snapshotCursor = commandCursor;
      return Promise.resolve();
    },
    loadPendingResult: () =>
      Promise.resolve(repository.pending ? { run: repository.pending } : null),
    savePendingResult: (_roomId, run) => {
      repository.pending = run;
      return Promise.resolve();
    },
    clearPendingResult: () => {
      repository.pending = null;
      return Promise.resolve();
    },
  };
  return repository;
}

interface Harness {
  transport: FixedFiveMultiplayerTransport;
  repository: FakeRepository;
  memberships: FixedFiveRoomMembership[];
  runners: FakeRunner[];
  deps: FixedFiveRoomSessionDeps;
  createRoom(options?: {
    mode?: FixedFiveRoomMode;
    sourceMode?: FixedFiveSourceMode;
  }): Promise<{ snapshot: FixedFiveRoomSnapshot; code: string }>;
  session(): FixedFiveRoomSession;
}

function createHarness(overrides: Partial<FixedFiveRoomSessionDeps> = {}): Harness {
  const clock = { now: 1_700_000_000_000 };
  let commandSequence = 0;
  const transport = createInMemoryFixedFiveTransport({
    clock: () => clock.now,
    random: { seed: 'fixed-five-room-session-test' },
  });
  const repository = createFakeRepository();
  const memberships: FixedFiveRoomMembership[] = [];
  const runners: FakeRunner[] = [];
  const deps: FixedFiveRoomSessionDeps = {
    roomId: 'pending-room',
    transport,
    repository,
    createRunner: (onEvent) => {
      const runner = new FakeRunner(onEvent);
      runners.push(runner);
      return runner;
    },
    loadAssets: () => Promise.resolve(null),
    loadMembership: () => null,
    saveMembership: (membership) => {
      memberships.push(membership);
    },
    loadLobbyId: () => null,
    removeLobbyGuest: () => {
      throw new Error('unexpected lobby remove');
    },
    now: () => clock.now,
    newCommandId: () => `command-id-${String((commandSequence += 1))}`,
    friendlyError: (error) => (error instanceof Error ? error.message : String(error)),
    buildTeam: (_manifest, teamId, displayName, refs) =>
      Promise.resolve({
        teamId,
        displayName,
        players: refs.map((ref) => ({
          playerId: ref.playerId,
          displayName: `Player ${ref.playerId}`,
        })),
      } as unknown as FixedFiveWorkerTeam),
    loadActivityAt: () => null,
    saveActivityNow: () => {},
    prefersReducedMotion: () => false,
    guardStorage: {
      load: () => null,
      save: () => {},
    },
    ...overrides,
  };
  return {
    transport,
    repository,
    memberships,
    runners,
    deps,
    async createRoom(options = {}) {
      const created = await transport.create({
        mode: options.mode ?? 'classic-shared-82',
        sourceMode: options.sourceMode ?? 'classic',
        variant: 'ratings',
        versions: defaultFixedFiveVersionLocks({
          dataVersion: 'test-data',
          engineVersion: 'test-engine',
        }),
      });
      deps.roomId = created.snapshot.roomId;
      return { snapshot: created.snapshot, code: created.code };
    },
    session() {
      return new FixedFiveRoomSession(deps);
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function sandboxCandidate(index: number): FixedFiveCandidate {
  const playerId = playerIdSchema.parse(`player-${String(index).padStart(2, '0')}`);
  return {
    playerId,
    playerVersionId: `pv-${index.toString(16).padStart(32, '0')}`,
    positions: ['PG', 'SG', 'SF', 'PF', 'C'],
    selectionScore: 60 - index,
    franchiseId: 'test-franchise',
    eraId: 'test-era',
  };
}

function sandboxAssets(pool: FixedFiveCandidate[]): FixedFiveSessionAssets {
  return {
    pool,
    poolById: new Map(pool.map((candidate) => [candidate.playerId, candidate])),
  } as unknown as FixedFiveSessionAssets;
}

async function fillSandboxDraft(
  transport: FixedFiveMultiplayerTransport,
  roomId: Id,
  pool: FixedFiveCandidate[],
): Promise<void> {
  const submit = (
    commandId: string,
    actor: 'p1' | 'p2',
    payload: FixedFiveCommandPayload,
  ): Promise<FixedFiveCommandReceipt> =>
    transport.submitCommand({
      schemaVersion: 1,
      roomId,
      commandId: commandIdSchema.parse(commandId),
      actorParticipantId: actor,
      payload,
    });
  const startReceipt = await submit('cmd-start', 'p1', { kind: 'start' });
  expect(startReceipt.accepted).toBe(true);
  const used = new Set<string>();
  const slots: Record<'p1' | 'p2', number> = { p1: 0, p2: 0 };
  for (let ordinal = 0; ordinal < 10; ordinal += 1) {
    const resumed = await transport.resume(roomId);
    const picker = resumed.snapshot.deadline?.participantId;
    if (!picker) throw new Error('sandbox draft deadline closed early');
    const candidate = pool.find((entry) => !used.has(entry.playerId));
    if (!candidate) throw new Error('sandbox pool exhausted');
    used.add(candidate.playerId);
    const receipt = await submit(`cmd-pick-${String(ordinal)}`, picker, {
      kind: 'sandbox-place',
      playerId: candidate.playerId,
      playerVersionId: candidate.playerVersionId,
      slotIndex: slots[picker],
    });
    expect(receipt.accepted).toBe(true);
    slots[picker] += 1;
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('condition was never met');
}

async function fillDuelDraft(transport: FixedFiveMultiplayerTransport, roomId: Id): Promise<void> {
  const submit = (
    commandId: string,
    actor: 'p1' | 'p2',
    payload: FixedFiveCommandPayload,
  ): Promise<FixedFiveCommandReceipt> =>
    transport.submitCommand({
      schemaVersion: 1,
      roomId,
      commandId: commandIdSchema.parse(commandId),
      actorParticipantId: actor,
      payload,
    });
  const startReceipt = await submit('duel-start', 'p1', { kind: 'start' });
  expect(startReceipt.accepted).toBe(true);
  for (let index = 0; index < 10; index += 1) {
    const receipt = await submit(`duel-pick-${String(index)}`, index % 2 === 0 ? 'p1' : 'p2', {
      kind: 'duel-claim',
      playerId: playerIdSchema.parse(`duel-player-${String(index)}`),
      slotIndex: index % 5,
      franchiseId: franchiseIdSchema.parse('lakers'),
      eraId: '1990s',
    });
    expect(receipt.accepted).toBe(true);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('FixedFiveRoomSession', () => {
  it('boots, resumes its seat, and syncs accepted commands', async () => {
    const harness = createHarness();
    const created = await harness.createRoom();
    const session = harness.session();
    const updates: FixedFiveRoomSessionSnapshot[] = [];
    session.subscribe((next) => updates.push(next));

    await session.start();
    expect(session.getSnapshot().loading).toBe(false);
    expect(session.getSnapshot().room?.roomId).toBe(created.snapshot.roomId);
    expect(session.getSnapshot().selfId).toBe('p1');
    expect(session.getSnapshot().phase).toBe('lobby');
    expect(updates.length).toBeGreaterThan(0);
    expect(updates[0]?.loading).toBe(true);
    expect(harness.memberships).toHaveLength(1);
    expect(harness.memberships[0]?.code).toBe(created.code);
    expect(harness.repository.snapshotCursor).toBe(0);

    await session.startDraft();
    const drafting = session.getSnapshot();
    expect(drafting.room?.phase).toBe('drafting');
    expect(drafting.phase).toBe('drafting');
    expect(drafting.busyAction).toBeNull();
    expect(drafting.commands.map((command) => command.payload.kind)).toEqual(['start']);
    expect([...harness.repository.rows.keys()]).toEqual([0]);

    session.dispose();
    expect(harness.runners).toHaveLength(0);
  });

  it('refetches commands appended by the other seat', async () => {
    const harness = createHarness();
    const created = await harness.createRoom();
    const session = harness.session();
    await session.start();

    await harness.transport.submitCommand({
      schemaVersion: 1,
      roomId: created.snapshot.roomId,
      commandId: commandIdSchema.parse('cmd-from-p2'),
      actorParticipantId: 'p2',
      payload: { kind: 'ready', ready: true },
    });
    await session.refresh();

    const state = session.getSnapshot();
    expect(state.commands).toHaveLength(1);
    expect(state.commands[0]?.actorParticipantId).toBe('p2');
    expect(state.commands[0]?.payload.kind).toBe('ready');
    expect(harness.repository.rows.get(0)?.commandId).toBe('cmd-from-p2');

    session.dispose();
  });

  it('recovers commands and readiness after a missed realtime notification', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const created = await harness.createRoom({ mode: 'duel', sourceMode: 'classic' });
    await harness.transport.join(created.code);
    await fillDuelDraft(harness.transport, created.snapshot.roomId);
    vi.spyOn(harness.transport, 'subscribe').mockReturnValue({ unsubscribe: () => {} });
    const session = harness.session();
    try {
      await session.start();
      expect(session.getSnapshot().opponentReady).toBe(false);
      const receipt = await harness.transport.submitCommand({
        schemaVersion: 1,
        roomId: created.snapshot.roomId,
        commandId: commandIdSchema.parse('missed-ready'),
        actorParticipantId: 'p2',
        payload: { kind: 'ready-next-game', gameNumber: 1, ready: true },
      });
      expect(receipt.accepted).toBe(true);

      await vi.advanceTimersByTimeAsync(15_000);

      const state = session.getSnapshot();
      expect(state.commands.some((command) => command.commandId === 'missed-ready')).toBe(true);
      expect(state.opponentReady).toBe(true);
      expect(
        state.room?.members.find((member) => member.participantId === 'p2')?.nextGameReady,
      ).toBe(1);
    } finally {
      session.dispose();
    }
  });

  it('recovers room state on focus after a missed realtime notification', async () => {
    const handlers = new Map<string, () => void>();
    vi.stubGlobal('window', {
      addEventListener: (type: string, handler: () => void) => {
        handlers.set(type, handler);
      },
      removeEventListener: (type: string) => {
        handlers.delete(type);
      },
    });
    const harness = createHarness();
    const created = await harness.createRoom({ mode: 'duel', sourceMode: 'classic' });
    await harness.transport.join(created.code);
    await fillDuelDraft(harness.transport, created.snapshot.roomId);
    vi.spyOn(harness.transport, 'subscribe').mockReturnValue({ unsubscribe: () => {} });
    const session = harness.session();
    try {
      await session.start();
      const receipt = await harness.transport.submitCommand({
        schemaVersion: 1,
        roomId: created.snapshot.roomId,
        commandId: commandIdSchema.parse('wake-ready'),
        actorParticipantId: 'p2',
        payload: { kind: 'ready-next-game', gameNumber: 1, ready: true },
      });
      expect(receipt.accepted).toBe(true);

      handlers.get('focus')?.();

      await vi.waitFor(() => {
        expect(session.getSnapshot().commands.some((c) => c.commandId === 'wake-ready')).toBe(true);
        expect(session.getSnapshot().opponentReady).toBe(true);
      });
      expect(session.getSnapshot().reconnecting).toBe(false);
    } finally {
      session.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('recomputes phase from an authoritative snapshot with no new commands', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const created = await harness.createRoom({ mode: 'duel', sourceMode: 'classic' });
    await harness.transport.join(created.code);
    await fillDuelDraft(harness.transport, created.snapshot.roomId);
    vi.spyOn(harness.transport, 'subscribe').mockReturnValue({ unsubscribe: () => {} });
    const session = harness.session();
    try {
      await session.start();
      const roomId = created.snapshot.roomId;
      for (const [commandId, actor, payload] of [
        ['phase-ready-p1', 'p1', { kind: 'ready-next-game', gameNumber: 1, ready: true }],
        ['phase-ready-p2', 'p2', { kind: 'ready-next-game', gameNumber: 1, ready: true }],
        ['phase-broadcast', 'p1', { kind: 'broadcast-start', gameNumber: 1 }],
      ] as const) {
        const receipt = await harness.transport.submitCommand({
          schemaVersion: 1,
          roomId,
          commandId: commandIdSchema.parse(commandId),
          actorParticipantId: actor,
          payload,
        });
        expect(receipt.accepted).toBe(true);
      }
      const realSnapshot = harness.transport.snapshot.bind(harness.transport);
      const authoritative = await realSnapshot(roomId);
      expect(authoritative.phase).toBe('broadcasting');
      const commandCount = session.getSnapshot().commands.length;
      vi.spyOn(harness.transport, 'refetch').mockResolvedValue([]);
      const snapshot = vi.spyOn(harness.transport, 'snapshot').mockResolvedValue(authoritative);

      await vi.advanceTimersByTimeAsync(15_000);

      let state = session.getSnapshot();
      expect(state.phase).toBe('broadcasting');
      expect(state.room?.broadcast?.gameNumber).toBe(1);
      expect(state.commands).toHaveLength(commandCount);

      const digest = contentHashSchema.parse('d'.repeat(64));
      for (const [commandId, actor, payload] of [
        [
          'phase-propose-p1',
          'p1',
          {
            kind: 'propose-game-result',
            gameNumber: 1,
            winner: 'p1',
            resultDigest: digest,
            tapeDigest: digest,
            inputDigest: digest,
          },
        ],
        [
          'phase-propose-p2',
          'p2',
          {
            kind: 'propose-game-result',
            gameNumber: 1,
            winner: 'p1',
            resultDigest: digest,
            tapeDigest: digest,
            inputDigest: digest,
          },
        ],
        [
          'phase-confirm-p1',
          'p1',
          { kind: 'confirm-game-result', gameNumber: 1, resultDigest: digest, verified: true },
        ],
        [
          'phase-confirm-p2',
          'p2',
          { kind: 'confirm-game-result', gameNumber: 1, resultDigest: digest, verified: true },
        ],
      ] as const) {
        const receipt = await harness.transport.submitCommand({
          schemaVersion: 1,
          roomId,
          commandId: commandIdSchema.parse(commandId),
          actorParticipantId: actor,
          payload,
        });
        expect(receipt.accepted).toBe(true);
      }
      const advanced = await realSnapshot(roomId);
      expect(advanced.series?.currentGameNumber).toBe(2);
      snapshot.mockResolvedValue(advanced);

      await vi.advanceTimersByTimeAsync(15_000);

      state = session.getSnapshot();
      expect(state.phase).toBe('preparing-game');
      expect(state.room?.series?.currentGameNumber).toBe(2);
      expect(state.commands).toHaveLength(commandCount);
    } finally {
      session.dispose();
    }
  });

  it('reconciles commands accepted between snapshot and log reads without realtime', async () => {
    const harness = createHarness();
    const created = await harness.createRoom();
    await harness.transport.join(created.code);
    vi.spyOn(harness.transport, 'subscribe').mockReturnValue({ unsubscribe: () => {} });
    const session = harness.session();
    try {
      await session.start();
      const readSnapshot = harness.transport.snapshot.bind(harness.transport);
      vi.spyOn(harness.transport, 'snapshot').mockImplementationOnce(async (roomId) => {
        const snapshot = await readSnapshot(roomId);
        await harness.transport.submitCommand({
          schemaVersion: 1,
          roomId: created.snapshot.roomId,
          commandId: commandIdSchema.parse('between-reads'),
          actorParticipantId: 'p1',
          payload: { kind: 'start' },
        });
        return snapshot;
      });
      const updates: FixedFiveRoomSessionSnapshot[] = [];
      session.subscribe((state) => updates.push(state));
      await session.refresh();
      const state = session.getSnapshot();
      expect(state.commands).toHaveLength(1);
      expect(state.room?.phase).toBe('drafting');
      expect(updates.every((update) => update.room?.commandCount === update.commands.length)).toBe(
        true,
      );
    } finally {
      session.dispose();
    }
  });

  it('keeps realtime snapshots private until their commands have been fetched', async () => {
    const harness = createHarness();
    const created = await harness.createRoom();
    await harness.transport.join(created.code);
    const session = harness.session();
    try {
      await session.start();
      const updates: FixedFiveRoomSessionSnapshot[] = [];
      session.subscribe((state) => updates.push(state));
      const receipt = await harness.transport.submitCommand({
        schemaVersion: 1,
        roomId: created.snapshot.roomId,
        commandId: commandIdSchema.parse('coherent-ready'),
        actorParticipantId: 'p2',
        payload: { kind: 'ready', ready: true },
      });
      expect(receipt.accepted).toBe(true);
      await session.refresh();
      expect(session.getSnapshot().commands).toHaveLength(1);
      expect(
        updates.every((state) => (state.room?.commandCount ?? 0) <= state.commands.length),
      ).toBe(true);
    } finally {
      session.dispose();
    }
  });

  it('coalesces overlapping syncs and publishes snapshot and commands together', async () => {
    const harness = createHarness();
    const created = await harness.createRoom();
    await harness.transport.join(created.code);
    vi.spyOn(harness.transport, 'subscribe').mockReturnValue({ unsubscribe: () => {} });
    const session = harness.session();
    try {
      await session.start();
      const roomId = created.snapshot.roomId;
      const receipt = await harness.transport.submitCommand({
        schemaVersion: 1,
        roomId,
        commandId: commandIdSchema.parse('concurrent-ready'),
        actorParticipantId: 'p2',
        payload: { kind: 'ready', ready: true },
      });
      expect(receipt.accepted).toBe(true);
      const realSnapshot = harness.transport.snapshot.bind(harness.transport);
      const authoritative = await realSnapshot(roomId);
      const pending = deferred<FixedFiveRoomSnapshot>();
      const snapshot = vi
        .spyOn(harness.transport, 'snapshot')
        .mockImplementationOnce(() => pending.promise)
        .mockImplementation(realSnapshot);
      const refetch = vi.spyOn(harness.transport, 'refetch');

      const first = session.refresh();
      await vi.waitFor(() => {
        expect(snapshot).toHaveBeenCalledTimes(1);
      });
      const second = session.refresh();
      await flush();
      expect(snapshot).toHaveBeenCalledTimes(1);
      expect(refetch).not.toHaveBeenCalled();

      pending.resolve(authoritative);
      await Promise.all([first, second]);

      expect(refetch).toHaveBeenCalledTimes(2);
      expect(snapshot).toHaveBeenCalledTimes(2);
      const state = session.getSnapshot();
      expect(state.commands.some((command) => command.commandId === 'concurrent-ready')).toBe(true);
      expect(state.room?.revision).toBe(authoritative.revision);
    } finally {
      session.dispose();
    }
  });

  it('removes the guest seat and leaves the room through the transport', async () => {
    const harness = createHarness();
    const created = await harness.createRoom();
    const session = harness.session();
    await session.start();

    await session.removeGuest();
    const afterRemove = session.getSnapshot();
    expect(afterRemove.busyAction).toBeNull();
    expect(afterRemove.room?.code).not.toBe(created.code);

    const left = await session.leaveRoom();
    expect(left).toBe(true);
    expect(session.getSnapshot().leaveBusy).toBe(false);

    session.dispose();
  });

  it('drops late asset loads and clears timers after dispose', async () => {
    vi.useFakeTimers();
    let resolveAssets: (value: FixedFiveSessionAssets | null) => void = () => {};
    const assetsPromise = new Promise<FixedFiveSessionAssets | null>((resolve) => {
      resolveAssets = resolve;
    });
    const harness = createHarness({ loadAssets: () => assetsPromise });
    await harness.createRoom();
    const session = harness.session();
    const updates: FixedFiveRoomSessionSnapshot[] = [];
    session.subscribe((next) => updates.push(next));

    const started = session.start();
    await flush();
    session.dispose();
    const settled = updates.length;
    resolveAssets(null);
    await started;

    expect(updates.length).toBe(settled);
    expect(session.getSnapshot().assets).toBeNull();
    expect(session.getSnapshot().loading).toBe(true);
    expect(harness.runners).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hands a completed sandbox draft to the runner and drops late results after dispose', async () => {
    const pool = Array.from({ length: 12 }, (_, index) => sandboxCandidate(index));
    const harness = createHarness({ loadAssets: () => Promise.resolve(sandboxAssets(pool)) });
    const created = await harness.createRoom({ mode: 'sandbox-shared-82', sourceMode: 'sandbox' });
    await fillSandboxDraft(harness.transport, created.snapshot.roomId, pool);

    const session = harness.session();
    await session.start();
    await waitFor(() => harness.runners.length > 0 || session.getSnapshot().simError !== null);

    const state = session.getSnapshot();
    expect(state.simError).toBeNull();
    expect(state.phase).toBe('simulating');
    expect(state.simStarted).toBe(true);
    expect(harness.runners).toHaveLength(1);
    const runner = harness.runners[0];
    if (!runner) throw new Error('runner was not created');
    expect(runner.sharedRuns).toHaveLength(1);
    const run = runner.sharedRuns[0];
    if (!run) throw new Error('shared-82 run was not started');
    expect(run.rootSeed).toBe(created.snapshot.rootSeed);
    expect(run.p1Team.players).toHaveLength(5);
    expect(run.p2Team.players).toHaveLength(5);

    runner.emit({ kind: 'progress', completedGames: 4, totalGames: 161 });
    expect(session.getSnapshot().progress).toEqual({ completed: 4, total: 161 });

    runner.emit({ kind: 'error', message: 'worker failed' });
    expect(session.getSnapshot().simError).toBe('worker failed');
    session.retrySimulation();
    await waitFor(() => harness.runners.length === 2);
    const retryRunner = harness.runners[1];
    expect(retryRunner?.sharedRuns[0]).toEqual(run);
    retryRunner?.emit({ kind: 'progress', completedGames: 4, totalGames: 161 });

    session.dispose();
    expect(retryRunner?.disposed).toBe(true);
    runner.emit({ kind: 'progress', completedGames: 9, totalGames: 161 });
    runner.emit({ kind: 'complete', gamesDelivered: 9 });
    expect(session.getSnapshot().progress).toEqual({ completed: 4, total: 161 });
    expect(session.getSnapshot().localResult).toBeNull();
  });

  it('recovers a saved season, rebuilds stats, and retries verification before completing once', async () => {
    vi.useFakeTimers();
    const pool = Array.from({ length: 12 }, (_, index) => sandboxCandidate(index));
    const assets = {
      ...sandboxAssets(pool),
      manifest: buildManifest(),
      bracket: buildFixtureBracket(),
      profile: buildEraSimulationProfile(),
    };
    const slots: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];
    const harness = createHarness({
      loadAssets: () => Promise.resolve(assets),
      buildTeam: (_manifest, teamId, displayName, refs) =>
        Promise.resolve({
          teamId,
          displayName,
          players: refs.map((ref) => {
            const position = slots[ref.slotIndex];
            assert(position);
            return buildSimulationPlayer({
              playerId: playerIdSchema.parse(ref.playerId),
              positions: [position],
            });
          }),
        }),
    });
    const created = await harness.createRoom({ mode: 'sandbox-shared-82', sourceMode: 'sandbox' });
    await fillSandboxDraft(harness.transport, created.snapshot.roomId, pool);
    const firstSession = harness.session();
    await firstSession.start();
    await waitFor(() => harness.runners.length === 1);
    const runner = harness.runners[0];
    assert(runner);
    const input = runner.sharedRuns[0];
    assert(input);
    const context = createEngineContext();
    const entries = [...shared82GameEvents({ ...input, bracket: assets.bracket }, context)];
    runner.emit({ kind: 'results', entries });
    runner.emit({ kind: 'complete', gamesDelivered: entries.length });
    await waitFor(() => harness.repository.pending !== null);
    await vi.advanceTimersByTimeAsync(7000);
    const originalResult = firstSession.getSnapshot().localResult;
    expect(originalResult).not.toBeNull();
    expect(harness.repository.pending?.resultDigest).toBe(originalResult?.digest);
    firstSession.dispose();

    const session = harness.session();
    await session.start();
    await waitFor(() => session.getSnapshot().simDone && harness.runners.length === 2);
    expect(session.getSnapshot().localResult).toEqual(originalResult);
    expect(session.getSnapshot().simEntries).toEqual([]);
    expect(session.getSnapshot().statsBuilding).toBe(true);
    session.requestStatsRebuild();
    expect(harness.runners).toHaveLength(2);
    const statsRunner = harness.runners[1];
    assert(statsRunner);
    statsRunner.emit({ kind: 'results', entries });
    statsRunner.emit({ kind: 'complete', gamesDelivered: entries.length });
    expect(session.getSnapshot().statsBuilding).toBe(false);
    expect(session.getSnapshot().statsEntries).toEqual(entries);
    assert(originalResult);
    const digest = originalResult.digest;
    for (const payload of [
      { kind: 'propose-result', resultDigest: digest },
      { kind: 'confirm-result', resultDigest: digest, verified: true },
    ] satisfies FixedFiveCommandPayload[]) {
      const receipt = await harness.transport.submitCommand({
        schemaVersion: 1,
        roomId: created.snapshot.roomId,
        commandId: commandIdSchema.parse(`peer-${payload.kind}`),
        actorParticipantId: 'p2',
        payload,
      });
      expect(receipt.accepted).toBe(true);
      await session.refresh();
    }
    await waitFor(() => harness.runners.some((job) => job.verifications.length > 0));
    const failedJob = harness.runners.find((job) => job.verifications.length > 0);
    assert(failedJob);
    failedJob.emit({ kind: 'verification-failed', failures: ['verification interrupted'] });
    await waitFor(() => session.getSnapshot().verificationError !== null);
    expect(session.getSnapshot().verificationReceipt).toBeNull();
    session.retryVerification();
    await waitFor(() => harness.runners.filter((job) => job.verifications.length > 0).length === 2);
    const verificationJob = harness.runners.at(-1);
    assert(verificationJob);
    const verificationInput = verificationJob.verifications[0];
    assert(verificationInput);
    const verification = verifyFixedFiveCompetition(verificationInput, context);
    expect(verification.ok).toBe(true);
    if (!verification.ok) throw new Error(verification.failures.join('; '));
    const complete = vi.spyOn(harness.transport, 'complete');
    const submitVerification = vi.spyOn(harness.transport, 'submitVerification');
    session.dispose();
    verificationJob.emit({ kind: 'verified', receipt: verification.receipt });
    await flush();
    expect(submitVerification).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();

    const resumed = harness.session();
    await resumed.start();
    await waitFor(() => harness.runners.filter((job) => job.verifications.length > 0).length === 3);
    const resumedJob = harness.runners.findLast((job) => job.verifications.length > 0);
    assert(resumedJob);
    const resumedInput = resumedJob.verifications[0];
    assert(resumedInput);
    const resumedVerification = verifyFixedFiveCompetition(resumedInput, context);
    expect(resumedVerification.ok).toBe(true);
    if (!resumedVerification.ok) throw new Error(resumedVerification.failures.join('; '));
    resumedJob.emit({ kind: 'verified', receipt: resumedVerification.receipt });
    await waitFor(() => resumed.getSnapshot().room?.phase === 'completed');
    expect(resumed.getSnapshot().submittedReceipt).toBe(resumedVerification.receipt.receiptDigest);
    await resumed.refresh();
    expect(complete).toHaveBeenCalledTimes(1);
    resumed.dispose();
  });

  it('coordinates a duel broadcast from readiness through the recap hold', async () => {
    const harness = createHarness();
    const created = await harness.createRoom({ mode: 'duel', sourceMode: 'classic' });
    await fillDuelDraft(harness.transport, created.snapshot.roomId);

    const session = harness.session();
    await session.start();
    let state = session.getSnapshot();
    expect(state.phase).toBe('preparing-game');
    expect(state.duelBroadcast).toBe(true);
    expect(state.room?.series?.currentGameNumber).toBe(1);

    await session.readyForNextGame();
    expect(session.getSnapshot().localReady).toBe(true);
    expect(session.getSnapshot().opponentReady).toBe(false);

    const p2Ready = await harness.transport.submitCommand({
      schemaVersion: 1,
      roomId: created.snapshot.roomId,
      commandId: commandIdSchema.parse('duel-ready-p2'),
      actorParticipantId: 'p2',
      payload: { kind: 'ready-next-game', gameNumber: 1, ready: true },
    });
    expect(p2Ready.accepted).toBe(true);
    await session.refresh();
    state = session.getSnapshot();
    expect(state.opponentReady).toBe(true);
    expect(state.readyCountdownMs).toBeNull();

    await session.startBroadcast();
    state = session.getSnapshot();
    expect(state.room?.phase).toBe('broadcasting');
    expect(state.room?.broadcast?.durationMs).toBe(10_000);

    session.beginPlayback();
    session.advancePlayback(5000);
    expect(session.getSnapshot().broadcastProgress).toBeGreaterThan(0.4);
    session.advancePlayback(5000);
    state = session.getSnapshot();
    expect(state.broadcastProgress).toBe(1);
    expect(state.duelRecapGame).toBe(1);
    expect(state.awaitingContinue).toBe(true);

    session.continueAfterGame();
    state = session.getSnapshot();
    expect(state.awaitingContinue).toBe(false);

    session.dispose();
  });

  it('keeps partial playback through repeated peer results snapshots', async () => {
    const harness = createHarness();
    const created = await harness.createRoom({ mode: 'duel', sourceMode: 'classic' });
    await harness.transport.join(created.code);
    await fillDuelDraft(harness.transport, created.snapshot.roomId);
    const session = harness.session();
    try {
      await session.start();
      await session.readyForNextGame();
      const roomId = created.snapshot.roomId;
      const submit = (commandId: string, payload: FixedFiveCommandPayload) =>
        harness.transport.submitCommand({
          schemaVersion: 1,
          roomId,
          commandId: commandIdSchema.parse(commandId),
          actorParticipantId: 'p2',
          payload,
        });
      await submit('peer-first-ready', { kind: 'ready-next-game', gameNumber: 1, ready: true });
      await session.startBroadcast();
      session.beginPlayback();
      session.advancePlayback(5000);
      const digest = contentHashSchema.parse('c'.repeat(64));
      await submit('peer-first-proposal', {
        kind: 'propose-game-result',
        gameNumber: 1,
        winner: 'p1',
        resultDigest: digest,
        tapeDigest: digest,
        inputDigest: digest,
      });
      await session.refresh();
      await session.refresh();
      expect(session.getSnapshot().phase).toBe('game-results');
      expect(session.getSnapshot().broadcastProgress).toBe(0.5);
      expect(session.getSnapshot().duelRecapGame).toBeNull();
      session.advancePlayback(5000);
      expect(session.getSnapshot().awaitingContinue).toBe(true);
      session.continueAfterGame();
      expect(session.getSnapshot().awaitingContinue).toBe(false);
      for (const actor of ['p1', 'p2'] as const) {
        const receipt = await harness.transport.submitCommand({
          schemaVersion: 1,
          roomId,
          commandId: commandIdSchema.parse(`peer-first-confirm-${actor}`),
          actorParticipantId: actor,
          payload: {
            kind: 'confirm-game-result',
            gameNumber: 1,
            resultDigest: digest,
            verified: true,
          },
        });
        expect(receipt.accepted).toBe(true);
      }
      await session.refresh();
      await waitFor(() => session.getSnapshot().localReady);
      expect(session.getSnapshot().room?.series?.currentGameNumber).toBe(2);
      const commands = await harness.transport.refetch(roomId, -1);
      expect(
        commands.filter(
          (command) =>
            command.actorParticipantId === 'p1' &&
            command.payload.kind === 'ready-next-game' &&
            command.payload.gameNumber === 2,
        ),
      ).toHaveLength(1);
    } finally {
      session.dispose();
    }
  });

  it('completes an elapsed broadcast on late reconnect so the review is not skipped', async () => {
    const harness = createHarness();
    const created = await harness.createRoom({ mode: 'duel', sourceMode: 'classic' });
    await harness.transport.join(created.code);
    await fillDuelDraft(harness.transport, created.snapshot.roomId);
    const roomId = created.snapshot.roomId;
    const submit = (commandId: string, actor: 'p1' | 'p2', payload: FixedFiveCommandPayload) =>
      harness.transport.submitCommand({
        schemaVersion: 1,
        roomId,
        commandId: commandIdSchema.parse(commandId),
        actorParticipantId: actor,
        payload,
      });
    for (const [commandId, actor, payload] of [
      ['late-ready-p1', 'p1', { kind: 'ready-next-game', gameNumber: 1, ready: true }],
      ['late-ready-p2', 'p2', { kind: 'ready-next-game', gameNumber: 1, ready: true }],
      ['late-broadcast', 'p1', { kind: 'broadcast-start', gameNumber: 1 }],
    ] as const) {
      const receipt = await submit(commandId, actor, payload);
      expect(receipt.accepted).toBe(true);
    }
    const digest = contentHashSchema.parse('c'.repeat(64));
    const proposal = await submit('late-propose', 'p2', {
      kind: 'propose-game-result',
      gameNumber: 1,
      winner: 'p1',
      resultDigest: digest,
      tapeDigest: digest,
      inputDigest: digest,
    });
    expect(proposal.accepted).toBe(true);

    let now = 1_700_000_000_000;
    harness.deps.now = () => now;
    const authoritative = await harness.transport.snapshot(roomId);
    expect(authoritative.phase).toBe('game-results');
    now = Date.parse(authoritative.broadcast?.startedAtIso ?? '') + 10_000;
    vi.spyOn(harness.transport, 'subscribe').mockReturnValue({ unsubscribe: () => {} });

    const session = harness.session();
    try {
      await session.start();
      const state = session.getSnapshot();
      expect(state.phase).toBe('game-results');
      expect(state.broadcastProgress).toBe(1);
      expect(state.duelRecapGame).toBe(1);
      expect(state.awaitingContinue).toBe(true);
    } finally {
      session.dispose();
    }
  });
});
