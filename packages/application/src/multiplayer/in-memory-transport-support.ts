import { idSchema, seedSchema } from '@hoop-rush/data-contracts';
import {
  membershipError,
  phaseError,
  type InMemoryRoomRecord,
  type InMemoryRoomSnapshot,
  type InMemoryRoomStore,
  type RoomDeadlineOf,
} from './in-memory-room-store.ts';

export type RoomParticipantId = 'p1' | 'p2';

const HOME_GAMES: ReadonlySet<number> = new Set([1, 2, 5, 7]);

export function nowIso(clock: () => number): string {
  return new Date(clock()).toISOString();
}

export function seedByteParity(rootSeed: string, offset: number): boolean {
  return Number.parseInt(rootSeed.slice(offset, offset + 2), 16) % 2 === 0;
}

export function otherParticipantId(participantId: RoomParticipantId): RoomParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}

export function pickerFor(firstPicker: RoomParticipantId, ordinal: number): RoomParticipantId {
  return ordinal % 2 === 0 ? firstPicker : otherParticipantId(firstPicker);
}

export function homeGameFor(
  homeWinner: RoomParticipantId,
  gameNumber: number,
  maxGames: number,
  label: string,
): RoomParticipantId {
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > maxGames) {
    throw new Error(
      `${label} gameNumber must be an integer in 1..${String(maxGames)} (got ${String(gameNumber)})`,
    );
  }
  return HOME_GAMES.has(gameNumber) ? homeWinner : otherParticipantId(homeWinner);
}

export function patchMember<Member extends { participantId: string }>(
  members: readonly Member[],
  participantId: Member['participantId'],
  patch: Partial<Member>,
): Member[] {
  return members.map((member) =>
    member.participantId === participantId ? { ...member, ...patch } : member,
  );
}

export function commandReceipt<
  RoomId extends string,
  CommandId extends string,
  RejectionCode extends string | null,
>(
  roomId: RoomId,
  commandId: CommandId,
  ordinal: number,
  rejectionCode: RejectionCode,
  revision: number,
) {
  return { roomId, commandId, ordinal, accepted: rejectionCode === null, rejectionCode, revision };
}

export function commandReceiptWithoutOrdinal<
  RoomId extends string,
  CommandId extends string,
  RejectionCode extends string | null,
>(roomId: RoomId, commandId: CommandId, rejectionCode: RejectionCode, revision: number) {
  return { roomId, commandId, accepted: rejectionCode === null, rejectionCode, revision };
}
interface RoomAllocator {
  claimCreateSlot(): number;
  allocateRoom(now: number): {
    roomId: string;
    code: string;
    rootSeed: string;
    codeExpiresAt: number;
  };
}

export function allocateInMemoryRoom(
  allocator: RoomAllocator,
  retentionMs: number,
  claimedNow = allocator.claimCreateSlot(),
) {
  const now = claimedNow;
  const allocation = allocator.allocateRoom(now);
  return {
    now,
    code: allocation.code,
    codeExpiresAt: allocation.codeExpiresAt,
    roomId: idSchema.parse(allocation.roomId),
    rootSeed: seedSchema.parse(allocation.rootSeed),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + retentionMs).toISOString(),
  };
}

export function baseRoomRecord<
  Snapshot,
  Event,
  Receipt extends { challenge: string; receiptDigest: string },
  Fallback extends { cursor: string },
>(input: {
  snapshot: Snapshot;
  code: string;
  codeExpiresAt: number;
  now: number;
}): InMemoryRoomRecord<Snapshot, Event, Receipt, Fallback> {
  return {
    snapshot: input.snapshot,
    commandIds: new Set(),
    code: input.code,
    codeExpiresAt: input.codeExpiresAt,
    updatedAt: input.now,
    subscribers: new Set(),
    transientSubscribers: new Set(),
    verificationChallenge: null,
    receipts: new Map(),
    fallback: null,
  };
}
interface SafeParsedSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export interface InMemoryTransportMechanicsOptions<
  Snapshot extends InMemoryRoomSnapshot & {
    members: Array<{ participantId: RoomParticipantId; online: boolean }>;
    successorRoomId: string | null;
  },
  Event,
  Receipt extends { challenge: string; receiptDigest: string },
  Fallback extends { cursor: string },
  Record extends InMemoryRoomRecord<Snapshot, Event, Receipt, Fallback>,
  Command,
  Payload,
  CommandReceipt,
  Code extends string,
> {
  store: InMemoryRoomStore<Snapshot, Event, Receipt, Fallback, Record>;
  clock: () => number;
  markOnline: (
    snapshot: Snapshot,
    participantId: RoomParticipantId,
    online: boolean,
    atIso: string,
  ) => Snapshot;
  removeGuest: (snapshot: Snapshot, nextCode: string) => Snapshot;
  touchOnRemoveGuest?: boolean;
  beforeJoin?: (record: Record) => void;
  findForSync?: (roomId: string) => Record | undefined;
  syncCommands: (record: Record, afterOrdinal: number) => Command[];
  syncCommandCount?: (record: Record) => number;
  refetchCommands?: (record: Record, afterOrdinal: number) => Command[];
  parseTransient?: (event: Event, roomId: string) => Event | null;
  receiptSchema: SafeParsedSchema<Receipt>;
  verificationOptions?: { touch?: boolean; foreignReceiptMessage?: string };
  buildFallback: (input: {
    record: Record;
    cursor: string;
    payload: Payload;
    deadline: RoomDeadlineOf<Snapshot>;
  }) => Fallback;
  afterFallback?: (record: Record, fallback: Fallback) => void;
  deadlineAt: (deadline: RoomDeadlineOf<Snapshot>) => string;
  timeoutCommandId: (deadline: RoomDeadlineOf<Snapshot>, fallback: Fallback) => string;
  submitTimeout: (
    record: Record,
    fallback: Fallback,
    commandId: string,
  ) => CommandReceipt | null | Promise<CommandReceipt | null>;
  rematch: {
    phase: Snapshot['phase'];
    reuseSuccessor: boolean;
    touch: boolean;
    create: (
      record: Record,
    ) => { snapshot: Snapshot; code: Code } | Promise<{ snapshot: Snapshot; code: Code }>;
  };
}

export function createRoomTransportMechanics<
  Snapshot extends InMemoryRoomSnapshot & {
    members: Array<{ participantId: RoomParticipantId; online: boolean }>;
    successorRoomId: string | null;
  },
  Event,
  Receipt extends { challenge: string; receiptDigest: string },
  Fallback extends { cursor: string },
  Record extends InMemoryRoomRecord<Snapshot, Event, Receipt, Fallback>,
  Command,
  Payload,
  CommandReceipt,
  Code extends string,
>(
  options: InMemoryTransportMechanicsOptions<
    Snapshot,
    Event,
    Receipt,
    Fallback,
    Record,
    Command,
    Payload,
    CommandReceipt,
    Code
  >,
) {
  const { store, clock } = options;
  return {
    preview: async (code: string): Promise<Snapshot> => {
      await Promise.resolve();
      return store.roomByCode(code).snapshot;
    },
    join: async (
      code: string,
    ): Promise<{
      snapshot: Snapshot;
      membership: { roomId: Snapshot['roomId']; participantId: RoomParticipantId; code: string };
    }> => {
      await Promise.resolve();
      const record = store.joinableRoom(code);
      options.beforeJoin?.(record);
      record.snapshot = options.markOnline(record.snapshot, 'p2', true, nowIso(clock));
      record.snapshot = { ...record.snapshot, revision: record.snapshot.revision + 1 };
      record.updatedAt = clock();
      store.emit(record);
      return {
        snapshot: record.snapshot,
        membership: { roomId: record.snapshot.roomId, participantId: 'p2', code: record.code },
      };
    },
    resume: async (
      roomId: string,
    ): Promise<{
      snapshot: Snapshot;
      membership: { roomId: Snapshot['roomId']; participantId: RoomParticipantId; code: string };
    }> => {
      await Promise.resolve();
      const record = store.require(roomId);
      return {
        snapshot: record.snapshot,
        membership: { roomId: record.snapshot.roomId, participantId: 'p1', code: record.code },
      };
    },
    sync: async (
      roomId: string,
      afterOrdinal: number,
    ): Promise<{ snapshot: Snapshot; commands: Command[]; commandCount?: number }> => {
      await Promise.resolve();
      const record = options.findForSync ? options.findForSync(roomId) : store.require(roomId);
      if (!record) throw new Error('authorization');
      const synced = {
        snapshot: record.snapshot,
        commands: options.syncCommands(record, afterOrdinal),
      };
      return options.syncCommandCount
        ? { ...synced, commandCount: options.syncCommandCount(record) }
        : synced;
    },
    subscribe: (
      roomId: string,
      handler: (snapshot: Snapshot) => void,
    ): { unsubscribe: () => void } => store.subscribe(roomId, handler),
    subscribeTransient: (
      roomId: string,
      handler: (event: Event) => void,
    ): { unsubscribe: () => void } => store.subscribeTransient(roomId, handler),
    publishTransient: (roomId: string, event: Event): Promise<boolean> => {
      const parsed = options.parseTransient ? options.parseTransient(event, roomId) : event;
      return Promise.resolve(parsed === null ? false : store.publishTransient(roomId, parsed));
    },
    refetch: async (roomId: string, afterOrdinal: number): Promise<Command[]> => {
      await Promise.resolve();
      const commands = options.refetchCommands ?? options.syncCommands;
      return commands(store.require(roomId), afterOrdinal);
    },
    verificationChallenge: async (roomId: string): Promise<string> => {
      await Promise.resolve();
      return store.verificationChallenge(store.require(roomId));
    },
    submitVerification: async (
      roomId: string,
      receipt: Receipt,
      expectedRevision?: number,
    ): Promise<{ receiptId: string; revision: number }> => {
      await Promise.resolve();
      return store.submitVerification(
        store.require(roomId),
        receipt,
        expectedRevision,
        options.receiptSchema,
        options.verificationOptions,
      );
    },
    commitFallback: async (
      roomId: string,
      cursor: string,
      payload: Payload,
      expectedRevision?: number,
    ): Promise<{ stored: boolean; revision: number }> => {
      await Promise.resolve();
      const record = store.require(roomId);
      return store.commitFallback(record, cursor, expectedRevision, (deadline) => {
        const fallback = options.buildFallback({ record, cursor, payload, deadline });
        options.afterFallback?.(record, fallback);
        return fallback;
      });
    },
    resolveTimeout: async (roomId: string): Promise<CommandReceipt | null> => {
      const record = store.find(roomId);
      return store.resolveTimeout(
        record,
        options.deadlineAt,
        options.timeoutCommandId,
        (fallback, commandId) =>
          record === undefined
            ? Promise.resolve(null)
            : options.submitTimeout(record, fallback, commandId),
      );
    },
    removeGuest: async (
      roomId: string,
      targetParticipantId: RoomParticipantId,
    ): Promise<Snapshot> => {
      await Promise.resolve();
      const record = store.require(roomId);
      if (record.snapshot.phase !== 'lobby') throw phaseError();
      if (targetParticipantId !== 'p2') throw membershipError();
      const nextCode = store.rotateCode(record);
      record.snapshot = options.removeGuest(record.snapshot, nextCode);
      record.snapshot = { ...record.snapshot, revision: record.snapshot.revision + 1 };
      if (options.touchOnRemoveGuest !== false) record.updatedAt = clock();
      store.emit(record);
      return record.snapshot;
    },
    leave: async (roomId: string, participantId: RoomParticipantId): Promise<void> => {
      await Promise.resolve();
      const record = store.find(roomId);
      if (!record) return;
      record.snapshot = options.markOnline(record.snapshot, participantId, false, nowIso(clock));
      record.snapshot = { ...record.snapshot, revision: record.snapshot.revision + 1 };
      record.updatedAt = clock();
      store.emit(record);
    },
    rematch: async (roomId: string): Promise<{ snapshot: Snapshot; code: Code }> => {
      const record = store.require(roomId);
      if (record.snapshot.phase !== options.rematch.phase) throw phaseError();
      if (options.rematch.reuseSuccessor && record.snapshot.successorRoomId) {
        const successor = store.require(record.snapshot.successorRoomId);
        return { snapshot: successor.snapshot, code: successor.code as Code };
      }
      const created = await options.rematch.create(record);
      record.snapshot = { ...record.snapshot, successorRoomId: created.snapshot.roomId };
      if (options.rematch.touch) record.updatedAt = clock();
      store.emit(record);
      return created;
    },
  };
}
