import {
  SEASON_MULTIPLAYER_VERSION,
  SEASON_ROOM_PROTOCOL_SCHEMA_VERSION,
  SEASON_TIMER_POLICY_VERSION,
} from './season-versions.ts';
import type {
  SeasonAcceptedCheckpoint,
  SeasonCheckpointAttestation,
  SeasonCommandReceipt,
  SeasonIntegrityFailure2,
  SeasonPrivateDecisionSubmission,
  SeasonPublicCommandEnvelope,
  SeasonRerunRequest,
  SeasonRoomCode,
  SeasonRoomMembership,
  SeasonRoomPublicSnapshot,
  SeasonRoomSettings,
  SeasonMultiplayerTransport,
} from './season-multiplayer-protocol.ts';
import { canonicalJson, seasonDigestHex } from './season-hash.ts';

type RoomPhase = SeasonRoomPublicSnapshot['phase'];

interface InMemoryRoom {
  roomId: string;
  settings: SeasonRoomSettings;
  rootSeed: string;
  phase: RoomPhase;
  cursor: string;
  revision: number;
  digest: string;
  code: string | null;
  codeExpiresAt: number | null;
  members: Map<string, SeasonRoomMembership>;
  memberPrivate: Map<
    string,
    { control: 'human' | 'ai-takeover' | 'surrendered'; missStreak: number }
  >;
  commands: SeasonPublicCommandEnvelope[];
  receipts: Map<string, SeasonCommandReceipt>;
  privateDecisions: Map<string, Map<string, SeasonPrivateDecisionSubmission>>;
  attestations: Map<string, SeasonCheckpointAttestation[]>;
  subscribers: Set<(snap: SeasonRoomPublicSnapshot) => void>;
  createdAt: number;
  p1FranchiseId: string | null;
  p2FranchiseId: string | null;
}

function randomCode(counter: number): string {
  return String(counter % 10000).padStart(4, '0');
}

function nowMs(): number {
  return Date.now();
}

function digestOf(value: unknown): string {
  return seasonDigestHex(canonicalJson(value));
}

export interface InMemoryTransportOptions {
  clock?: () => number;
  codeExpiryMs?: number;
}

export class InMemorySeasonMultiplayerTransport implements SeasonMultiplayerTransport {
  private rooms = new Map<string, InMemoryRoom>();
  private codeToRoom = new Map<string, string>();
  private counter = 0;
  private roomCounter = 0;
  private joinAttempts = new Map<string, number[]>();
  private createAttempts = new Map<string, number[]>();
  private clock: () => number;
  private codeExpiryMs: number;

  constructor(options: InMemoryTransportOptions = {}) {
    this.clock = options.clock ?? nowMs;
    this.codeExpiryMs = options.codeExpiryMs ?? 15 * 60 * 1000;
  }

  private nextRoomId(): string {
    this.roomCounter += 1;
    return `room-${String(this.roomCounter).padStart(8, '0')}`;
  }

  private publicSnapshotOf(room: InMemoryRoom): SeasonRoomPublicSnapshot {
    return {
      roomId: room.roomId,
      settings: room.settings,
      phase: room.phase,
      cursor: room.cursor,
      revision: room.revision,
      digest: room.digest,
      memberCount: room.members.size,
      codeActive:
        room.code !== null && room.codeExpiresAt !== null && room.codeExpiresAt > this.clock(),
      expiresAt: room.codeExpiresAt ? new Date(room.codeExpiresAt).toISOString() : null,
    };
  }

  private notify(room: InMemoryRoom): void {
    const snap = this.publicSnapshotOf(room);
    for (const handler of room.subscribers) {
      handler(snap);
    }
  }

  async create(
    settings: SeasonRoomSettings,
    rootSeed: string,
  ): Promise<
    SeasonRoomPublicSnapshot & { code: SeasonRoomCode; membership: SeasonRoomMembership }
  > {
    const uid = 'anon-create';
    const attempts = this.createAttempts.get(uid) ?? [];
    const now = this.clock();
    const recent = attempts.filter((t) => now - t < 60 * 60 * 1000);
    if (recent.length >= 3) {
      throw Object.assign(new Error('rate-limit'), { code: 'rate-limit' });
    }
    recent.push(now);
    this.createAttempts.set(uid, recent);

    let code: string;
    let tries = 0;
    do {
      code = randomCode(this.counter++);
      tries += 1;
      if (tries > 100) throw new Error('code collision retry exhausted');
    } while (this.codeToRoom.has(code));

    const roomId = this.nextRoomId();
    // normalize mode for backward compat
    const normalizedSettings: SeasonRoomSettings = {
      schemaVersion: 1,
      pace: settings.pace,
      mode: (settings as SeasonRoomSettings).mode ?? 'season',
      roomProtocolVersion: 1,
      multiplayerVersion: SEASON_MULTIPLAYER_VERSION,
      timerPolicyVersion: SEASON_TIMER_POLICY_VERSION,
    };
    const room: InMemoryRoom = {
      roomId,
      settings: normalizedSettings,
      rootSeed,
      phase: 'waiting',
      cursor: 'draft-0',
      revision: 0,
      digest: digestOf({ rootSeed, settings: normalizedSettings }),
      code,
      codeExpiresAt: now + this.codeExpiryMs,
      members: new Map(),
      memberPrivate: new Map(),
      commands: [],
      receipts: new Map(),
      privateDecisions: new Map(),
      attestations: new Map(),
      subscribers: new Set(),
      createdAt: now,
      p1FranchiseId: null,
      p2FranchiseId: null,
    };
    // auto-join host as p1 so create immediately has identity (mirrors supabase behavior)
    const membership: SeasonRoomMembership = {
      roomId,
      participantId: 'p1',
      franchiseId: 'franchise-p1',
      uid: `uid-p1-${roomId}`,
      seat: 'p1',
    };
    room.members.set('p1', membership);
    room.memberPrivate.set('p1', { control: 'human', missStreak: 0 });
    room.p1FranchiseId = membership.franchiseId;
    this.rooms.set(roomId, room);
    this.codeToRoom.set(code, roomId);
    const snap = this.publicSnapshotOf(room) as SeasonRoomPublicSnapshot & {
      code: SeasonRoomCode;
      membership: SeasonRoomMembership;
    };
    snap.code = code as SeasonRoomCode;
    snap.membership = membership;
    return snap;
  }

  async preview(code: string): Promise<SeasonRoomPublicSnapshot> {
    const roomId = this.codeToRoom.get(code);
    if (!roomId) {
      throw Object.assign(new Error('invalid-code'), { code: 'invalid-code' });
    }
    const room = this.rooms.get(roomId);
    if (
      !room ||
      room.code !== code ||
      (room.codeExpiresAt !== null && room.codeExpiresAt <= this.clock())
    ) {
      throw Object.assign(new Error('invalid-code'), { code: 'invalid-code' });
    }
    return this.publicSnapshotOf(room);
  }

  async join(code: string): Promise<SeasonRoomMembership> {
    const now = this.clock();
    const key = `join:${code}`;
    const attempts = this.joinAttempts.get(key) ?? [];
    const recentMin = attempts.filter((t) => now - t < 60 * 1000);
    if (recentMin.length >= 5) throw Object.assign(new Error('rate-limit'), { code: 'rate-limit' });
    const recentHour = attempts.filter((t) => now - t < 60 * 60 * 1000);
    if (recentHour.length >= 20)
      throw Object.assign(new Error('rate-limit'), { code: 'rate-limit' });
    recentMin.push(now);
    this.joinAttempts.set(key, [...recentHour, now].slice(-20));

    const roomId = this.codeToRoom.get(code);
    if (!roomId) throw Object.assign(new Error('invalid-code'), { code: 'invalid-code' });
    const room = this.rooms.get(roomId);
    if (!room || room.code !== code || (room.codeExpiresAt !== null && room.codeExpiresAt <= now)) {
      throw Object.assign(new Error('invalid-code'), { code: 'invalid-code' });
    }
    if (room.members.size >= 2) throw Object.assign(new Error('room-full'), { code: 'room-full' });
    if (room.phase !== 'waiting') throw Object.assign(new Error('phase'), { code: 'phase' });

    const participantId = room.members.size === 0 ? 'p1' : 'p2';
    const franchiseId = participantId === 'p1' ? 'franchise-p1' : 'franchise-p2';
    const seat = participantId;
    const membership: SeasonRoomMembership = {
      roomId,
      participantId,
      franchiseId,
      uid: `uid-${participantId}-${roomId}`,
      seat,
    };
    room.members.set(participantId, membership);
    room.memberPrivate.set(participantId, { control: 'human', missStreak: 0 });
    if (participantId === 'p1') room.p1FranchiseId = franchiseId;
    if (participantId === 'p2') room.p2FranchiseId = franchiseId;

    if (room.members.size === 2) {
      // clear join code after both joined but keep phase as waiting until host explicitly starts draft
      room.code = null;
      room.codeExpiresAt = null;
      // phase remains 'waiting' until startDraft is called
    }
    this.notify(room);
    return membership;
  }

  async startDraft(roomId: string): Promise<SeasonRoomPublicSnapshot> {
    const room = this.rooms.get(roomId);
    if (!room) throw Object.assign(new Error('membership'), { code: 'membership' });
    if (room.phase !== 'waiting') throw Object.assign(new Error('phase'), { code: 'phase' });
    if (room.members.size !== 2) throw Object.assign(new Error('phase'), { code: 'phase' });
    room.phase = 'drafting';
    this.notify(room);
    return this.publicSnapshotOf(room);
  }

  async resume(roomId: string): Promise<SeasonRoomPublicSnapshot> {
    const room = this.rooms.get(roomId);
    if (!room) throw Object.assign(new Error('membership'), { code: 'membership' });
    return this.publicSnapshotOf(room);
  }

  subscribe(
    roomId: string,
    handler: (snapshot: SeasonRoomPublicSnapshot) => void,
  ): { unsubscribe: () => void } {
    const room = this.rooms.get(roomId);
    if (!room) throw Object.assign(new Error('membership'), { code: 'membership' });
    room.subscribers.add(handler);
    return {
      unsubscribe: () => room.subscribers.delete(handler),
    };
  }

  async refetch(roomId: string, afterOrdinal: number): Promise<SeasonPublicCommandEnvelope[]> {
    const room = this.rooms.get(roomId);
    if (!room) throw Object.assign(new Error('membership'), { code: 'membership' });
    return room.commands.filter((c) => c.ordinal > afterOrdinal);
  }

  async submitCommand(envelope: SeasonPublicCommandEnvelope): Promise<SeasonCommandReceipt> {
    const room = this.rooms.get(envelope.roomId);
    if (!room) throw Object.assign(new Error('membership'), { code: 'membership' });
    if (!room.members.has(envelope.actorParticipantId)) {
      throw Object.assign(new Error('authorization'), { code: 'authorization' });
    }
    const existing = room.receipts.get(envelope.commandId);
    if (existing) return existing;

    const ordinal = room.commands.length;
    if (envelope.ordinal !== ordinal) {
      const receipt: SeasonCommandReceipt = {
        roomId: envelope.roomId,
        commandId: envelope.commandId,
        ordinal,
        accepted: false,
        rejectionCode: 'stale-revision',
        resultDigest: null,
      };
      room.receipts.set(envelope.commandId, receipt);
      return receipt;
    }

    room.commands.push(envelope);
    room.revision += 1;
    room.digest = digestOf({ revision: room.revision, envelope });
    const receipt: SeasonCommandReceipt = {
      roomId: envelope.roomId,
      commandId: envelope.commandId,
      ordinal,
      accepted: true,
      rejectionCode: null,
      resultDigest: room.digest,
    };
    room.receipts.set(envelope.commandId, receipt);
    this.notify(room);
    return receipt;
  }

  async submitPrivateDecision(
    submission: SeasonPrivateDecisionSubmission,
  ): Promise<{ locked: boolean }> {
    const room = this.rooms.get(submission.roomId);
    if (!room) throw Object.assign(new Error('membership'), { code: 'membership' });
    if (!room.members.has(submission.participantId)) {
      throw Object.assign(new Error('authorization'), { code: 'authorization' });
    }
    const key = submission.cursor;
    let map = room.privateDecisions.get(key);
    if (!map) {
      map = new Map();
      room.privateDecisions.set(key, map);
    }
    map.set(submission.participantId, submission);
    const locked = map.size === 2;
    if (locked) {
      room.phase = 'simulation';
      this.notify(room);
    }
    return { locked };
  }

  async publishAttestation(
    attestation: SeasonCheckpointAttestation,
  ): Promise<SeasonAcceptedCheckpoint | SeasonRerunRequest | SeasonIntegrityFailure2> {
    const room = this.rooms.get(attestation.roomId);
    if (!room) throw Object.assign(new Error('membership'), { code: 'membership' });
    const key = `${attestation.cursor}:${String(attestation.attempt)}`;
    let list = room.attestations.get(key);
    if (!list) {
      list = [];
      room.attestations.set(key, list);
    }
    const existing = list.find((a) => a.participantId === attestation.participantId);
    if (existing) {
      if (
        existing.inputDigest === attestation.inputDigest &&
        existing.resultDigest === attestation.resultDigest
      ) {
        // idempotent
      } else {
        throw Object.assign(new Error('hash-mismatch'), { code: 'hash-mismatch' });
      }
    } else {
      list.push(attestation);
    }

    if (list.length === 2) {
      const [a, b] = list as [SeasonCheckpointAttestation, SeasonCheckpointAttestation];
      if (a.inputDigest === b.inputDigest && a.resultDigest === b.resultDigest) {
        room.phase = 'hash-verification';
        this.notify(room);
        const accepted: SeasonAcceptedCheckpoint = {
          roomId: attestation.roomId,
          cursor: attestation.cursor,
          inputDigest: a.inputDigest,
          resultDigest: a.resultDigest,
          acceptedAt: new Date(this.clock()).toISOString(),
        };
        room.phase = 'checkpoint-setup';
        room.cursor = attestation.cursor;
        room.revision += 1;
        room.digest = a.resultDigest;
        return accepted;
      }
      if (attestation.attempt === 1) {
        const rerun: SeasonRerunRequest = {
          roomId: attestation.roomId,
          cursor: attestation.cursor,
          reason: 'hash mismatch, rerun from last checkpoint',
          attempt: 2,
        };
        return rerun;
      }
      const failure: SeasonIntegrityFailure2 = {
        roomId: attestation.roomId,
        cursor: attestation.cursor,
        expectedInputDigest: a.inputDigest,
        expectedResultDigest: a.resultDigest,
        attestations: list.slice(0, 2) as [
          SeasonCheckpointAttestation,
          SeasonCheckpointAttestation,
        ],
        terminal: true,
      };
      room.phase = 'integrity-failed';
      this.notify(room);
      return failure;
    }

    const rerun: SeasonRerunRequest = {
      roomId: attestation.roomId,
      cursor: attestation.cursor,
      reason: 'awaiting peer attestation',
      attempt: attestation.attempt,
    };
    return rerun;
  }

  async requestReclaim(roomId: string, participantId: 'p1' | 'p2'): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) throw Object.assign(new Error('membership'), { code: 'membership' });
    const priv = room.memberPrivate.get(participantId);
    if (!priv) throw Object.assign(new Error('membership'), { code: 'membership' });
    if (priv.control === 'surrendered')
      throw Object.assign(new Error('authorization'), { code: 'authorization' });
    // reclaim takes effect at next unresolved checkpoint
  }

  async surrender(roomId: string, participantId: 'p1' | 'p2'): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) throw Object.assign(new Error('membership'), { code: 'membership' });
    const priv = room.memberPrivate.get(participantId);
    if (!priv) throw Object.assign(new Error('membership'), { code: 'membership' });
    priv.control = 'surrendered';
    this.notify(room);
  }

  async preDraftRemoval(roomId: string, targetParticipantId: 'p1' | 'p2'): Promise<SeasonRoomCode> {
    const room = this.rooms.get(roomId);
    if (!room) throw Object.assign(new Error('membership'), { code: 'membership' });
    if (room.phase !== 'waiting') throw Object.assign(new Error('phase'), { code: 'phase' });
    room.members.delete(targetParticipantId);
    room.memberPrivate.delete(targetParticipantId);
    const newCode = randomCode(this.counter++);
    room.code = newCode;
    room.codeExpiresAt = this.clock() + this.codeExpiryMs;
    this.codeToRoom.set(newCode, roomId);
    this.notify(room);
    return newCode as SeasonRoomCode;
  }

  async close(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room) return;
    if (room.code) this.codeToRoom.delete(room.code);
    this.rooms.delete(roomId);
  }

  // test helpers
  getRoom(roomId: string): InMemoryRoom | undefined {
    return this.rooms.get(roomId);
  }

  getCode(roomId: string): string | null {
    return this.rooms.get(roomId)?.code ?? null;
  }
}
