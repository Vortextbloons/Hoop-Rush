import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commandIdSchema,
  createInMemoryFixedFiveTransport,
  defaultFixedFiveVersionLocks,
  franchiseIdSchema,
  playerIdSchema,
  playerVersionId,
  type FixedFiveCommand,
  type FixedFiveMultiplayerTransport,
  type FixedFiveRoomMembership,
  type FixedFiveRoomSnapshot,
  type FixedFiveWorkerTeam,
  type PlayersIndexEntry,
} from '@hoop-rush/data-contracts';
import {
  createEngineContext,
  fixedFiveSandboxFirstPicker,
  type FixedFiveCandidate,
} from '@hoop-rush/engine';
import type { FixedFiveRunnerEvent } from './fixed-five-runner';
import type {
  FixedFiveRoomRepositoryPort,
  FixedFiveRoomSessionDeps,
  FixedFiveSessionAssets,
} from '@hoop-rush/application/fixed-five';
import { FixedFiveRoomController } from './fixed-five-room-controller.svelte.js';

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/paths', () => ({
  resolve: (path: string) => (path.startsWith('/') ? path : `/${path}`),
}));
vi.mock('./fixed-five-repo', () => ({ fixedFiveRepository: {} }));

class FakeRunner {
  disposed = false;
  private readonly onEvent: (event: FixedFiveRunnerEvent) => void;
  constructor(onEvent: (event: FixedFiveRunnerEvent) => void) {
    this.onEvent = onEvent;
  }
  runShared82(): void {}
  runDuel(): void {}
  runDuelGame(): void {}
  verify(): void {}
  dispose(): void {
    this.disposed = true;
  }
  emit(event: FixedFiveRunnerEvent): void {
    this.onEvent(event);
  }
}

function createFakeRepository(): FixedFiveRoomRepositoryPort {
  const rows = new Map<number, FixedFiveCommand>();
  return {
    listCommands: () => Promise.resolve([...rows.values()].sort((a, b) => a.ordinal - b.ordinal)),
    appendCommand: (command) => {
      rows.set(command.ordinal, command);
      return Promise.resolve();
    },
    saveActiveSnapshot: () => Promise.resolve(),
    loadPendingResult: () => Promise.resolve(null),
    savePendingResult: () => Promise.resolve(),
    clearPendingResult: () => Promise.resolve(),
  };
}

function createHarness(): {
  transport: FixedFiveMultiplayerTransport;
  deps: FixedFiveRoomSessionDeps;
  createRoom(options?: {
    mode?: FixedFiveRoomSnapshot['settings']['mode'];
    sourceMode?: FixedFiveRoomSnapshot['settings']['sourceMode'];
  }): Promise<{ snapshot: FixedFiveRoomSnapshot; code: string }>;
} {
  const transport = createInMemoryFixedFiveTransport({ seed: 'fixed-five-controller-test' });
  const memberships: FixedFiveRoomMembership[] = [];
  let commandSequence = 0;
  const deps: FixedFiveRoomSessionDeps = {
    roomId: 'pending-room',
    transport,
    repository: createFakeRepository(),
    createRunner: (onEvent) => new FakeRunner(onEvent),
    loadAssets: () => Promise.resolve(null),
    buildTeam: (_manifest, teamId, displayName, refs) =>
      Promise.resolve({
        teamId,
        displayName,
        players: refs.map((ref) => ({
          playerId: ref.playerId,
          displayName: `Player ${ref.playerId}`,
        })),
      } as unknown as FixedFiveWorkerTeam),
    loadMembership: () => null,
    saveMembership: (membership) => {
      memberships.push(membership);
    },
    loadLobbyId: () => null,
    removeLobbyGuest: () => {
      throw new Error('unexpected lobby remove');
    },
    now: () => Date.now(),
    newCommandId: () => `command-id-${String((commandSequence += 1))}`,
    friendlyError: (error) => (error instanceof Error ? error.message : String(error)),
    loadActivityAt: () => null,
    saveActivityNow: () => {},
    prefersReducedMotion: () => false,
    guardStorage: {
      load: () => null,
      save: () => {},
    },
  };
  return {
    transport,
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
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('condition was never met');
}

function snakeCandidate(index: number): FixedFiveCandidate {
  const playerId = playerIdSchema.parse(`snake-player-${String(index)}`);
  const franchiseId = 'test-franchise';
  const eraId = 'test-era';
  const seasonKey = '1990-91';
  return {
    playerId,
    playerVersionId: playerVersionId(playerId, franchiseId, eraId, seasonKey),
    positions: ['PG', 'SG', 'SF', 'PF', 'C'],
    selectionScore: 80 - index,
    franchiseId,
    eraId,
  };
}

function indexEntryOf(candidate: FixedFiveCandidate): PlayersIndexEntry {
  return {
    playerId: candidate.playerId,
    franchiseId: candidate.franchiseId,
    eraId: candidate.eraId,
    seasonKey: '1990-91',
    displayName: `Player ${candidate.playerId}`,
    firstName: 'P',
    lastName: candidate.playerId,
    positionsPlayable: candidate.positions,
  } as unknown as PlayersIndexEntry;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('FixedFiveRoomController', () => {
  it('mirrors the session snapshot and follows the draft phase', async () => {
    const harness = createHarness();
    const created = await harness.createRoom();
    const controller = new FixedFiveRoomController({
      roomId: created.snapshot.roomId,
      session: harness.deps,
    });

    await controller.start();
    expect(controller.loading).toBe(false);
    expect(controller.roomSnapshot?.roomId).toBe(created.snapshot.roomId);
    expect(controller.phase).toBe('lobby');
    expect(controller.phaseLabel).toBe('Lobby');
    expect(controller.stageIndex).toBe(0);
    expect(controller.display?.members).toHaveLength(2);
    expect(controller.rollAnimation).toEqual({ nonce: 0, axis: 'both' });
    expect(controller.modeDetailLabel).toBe('Season · 82 games · Classic');
    expect(controller.canRematch).toBe(false);
    expect(controller.playerStats).toBeNull();
    expect(controller.statsState).toBe('empty');
    expect(controller.clockText).toBeNull();

    await controller.startDraft();
    expect(controller.roomSnapshot?.phase).toBe('drafting');
    expect(controller.phase).toBe('drafting');
    expect(controller.stageIndex).toBe(1);
    expect(controller.phaseLabel).toBe('Draft');
    expect(controller.clockText).toMatch(/^Pick clock: /);

    await controller.leaveRoom();
    expect(goto).toHaveBeenCalledWith('/multiplayer/');

    const before = controller.roomSnapshot;
    controller.dispose();
    await harness.transport.submitCommand({
      schemaVersion: 1,
      roomId: created.snapshot.roomId,
      commandId: commandIdSchema.parse('cmd-after-dispose'),
      actorParticipantId: 'p2',
      payload: { kind: 'ready', ready: true },
    });
    await Promise.resolve();
    expect(controller.roomSnapshot).toBe(before);
  });

  it('repositions a snake pick off-turn without spending one', async () => {
    const pool = Array.from({ length: 12 }, (_, index) => snakeCandidate(index));
    const harness = createHarness();
    harness.deps.loadAssets = () =>
      Promise.resolve({
        pool,
        poolById: new Map(pool.map((candidate) => [candidate.playerId, candidate])),
        context: createEngineContext(),
      } as unknown as FixedFiveSessionAssets);
    const created = await harness.transport.create({
      mode: 'sandbox-shared-82',
      sourceMode: 'sandbox',
      variant: 'ratings',
      versions: defaultFixedFiveVersionLocks({
        dataVersion: 'test-data',
        engineVersion: 'test-engine',
      }),
    });
    harness.deps.roomId = created.snapshot.roomId;
    const controller = new FixedFiveRoomController({
      roomId: created.snapshot.roomId,
      session: harness.deps,
    });
    await controller.start();

    const started = await harness.transport.submitCommand({
      schemaVersion: 1,
      roomId: created.snapshot.roomId,
      commandId: commandIdSchema.parse('snake-start'),
      actorParticipantId: 'p1',
      payload: { kind: 'start' },
    });
    expect(started.accepted).toBe(true);
    const rootSeed = created.snapshot.rootSeed;
    if (!rootSeed) throw new Error('snake room is missing a root seed');
    const first = fixedFiveSandboxFirstPicker(rootSeed);
    const other = first === 'p1' ? 'p2' : 'p1';
    const order: Array<'p1' | 'p2'> = [first, other, other, first];
    const slots: Record<'p1' | 'p2', number> = { p1: 0, p2: 0 };
    let placed = 0;
    let p1Candidate: FixedFiveCandidate | null = null;
    for (const actor of order) {
      const candidate = pool[placed];
      if (!candidate) throw new Error('snake pool exhausted');
      const receipt = await harness.transport.submitCommand({
        schemaVersion: 1,
        roomId: created.snapshot.roomId,
        commandId: commandIdSchema.parse(`snake-place-${String(placed)}`),
        actorParticipantId: actor,
        payload: {
          kind: 'sandbox-place',
          playerId: candidate.playerId,
          playerVersionId: candidate.playerVersionId,
          slotIndex: slots[actor],
        },
      });
      expect(receipt.accepted).toBe(true);
      if (actor === 'p1' && p1Candidate === null) p1Candidate = candidate;
      slots[actor] += 1;
      placed += 1;
    }
    await waitFor(() => {
      const replay = controller.replay;
      return (
        replay?.mode === 'sandbox-shared-82' &&
        replay.draftStyle === 'snake' &&
        replay.state.picks.length === 4
      );
    });
    if (p1Candidate === null) throw new Error('p1 never placed in the snake fixture');
    const before = controller.roomSnapshot?.deadline;
    if (!before) throw new Error('snake fixture is missing its deadline');

    await controller.pickPlayer(indexEntryOf(p1Candidate), 2);
    await waitFor(() =>
      controller.commands.some((command) => command.payload.kind === 'sandbox-reposition'),
    );
    expect(controller.draftError).toBeNull();
    const move = controller.commands.find(
      (command) => command.payload.kind === 'sandbox-reposition',
    );
    expect(move?.actorParticipantId).toBe('p1');
    if (move?.payload.kind !== 'sandbox-reposition') throw new Error('missing reposition command');
    expect(move.payload.playerId).toBe(p1Candidate.playerId);
    expect(move.payload.slotIndex).toBe(2);
    const after = controller.roomSnapshot?.deadline;
    expect(after?.cursor).toBe(before.cursor);
    expect(after?.participantId).toBe(before.participantId);
    expect(after?.pickOrdinal).toBe(before.pickOrdinal);
    const replay = controller.replay;
    if (replay?.mode !== 'sandbox-shared-82' || replay.draftStyle !== 'snake') {
      throw new Error('unexpected replay shape');
    }
    expect(
      replay.state.picks.find((pick) => pick.playerId === p1Candidate.playerId)?.slotIndex,
    ).toBe(2);
    controller.dispose();
  });

  it('mirrors the duel broadcast phases and readiness', async () => {
    const harness = createHarness();
    const created = await harness.createRoom({ mode: 'duel', sourceMode: 'classic' });
    const started = await harness.transport.submitCommand({
      schemaVersion: 1,
      roomId: created.snapshot.roomId,
      commandId: commandIdSchema.parse('duel-start'),
      actorParticipantId: 'p1',
      payload: { kind: 'start' },
    });
    expect(started.accepted).toBe(true);
    for (let index = 0; index < 10; index += 1) {
      const receipt = await harness.transport.submitCommand({
        schemaVersion: 1,
        roomId: created.snapshot.roomId,
        commandId: commandIdSchema.parse(`duel-pick-${String(index)}`),
        actorParticipantId: index % 2 === 0 ? 'p1' : 'p2',
        payload: {
          kind: 'duel-claim',
          playerId: playerIdSchema.parse(`duel-player-${String(index)}`),
          slotIndex: index % 5,
          franchiseId: franchiseIdSchema.parse('lakers'),
          eraId: '1990s',
        },
      });
      expect(receipt.accepted).toBe(true);
    }

    const controller = new FixedFiveRoomController({
      roomId: created.snapshot.roomId,
      session: harness.deps,
    });
    await controller.start();
    expect(controller.duelBroadcast).toBe(true);
    expect(controller.phase).toBe('preparing-game');
    expect(controller.phaseLabel).toBe('Pre-game');
    expect(controller.stageIndex).toBe(2);
    expect(controller.duelCurrentGameNumber).toBe(1);
    expect(controller.duelSeries?.currentGameNumber).toBe(1);

    await controller.readyForNextGame();
    expect(controller.localReady).toBe(true);
    expect(controller.opponentReady).toBe(false);

    controller.dispose();
  });
});
