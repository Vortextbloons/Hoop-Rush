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
  CapRushMultiplayerTransport,
  CapRushMultiplayerVerificationReceipt,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  capRushMultiplayerRoomSnapshotSchema,
  capRushMultiplayerSettingsSchema,
  commandIdSchema,
  idSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import {
  applyCapRushMultiplayerCommand,
  capRushMultiplayerStateDigest,
  createCapRushMultiplayerState,
} from '@hoop-rush/engine';
import { capRushMultiplayerDeadlineOf } from '@hoop-rush/application/cap-rush-multiplayer';
import { createRealtimeRoomRegistry, getMultiplayerClient } from '#lib/supabase-runtime.js';
import { getCapRushMultiplayerData } from './cap-rush-multiplayer-assets.js';

interface CommandRow {
  command_id: string;
  ordinal: number;
  actor_participant_id: CapRushMultiplayerSeatId;
  accepted_at: string;
  payload: CapRushMultiplayerCommandPayload;
}

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
    const sync = await this.sync(roomId);
    return sync.snapshot;
  }

  async sync(roomId: string, afterOrdinal = -1): Promise<CapRushMultiplayerSync> {
    const client = await getMultiplayerClient();
    const result = await client.rpc('cap_rush_multiplayer_room_sync', {
      p_room_id: roomId,
      p_after_ordinal: afterOrdinal,
    });
    if (result.error) throw new Error(result.error.message);
    const row = recordOf(result.data);
    const snapshot = capRushMultiplayerRoomSnapshotSchema.parse(row.room);
    const commands: CapRushMultiplayerCommand[] = (
      (row.commands as CommandRow[] | undefined) ?? []
    ).map((command) => ({
      schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
      roomId: snapshot.roomId,
      commandId: commandIdSchema.parse(command.command_id),
      ordinal: command.ordinal,
      actorParticipantId: command.actor_participant_id,
      expectedRevision: Math.max(0, command.ordinal),
      acceptedAtIso: command.accepted_at,
      payload: command.payload,
    }));
    return { snapshot, commands, commandCount: snapshot.commandCount };
  }

  subscribe(roomId: string, onChange: () => void, onError: (error: Error) => void): () => void {
    return this.rooms.subscribe(roomId, onChange, onError).unsubscribe;
  }

  async submitCommand(
    input: CapRushMultiplayerSubmitInput,
  ): Promise<CapRushMultiplayerCommandReceipt> {
    const client = await getMultiplayerClient();
    const clock = await client.rpc('cap_rush_multiplayer_clock');
    if (clock.error) throw new Error(clock.error.message);
    const acceptedAtIso = capRushMultiplayerAcceptedAt(clock.data);
    const snapshot = await this.snapshot(input.roomId);
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
    const data = await getCapRushMultiplayerData();
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
    const outcome = applyCapRushMultiplayerCommand(
      state,
      command,
      data.environment,
      snapshot.settings.variant,
    );
    if (!outcome.ok) {
      return {
        roomId: snapshot.roomId,
        commandId: command.commandId,
        ordinal: snapshot.commandCount,
        accepted: false,
        rejectionCode: outcome.code,
        revision: snapshot.revision,
      };
    }
    const result = await client.rpc('cap_rush_multiplayer_command_submit', {
      p_room_id: input.roomId,
      p_command_id: input.commandId,
      p_expected_revision: input.expectedRevision,
      p_payload: input.payload,
      p_state: outcome.state,
      p_state_digest: capRushMultiplayerStateDigest(outcome.state),
      p_accepted_at: acceptedAtIso,
      p_deadline: capRushMultiplayerDeadlineOf(outcome.state),
    });
    if (result.error) throw new Error(result.error.message);
    const receipt = recordOf(result.data);
    const parsed: CapRushMultiplayerCommandReceipt = {
      roomId: snapshot.roomId,
      commandId: command.commandId,
      ordinal: typeof receipt.ordinal === 'number' ? receipt.ordinal : snapshot.commandCount,
      accepted: receipt.accepted === true,
      rejectionCode: typeof receipt.rejectionCode === 'string' ? receipt.rejectionCode : null,
      revision: typeof receipt.revision === 'number' ? receipt.revision : snapshot.revision,
    };
    return parsed;
  }

  async closeDueAuctions(roomId: string): Promise<CapRushMultiplayerCommandReceipt | null> {
    const snapshot = await this.snapshot(roomId);
    const state = snapshot.state;
    if (state === null || snapshot.phase !== 'recruiting' || snapshot.deadline === null)
      return null;
    if (Date.parse(snapshot.deadline.atIso) > Date.now()) return null;
    return this.submitCommand({
      roomId,
      commandId: `close-${String(state.recruitment?.roundIndex ?? 0)}-${String(snapshot.commandCount)}`,
      actorParticipantId: 'p1',
      expectedRevision: snapshot.revision,
      payload: {
        kind: 'close-due-auctions',
        round: state.recruitment?.roundIndex ?? 0,
      },
    });
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
