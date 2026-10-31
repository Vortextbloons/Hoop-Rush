import type {
  CapRushMultiplayerCommand,
  CapRushMultiplayerCommandPayload,
  CapRushMultiplayerCommandReceipt,
  CapRushMultiplayerCreateInput,
  CapRushMultiplayerRoomMembership,
  CapRushMultiplayerRoomSnapshot,
  CapRushMultiplayerSeatId,
  CapRushMultiplayerSettings,
  CapRushMultiplayerState,
  CapRushMultiplayerSubmitInput,
  CapRushMultiplayerSync,
  CapRushMultiplayerTransport,
  CapRushMultiplayerVerificationReceipt,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
  capRushMultiplayerSettingsSchema,
  canonicalJson,
  commandIdSchema,
  idSchema,
  seedSchema,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import {
  applyCapRushMultiplayerCommand,
  createCapRushMultiplayerState,
  type CapRushMultiplayerEnvironment,
} from '@hoop-rush/engine';
import type { CapRushMultiplayerNextDeadline } from './recruitment-deadline.ts';

export interface CapRushMultiplayerInMemoryTransportOptions {
  readonly environment: CapRushMultiplayerEnvironment;
  readonly defaultSettings: CapRushMultiplayerSettings;
  readonly now?: () => number;
  readonly rootSeed?: string;
  readonly codeStart?: number;
}

interface InMemoryMember {
  readonly participantId: CapRushMultiplayerSeatId;
  displayName: string;
  online: boolean;
  lastSeenAt: string | null;
}

interface InMemoryRoom {
  roomId: string;
  code: string;
  settings: CapRushMultiplayerSettings;
  rootSeed: string;
  state: CapRushMultiplayerState;
  revision: number;
  commands: CapRushMultiplayerCommand[];
  commandIds: Map<string, { actor: CapRushMultiplayerSeatId; payload: string; ordinal: number }>;
  members: Map<CapRushMultiplayerSeatId, InMemoryMember>;
  subscribers: Set<() => void>;
  createdAtIso: string;
  expiresAtIso: string;
  receipts: Map<CapRushMultiplayerSeatId, CapRushMultiplayerVerificationReceipt>;
}

function digestOf(value: unknown): string {
  return seasonDigestHex(canonicalJson(value));
}

function payloadKey(payload: CapRushMultiplayerCommandPayload): string {
  return canonicalJson(payload);
}

export class CapRushMultiplayerInMemoryTransport implements CapRushMultiplayerTransport {
  private readonly rooms = new Map<string, InMemoryRoom>();
  private readonly codes = new Map<string, string>();
  private counter = 0;
  private codeCounter: number;
  private readonly now: () => number;

  constructor(private readonly options: CapRushMultiplayerInMemoryTransportOptions) {
    this.now = options.now ?? (() => Date.parse('2026-11-01T00:00:00.000Z'));
    this.codeCounter = options.codeStart ?? 1000;
  }

  async create(input: CapRushMultiplayerCreateInput): Promise<CapRushMultiplayerRoomMembership> {
    this.counter += 1;
    const roomId = idSchema.parse(`crm-${String(this.counter)}`);
    const code = String(this.codeCounter + this.counter);
    const rootSeed = seedSchema.parse(
      this.options.rootSeed ?? digestOf({ roomId, kind: 'cap-rush-multiplayer-root' }),
    );
    const settings = capRushMultiplayerSettingsSchema.parse(
      input.settings ?? this.options.defaultSettings,
    );
    const createdAtIso = new Date(this.now()).toISOString();
    const room: InMemoryRoom = {
      roomId,
      code,
      settings,
      rootSeed,
      state: createCapRushMultiplayerState(rootSeed),
      revision: 0,
      commands: [],
      commandIds: new Map(),
      members: new Map([
        [
          'p1',
          {
            participantId: 'p1',
            displayName: 'Host',
            online: true,
            lastSeenAt: createdAtIso,
          },
        ],
      ]),
      subscribers: new Set(),
      createdAtIso,
      expiresAtIso: new Date(this.now() + 24 * 60 * 60 * 1000).toISOString(),
      receipts: new Map(),
    };
    this.rooms.set(roomId, room);
    this.codes.set(code, roomId);
    return { roomId, participantId: 'p1', code };
  }

  async preview(code: string): Promise<CapRushMultiplayerRoomSnapshot> {
    const roomId = this.codes.get(code);
    if (roomId === undefined) throw new Error('invalid-code');
    return this.snapshotOf(this.room(roomId));
  }

  async join(code: string): Promise<CapRushMultiplayerRoomMembership> {
    const roomId = this.codes.get(code);
    if (roomId === undefined) throw new Error('invalid-code');
    const room = this.room(roomId);
    if (room.members.has('p2')) throw new Error('room-full');
    room.members.set('p2', {
      participantId: 'p2',
      displayName: 'Guest',
      online: true,
      lastSeenAt: new Date(this.now()).toISOString(),
    });
    this.emit(room);
    return { roomId, participantId: 'p2', code };
  }

  async resume(roomId: string): Promise<CapRushMultiplayerRoomMembership> {
    const room = this.room(roomId);
    const member = room.members.get('p1');
    if (member === undefined) throw new Error('membership');
    member.online = true;
    member.lastSeenAt = new Date(this.now()).toISOString();
    this.emit(room);
    return { roomId, participantId: 'p1', code: room.code };
  }

  async snapshot(roomId: string): Promise<CapRushMultiplayerRoomSnapshot> {
    return this.snapshotOf(this.room(roomId));
  }

  async sync(roomId: string, afterOrdinal = -1): Promise<CapRushMultiplayerSync> {
    const room = this.room(roomId);
    return {
      snapshot: this.snapshotOf(room),
      commands: room.commands.filter((command) => command.ordinal > afterOrdinal),
      commandCount: room.commands.length,
    };
  }

  subscribe(roomId: string, onChange: () => void, onError: (error: Error) => void): () => void {
    const room = this.rooms.get(roomId);
    if (room === undefined) {
      onError(new Error('invalid-room'));
      return () => {};
    }
    room.subscribers.add(onChange);
    return () => {
      room.subscribers.delete(onChange);
    };
  }

  async submitCommand(
    input: CapRushMultiplayerSubmitInput,
  ): Promise<CapRushMultiplayerCommandReceipt> {
    const room = this.room(input.roomId);
    commandIdSchema.parse(input.commandId);
    const key = payloadKey(input.payload);
    const existing = room.commandIds.get(input.commandId);
    if (existing !== undefined) {
      if (existing.actor === input.actorParticipantId && existing.payload === key) {
        return {
          roomId: idSchema.parse(room.roomId),
          commandId: commandIdSchema.parse(input.commandId),
          ordinal: existing.ordinal,
          accepted: true,
          rejectionCode: null,
          revision: room.revision,
        };
      }
      return {
        roomId: idSchema.parse(room.roomId),
        commandId: commandIdSchema.parse(input.commandId),
        ordinal: existing.ordinal,
        accepted: false,
        rejectionCode: 'command-conflict',
        revision: room.revision,
      };
    }
    if (input.expectedRevision !== room.revision) {
      return {
        roomId: idSchema.parse(room.roomId),
        commandId: commandIdSchema.parse(input.commandId),
        ordinal: room.commands.length,
        accepted: false,
        rejectionCode: 'stale-revision',
        revision: room.revision,
      };
    }
    const command: CapRushMultiplayerCommand = {
      schemaVersion: CAP_RUSH_MULTIPLAYER_SCHEMA_VERSION,
      roomId: idSchema.parse(room.roomId),
      commandId: commandIdSchema.parse(input.commandId),
      ordinal: room.commands.length,
      actorParticipantId: input.actorParticipantId,
      expectedRevision: input.expectedRevision,
      acceptedAtIso: new Date(this.now()).toISOString(),
      payload: input.payload,
    };
    const outcome = applyCapRushMultiplayerCommand(room.state, command, this.options.environment);
    if (!outcome.ok) {
      return {
        roomId: idSchema.parse(room.roomId),
        commandId: commandIdSchema.parse(input.commandId),
        ordinal: room.commands.length,
        accepted: false,
        rejectionCode: outcome.code,
        revision: room.revision,
      };
    }
    room.commands.push(command);
    room.commandIds.set(input.commandId, {
      actor: input.actorParticipantId,
      payload: key,
      ordinal: command.ordinal,
    });
    room.state = outcome.state;
    room.revision += 1;
    this.emit(room);
    return {
      roomId: idSchema.parse(room.roomId),
      commandId: commandIdSchema.parse(input.commandId),
      ordinal: command.ordinal,
      accepted: true,
      rejectionCode: null,
      revision: room.revision,
    };
  }

  async closeDueAuctions(roomId: string): Promise<CapRushMultiplayerCommandReceipt | null> {
    const room = this.room(roomId);
    const deadline = this.deadlineOf(room.state);
    if (deadline === null || room.state.recruitment === null) return null;
    if (Date.parse(deadline.atIso) > this.now()) return null;
    return this.submitCommand({
      roomId,
      commandId: `close-${String(room.state.recruitment.roundIndex)}-${String(room.commands.length)}`,
      actorParticipantId: 'p1',
      expectedRevision: room.revision,
      payload: {
        kind: 'close-due-auctions',
        round: room.state.recruitment.roundIndex,
      },
    });
  }

  async removeGuest(roomId: string): Promise<void> {
    const room = this.room(roomId);
    room.members.delete('p2');
    this.emit(room);
  }

  async leave(roomId: string): Promise<void> {
    const room = this.room(roomId);
    this.emit(room);
  }

  async verificationChallenge(roomId: string): Promise<string> {
    const room = this.room(roomId);
    return digestOf({
      roomId: room.roomId,
      rootSeed: room.rootSeed,
      commandIds: room.commands.map((command) => command.commandId),
      stateDigest: digestOf(room.state),
    });
  }

  async submitVerification(
    roomId: string,
    participantId: CapRushMultiplayerSeatId,
    receipt: CapRushMultiplayerVerificationReceipt,
  ): Promise<void> {
    this.room(roomId).receipts.set(participantId, receipt);
  }

  async complete(roomId: string): Promise<void> {
    this.room(roomId);
  }

  async fail(roomId: string): Promise<void> {
    const room = this.room(roomId);
    room.state = { ...room.state, phase: 'integrity-failed' };
    this.emit(room);
  }

  stateOf(roomId: string): CapRushMultiplayerState {
    return this.room(roomId).state;
  }

  deadlineOf(state: CapRushMultiplayerState): CapRushMultiplayerNextDeadline | null {
    if (state.recruitment === null) return null;
    const round = state.recruitment.rounds[state.recruitment.rounds.length - 1];
    if (round === undefined || round.status !== 'bidding') return null;
    let earliest: { cursor: string; atIso: string } | null = null;
    for (const auction of round.auctions) {
      if (auction.status !== 'open') continue;
      if (earliest === null || auction.endsAtIso < earliest.atIso) {
        earliest = {
          cursor: `auction:${String(round.index)}:${auction.playerId}`,
          atIso: auction.endsAtIso,
        };
      }
    }
    return earliest;
  }

  private room(roomId: string): InMemoryRoom {
    const room = this.rooms.get(roomId);
    if (room === undefined) throw new Error('invalid-room');
    return room;
  }

  private emit(room: InMemoryRoom): void {
    for (const subscriber of [...room.subscribers]) subscriber();
  }

  private snapshotOf(room: InMemoryRoom): CapRushMultiplayerRoomSnapshot {
    const deadline = this.deadlineOf(room.state);
    const members = (['p1', 'p2'] as const).map((seat) => {
      const member = room.members.get(seat);
      return {
        participantId: seat,
        displayName: member?.displayName ?? (seat === 'p1' ? 'Host' : 'Guest'),
        online: member?.online ?? false,
        ready: seat === 'p1' ? room.state.ready.p1 : room.state.ready.p2,
        lastSeenAt: member?.lastSeenAt ?? null,
      };
    });
    return {
      roomId: room.roomId,
      code: room.code,
      codeActive: true,
      settings: room.settings,
      phase: room.state.phase,
      revision: room.revision,
      commandCount: room.commands.length,
      members,
      rootSeed: room.rootSeed,
      state: room.state,
      deadline,
      resultDigest: room.state.report === null ? null : digestOf(room.state.report),
      confirmedDigest: null,
      successorRoomId: null,
      expiresAt: room.expiresAtIso,
      createdAt: room.createdAtIso,
    };
  }
}
