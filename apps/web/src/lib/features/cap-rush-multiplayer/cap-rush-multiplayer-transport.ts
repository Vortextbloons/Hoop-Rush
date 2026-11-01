import { getPersistence } from '#lib/persistence.js';
import {
  CapRushMultiplayerRunner,
  CapRushMultiplayerProjectionRejection,
} from './cap-rush-multiplayer-runner.js';
import type {
  CapRushMultiplayerCommand,
  CapRushMultiplayerCommandPayload,
  CapRushMultiplayerCommandReceipt,
  CapRushMultiplayerCreateInput,
  CapRushMultiplayerRoomMembership,
  CapRushMultiplayerRoomSnapshot,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerSubmitInput,
  CapRushMultiplayerSync,
  CapRushMultiplayerState,
  CapRushMultiplayerTransport,
  CapRushMultiplayerVerificationReceipt,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  CAP_RUSH_MULTIPLAYER_VERSION,
  capRushMultiplayerRoomSnapshotSchema,
  capRushMultiplayerSettingsSchema,
  commandIdSchema,
  idSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { capRushMultiplayerStateDigest, createCapRushMultiplayerState } from '@hoop-rush/engine';
import { capRushMultiplayerDeadlineOf } from '@hoop-rush/application/cap-rush-multiplayer';
import { createRealtimeRoomRegistry, getMultiplayerClient } from '#lib/supabase-runtime.js';
import { getCapRushMultiplayerData } from './cap-rush-multiplayer-assets.js';
import { capRushMultiplayerAcceptedAt } from './cap-rush-multiplayer-presentation.js';

interface CommandRow {
  command_id: string;
  ordinal: number;
  actor_participant_id: CapRushMultiplayerSeatId;
  accepted_at: string;
  payload: CapRushMultiplayerCommandPayload;
}

const roomMetadataSchema = capRushMultiplayerRoomSnapshotSchema.omit({ state: true });

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`cap rush multiplayer response is missing ${key}`);
  }
  return value;
}

export class CapRushMultiplayerSupabaseTransport implements CapRushMultiplayerTransport {
  private readonly projector = new CapRushMultiplayerRunner();
  private projectionTail: Promise<unknown> = Promise.resolve();
  private readonly snapshots = new Map<string, CapRushMultiplayerRoomSnapshot>();
  private readonly stateDigests = new WeakMap<CapRushMultiplayerState, string>();
  private readonly rooms = createRealtimeRoomRegistry({
    label: 'Cap Rush',
    roomsTable: 'cap_rush_multiplayer_rooms',
    commandsTable: 'cap_rush_multiplayer_room_commands',
    topic: (roomId) => `cap-rush-multiplayer:${roomId}`,
    getClient: getMultiplayerClient,
  });

  async create(input: CapRushMultiplayerCreateInput): Promise<CapRushMultiplayerRoomMembership> {
    const data = await getCapRushMultiplayerData();
    const settings = capRushMultiplayerSettingsSchema.parse({
      schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
      variant: input.variant,
      versionLocks: data.versionLocks,
    });
    const client = await getMultiplayerClient();
    const created = await client.rpc('cap_rush_multiplayer_room_create', {
      p_variant: input.variant,
      p_settings: settings,
    });
    if (created.error) throw new Error(created.error.message);
    const row = recordOf(created.data);
    const roomId = idSchema.parse(requiredString(row, 'roomId'));
    const rootSeed = seedSchema.parse(requiredString(row, 'rootSeed'));
    const state = createCapRushMultiplayerState(rootSeed);
    const initialized = await client.rpc('cap_rush_multiplayer_room_init', {
      p_room_id: roomId,
      p_state: state,
    });
    if (initialized.error) throw new Error(initialized.error.message);
    return {
      roomId,
      participantId: 'p1',
      code: requiredString(row, 'code'),
    };
  }

  async preview(code: string): Promise<CapRushMultiplayerRoomSnapshot> {
    const client = await getMultiplayerClient();
    const result = await client.rpc('cap_rush_multiplayer_room_preview', { p_code: code });
    if (result.error) throw new Error(result.error.message);
    return capRushMultiplayerRoomSnapshotSchema.parse(result.data);
  }

  async join(code: string): Promise<CapRushMultiplayerRoomMembership> {
    const client = await getMultiplayerClient();
    const result = await client.rpc('cap_rush_multiplayer_room_join', { p_code: code });
    if (result.error) throw new Error(result.error.message);
    const row = recordOf(result.data);
    return {
      roomId: idSchema.parse(requiredString(row, 'roomId')),
      participantId: 'p2',
      code,
    };
  }

  async resume(roomId: string): Promise<CapRushMultiplayerRoomMembership> {
    const client = await getMultiplayerClient();
    const result = await client.rpc('cap_rush_multiplayer_room_resume', { p_room_id: roomId });
    if (result.error) throw new Error(result.error.message);
    const row = recordOf(result.data);
    return {
      roomId: idSchema.parse(requiredString(row, 'roomId')),
      participantId: row.participantId === 'p2' ? 'p2' : 'p1',
      code: requiredString(row, 'code'),
    };
  }

  async snapshot(roomId: string): Promise<CapRushMultiplayerRoomSnapshot> {
    const sync = await this.sync(roomId, 2_147_483_647);
    return sync.snapshot;
  }

  async sync(roomId: string, afterOrdinal = -1): Promise<CapRushMultiplayerSync> {
    const client = await getMultiplayerClient();
    let previous = this.snapshots.get(roomId);
    if (!previous) {
      const saved = await getPersistence().capRushMultiplayerRepository.loadActive(roomId);
      if (saved) {
        previous = saved.snapshot;
        this.snapshots.set(roomId, previous);
      }
    }
    const cursor = previous ? Math.min(afterOrdinal, previous.commandCount - 1) : -1;
    const result = await client.rpc('cap_rush_multiplayer_room_sync', {
      p_room_id: roomId,
      p_after_ordinal: cursor,
    });
    if (result.error) throw new Error(result.error.message);
    const row = recordOf(result.data);
    const rawRoom = recordOf(row.room);
    const protocol = recordOf(recordOf(rawRoom.settings).versionLocks).multiplayerVersion;
    if (typeof protocol === 'string' && protocol !== CAP_RUSH_MULTIPLAYER_VERSION)
      throw new Error(
        'This room uses the old Cap Rush multiplayer protocol. Leave the lobby and create a new Cap Rush match.',
      );
    const commands: CapRushMultiplayerCommand[] = (
      (row.commands as CommandRow[] | undefined) ?? []
    ).map((command) => ({
      schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
      roomId: idSchema.parse(roomId),
      commandId: commandIdSchema.parse(command.command_id),
      ordinal: command.ordinal,
      actorParticipantId: command.actor_participant_id,
      expectedRevision: command.ordinal,
      acceptedAtIso: command.accepted_at,
      payload: command.payload,
    }));
    let localState: CapRushMultiplayerState | undefined;
    if (recordOf(rawRoom.state)._localSimulation === true) {
      const settings = capRushMultiplayerSettingsSchema.parse(rawRoom.settings);
      const rootSeed = seedSchema.parse(rawRoom.rootSeed);
      const pending = commands.filter(
        (command) => command.ordinal >= (previous?.commandCount ?? 0),
      );
      const start = previous?.commandCount ?? 0;
      for (let index = 0; index < pending.length; index += 1) {
        if (pending[index]?.ordinal !== start + index)
          throw new Error('cap rush command log has a gap');
      }
      if (start + pending.length !== rawRoom.commandCount)
        throw new Error('cap rush command log is incomplete');
      const projected =
        pending.length === 0 && previous?.state
          ? previous.state
          : await this.project(
              previous?.state ?? createCapRushMultiplayerState(rootSeed),
              pending,
              settings.variant,
            );
      if (
        typeof rawRoom.stateDigest === 'string' &&
        this.digestOf(projected) !== rawRoom.stateDigest
      )
        throw new Error(
          'Cap Rush simulation mismatch. Both players must use the same game version.',
        );
      localState = projected;
    }
    const snapshot = localState
      ? { ...roomMetadataSchema.parse(rawRoom), state: localState }
      : capRushMultiplayerRoomSnapshotSchema.parse(rawRoom);
    const latest = this.snapshots.get(roomId);
    if (!latest || snapshot.revision >= latest.revision) {
      this.snapshots.set(roomId, snapshot);
      if (snapshot.state && snapshot.revision !== previous?.revision) {
        await getPersistence().capRushMultiplayerRepository.saveCheckpoint({
          snapshot,
          state: snapshot.state,
          commands,
          receipts: [],
          games:
            snapshot.state.season?.games.filter(
              (game) => !previous?.state?.season?.games.some((old) => old.gameId === game.gameId),
            ) ?? [],
          updatedAtIso: new Date().toISOString(),
        });
      }
    }
    return { snapshot, commands, commandCount: snapshot.commandCount };
  }

  private project(
    state: import('@hoop-rush/data-contracts').CapRushMultiplayerState,
    commands: readonly CapRushMultiplayerCommand[],
    variant: 'clash' | 'roulette',
  ) {
    const next = this.projectionTail.then(async () =>
      this.projector.project({
        state,
        commands,
        environment: (await getCapRushMultiplayerData()).environment,
        variant,
      }),
    );
    this.projectionTail = next.catch(() => {});
    return next;
  }

  private digestOf(state: CapRushMultiplayerState): string {
    const previous = this.stateDigests.get(state);
    if (previous !== undefined) return previous;
    const digest = capRushMultiplayerStateDigest(state);
    this.stateDigests.set(state, digest);
    return digest;
  }

  subscribe(roomId: string, onChange: () => void, onError: (error: Error) => void): () => void {
    return this.rooms.subscribe(roomId, onChange, onError).unsubscribe;
  }

  async submitCommand(
    input: CapRushMultiplayerSubmitInput,
  ): Promise<CapRushMultiplayerCommandReceipt> {
    const cached = this.snapshots.get(input.roomId);
    const [acceptedAtIso, snapshot] = await Promise.all([
      this.clockNow(),
      cached?.revision === input.expectedRevision
        ? Promise.resolve(cached)
        : this.snapshot(input.roomId),
    ]);
    return this.submitWithSnapshot(input, snapshot, acceptedAtIso);
  }

  private async clockNow(): Promise<string> {
    const client = await getMultiplayerClient();
    const clock = await client.rpc('cap_rush_multiplayer_clock');
    if (clock.error) throw new Error(clock.error.message);
    return capRushMultiplayerAcceptedAt(clock.data);
  }

  private async submitWithSnapshot(
    input: CapRushMultiplayerSubmitInput,
    snapshot: CapRushMultiplayerRoomSnapshot,
    acceptedAtIso: string,
  ): Promise<CapRushMultiplayerCommandReceipt> {
    const client = await getMultiplayerClient();
    const state = snapshot.state;
    if (state === null) {
      return {
        roomId: snapshot.roomId,
        commandId: commandIdSchema.parse(input.commandId),
        ordinal: snapshot.commandCount,
        accepted: false,
        rejectionCode: 'invalid-phase',
        revision: snapshot.revision,
      };
    }
    const command: CapRushMultiplayerCommand = {
      schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
      roomId: snapshot.roomId,
      commandId: commandIdSchema.parse(input.commandId),
      ordinal: snapshot.commandCount,
      actorParticipantId: input.actorParticipantId,
      expectedRevision: input.expectedRevision,
      acceptedAtIso,
      payload: input.payload,
    };
    let projected;
    try {
      projected = await this.project(state, [command], snapshot.settings.variant);
    } catch (error) {
      if (!(error instanceof CapRushMultiplayerProjectionRejection)) throw error;
      return {
        roomId: snapshot.roomId,
        commandId: command.commandId,
        ordinal: snapshot.commandCount,
        accepted: false,
        rejectionCode: error.code,
        revision: snapshot.revision,
      };
    }
    const coordinationState = {
      _localSimulation: true,
      phase: projected.phase,
      ready: projected.ready,
    };
    const result = await client.rpc('cap_rush_multiplayer_command_submit', {
      p_room_id: input.roomId,
      p_command_id: input.commandId,
      p_expected_revision: input.expectedRevision,
      p_payload: input.payload,
      p_state: coordinationState,
      p_state_digest: this.digestOf(projected),
      p_accepted_at: acceptedAtIso,
      p_deadline: capRushMultiplayerDeadlineOf(projected),
    });
    if (result.error) throw new Error(result.error.message);
    const receipt = recordOf(result.data);
    if (
      receipt.accepted === true &&
      typeof receipt.revision === 'number' &&
      typeof receipt.ordinal === 'number'
    ) {
      const accepted = {
        ...snapshot,
        phase: projected.phase,
        revision: receipt.revision,
        commandCount: receipt.ordinal + 1,
        state: projected,
        deadline: capRushMultiplayerDeadlineOf(projected),
      };
      this.snapshots.set(snapshot.roomId, accepted);
      await getPersistence().capRushMultiplayerRepository.saveCheckpoint({
        snapshot: accepted,
        state: projected,
        commands: [command],
        receipts: [],
        games:
          projected.season?.games.filter(
            (game) => !state.season?.games.some((old) => old.gameId === game.gameId),
          ) ?? [],
        updatedAtIso: new Date().toISOString(),
      });
    }
    return {
      roomId: snapshot.roomId,
      commandId: command.commandId,
      ordinal: typeof receipt.ordinal === 'number' ? receipt.ordinal : snapshot.commandCount,
      accepted: receipt.accepted === true,
      rejectionCode: typeof receipt.rejectionCode === 'string' ? receipt.rejectionCode : null,
      revision: typeof receipt.revision === 'number' ? receipt.revision : snapshot.revision,
    };
  }

  async closeDueAuctions(roomId: string): Promise<CapRushMultiplayerCommandReceipt | null> {
    const [snapshot, acceptedAtIso] = await Promise.all([this.snapshot(roomId), this.clockNow()]);
    const state = snapshot.state;
    if (state === null || snapshot.phase !== 'recruiting' || snapshot.deadline === null)
      return null;
    if (Date.parse(snapshot.deadline.atIso) > Date.now()) return null;
    return this.submitWithSnapshot(
      {
        roomId,
        commandId: `close-${String(state.recruitment?.roundIndex ?? 0)}-${String(snapshot.commandCount)}`,
        actorParticipantId: 'p1',
        expectedRevision: snapshot.revision,
        payload: {
          kind: 'close-due-auctions',
          round: state.recruitment?.roundIndex ?? 0,
        },
      },
      snapshot,
      acceptedAtIso,
    );
  }

  async removeGuest(roomId: string, targetParticipantId: CapRushMultiplayerSeatId): Promise<void> {
    const client = await getMultiplayerClient();
    const result = await client.rpc('cap_rush_multiplayer_room_remove_guest', {
      p_room_id: roomId,
      p_target: targetParticipantId,
    });
    if (result.error) throw new Error(result.error.message);
  }

  async leave(roomId: string): Promise<void> {
    const client = await getMultiplayerClient();
    const result = await client.rpc('cap_rush_multiplayer_room_leave', { p_room_id: roomId });
    if (result.error) throw new Error(result.error.message);
  }

  async verificationChallenge(roomId: string): Promise<string> {
    const client = await getMultiplayerClient();
    const result = await client.rpc('cap_rush_multiplayer_verification_challenge', {
      p_room_id: roomId,
    });
    if (result.error) throw new Error(result.error.message);
    return typeof result.data === 'string' ? result.data : '';
  }

  async submitVerification(
    roomId: string,
    participantId: CapRushMultiplayerSeatId,
    receipt: CapRushMultiplayerVerificationReceipt,
  ): Promise<void> {
    const client = await getMultiplayerClient();
    const result = await client.rpc('cap_rush_multiplayer_verification_submit', {
      p_room_id: roomId,
      p_participant: participantId,
      p_receipt: receipt,
    });
    if (result.error) throw new Error(result.error.message);
  }

  async complete(roomId: string, resultDigest: string): Promise<void> {
    const client = await getMultiplayerClient();
    const result = await client.rpc('cap_rush_multiplayer_room_complete', {
      p_room_id: roomId,
      p_result_digest: resultDigest,
    });
    if (result.error) throw new Error(result.error.message);
  }

  async fail(roomId: string): Promise<void> {
    const client = await getMultiplayerClient();
    const result = await client.rpc('cap_rush_multiplayer_room_fail', { p_room_id: roomId });
    if (result.error) throw new Error(result.error.message);
  }
}

let activeTransport: CapRushMultiplayerSupabaseTransport | null = null;

export function getCapRushMultiplayerTransport(): CapRushMultiplayerSupabaseTransport {
  if (activeTransport === null) activeTransport = new CapRushMultiplayerSupabaseTransport();
  return activeTransport;
}
