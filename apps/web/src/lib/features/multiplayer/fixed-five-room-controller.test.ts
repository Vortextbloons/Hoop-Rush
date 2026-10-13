import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commandIdSchema,
  createInMemoryFixedFiveTransport,
  defaultFixedFiveVersionLocks,
  type FixedFiveCommand,
  type FixedFiveMultiplayerTransport,
  type FixedFiveRoomMembership,
  type FixedFiveRoomSnapshot,
  type FixedFiveWorkerTeam,
} from '@hoop-rush/data-contracts';
import type { FixedFiveRunnerEvent } from './fixed-five-runner';
import type {
  FixedFiveRoomRepositoryPort,
  FixedFiveRoomSessionDeps,
} from '@hoop-rush/application/fixed-five';
import { FixedFiveRoomController } from './fixed-five-room-controller.svelte';

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('./fixed-five-repo', () => ({ fixedFiveRepository: {} }));

class FakeRunner {
  disposed = false;
  private readonly onEvent: (event: FixedFiveRunnerEvent) => void;
  constructor(onEvent: (event: FixedFiveRunnerEvent) => void) {
    this.onEvent = onEvent;
  }
  runShared82(): void {}
  runDuel(): void {}
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
  createRoom(): Promise<{ snapshot: FixedFiveRoomSnapshot; code: string }>;
} {
  const transport = createInMemoryFixedFiveTransport({ seed: 'fixed-five-controller-test' });
  const memberships: FixedFiveRoomMembership[] = [];
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
    newCommandId: () => 'command-id-1',
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
    async createRoom() {
      const created = await transport.create({
        mode: 'classic-shared-82',
        sourceMode: 'classic',
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
    expect(goto).toHaveBeenCalledWith('/multiplayer');

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
});
