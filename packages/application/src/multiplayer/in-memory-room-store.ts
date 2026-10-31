import { createSeededRng } from '../runtime/seeded-rng.ts';

export type InMemoryRandomSource =
  { seed: string } | { rng: () => number } | { bytes: (length: number) => Uint8Array };

export interface InMemoryRoomRecord<Snapshot, Event, Receipt, Fallback extends { cursor: string }> {
  snapshot: Snapshot;
  commandIds: Set<string>;
  code: string;
  codeExpiresAt: number;
  updatedAt: number;
  subscribers: Set<(snapshot: Snapshot) => void>;
  transientSubscribers: Set<(event: Event) => void>;
  verificationChallenge: string | null;
  receipts: Map<string, Receipt>;
  fallback: Fallback | null;
}

export interface InMemoryRoomSnapshot {
  roomId: string;
  phase: string;
  revision: number;
  deadline: { cursor: string } | null;
}

export type RoomDeadlineOf<Snapshot extends InMemoryRoomSnapshot> = NonNullable<
  Snapshot['deadline']
>;

interface ParsedSchema<T> {
  parse(value: unknown): T;
}

interface SafeParsedSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export function roomError(message: string, code: string, retryable: boolean): Error {
  return Object.assign(new Error(message), { code, retryable });
}

export const authorizationError = () => roomError('authorization', 'authorization', false);
export const invalidCodeError = () => roomError('invalid-code', 'invalid-code', false);
export const codeExpiredError = () => roomError('code-expired', 'code-expired', false);
export const phaseError = () => roomError('phase', 'phase', false);
export const membershipError = () => roomError('membership', 'membership', false);
export const staleRevisionError = () => roomError('stale-revision', 'stale-revision', true);

export interface InMemoryRoomStoreOptions<
  Snapshot extends InMemoryRoomSnapshot,
  Fallback extends { cursor: string },
> {
  clock: () => number;
  random: InMemoryRandomSource;
  roomIdPrefix: string;
  codeTtlMs: number;
  codeSchema: ParsedSchema<string>;
  challengePrefix: string;
  challengeBytes: number;
  codeExhaustedMessage: string;
  clearCode?: (snapshot: Snapshot) => Snapshot;
  initialFallback?: () => Fallback | null;
}

export interface InMemoryRoomStore<
  Snapshot extends InMemoryRoomSnapshot,
  Event,
  Receipt extends { challenge: string; receiptDigest: string },
  Fallback extends { cursor: string },
  Record extends InMemoryRoomRecord<Snapshot, Event, Receipt, Fallback>,
> {
  readonly clock: () => number;
  add(roomId: string, record: Record): void;
  claimCreateSlot(): number;
  allocateRoom(now: number): {
    roomId: string;
    code: string;
    rootSeed: string;
    codeExpiresAt: number;
  };
  all(): Iterable<Record>;
  pruneExpiredCodes(): void;
  emit(record: Record): void;
  find(roomId: string): Record | undefined;
  require(roomId: string): Record;
  roomByCode(code: string): Record;
  joinableRoom(code: string): Record;
  subscribe(roomId: string, handler: (snapshot: Snapshot) => void): { unsubscribe: () => void };
  subscribeTransient(roomId: string, handler: (event: Event) => void): { unsubscribe: () => void };
  publishTransient(roomId: string, event: Event): boolean;
  rotateCode(record: Record): string;
  retireCode(record: Record): void;
  verificationChallenge(record: Record): string;
  commitFallback(
    record: Record,
    cursor: string,
    expectedRevision: number | undefined,
    build: (deadline: RoomDeadlineOf<Snapshot>) => Fallback,
  ): { stored: boolean; revision: number };
  resolveTimeout<T>(
    record: Record | undefined,
    deadlineAt: (deadline: RoomDeadlineOf<Snapshot>) => string,
    commandIdOf: (deadline: RoomDeadlineOf<Snapshot>, fallback: Fallback) => string,
    submit: (fallback: Fallback, commandId: string) => T | Promise<T>,
  ): Promise<T | null>;
  submitVerification(
    record: Record,
    receipt: unknown,
    expectedRevision: number | undefined,
    schema: SafeParsedSchema<Receipt>,
    options?: { touch?: boolean; foreignReceiptMessage?: string },
  ): { receiptId: string; revision: number };
}

export function createInMemoryRoomStore<
  Snapshot extends InMemoryRoomSnapshot,
  Event,
  Receipt extends { challenge: string; receiptDigest: string },
  Fallback extends { cursor: string },
  Record extends InMemoryRoomRecord<Snapshot, Event, Receipt, Fallback>,
>(
  options: InMemoryRoomStoreOptions<Snapshot, Fallback>,
): InMemoryRoomStore<Snapshot, Event, Receipt, Fallback, Record> {
  const clock = options.clock;
  const random = options.random;
  const randomBytes = 'bytes' in random ? random.bytes : undefined;
  const rng =
    'rng' in random
      ? random.rng
      : 'seed' in random
        ? createSeededRng(random.seed)
        : () => {
            const bytes = new Uint8Array(random.bytes(4));
            return new DataView(bytes.buffer).getUint32(0, true) / 4294967296;
          };
  const rooms = new Map<string, Record>();
  const codeIndex = new Map<string, string>();
  const createTimestamps: number[] = [];

  function bytesOf(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    if (randomBytes) {
      bytes.set(randomBytes(bytes.length));
      return bytes;
    }
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(rng() * 256);
    return bytes;
  }

  function hexOf(length: number): string {
    return [...bytesOf(length)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function randomCode(existing: Set<string>): string {
    for (let attempt = 0; attempt < 2000; attempt += 1) {
      const code = String(Math.floor(rng() * 10000)).padStart(4, '0');
      if (!existing.has(code)) return options.codeSchema.parse(code);
    }
    throw new Error(options.codeExhaustedMessage);
  }

  function randomRoomId(): string {
    return `${options.roomIdPrefix}${[...bytesOf(12)]
      .map((b) => b.toString(36))
      .join('')
      .slice(0, 12)}`
      .toLowerCase()
      .replace(/[^a-z0-9._:-]/g, 'a');
  }

  function pruneExpiredCodes(): void {
    const now = clock();
    for (const [code, roomId] of [...codeIndex.entries()]) {
      const record = rooms.get(roomId);
      if (!record || record.codeExpiresAt <= now || record.snapshot.phase === 'expired') {
        codeIndex.delete(code);
        if (record && options.clearCode) record.snapshot = options.clearCode(record.snapshot);
      }
    }
  }

  function emit(record: Record): void {
    for (const handler of record.subscribers) {
      try {
        handler(record.snapshot);
      } catch {
        continue;
      }
    }
  }

  function find(roomId: string): Record | undefined {
    return rooms.get(roomId);
  }

  function require(roomId: string): Record {
    const record = rooms.get(roomId);
    if (!record) throw authorizationError();
    return record;
  }

  function roomByCode(code: string): Record {
    pruneExpiredCodes();
    const roomId = codeIndex.get(code);
    const record = roomId === undefined ? undefined : rooms.get(roomId);
    if (!record) throw invalidCodeError();
    return record;
  }

  function joinableRoom(code: string): Record {
    const record = roomByCode(code);
    if (record.snapshot.phase === 'expired') throw codeExpiredError();
    return record;
  }

  function rotateCode(record: Record): string {
    const nextCode = randomCode(
      new Set([...codeIndex.keys()].filter((code) => code !== record.code)),
    );
    codeIndex.delete(record.code);
    codeIndex.set(nextCode, record.snapshot.roomId);
    record.code = nextCode;
    record.codeExpiresAt = clock() + options.codeTtlMs;
    return nextCode;
  }

  return {
    clock,
    add(roomId, record) {
      rooms.set(roomId, record);
      codeIndex.set(record.code, roomId);
    },
    claimCreateSlot() {
      pruneExpiredCodes();
      const now = clock();
      const recent = createTimestamps.filter((timestamp) => now - timestamp < 60000);
      if (recent.length >= 60) {
        throw Object.assign(new Error('rate-limit: too many rooms'), {
          code: 'rate-limit',
          retryable: true,
        });
      }
      createTimestamps.push(now);
      return now;
    },
    allocateRoom(now) {
      const roomId = randomRoomId();
      const code = randomCode(new Set(codeIndex.keys()));
      return { roomId, code, rootSeed: hexOf(16), codeExpiresAt: now + options.codeTtlMs };
    },
    all() {
      return rooms.values();
    },
    pruneExpiredCodes,
    emit,
    find,
    require,
    roomByCode,
    joinableRoom,
    subscribe(roomId, handler) {
      const record = rooms.get(roomId);
      if (!record) return { unsubscribe: () => {} };
      record.subscribers.add(handler);
      return { unsubscribe: () => record.subscribers.delete(handler) };
    },
    subscribeTransient(roomId, handler) {
      const record = rooms.get(roomId);
      if (!record) return { unsubscribe: () => {} };
      record.transientSubscribers.add(handler);
      return { unsubscribe: () => record.transientSubscribers.delete(handler) };
    },
    publishTransient(roomId, event) {
      const record = rooms.get(roomId);
      if (!record) return false;
      for (const handler of record.transientSubscribers) {
        try {
          handler(event);
        } catch {
          continue;
        }
      }
      return true;
    },
    rotateCode,
    retireCode(record) {
      codeIndex.delete(record.code);
    },
    verificationChallenge(record) {
      record.verificationChallenge ??= `${options.challengePrefix}${hexOf(options.challengeBytes)}`;
      return record.verificationChallenge;
    },
    commitFallback(record, cursor, expectedRevision, build) {
      const deadline = record.snapshot.deadline;
      if (!deadline || deadline.cursor !== cursor) {
        return { stored: false, revision: record.snapshot.revision };
      }
      if (expectedRevision !== undefined && expectedRevision !== record.snapshot.revision) {
        throw staleRevisionError();
      }
      record.fallback = build(deadline);
      return { stored: true, revision: record.snapshot.revision };
    },
    async resolveTimeout(record, deadlineAt, commandIdOf, submit) {
      if (!record) return null;
      const deadline = record.snapshot.deadline;
      if (!deadline) return null;
      if (clock() < Date.parse(deadlineAt(deadline))) return null;
      const fallback = record.fallback;
      if (!fallback || fallback.cursor !== deadline.cursor) return null;
      const commandId = commandIdOf(deadline, fallback);
      if (record.commandIds.has(commandId)) return null;
      return submit(fallback, commandId);
    },
    submitVerification(record, receipt, expectedRevision, schema, submitOptions) {
      const invalidReceipt = (message: string) =>
        Object.assign(new Error(message), {
          rejectionCode: 'invalid-receipt',
          revision: record.snapshot.revision,
        });
      const parsed = schema.safeParse(receipt);
      if (!parsed.success) throw invalidReceipt('verification: invalid receipt');
      const receiptRoomId = (parsed.data as { roomId?: string }).roomId;
      if (receiptRoomId !== undefined && receiptRoomId !== record.snapshot.roomId) {
        throw invalidReceipt(
          submitOptions?.foreignReceiptMessage ?? 'verification: invalid receipt',
        );
      }
      if (
        record.verificationChallenge === null ||
        parsed.data.challenge !== record.verificationChallenge
      ) {
        throw Object.assign(new Error('verification: challenge mismatch'), {
          rejectionCode: 'invalid-receipt',
          revision: record.snapshot.revision,
        });
      }
      if (expectedRevision !== undefined && expectedRevision !== record.snapshot.revision) {
        throw Object.assign(new Error('stale-revision'), {
          rejectionCode: 'stale-revision',
          revision: record.snapshot.revision,
        });
      }
      record.receipts.set(parsed.data.receiptDigest, parsed.data);
      if (submitOptions?.touch) record.updatedAt = clock();
      return { receiptId: parsed.data.receiptDigest, revision: record.snapshot.revision };
    },
  };
}
