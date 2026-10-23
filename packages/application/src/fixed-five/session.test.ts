import {
  buildEraSimulationProfile,
  buildFixtureBracket,
  buildManifest,
  buildSimulationPlayer,
} from '@hoop-rush/test-fixtures';
import {
  createEngineContext,
  findWeakestOpponent,
  fixedFiveDuelGameInputDigest,
  fixedFiveDuelGameResultDigest,
  fixedFiveDuelGameTapeDigest,
  h2hGameNumbersFor,
  shared82H2HGameInput,
  shared82GameEvents,
  simulateRecordedShared82H2HGame,
  verifyFixedFiveCompetition,
} from '@hoop-rush/engine';
import type {
  FixedFiveCompetitionRun,
  FixedFiveShared82H2HGameOutput,
  FixedFiveWorkerResultEntry,
  Position,
} from '@hoop-rush/data-contracts';
import { afterEach, describe, expect, it, vi } from 'bun:test';
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

function assert(condition: unknown): asserts condition {
  if (!condition) throw new Error('assertion failed');
}

class FakeRunner implements FixedFiveRunnerPort {
  readonly events: FixedFiveRunnerEvent[] = [];
  readonly sharedRuns: Parameters<FixedFiveRunnerPort['runShared82']>[0][] = [];
  readonly shared82H2HGameRuns: Parameters<FixedFiveRunnerPort['runShared82H2HGame']>[0][] = [];
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
  runShared82H2HGame(input: Parameters<FixedFiveRunnerPort['runShared82H2HGame']>[0]): void {
    this.shared82H2HGameRuns.push(input);
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
    expect(harness.repository.rows.get(0)?.commandId).toBe(commandIdSchema.parse('cmd-from-p2'));

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

      vi.advanceTimersByTime(15_000);
      await flush();

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
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      addEventListener: (type: string, handler: () => void) => {
        handlers.set(type, handler);
      },
      removeEventListener: (type: string) => {
        handlers.delete(type);
      },
    };
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

      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          expect(session.getSnapshot().commands.some((c) => c.commandId === 'wake-ready')).toBe(
            true,
          );
          expect(session.getSnapshot().opponentReady).toBe(true);
          break;
        } catch {
          await flush();
        }
        if (attempt === 99) {
          expect(session.getSnapshot().commands.some((c) => c.commandId === 'wake-ready')).toBe(
            true,
          );
          expect(session.getSnapshot().opponentReady).toBe(true);
        }
      }
      for (let attempt = 0; attempt < 100 && session.getSnapshot().reconnecting; attempt += 1) {
        await flush();
      }
      expect(session.getSnapshot().reconnecting).toBe(false);
    } finally {
      session.dispose();
      (globalThis as { window?: unknown }).window = originalWindow;
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

      vi.advanceTimersByTime(15_000);
      await flush();

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

      vi.advanceTimersByTime(15_000);
      await flush();

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
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          expect(snapshot).toHaveBeenCalledTimes(1);
          break;
        } catch {
          await flush();
        }
        if (attempt === 99) {
          expect(snapshot).toHaveBeenCalledTimes(1);
        }
      }
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
    const rootSeed = created.snapshot.rootSeed;
    if (!rootSeed) throw new Error('fixed-five room is missing a root seed');
    expect(run.rootSeed).toBe(rootSeed);
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

  it('holds revealed records at each H2H until its synchronized broadcast completes', async () => {
    vi.useFakeTimers();
    const pool = Array.from({ length: 12 }, (_, index) => sandboxCandidate(index));
    const fixtureBracket = buildFixtureBracket();
    const weakestOpponentId = findWeakestOpponent(fixtureBracket).opponentId;
    const fixtureH2H = h2hGameNumbersFor(fixtureBracket, weakestOpponentId);
    const firstFixtureH2H = fixtureH2H[0];
    assert(firstFixtureH2H !== undefined);
    const existingFirstMatchup = fixtureBracket.schedule[firstFixtureH2H - 1];
    const gameFortyMatchup = fixtureBracket.schedule[39];
    assert(existingFirstMatchup);
    assert(gameFortyMatchup);
    const schedule = [...fixtureBracket.schedule];
    schedule[firstFixtureH2H - 1] = {
      ...existingFirstMatchup,
      opponentId: gameFortyMatchup.opponentId,
    };
    schedule[39] = { ...gameFortyMatchup, opponentId: weakestOpponentId };
    const assets = {
      ...sandboxAssets(pool),
      manifest: buildManifest(),
      bracket: { ...fixtureBracket, schedule },
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
    await harness.transport.join(created.code);
    await fillSandboxDraft(harness.transport, created.snapshot.roomId, pool);
    for (const actor of ['p1', 'p2'] as const) {
      const receipt = await harness.transport.submitCommand({
        schemaVersion: 1,
        roomId: created.snapshot.roomId,
        commandId: commandIdSchema.parse(`lock-${actor}`),
        actorParticipantId: actor,
        payload: { kind: 'sandbox-lock' },
      });
      expect(receipt.accepted).toBe(true);
    }

    let session = harness.session();
    try {
      await session.start();
      await waitFor(() => harness.runners.length === 1);
      const runner = harness.runners[0];
      assert(runner);
      const run = runner.sharedRuns[0];
      assert(run);
      const input = { ...run, bracket: assets.bracket };
      const engineContext = createEngineContext({ engineVersion: 'test-engine' });
      const events = [...shared82GameEvents(input, engineContext, 1, { recordH2H: true })];
      const entries: FixedFiveWorkerResultEntry[] = events.map((event) =>
        event.tag === 'h2h'
          ? { tag: 'h2h', game: event.game, ...(event.tape ? { tape: event.tape } : {}) }
          : { tag: event.tag, game: event.game },
      );
      const weakest = findWeakestOpponent(assets.bracket);
      const eligibleGameNumbers = h2hGameNumbersFor(assets.bracket, weakest.opponentId);
      const firstGame = eligibleGameNumbers[0];
      assert(firstGame);
      const recorded = simulateRecordedShared82H2HGame(input, firstGame, engineContext);
      const gameInput = shared82H2HGameInput(input, firstGame);
      let output: FixedFiveShared82H2HGameOutput = {
        schemaVersion: 1,
        gameNumber: firstGame,
        homeParticipantId: 'p1',
        awayParticipantId: 'p2',
        seed: recorded.seed,
        result: recorded.result,
        tape: recorded.tape,
        inputDigest: fixedFiveDuelGameInputDigest(gameInput),
        resultDigest: fixedFiveDuelGameResultDigest(recorded.result),
        tapeDigest: fixedFiveDuelGameTapeDigest(recorded.tape),
      };
      runner.emit({ kind: 'results', entries });
      runner.emit({ kind: 'complete', gamesDelivered: entries.length });
      await waitFor(() => harness.repository.pending !== null);
      vi.advanceTimersByTime(Math.ceil(firstGame / 4) * 240);
      await flush();
      await waitFor(() => session.getSnapshot().shared82H2HPendingGame === firstGame);
      expect(session.getSnapshot().shared82H2HSimulatingGame).toBeNull();
      expect(harness.runners).toHaveLength(1);
      vi.advanceTimersByTime(960);
      await flush();
      expect(session.getSnapshot().shared82H2HPendingGame).toBe(firstGame);
      expect(harness.runners).toHaveLength(1);

      session.continueShared82H2HGame();
      await waitFor(() => harness.runners.length === 2);
      const failedTapeRunner = harness.runners[1];
      assert(failedTapeRunner);
      expect(
        failedTapeRunner.shared82H2HGameRuns.some((game) => game.gameNumber === firstGame),
      ).toBe(true);
      failedTapeRunner.emit({ kind: 'error', message: 'the fixed-five worker crashed' });

      let state = session.getSnapshot();
      expect(state.revealedEntries).toHaveLength(78);
      expect(state.room?.broadcast).toBeNull();
      expect(state.shared82H2HError).toBe('the fixed-five worker crashed');
      vi.advanceTimersByTime(960);
      await flush();
      expect(harness.runners).toHaveLength(2);
      expect(session.getSnapshot().shared82H2HError).toBe('the fixed-five worker crashed');

      const submitCommand = harness.transport.submitCommand.bind(harness.transport);
      let rejectBroadcastStart = true;
      vi.spyOn(harness.transport, 'submitCommand').mockImplementation(async (command) => {
        if (rejectBroadcastStart && command.payload.kind === 'broadcast-start') {
          rejectBroadcastStart = false;
          return {
            roomId: command.roomId,
            commandId: command.commandId,
            ordinal: 0,
            accepted: false,
            rejectionCode: 'turn',
            revision: 0,
          };
        }
        return submitCommand(command);
      });

      session.retryShared82H2HGame();
      await waitFor(() => harness.runners.length === 3);
      const retryTapeRunner = harness.runners[2];
      assert(retryTapeRunner);
      retryTapeRunner.emit({ kind: 'shared82-h2h-game', output });
      await waitFor(() => session.getSnapshot().shared82H2HError !== null);
      expect(session.getSnapshot().shared82H2HError).toBe(
        'The head-to-head broadcast could not be started.',
      );
      expect(session.getSnapshot().error).toBe('Command rejected: turn');
      expect(session.getSnapshot().room?.broadcast).toBeNull();
      vi.advanceTimersByTime(960);
      await flush();
      expect(harness.runners).toHaveLength(3);

      session.retryShared82H2HGame();
      await waitFor(() => harness.runners.length === 4);
      const acceptedTapeRunner = harness.runners[3];
      assert(acceptedTapeRunner);
      acceptedTapeRunner.emit({ kind: 'shared82-h2h-game', output });
      vi.advanceTimersByTime(7000);
      await flush();
      await waitFor(() => session.getSnapshot().room?.broadcast?.gameNumber === firstGame);

      state = session.getSnapshot();
      expect(state.revealedThroughGameNumber).toBe(firstGame - 1);
      expect(state.revealedEntries.some((entry) => entry.tag === 'h2h')).toBe(false);
      expect(state.simDone).toBe(false);
      expect(state.localResult).toBeNull();

      const originalOutput = output;
      session.dispose();
      let reconnectNowMs = 1_700_000_004_000;
      harness.deps.now = () => reconnectNowMs;
      session = harness.session();
      await session.start();
      await waitFor(() =>
        harness.runners.some(
          (candidate) => candidate !== runner && candidate.sharedRuns.length > 0,
        ),
      );
      const resumedRunner = harness.runners.find(
        (candidate) => candidate !== runner && candidate.sharedRuns.length > 0,
      );
      assert(resumedRunner);
      vi.advanceTimersByTime(240);
      await flush();
      await waitFor(() =>
        harness.runners.some((candidate) =>
          candidate.shared82H2HGameRuns.some((game) => game.gameNumber === firstGame),
        ),
      );
      const tapeRunner = harness.runners.find(
        (candidate) =>
          candidate !== failedTapeRunner &&
          candidate !== retryTapeRunner &&
          candidate !== acceptedTapeRunner &&
          candidate.shared82H2HGameRuns.some((game) => game.gameNumber === firstGame),
      );
      assert(tapeRunner);
      const tapeRun = tapeRunner.shared82H2HGameRuns[0];
      assert(tapeRun);
      expect(tapeRun.rootSeed).toBe(run.rootSeed);
      expect(tapeRun.gameNumber).toBe(firstGame);
      const resumedInput = {
        p1Team: tapeRun.p1Team,
        p2Team: tapeRun.p2Team,
        bracket: tapeRun.bracket,
        profile: tapeRun.profile,
        rootSeed: tapeRun.rootSeed,
        dataVersion: tapeRun.dataVersion,
      };
      const resumedRecorded = simulateRecordedShared82H2HGame(
        resumedInput,
        firstGame,
        engineContext,
      );
      const resumedGameInput = shared82H2HGameInput(resumedInput, firstGame);
      output = {
        schemaVersion: 1,
        gameNumber: firstGame,
        homeParticipantId: 'p1',
        awayParticipantId: 'p2',
        seed: resumedRecorded.seed,
        result: resumedRecorded.result,
        tape: resumedRecorded.tape,
        inputDigest: fixedFiveDuelGameInputDigest(resumedGameInput),
        resultDigest: fixedFiveDuelGameResultDigest(resumedRecorded.result),
        tapeDigest: fixedFiveDuelGameTapeDigest(resumedRecorded.tape),
      };
      expect(output).toStrictEqual(originalOutput);
      tapeRunner.emit({ kind: 'shared82-h2h-game', output });
      resumedRunner.emit({ kind: 'results', entries });
      expect(session.getSnapshot().shared82H2HOutputs[firstGame]).toEqual(output);
      session.beginPlayback();
      expect(session.getSnapshot().broadcastProgress).toBeCloseTo(0.4, 1);
      reconnectNowMs += 6_000;
      session.advancePlayback(6_000);
      const peerPropose = await harness.transport.submitCommand({
        schemaVersion: 1,
        roomId: created.snapshot.roomId,
        commandId: commandIdSchema.parse('peer-season-proposal'),
        actorParticipantId: 'p2',
        payload: {
          kind: 'propose-game-result',
          gameNumber: firstGame,
          winner: output.result.winner === 'home' ? 'p1' : 'p2',
          resultDigest: output.resultDigest,
          tapeDigest: output.tapeDigest,
          inputDigest: output.inputDigest,
        },
      });
      expect(peerPropose.accepted).toBe(true);
      await session.refresh();
      const peerConfirm = await harness.transport.submitCommand({
        schemaVersion: 1,
        roomId: created.snapshot.roomId,
        commandId: commandIdSchema.parse('peer-season-confirmation'),
        actorParticipantId: 'p2',
        payload: {
          kind: 'confirm-game-result',
          gameNumber: firstGame,
          resultDigest: output.resultDigest,
          verified: true,
        },
      });
      expect(peerConfirm.accepted).toBe(true);
      await waitFor(() =>
        session
          .getSnapshot()
          .commands.some(
            (command) =>
              command.actorParticipantId === 'p1' &&
              command.payload.kind === 'confirm-game-result' &&
              command.payload.gameNumber === firstGame,
          ),
      );
      await session.refresh();
      state = session.getSnapshot();
      expect(state.room?.seasonBroadcast?.lastCompletedGameNumber).toBe(firstGame);
      expect(
        state.revealedEntries.filter(
          (entry) => entry.tag === 'h2h' && entry.game.gameNumber === firstGame,
        ),
      ).toHaveLength(1);
      expect(state.simDone).toBe(false);
      expect(state.localResult).toBeNull();
    } finally {
      session.dispose();
    }
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
    for (const actor of ['p1', 'p2'] as const) {
      const receipt = await harness.transport.submitCommand({
        schemaVersion: 1,
        roomId: created.snapshot.roomId,
        commandId: commandIdSchema.parse(`recovery-lock-${actor}`),
        actorParticipantId: actor,
        payload: { kind: 'sandbox-lock' },
      });
      expect(receipt.accepted).toBe(true);
    }
    const firstSession = harness.session();
    await firstSession.start();
    await waitFor(() => harness.runners.length === 1);
    const runner = harness.runners[0];
    assert(runner);
    const input = runner.sharedRuns[0];
    assert(input);
    const context = createEngineContext();
    const simulationInput = { ...input, bracket: assets.bracket };
    const entries = [...shared82GameEvents(simulationInput, context)];
    const recordedEvents = [
      ...shared82GameEvents(simulationInput, context, 1, { recordH2H: true }),
    ];
    const recordedEntries: FixedFiveWorkerResultEntry[] = recordedEvents.map((event) =>
      event.tag === 'h2h'
        ? { tag: 'h2h', game: event.game, ...(event.tape ? { tape: event.tape } : {}) }
        : { tag: event.tag, game: event.game },
    );
    const eligibleGameNumbers = h2hGameNumbersFor(
      assets.bracket,
      findWeakestOpponent(assets.bracket).opponentId,
    );
    const h2hOutputs = new Map<number, FixedFiveShared82H2HGameOutput>();
    for (const gameNumber of eligibleGameNumbers) {
      const recorded = simulateRecordedShared82H2HGame(simulationInput, gameNumber, context);
      const gameInput = shared82H2HGameInput(simulationInput, gameNumber);
      h2hOutputs.set(gameNumber, {
        schemaVersion: 1,
        gameNumber,
        homeParticipantId: 'p1',
        awayParticipantId: 'p2',
        seed: recorded.seed,
        result: recorded.result,
        tape: recorded.tape,
        inputDigest: fixedFiveDuelGameInputDigest(gameInput),
        resultDigest: fixedFiveDuelGameResultDigest(recorded.result),
        tapeDigest: fixedFiveDuelGameTapeDigest(recorded.tape),
      });
    }
    runner.emit({ kind: 'results', entries: recordedEntries });
    for (const output of h2hOutputs.values()) {
      runner.emit({ kind: 'shared82-h2h-game', output });
    }
    runner.emit({ kind: 'complete', gamesDelivered: entries.length });
    await waitFor(() => harness.repository.pending !== null);
    for (const gameNumber of eligibleGameNumbers) {
      vi.advanceTimersByTime(10_000);
      await flush();
      await waitFor(() => firstSession.getSnapshot().shared82H2HPendingGame === gameNumber);
      firstSession.continueShared82H2HGame();
      await waitFor(() => firstSession.getSnapshot().room?.broadcast?.gameNumber === gameNumber);
      firstSession.beginPlayback();
      firstSession.advancePlayback(10_000);
      await waitFor(() =>
        firstSession
          .getSnapshot()
          .commands.some(
            (command) =>
              command.actorParticipantId === 'p1' &&
              command.payload.kind === 'propose-game-result' &&
              command.payload.gameNumber === gameNumber,
          ),
      );
      const output = h2hOutputs.get(gameNumber);
      assert(output);
      const peerPropose = await harness.transport.submitCommand({
        schemaVersion: 1,
        roomId: created.snapshot.roomId,
        commandId: commandIdSchema.parse(`recovery-propose-${String(gameNumber)}`),
        actorParticipantId: 'p2',
        payload: {
          kind: 'propose-game-result',
          gameNumber,
          winner: output.result.winner === 'home' ? 'p1' : 'p2',
          resultDigest: output.resultDigest,
          tapeDigest: output.tapeDigest,
          inputDigest: output.inputDigest,
        },
      });
      expect(peerPropose.accepted).toBe(true);
      await firstSession.refresh();
      const peerConfirm = await harness.transport.submitCommand({
        schemaVersion: 1,
        roomId: created.snapshot.roomId,
        commandId: commandIdSchema.parse(`recovery-confirm-${String(gameNumber)}`),
        actorParticipantId: 'p2',
        payload: {
          kind: 'confirm-game-result',
          gameNumber,
          resultDigest: output.resultDigest,
          verified: true,
        },
      });
      expect(peerConfirm.accepted).toBe(true);
      await waitFor(
        () =>
          firstSession.getSnapshot().room?.seasonBroadcast?.lastCompletedGameNumber === gameNumber,
      );
    }
    vi.advanceTimersByTime(2000);
    await flush();
    await waitFor(() => firstSession.getSnapshot().localResult !== null);
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
