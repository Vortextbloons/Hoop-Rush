import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commandIdSchema,
  createInMemoryFixedFiveTransport,
  defaultFixedFiveVersionLocks,
  playerIdSchema,
  type FixedFiveCommand,
  type FixedFiveCommandPayload,
  type FixedFiveCommandReceipt,
  type FixedFiveMultiplayerTransport,
  type FixedFiveRoomMode,
  type FixedFiveRoomSnapshot,
  type FixedFiveSourceMode,
  type Id,
} from '@hoop-rush/data-contracts';
import type { FixedFiveRunner, FixedFiveRunnerEvent } from './fixed-five-runner';
import type { StoredFixedFiveMembership } from './fixed-five-identity';
import {
  FixedFiveRoomSession,
  type FixedFiveRoomRepositoryPort,
  type FixedFiveRoomSessionDeps,
  type FixedFiveRoomSessionSnapshot,
} from './fixed-five-room-session';
import type { FixedFiveAssets, FixedFiveCandidate } from './fixed-five-room-state';

vi.mock('$lib/player-refs', () => ({
  resolvePlayerRefs: (
    refs: readonly { playerId: string; franchiseId: string; eraId: string }[],
  ): Promise<unknown[]> =>
    Promise.resolve(
      refs.map((ref) => ({
        playerId: ref.playerId,
        displayName: `Player ${ref.playerId}`,
        positions: { playable: ['PG', 'SG', 'SF', 'PF', 'C'] },
        heightInches: 78,
        weightLbs: 205,
        detailedRatings: {},
        tendencies: {},
        anchors: {},
        reconstructedThreePoint: 0.35,
        summaryRatings: { overallRating: 72 },
        ratingProfile: {},
      })),
    ),
}));

class FakeRunner {
  readonly events: FixedFiveRunnerEvent[] = [];
  readonly sharedRuns: Parameters<FixedFiveRunner['runShared82']>[0][] = [];
  readonly duelRuns: Parameters<FixedFiveRunner['runDuel']>[0][] = [];
  disposed = false;
  constructor(private readonly onEvent: (event: FixedFiveRunnerEvent) => void) {}
  runShared82(input: Parameters<FixedFiveRunner['runShared82']>[0]): void {
    this.sharedRuns.push(input);
  }
  runDuel(input: Parameters<FixedFiveRunner['runDuel']>[0]): void {
    this.duelRuns.push(input);
  }
  verify(): void {}
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
}

function createFakeRepository(): FakeRepository {
  const rows = new Map<number, FixedFiveCommand>();
  const repository: FakeRepository = {
    rows,
    snapshotCursor: -1,
    listCommands: () => Promise.resolve([...rows.values()].sort((a, b) => a.ordinal - b.ordinal)),
    appendCommand: (command) => {
      rows.set(command.ordinal, command);
      return Promise.resolve();
    },
    saveActiveSnapshot: (_snapshot, commandCursor) => {
      repository.snapshotCursor = commandCursor;
      return Promise.resolve();
    },
    loadPendingResult: () => Promise.resolve(null),
    savePendingResult: () => Promise.resolve(),
    clearPendingResult: () => Promise.resolve(),
  };
  return repository;
}

interface Harness {
  transport: FixedFiveMultiplayerTransport;
  repository: FakeRepository;
  memberships: StoredFixedFiveMembership[];
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
  const transport = createInMemoryFixedFiveTransport({
    clock: () => clock.now,
    seed: 'fixed-five-room-session-test',
  });
  const repository = createFakeRepository();
  const memberships: StoredFixedFiveMembership[] = [];
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
    loadActivityAt: () => null,
    saveActivityNow: () => {},
    prefersReducedMotion: () => false,
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

function sandboxAssets(pool: FixedFiveCandidate[]): FixedFiveAssets {
  return {
    pool,
    poolById: new Map(pool.map((candidate) => [candidate.playerId, candidate])),
  } as unknown as FixedFiveAssets;
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
    let resolveAssets: (value: FixedFiveAssets | null) => void = () => {};
    const assetsPromise = new Promise<FixedFiveAssets | null>((resolve) => {
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

    session.dispose();
    expect(runner.disposed).toBe(true);
    runner.emit({ kind: 'progress', completedGames: 9, totalGames: 161 });
    runner.emit({ kind: 'complete', gamesDelivered: 9 });
    expect(session.getSnapshot().progress).toEqual({ completed: 4, total: 161 });
    expect(session.getSnapshot().localResult).toBeNull();
  });
});
