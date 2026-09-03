import {
  FIXED_FIVE_CODE_TTL_MS,
  FIXED_FIVE_ENVELOPE_MAX_BYTES,
  FIXED_FIVE_MULTIPLAYER_VERSION,
  FIXED_FIVE_ROOM_PROTOCOL_VERSION,
  FIXED_FIVE_ROOM_SCHEMA_VERSION,
  fixedFiveCommandSchema,
  fixedFiveTimeoutMsForMode,
  type FixedFiveCommand,
  type FixedFiveCommandReceipt,
  type FixedFiveMultiplayerTransport,
  type FixedFiveParticipantId,
  type FixedFiveRoomCode,
  type FixedFiveRoomMembership,
  type FixedFiveRoomSettings,
  type FixedFiveRoomSnapshot,
} from './fixed-five-multiplayer.ts';
import { canonicalJson, seasonDigestHex } from './season-hash.ts';

function nowIso(): string {
  return new Date().toISOString();
}

function randomSeed(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomCode(existing: Set<string>): FixedFiveRoomCode {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const n = Math.floor(Math.random() * 10000);
    const code = String(n).padStart(4, '0');
    if (!existing.has(code)) return code;
  }
  throw new Error('in-memory fixed-five: code space exhausted');
}

function randomRoomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `ff-${[...bytes]
    .map((b) => b.toString(36))
    .join('')
    .slice(0, 12)}`
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, 'a');
}

interface RoomRecord {
  snapshot: FixedFiveRoomSnapshot;
  commands: FixedFiveCommand[];
  commandIds: Set<string>;
  code: FixedFiveRoomCode;
  codeExpiresAt: number;
  subscribers: Set<(snapshot: FixedFiveRoomSnapshot) => void>;
}

function snapshotDigest(snapshot: FixedFiveRoomSnapshot): string {
  return seasonDigestHex(
    canonicalJson({
      roomId: snapshot.roomId,
      revision: snapshot.revision,
      phase: snapshot.phase,
      commandCount: snapshot.commandCount,
    }),
  );
}

export function createInMemoryFixedFiveTransport(options?: {
  clock?: () => number;
}): FixedFiveMultiplayerTransport {
  const clock = options?.clock ?? Date.now;
  const rooms = new Map<string, RoomRecord>();
  const codeIndex = new Map<string, string>();
  const createTimestamps: number[] = [];

  function pruneExpiredCodes(): void {
    const now = clock();
    for (const [code, roomId] of [...codeIndex.entries()]) {
      const record = rooms.get(roomId);
      if (!record || record.codeExpiresAt <= now || record.snapshot.phase === 'expired') {
        codeIndex.delete(code);
        if (record && record.snapshot.codeActive) {
          record.snapshot = { ...record.snapshot, codeActive: false, code: null };
        }
      }
    }
  }

  function emit(record: RoomRecord): void {
    for (const handler of record.subscribers) {
      try {
        handler(record.snapshot);
      } catch {
        continue;
      }
    }
  }

  function touchDeadline(record: RoomRecord): void {
    if (record.snapshot.phase !== 'drafting') {
      if (record.snapshot.deadline !== null) {
        record.snapshot = { ...record.snapshot, deadline: null };
      }
      return;
    }
  }

  return {
    async create(settingsInput) {
      await Promise.resolve();
      pruneExpiredCodes();
      const now = clock();
      const recent = createTimestamps.filter((t) => now - t < 60_000);
      if (recent.length >= 6) {
        throw Object.assign(new Error('rate-limit: too many rooms'), {
          code: 'rate-limit',
          retryable: true,
        });
      }
      createTimestamps.push(now);
      const settings: FixedFiveRoomSettings = {
        schemaVersion: FIXED_FIVE_ROOM_SCHEMA_VERSION,
        timerPolicyVersion: 'fixed-five-autopick-v1',
        ...settingsInput,
        versions: settingsInput.versions,
      };
      const roomId = randomRoomId();
      const codes = new Set(codeIndex.keys());
      const code = randomCode(codes);
      const rootSeed = randomSeed();
      const timeoutMs = fixedFiveTimeoutMsForMode(settings.mode);
      const createdAt = new Date(now).toISOString();
      const expiresAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();
      const deadlineAt = new Date(now + timeoutMs).toISOString();
      const snapshot: FixedFiveRoomSnapshot = {
        roomId,
        code,
        codeActive: true,
        settings,
        phase: 'lobby',
        revision: 0,
        commandCount: 0,
        digest: null,
        members: [
          {
            participantId: 'p1',
            online: true,
            ready: false,
            picksCommitted: 0,
            locked: false,
            lastSeenAt: createdAt,
          },
          {
            participantId: 'p2',
            online: false,
            ready: false,
            picksCommitted: 0,
            locked: false,
            lastSeenAt: null,
          },
        ],
        rootSeed: null,
        deadline: {
          roomId,
          cursor: 'lobby',
          participantId: 'p1',
          deadlineAt,
          fallback: { kind: 'ready', ready: true },
          pickOrdinal: 0,
        },
        resultDigest: null,
        confirmedDigest: null,
        successorRoomId: null,
        expiresAt,
        createdAt,
      };
      void rootSeed;
      const record: RoomRecord = {
        snapshot,
        commands: [],
        commandIds: new Set(),
        code,
        codeExpiresAt: now + FIXED_FIVE_CODE_TTL_MS,
        subscribers: new Set(),
      };
      rooms.set(roomId, record);
      codeIndex.set(code, roomId);
      const membership: FixedFiveRoomMembership = { roomId, participantId: 'p1', code };
      return { snapshot, code, membership };
    },
    async preview(code) {
      await Promise.resolve();
      pruneExpiredCodes();
      const roomId = codeIndex.get(code);
      if (!roomId)
        throw Object.assign(new Error('invalid-code'), { code: 'invalid-code', retryable: false });
      const record = rooms.get(roomId);
      if (!record)
        throw Object.assign(new Error('invalid-code'), { code: 'invalid-code', retryable: false });
      return record.snapshot;
    },
    async join(code) {
      await Promise.resolve();
      pruneExpiredCodes();
      const roomId = codeIndex.get(code);
      if (!roomId)
        throw Object.assign(new Error('invalid-code'), { code: 'invalid-code', retryable: false });
      const record = rooms.get(roomId);
      if (!record)
        throw Object.assign(new Error('invalid-code'), { code: 'invalid-code', retryable: false });
      if (record.snapshot.phase === 'expired')
        throw Object.assign(new Error('code-expired'), { code: 'code-expired', retryable: false });
      const p2 = record.snapshot.members.find((m) => m.participantId === 'p2');
      const updated = record.snapshot.members.map((m) =>
        m.participantId === 'p2' ? { ...m, online: true, lastSeenAt: nowIso() } : m,
      );
      void p2;
      record.snapshot = {
        ...record.snapshot,
        members: updated,
        revision: record.snapshot.revision + 1,
      };
      emit(record);
      return {
        snapshot: record.snapshot,
        membership: { roomId, participantId: 'p2', code: record.code },
      };
    },
    async resume(roomId) {
      await Promise.resolve();
      const record = rooms.get(roomId);
      if (!record)
        throw Object.assign(new Error('authorization'), {
          code: 'authorization',
          retryable: false,
        });
      return {
        snapshot: record.snapshot,
        membership: { roomId, participantId: 'p1', code: record.code },
      };
    },
    subscribe(roomId, handler) {
      const record = rooms.get(roomId);
      if (!record) return { unsubscribe: () => {} };
      record.subscribers.add(handler);
      return {
        unsubscribe: () => {
          record.subscribers.delete(handler);
        },
      };
    },
    async refetch(roomId, afterOrdinal) {
      await Promise.resolve();
      const record = rooms.get(roomId);
      if (!record)
        throw Object.assign(new Error('authorization'), {
          code: 'authorization',
          retryable: false,
        });
      return record.commands.filter((c) => c.ordinal > afterOrdinal);
    },
    async submitCommand(command) {
      await Promise.resolve();
      const record = rooms.get(command.roomId);
      if (!record)
        throw Object.assign(new Error('authorization'), {
          code: 'authorization',
          retryable: false,
        });
      const payloadBytes = new TextEncoder().encode(canonicalJson(command.payload)).length;
      if (payloadBytes > FIXED_FIVE_ENVELOPE_MAX_BYTES) {
        return {
          roomId: command.roomId,
          commandId: command.commandId,
          ordinal: -1,
          accepted: false,
          rejectionCode: 'payload-too-large',
          revision: record.snapshot.revision,
        };
      }
      if (record.commandIds.has(command.commandId)) {
        const existing = record.commands.find((c) => c.commandId === command.commandId);
        return {
          roomId: command.roomId,
          commandId: command.commandId,
          ordinal: existing?.ordinal ?? -1,
          accepted: true,
          rejectionCode: null,
          revision: record.snapshot.revision,
        };
      }
      const expectedOrdinal = record.commands.length;
      const ordinal = command.ordinal ?? expectedOrdinal;
      if (ordinal !== expectedOrdinal) {
        const receipt: FixedFiveCommandReceipt = {
          roomId: command.roomId,
          commandId: command.commandId,
          ordinal: -1,
          accepted: false,
          rejectionCode: 'stale-revision',
          revision: record.snapshot.revision,
        };
        return receipt;
      }
      const full = { ...command, ordinal, schemaVersion: 1 as const };
      const parsed = fixedFiveCommandSchema.safeParse(full);
      if (!parsed.success) {
        return {
          roomId: command.roomId,
          commandId: command.commandId,
          ordinal: -1,
          accepted: false,
          rejectionCode: 'illegal-move',
          revision: record.snapshot.revision,
        };
      }
      record.commands.push(parsed.data);
      record.commandIds.add(command.commandId);
      record.snapshot = {
        ...record.snapshot,
        commandCount: record.commands.length,
        revision: record.snapshot.revision + 1,
        digest: snapshotDigest({
          ...record.snapshot,
          revision: record.snapshot.revision + 1,
          commandCount: record.commands.length,
        }),
      };
      touchDeadline(record);
      emit(record);
      return {
        roomId: command.roomId,
        commandId: command.commandId,
        ordinal,
        accepted: true,
        rejectionCode: null,
        revision: record.snapshot.revision,
      };
    },
    async resolveTimeout(roomId) {
      const record = rooms.get(roomId);
      if (!record) return null;
      if (!record.snapshot.deadline) return null;
      const deadline = record.snapshot.deadline;
      if (clock() < Date.parse(deadline.deadlineAt)) return null;
      const commandId = `timeout-${deadline.cursor}-${String(deadline.pickOrdinal)}`;
      if (record.commandIds.has(commandId)) return null;
      const receipt = await this.submitCommand({
        schemaVersion: 1,
        roomId,
        commandId,
        actorParticipantId: deadline.participantId,
        payload: deadline.fallback,
      });
      return receipt;
    },
    async removeGuest(roomId, targetParticipantId: FixedFiveParticipantId) {
      await Promise.resolve();
      const record = rooms.get(roomId);
      if (!record)
        throw Object.assign(new Error('authorization'), {
          code: 'authorization',
          retryable: false,
        });
      if (record.snapshot.phase !== 'lobby')
        throw Object.assign(new Error('phase'), { code: 'phase', retryable: false });
      if (targetParticipantId !== 'p2')
        throw Object.assign(new Error('membership'), { code: 'membership', retryable: false });
      const codes = new Set([...codeIndex.keys()].filter((c) => c !== record.code));
      const nextCode = randomCode(codes);
      codeIndex.delete(record.code);
      codeIndex.set(nextCode, roomId);
      record.code = nextCode;
      record.codeExpiresAt = clock() + FIXED_FIVE_CODE_TTL_MS;
      record.snapshot = {
        ...record.snapshot,
        code: nextCode,
        codeActive: true,
        revision: record.snapshot.revision + 1,
      };
      emit(record);
      return record.snapshot;
    },
    async leave(roomId, participantId) {
      await Promise.resolve();
      const record = rooms.get(roomId);
      if (!record) return;
      record.snapshot = {
        ...record.snapshot,
        members: record.snapshot.members.map((m) =>
          m.participantId === participantId ? { ...m, online: false } : m,
        ),
        revision: record.snapshot.revision + 1,
      };
      emit(record);
    },
    async rematch(roomId) {
      const record = rooms.get(roomId);
      if (!record)
        throw Object.assign(new Error('authorization'), {
          code: 'authorization',
          retryable: false,
        });
      if (record.snapshot.phase !== 'completed')
        throw Object.assign(new Error('phase'), { code: 'phase', retryable: false });
      const created = await this.create({
        mode: record.snapshot.settings.mode,
        sourceMode: record.snapshot.settings.sourceMode,
        variant: record.snapshot.settings.variant,
        versions: record.snapshot.settings.versions,
      });
      record.snapshot = { ...record.snapshot, successorRoomId: created.snapshot.roomId };
      emit(record);
      return { snapshot: created.snapshot, code: created.code };
    },
  };
}

export function fixedFiveInMemoryProtocolTag(): string {
  return `${FIXED_FIVE_MULTIPLAYER_VERSION}/room-${String(FIXED_FIVE_ROOM_PROTOCOL_VERSION)}`;
}
