import {
  FIXED_FIVE_CODE_TTL_MS,
  FIXED_FIVE_DUEL_BROADCAST_MS,
  FIXED_FIVE_ENVELOPE_MAX_BYTES,
  FIXED_FIVE_MULTIPLAYER_VERSION,
  FIXED_FIVE_ROOM_SCHEMA_VERSION,
  fixedFiveCommandPayloadSchema,
  fixedFiveCommandSchema,
  fixedFiveTimeoutMsForMode,
  fixedFiveVerificationReceiptSchema,
  type FixedFiveCommand,
  type FixedFiveCommandPayload,
  type FixedFiveCommandReceipt,
  type FixedFiveMultiplayerTransport,
  type FixedFiveParticipantId,
  type FixedFiveRoomCode,
  type FixedFiveRoomMembership,
  type FixedFiveRoomSettings,
  type FixedFiveRoomSnapshot,
  type FixedFiveVerificationReceipt,
  canonicalJson,
  commandIdSchema,
  contentHashSchema,
  idSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { createSeededRng } from '../runtime/seeded-rng.ts';

function nowIsoWith(clock: () => number): string {
  return new Date(clock()).toISOString();
}
function isSandboxSnakeRoom(settings: FixedFiveRoomSettings): boolean {
  return (
    settings.mode === 'sandbox-shared-82' ||
    (settings.mode === 'duel' && settings.sourceMode === 'sandbox')
  );
}
const FIXED_FIVE_SNAKE_ROOM_VERSIONS: ReadonlySet<string> = new Set([
  'fixed-five-multiplayer-v3',
  'fixed-five-multiplayer-v4',
  FIXED_FIVE_MULTIPLAYER_VERSION,
]);
const FIXED_FIVE_REPOSITION_VERSIONS: ReadonlySet<string> = new Set([
  'fixed-five-multiplayer-v4',
  FIXED_FIVE_MULTIPLAYER_VERSION,
]);
const FIXED_FIVE_DUEL_BROADCAST_VERSIONS: ReadonlySet<string> = new Set([
  FIXED_FIVE_MULTIPLAYER_VERSION,
]);
function isRepositionAwareRoom(settings: FixedFiveRoomSettings): boolean {
  return FIXED_FIVE_REPOSITION_VERSIONS.has(settings.versions.multiplayerVersion);
}
function isDuelBroadcastRoom(settings: FixedFiveRoomSettings): boolean {
  return (
    settings.mode === 'duel' &&
    FIXED_FIVE_DUEL_BROADCAST_VERSIONS.has(settings.versions.multiplayerVersion)
  );
}
function isShared82BroadcastRoom(settings: FixedFiveRoomSettings): boolean {
  return (
    settings.mode !== 'duel' &&
    FIXED_FIVE_DUEL_BROADCAST_VERSIONS.has(settings.versions.multiplayerVersion)
  );
}
function shared82DraftReady(record: RoomRecord): boolean {
  if (record.snapshot.phase === 'simulating') return true;
  if (record.snapshot.settings.mode === 'classic-shared-82') {
    return (
      record.commands.filter((command) =>
        ['classic-pick', 'timeout-autopick'].includes(command.payload.kind),
      ).length >= 10
    );
  }
  const locked = new Set(
    record.commands
      .filter((command) => command.payload.kind === 'sandbox-lock')
      .map((command) => command.actorParticipantId),
  );
  return locked.size === 2;
}
function duelHomeForGame(gameNumber: number): FixedFiveParticipantId {
  return gameNumber % 2 === 1 ? 'p1' : 'p2';
}
function otherParticipantId(participantId: FixedFiveParticipantId): FixedFiveParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}
function sandboxPicker(rootSeed: string, pickOrdinal: number): FixedFiveParticipantId {
  const first = Number.parseInt(rootSeed.slice(0, 2), 16) % 2 === 0 ? 'p1' : 'p2';
  const other = first === 'p1' ? 'p2' : 'p1';
  const roundFirst = Math.floor(pickOrdinal / 2) % 2 === 0 ? first : other;
  return pickOrdinal % 2 === 0 ? roundFirst : roundFirst === 'p1' ? 'p2' : 'p1';
}
function sandboxPickerForSnapshot(
  snapshot: FixedFiveRoomSnapshot,
  pickOrdinal: number,
): FixedFiveParticipantId {
  if (!snapshot.rootSeed) throw new Error('sandbox snake room is missing a root seed');
  return sandboxPicker(snapshot.rootSeed, pickOrdinal);
}
function randomSeedWith(
  rng: () => number,
  randomBytes: ((length: number) => Uint8Array) | undefined,
): string {
  if (randomBytes) {
    const bytes = new Uint8Array(16);
    bytes.set(randomBytes(bytes.length));
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(rng() * 256);
  }
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomCodeWith(existing: Set<string>, rng: () => number): FixedFiveRoomCode {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const n = Math.floor(rng() * 10000);
    const code = String(n).padStart(4, '0');
    if (!existing.has(code)) return code;
  }
  throw new Error('in-memory fixed-five: code space exhausted');
}
function randomRoomIdWith(
  rng: () => number,
  randomBytes: ((length: number) => Uint8Array) | undefined,
): string {
  if (randomBytes) {
    const bytes = new Uint8Array(12);
    bytes.set(randomBytes(bytes.length));
    return `ff-${[...bytes]
      .map((b) => b.toString(36))
      .join('')
      .slice(0, 12)}`
      .toLowerCase()
      .replace(/[^a-z0-9._:-]/g, 'a');
  }
  const bytes = new Uint8Array(12);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(rng() * 256);
  }
  return `ff-${[...bytes]
    .map((b) => b.toString(36))
    .join('')
    .slice(0, 12)}`
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, 'a');
}
function randomChallengeWith(
  rng: () => number,
  randomBytes: ((length: number) => Uint8Array) | undefined,
): string {
  const bytes = new Uint8Array(24);
  if (randomBytes) {
    bytes.set(randomBytes(bytes.length));
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(rng() * 256);
    }
  }
  return `ff-challenge-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
interface FallbackCommitment {
  cursor: string;
  participantId: FixedFiveParticipantId;
  pickOrdinal: number;
  payload: FixedFiveCommandPayload;
}
interface DuelGameProposal {
  gameNumber: number;
  resultDigest: string;
  tapeDigest: string;
  inputDigest: string;
  winner: FixedFiveParticipantId;
}
interface DuelGameConfirmation {
  gameNumber: number;
  resultDigest: string;
  verified: boolean;
}
interface DuelGameState {
  proposals: Partial<Record<FixedFiveParticipantId, DuelGameProposal>>;
  confirmations: Partial<Record<FixedFiveParticipantId, DuelGameConfirmation>>;
}
interface RoomRecord {
  snapshot: FixedFiveRoomSnapshot;
  commands: FixedFiveCommand[];
  commandIds: Set<string>;
  code: FixedFiveRoomCode;
  codeExpiresAt: number;
  updatedAt: number;
  subscribers: Set<(snapshot: FixedFiveRoomSnapshot) => void>;
  verificationChallenge: string | null;
  receipts: Map<string, FixedFiveVerificationReceipt>;
  fallback: FallbackCommitment | null;
  gameState: DuelGameState;
}
function emptyDuelGameState(): DuelGameState {
  return { proposals: {}, confirmations: {} };
}
export function createInMemoryFixedFiveTransport(options: {
  clock: () => number;
  random: { seed: string } | { rng: () => number } | { bytes: (length: number) => Uint8Array };
}): FixedFiveMultiplayerTransport {
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
  function touchDeadline(record: RoomRecord, payload: FixedFiveCommandPayload): void {
    const { snapshot } = record;
    const sandboxSnake = isSandboxSnakeRoom(snapshot.settings);
    const current = snapshot.deadline;
    if (payload.kind === 'start') {
      const participant = sandboxSnake ? sandboxPickerForSnapshot(snapshot, 0) : 'p1';
      record.snapshot = {
        ...snapshot,
        phase: 'drafting',
        deadline: {
          roomId: snapshot.roomId,
          cursor: 't0',
          participantId: participant,
          deadlineAt: new Date(
            clock() + fixedFiveTimeoutMsForMode(snapshot.settings.mode),
          ).toISOString(),
          fallback: null,
          pickOrdinal: 0,
        },
      };
      return;
    }
    if (
      current &&
      (payload.kind === 'timeout-autopick' || (sandboxSnake && payload.kind === 'sandbox-place'))
    ) {
      const nextOrdinal = current.pickOrdinal + 1;
      record.snapshot = {
        ...snapshot,
        deadline:
          nextOrdinal >= 10
            ? null
            : {
                roomId: snapshot.roomId,
                cursor: `t${String(nextOrdinal)}`,
                participantId: sandboxSnake
                  ? sandboxPickerForSnapshot(snapshot, nextOrdinal)
                  : current.participantId === 'p1'
                    ? 'p2'
                    : 'p1',
                deadlineAt: new Date(
                  clock() + fixedFiveTimeoutMsForMode(snapshot.settings.mode),
                ).toISOString(),
                fallback: null,
                pickOrdinal: nextOrdinal,
              },
      };
      return;
    }
  }
  function isDuelPickPayload(payload: FixedFiveCommandPayload): boolean {
    return (
      payload.kind === 'duel-claim' ||
      payload.kind === 'classic-pick' ||
      payload.kind === 'sandbox-place' ||
      payload.kind === 'timeout-autopick'
    );
  }
  function duelDraftPickCount(commands: FixedFiveCommand[]): number {
    return commands.filter((command) => isDuelPickPayload(command.payload)).length;
  }
  function initializeDuelSeries(record: RoomRecord): void {
    record.snapshot = {
      ...record.snapshot,
      phase: 'preparing-game',
      series: { games: [], p1Wins: 0, p2Wins: 0, currentGameNumber: 1, champion: null },
      broadcast: null,
      deadline: null,
      members: record.snapshot.members.map((member) => ({ ...member, nextGameReady: null })),
    };
    record.gameState = emptyDuelGameState();
  }
  function duelBroadcastRejection(record: RoomRecord, command: FixedFiveCommand): string | null {
    const payload = command.payload;
    const broadcastKind =
      payload.kind === 'ready-next-game' ||
      payload.kind === 'broadcast-start' ||
      payload.kind === 'propose-game-result' ||
      payload.kind === 'confirm-game-result';
    if (!broadcastKind) return null;
    if (isShared82BroadcastRoom(record.snapshot.settings)) {
      if (payload.kind === 'ready-next-game') return 'illegal-move';
      const progress = record.snapshot.seasonBroadcast;
      if (payload.kind === 'broadcast-start') {
        if (record.snapshot.broadcast?.gameNumber === payload.gameNumber) return null;
        if (!shared82DraftReady(record)) return 'phase';
        const eligible = payload.eligibleGameNumbers;
        if (!eligible) return 'illegal-move';
        for (let index = 1; index < eligible.length; index += 1) {
          const previous = eligible[index - 1];
          const current = eligible[index];
          if (previous === undefined || current === undefined || previous >= current) {
            return 'illegal-move';
          }
        }
        if (eligible.length === 0) {
          return 'illegal-move';
        }
        if (
          progress &&
          (progress.eligibleGameNumbers.length !== eligible.length ||
            progress.eligibleGameNumbers.some((number, index) => number !== eligible[index]))
        ) {
          return 'illegal-move';
        }
        const lastCompleted = progress?.lastCompletedGameNumber ?? null;
        const next = eligible.find((number) => lastCompleted === null || number > lastCompleted);
        if (next !== payload.gameNumber) return 'turn';
        return null;
      }
      if (
        (record.snapshot.phase !== 'broadcasting' && record.snapshot.phase !== 'game-results') ||
        record.snapshot.broadcast?.gameNumber !== payload.gameNumber ||
        progress === null
      ) {
        return 'phase';
      }
      if (payload.kind === 'propose-game-result') return null;
      const matching = Object.values(record.gameState.proposals).some(
        (proposal) =>
          proposal.gameNumber === payload.gameNumber &&
          proposal.resultDigest === payload.resultDigest,
      );
      return matching ? null : 'illegal-move';
    }
    if (!isDuelBroadcastRoom(record.snapshot.settings)) return 'illegal-move';
    const series = record.snapshot.series;
    if (!series) return 'phase';
    if (payload.kind === 'ready-next-game') {
      if (record.snapshot.phase !== 'preparing-game') return 'phase';
      if (payload.gameNumber !== series.currentGameNumber) return 'turn';
      return null;
    }
    if (payload.kind === 'broadcast-start') {
      if (
        record.snapshot.broadcast?.gameNumber === payload.gameNumber &&
        (record.snapshot.phase === 'broadcasting' || record.snapshot.phase === 'game-results')
      ) {
        return null;
      }
      if (record.snapshot.phase !== 'preparing-game') return 'phase';
      if (payload.gameNumber !== series.currentGameNumber) return 'turn';
      const readyCount = record.snapshot.members.filter(
        (member) => member.nextGameReady === payload.gameNumber,
      ).length;
      if (readyCount < 2) {
        if (payload.auto !== true || clock() - record.updatedAt < 60_000) return 'not-ready';
      }
      return null;
    }
    if (payload.kind === 'propose-game-result') {
      if (record.snapshot.phase !== 'broadcasting' && record.snapshot.phase !== 'game-results') {
        return 'phase';
      }
      if (payload.gameNumber !== series.currentGameNumber) return 'turn';
      const home = duelHomeForGame(payload.gameNumber);
      if (payload.winner !== home && payload.winner !== otherParticipantId(home)) {
        return 'illegal-move';
      }
      return null;
    }
    if (record.snapshot.phase !== 'broadcasting' && record.snapshot.phase !== 'game-results') {
      return 'phase';
    }
    if (payload.gameNumber !== series.currentGameNumber) return 'turn';
    const matching = Object.values(record.gameState.proposals).some(
      (proposal) =>
        proposal.gameNumber === payload.gameNumber &&
        proposal.resultDigest === payload.resultDigest,
    );
    if (!matching) return 'illegal-move';
    return null;
  }
  function applyDuelBroadcastCommand(record: RoomRecord, command: FixedFiveCommand): void {
    if (!isDuelBroadcastRoom(record.snapshot.settings)) return;
    const payload = command.payload;
    if (payload.kind === 'ready-next-game') {
      record.snapshot = {
        ...record.snapshot,
        members: record.snapshot.members.map((member) =>
          member.participantId === command.actorParticipantId
            ? { ...member, nextGameReady: payload.ready ? payload.gameNumber : null }
            : member,
        ),
      };
      return;
    }
    if (payload.kind === 'broadcast-start') {
      if (record.snapshot.broadcast?.gameNumber === payload.gameNumber) return;
      const gameNumber = payload.gameNumber;
      let members = record.snapshot.members;
      const readyCount = members.filter((member) => member.nextGameReady === gameNumber).length;
      if (readyCount < 2) {
        members = members.map((member) => ({ ...member, nextGameReady: gameNumber }));
      }
      record.snapshot = {
        ...record.snapshot,
        phase: 'broadcasting',
        broadcast: {
          gameNumber,
          startedAtIso: nowIsoWith(clock),
          durationMs: FIXED_FIVE_DUEL_BROADCAST_MS,
        },
        members: members.map((member) => ({ ...member, nextGameReady: null })),
      };
      return;
    }
    if (payload.kind === 'propose-game-result') {
      record.gameState.proposals[command.actorParticipantId] = {
        gameNumber: payload.gameNumber,
        resultDigest: payload.resultDigest,
        tapeDigest: payload.tapeDigest,
        inputDigest: payload.inputDigest,
        winner: payload.winner,
      };
      record.snapshot = { ...record.snapshot, phase: 'game-results' };
      return;
    }
    if (payload.kind === 'confirm-game-result') {
      record.gameState.confirmations[command.actorParticipantId] = {
        gameNumber: payload.gameNumber,
        resultDigest: payload.resultDigest,
        verified: payload.verified,
      };
      const p1 = record.gameState.confirmations.p1;
      const p2 = record.gameState.confirmations.p2;
      if (
        !p1 ||
        !p2 ||
        p1.gameNumber !== p2.gameNumber ||
        p1.resultDigest !== p2.resultDigest ||
        !p1.verified ||
        !p2.verified
      ) {
        return;
      }
      const gameNumber = p1.gameNumber;
      const winner = Object.values(record.gameState.proposals).find(
        (proposal) =>
          proposal.gameNumber === gameNumber && proposal.resultDigest === p1.resultDigest,
      )?.winner;
      const series = record.snapshot.series;
      if (!winner || !series) return;
      const home = duelHomeForGame(gameNumber);
      const away = otherParticipantId(home);
      const p1Wins = series.p1Wins + (winner === 'p1' ? 1 : 0);
      const p2Wins = series.p2Wins + (winner === 'p2' ? 1 : 0);
      const champion = p1Wins >= 4 ? 'p1' : p2Wins >= 4 ? 'p2' : null;
      record.snapshot = {
        ...record.snapshot,
        phase: champion ? 'awaiting-confirmation' : 'preparing-game',
        series: {
          games: [
            ...series.games,
            { gameNumber, homeParticipantId: home, awayParticipantId: away, winner },
          ],
          p1Wins,
          p2Wins,
          currentGameNumber: champion ? null : gameNumber + 1,
          champion,
        },
        broadcast: null,
        members: record.snapshot.members.map((member) => ({ ...member, nextGameReady: null })),
      };
      record.gameState = emptyDuelGameState();
    }
  }
  function applyShared82BroadcastCommand(record: RoomRecord, command: FixedFiveCommand): void {
    if (!isShared82BroadcastRoom(record.snapshot.settings)) return;
    const payload = command.payload;
    if (payload.kind === 'broadcast-start') {
      if (record.snapshot.broadcast?.gameNumber === payload.gameNumber) return;
      const eligibleGameNumbers =
        record.snapshot.seasonBroadcast?.eligibleGameNumbers ?? payload.eligibleGameNumbers ?? [];
      record.snapshot = {
        ...record.snapshot,
        phase: 'broadcasting',
        broadcast: {
          gameNumber: payload.gameNumber,
          startedAtIso: nowIsoWith(clock),
          durationMs: FIXED_FIVE_DUEL_BROADCAST_MS,
        },
        seasonBroadcast: {
          eligibleGameNumbers,
          lastCompletedGameNumber: record.snapshot.seasonBroadcast?.lastCompletedGameNumber ?? null,
        },
      };
      return;
    }
    if (payload.kind === 'propose-game-result') {
      record.gameState.proposals[command.actorParticipantId] = {
        gameNumber: payload.gameNumber,
        resultDigest: payload.resultDigest,
        tapeDigest: payload.tapeDigest,
        inputDigest: payload.inputDigest,
        winner: payload.winner,
      };
      record.snapshot = { ...record.snapshot, phase: 'game-results' };
      return;
    }
    if (payload.kind !== 'confirm-game-result') return;
    record.gameState.confirmations[command.actorParticipantId] = {
      gameNumber: payload.gameNumber,
      resultDigest: payload.resultDigest,
      verified: payload.verified,
    };
    const p1 = record.gameState.confirmations.p1;
    const p2 = record.gameState.confirmations.p2;
    if (
      !p1 ||
      !p2 ||
      p1.gameNumber !== p2.gameNumber ||
      p1.resultDigest !== p2.resultDigest ||
      !p1.verified ||
      !p2.verified
    ) {
      return;
    }
    const seasonBroadcast = record.snapshot.seasonBroadcast;
    if (!seasonBroadcast) return;
    record.snapshot = {
      ...record.snapshot,
      phase: 'simulating',
      broadcast: null,
      seasonBroadcast: {
        ...seasonBroadcast,
        lastCompletedGameNumber: p1.gameNumber,
      },
    };
    record.gameState = emptyDuelGameState();
  }
  return {
    async create(settingsInput) {
      await Promise.resolve();
      pruneExpiredCodes();
      const now = clock();
      const recent = createTimestamps.filter((t) => now - t < 60000);
      if (recent.length >= 60) {
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
      const roomId = idSchema.parse(randomRoomIdWith(rng, randomBytes));
      const codes = new Set(codeIndex.keys());
      const code = randomCodeWith(codes, rng);
      const rootSeed = seedSchema.parse(randomSeedWith(rng, randomBytes));
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
            nextGameReady: null,
            lastSeenAt: createdAt,
          },
          {
            participantId: 'p2',
            online: false,
            ready: false,
            picksCommitted: 0,
            locked: false,
            nextGameReady: null,
            lastSeenAt: null,
          },
        ],
        rootSeed,
        deadline: {
          roomId,
          cursor: 'lobby',
          participantId: 'p1',
          deadlineAt,
          fallback: { kind: 'ready', ready: true },
          pickOrdinal: 0,
        },
        series: null,
        broadcast: null,
        seasonBroadcast: null,
        resultDigest: null,
        confirmedDigest: null,
        successorRoomId: null,
        expiresAt,
        createdAt,
      };
      const record: RoomRecord = {
        snapshot,
        commands: [],
        commandIds: new Set(),
        code,
        codeExpiresAt: now + FIXED_FIVE_CODE_TTL_MS,
        updatedAt: now,
        subscribers: new Set(),
        verificationChallenge: null,
        receipts: new Map(),
        fallback: null,
        gameState: emptyDuelGameState(),
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
        m.participantId === 'p2' ? { ...m, online: true, lastSeenAt: nowIsoWith(clock) } : m,
      );
      void p2;
      record.snapshot = {
        ...record.snapshot,
        members: updated,
        revision: record.snapshot.revision + 1,
      };
      record.updatedAt = clock();
      emit(record);
      return {
        snapshot: record.snapshot,
        membership: { roomId: record.snapshot.roomId, participantId: 'p2', code: record.code },
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
        membership: { roomId: record.snapshot.roomId, participantId: 'p1', code: record.code },
      };
    },
    async snapshot(roomId) {
      await Promise.resolve();
      const record = rooms.get(roomId);
      if (!record)
        throw Object.assign(new Error('authorization'), {
          code: 'authorization',
          retryable: false,
        });
      return record.snapshot;
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
      if (
        command.expectedRevision !== undefined &&
        command.expectedRevision !== record.snapshot.revision
      ) {
        return {
          roomId: command.roomId,
          commandId: command.commandId,
          ordinal: -1,
          accepted: false,
          rejectionCode: 'stale-revision',
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
      const sandboxSnake =
        isSandboxSnakeRoom(record.snapshot.settings) &&
        FIXED_FIVE_SNAKE_ROOM_VERSIONS.has(record.snapshot.settings.versions.multiplayerVersion);
      const repositionAware = isRepositionAwareRoom(record.snapshot.settings);
      if (
        parsed.data.payload.kind === 'duel-reposition' &&
        (record.snapshot.settings.mode !== 'duel' || !repositionAware)
      ) {
        return {
          roomId: command.roomId,
          commandId: command.commandId,
          ordinal: -1,
          accepted: false,
          rejectionCode: 'illegal-move',
          revision: record.snapshot.revision,
        };
      }
      if (parsed.data.payload.kind === 'sandbox-reposition' && sandboxSnake && !repositionAware) {
        return {
          roomId: command.roomId,
          commandId: command.commandId,
          ordinal: -1,
          accepted: false,
          rejectionCode: 'illegal-move',
          revision: record.snapshot.revision,
        };
      }
      const pickedPayload =
        parsed.data.payload.kind === 'sandbox-place' ||
        parsed.data.payload.kind === 'timeout-autopick'
          ? parsed.data.payload
          : null;
      if (sandboxSnake && pickedPayload) {
        const priorPicks = record.commands.filter(
          (entry) =>
            entry.payload.kind === 'sandbox-place' || entry.payload.kind === 'timeout-autopick',
        );
        if (
          priorPicks.some((entry) => {
            if (
              entry.payload.kind !== 'sandbox-place' &&
              entry.payload.kind !== 'timeout-autopick'
            ) {
              return false;
            }
            if (entry.payload.playerId === pickedPayload.playerId) return true;
            return (
              !repositionAware &&
              entry.actorParticipantId === parsed.data.actorParticipantId &&
              entry.payload.slotIndex === pickedPayload.slotIndex
            );
          })
        ) {
          return {
            roomId: command.roomId,
            commandId: command.commandId,
            ordinal: -1,
            accepted: false,
            rejectionCode: 'illegal-move',
            revision: record.snapshot.revision,
          };
        }
      }
      if (
        sandboxSnake &&
        pickedPayload?.kind === 'sandbox-place' &&
        record.snapshot.deadline &&
        record.snapshot.deadline.participantId !== parsed.data.actorParticipantId
      ) {
        return {
          roomId: command.roomId,
          commandId: command.commandId,
          ordinal: -1,
          accepted: false,
          rejectionCode: 'turn',
          revision: record.snapshot.revision,
        };
      }
      const broadcastRejection = duelBroadcastRejection(record, parsed.data);
      if (broadcastRejection !== null) {
        return {
          roomId: command.roomId,
          commandId: command.commandId,
          ordinal: -1,
          accepted: false,
          rejectionCode: broadcastRejection,
          revision: record.snapshot.revision,
        };
      }
      record.commands.push(parsed.data);
      record.commandIds.add(command.commandId);
      record.snapshot = {
        ...record.snapshot,
        commandCount: record.commands.length,
        revision: record.snapshot.revision + 1,
        digest: null,
      };
      touchDeadline(record, parsed.data.payload);
      record.updatedAt = clock();
      if (
        isDuelBroadcastRoom(record.snapshot.settings) &&
        record.snapshot.series === null &&
        duelDraftPickCount(record.commands) >= 10
      ) {
        initializeDuelSeries(record);
      }
      applyDuelBroadcastCommand(record, parsed.data);
      applyShared82BroadcastCommand(record, parsed.data);
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
    async verificationChallenge(roomId) {
      await Promise.resolve();
      const record = rooms.get(roomId);
      if (!record)
        throw Object.assign(new Error('authorization'), {
          code: 'authorization',
          retryable: false,
        });
      record.verificationChallenge ??= randomChallengeWith(rng, randomBytes);
      return record.verificationChallenge;
    },
    async submitVerification(roomId, receipt, expectedRevision) {
      await Promise.resolve();
      const record = rooms.get(roomId);
      if (!record)
        throw Object.assign(new Error('authorization'), {
          code: 'authorization',
          retryable: false,
        });
      const parsed = fixedFiveVerificationReceiptSchema.safeParse(receipt);
      if (!parsed.success) {
        throw Object.assign(new Error('verification: invalid receipt'), {
          rejectionCode: 'invalid-receipt',
          revision: record.snapshot.revision,
        });
      }
      if (parsed.data.roomId !== record.snapshot.roomId) {
        throw Object.assign(new Error('verification: receipt does not belong to the room'), {
          rejectionCode: 'invalid-receipt',
          revision: record.snapshot.revision,
        });
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
      return { receiptId: parsed.data.receiptDigest, revision: record.snapshot.revision };
    },
    async commitFallback(roomId, cursor, payload, expectedRevision) {
      await Promise.resolve();
      const record = rooms.get(roomId);
      if (!record)
        throw Object.assign(new Error('authorization'), {
          code: 'authorization',
          retryable: false,
        });
      const deadline = record.snapshot.deadline;
      if (!deadline || deadline.cursor !== cursor) {
        return { stored: false, revision: record.snapshot.revision };
      }
      if (expectedRevision !== undefined && expectedRevision !== record.snapshot.revision) {
        throw Object.assign(new Error('stale-revision'), {
          code: 'stale-revision',
          retryable: true,
        });
      }
      const parsed = fixedFiveCommandPayloadSchema.safeParse(payload);
      if (
        !parsed.success ||
        parsed.data.kind !== 'timeout-autopick' ||
        parsed.data.pickOrdinal !== deadline.pickOrdinal
      ) {
        throw Object.assign(
          new Error('commit-fallback: payload must match the deadline autopick'),
          {
            code: 'illegal-move',
            retryable: false,
          },
        );
      }
      record.fallback = {
        cursor,
        participantId: deadline.participantId,
        pickOrdinal: deadline.pickOrdinal,
        payload: parsed.data,
      };
      return { stored: true, revision: record.snapshot.revision };
    },
    async resolveTimeout(roomId) {
      const record = rooms.get(roomId);
      if (!record) return null;
      const deadline = record.snapshot.deadline;
      if (!deadline) return null;
      if (clock() < Date.parse(deadline.deadlineAt)) return null;
      const commitment = record.fallback;
      if (!commitment || commitment.cursor !== deadline.cursor) return null;
      const commandId = `timeout-${deadline.cursor}-${String(commitment.pickOrdinal)}`;
      if (record.commandIds.has(commandId)) return null;
      const receipt = await this.submitCommand({
        schemaVersion: 1,
        roomId: record.snapshot.roomId,
        commandId: commandIdSchema.parse(commandId),
        actorParticipantId: commitment.participantId,
        payload: commitment.payload,
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
      const nextCode = randomCodeWith(codes, rng);
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
      record.updatedAt = clock();
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
    async complete(roomId, receiptId) {
      await Promise.resolve();
      const record = rooms.get(roomId);
      if (!record)
        throw Object.assign(new Error('authorization'), {
          code: 'authorization',
          retryable: false,
        });
      if (record.snapshot.phase === 'completed')
        return { completed: true, phase: record.snapshot.phase };
      if (record.snapshot.phase === 'integrity-failed' || record.snapshot.phase === 'expired')
        return { completed: false, phase: record.snapshot.phase };
      const receipt = record.receipts.get(receiptId);
      if (!receipt) return { completed: false, phase: record.snapshot.phase };
      const confirmedSeats = new Set(
        record.commands
          .filter(
            (c) =>
              c.payload.kind === 'confirm-result' &&
              c.payload.verified &&
              c.payload.resultDigest === receipt.resultDigest,
          )
          .map((c) => c.actorParticipantId),
      );
      if (confirmedSeats.size < 2) return { completed: false, phase: record.snapshot.phase };
      const digest = contentHashSchema.parse(receipt.resultDigest);
      record.snapshot = {
        ...record.snapshot,
        phase: 'completed',
        resultDigest: digest,
        confirmedDigest: digest,
        code: null,
        codeActive: false,
        revision: record.snapshot.revision + 1,
      };
      emit(record);
      return { completed: true, phase: record.snapshot.phase };
    },
    async fail(roomId) {
      await Promise.resolve();
      const record = rooms.get(roomId);
      if (!record)
        throw Object.assign(new Error('authorization'), {
          code: 'authorization',
          retryable: false,
        });
      if (record.snapshot.phase === 'integrity-failed')
        return { failed: true, phase: record.snapshot.phase };
      if (record.snapshot.phase === 'completed' || record.snapshot.phase === 'expired')
        return { failed: false, phase: record.snapshot.phase };
      const digests = new Set(
        record.commands
          .filter((c) => c.payload.kind === 'propose-result')
          .map((c) => (c.payload.kind === 'propose-result' ? c.payload.resultDigest : '')),
      );
      const denied = record.commands.some(
        (c) => c.payload.kind === 'confirm-result' && !c.payload.verified,
      );
      const gameDigests = new Set(
        record.commands
          .filter((c) => c.payload.kind === 'propose-game-result')
          .map((c) => (c.payload.kind === 'propose-game-result' ? c.payload.resultDigest : '')),
      );
      const gameDenied = record.commands.some(
        (c) => c.payload.kind === 'confirm-game-result' && !c.payload.verified,
      );
      if ((digests.size < 2 || !denied) && (gameDigests.size < 2 || !gameDenied)) {
        return { failed: false, phase: record.snapshot.phase };
      }
      record.snapshot = {
        ...record.snapshot,
        phase: 'integrity-failed',
        code: null,
        codeActive: false,
        revision: record.snapshot.revision + 1,
      };
      emit(record);
      return { failed: true, phase: record.snapshot.phase };
    },
  };
}
