import {
  DRAFT_DUEL_AUTOPICK_VERSION,
  DRAFT_DUEL_BROADCAST_MS,
  DRAFT_DUEL_CODE_TTL_MS,
  DRAFT_DUEL_ENVELOPE_MAX_BYTES,
  DRAFT_DUEL_MULTIPLAYER_VERSION,
  DRAFT_DUEL_PICK_TIMEOUT_MS,
  DRAFT_DUEL_ROOM_RETENTION_MS,
  DRAFT_DUEL_ROOM_SCHEMA_VERSION,
  draftDuelCommandPayloadSchema,
  draftDuelRoomCodeSchema,
  draftDuelRoomSettingsSchema,
  draftDuelTransientEventSchema,
  draftDuelVerificationReceiptSchema,
  type DraftDuelCommand,
  type DraftDuelCommandPayload,
  type DraftDuelCommandReceipt,
  type DraftDuelMemberSnapshot,
  type DraftDuelMultiplayerTransport,
  type DraftDuelParticipantId,
  type DraftDuelRoomCode,
  type DraftDuelRoomMembership,
  type DraftDuelRoomSettings,
  type DraftDuelRoomSnapshot,
  type DraftDuelSeriesSnapshot,
  type DraftDuelTransientEvent,
  type DraftDuelVerificationReceipt,
} from './draft-duel.ts';
import { commandIdSchema, contentHashSchema, idSchema, seedSchema, type Id } from './ids.ts';
import { canonicalJson, fnv1a32 } from './season-hash.ts';

function mulberry32Seed(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function draftDuelFirstPickerFor(rootSeed: string): DraftDuelParticipantId {
  return seedByteParity(rootSeed, 0) ? 'p1' : 'p2';
}

export function draftDuelHomeWinnerFor(rootSeed: string): DraftDuelParticipantId {
  return seedByteParity(rootSeed, 2) ? 'p1' : 'p2';
}

function seedByteParity(rootSeed: string, offset: number): boolean {
  return Number.parseInt(rootSeed.slice(offset, offset + 2), 16) % 2 === 0;
}

function otherParticipant(participantId: DraftDuelParticipantId): DraftDuelParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}

function pickerFor(
  firstPicker: DraftDuelParticipantId,
  pickOrdinal: number,
): DraftDuelParticipantId {
  return pickOrdinal % 2 === 0 ? firstPicker : otherParticipant(firstPicker);
}

const DRAFT_DUEL_HOME_GAMES: ReadonlySet<number> = new Set([1, 2, 5, 7]);

export function draftDuelHomeForGameFor(
  homeWinner: DraftDuelParticipantId,
  gameNumber: number,
): DraftDuelParticipantId {
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > 7) {
    throw new Error(`draft duel gameNumber must be an integer in 1..7 (got ${String(gameNumber)})`);
  }
  return DRAFT_DUEL_HOME_GAMES.has(gameNumber) ? homeWinner : otherParticipant(homeWinner);
}

function cryptoRng(): number {
  const word = new Uint32Array(1);
  crypto.getRandomValues(word);
  return (word[0] as number) / 4294967296;
}

function nowIsoWith(clock: () => number): string {
  return new Date(clock()).toISOString();
}

function randomSeedWith(rng: () => number, useCrypto: boolean): string {
  const bytes = new Uint8Array(16);
  if (useCrypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(rng() * 256);
    }
  }
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomCodeWith(existing: Set<string>, rng: () => number): DraftDuelRoomCode {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const n = Math.floor(rng() * 10000);
    const code = String(n).padStart(4, '0');
    if (!existing.has(code)) return draftDuelRoomCodeSchema.parse(code);
  }
  throw new Error('in-memory draft-duel: code space exhausted');
}

function randomRoomIdWith(rng: () => number, useCrypto: boolean): Id {
  const bytes = new Uint8Array(12);
  if (useCrypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(rng() * 256);
    }
  }
  return idSchema.parse(
    `dd-${[...bytes]
      .map((b) => b.toString(36))
      .join('')
      .slice(0, 12)
      .toLowerCase()
      .replace(/[^a-z0-9._:-]/g, 'a')}`,
  );
}

function randomChallengeWith(rng: () => number, useCrypto: boolean): string {
  const bytes = new Uint8Array(24);
  if (useCrypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(rng() * 256);
    }
  }
  return `dd-challenge-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function idleMember(participantId: DraftDuelParticipantId): DraftDuelMemberSnapshot {
  return {
    participantId,
    online: false,
    ready: false,
    nextGameReady: null,
    locked: false,
    lastSeenAt: null,
  };
}

function memberWith(
  snapshot: DraftDuelRoomSnapshot,
  participantId: DraftDuelParticipantId,
  patch: Partial<DraftDuelMemberSnapshot>,
): DraftDuelRoomSnapshot {
  return {
    ...snapshot,
    members: snapshot.members.map((member) =>
      member.participantId === participantId ? { ...member, ...patch } : member,
    ),
  };
}

interface FallbackCommitment {
  cursor: string;
  participantId: DraftDuelParticipantId;
  pickOrdinal: number;
  payload: DraftDuelCommandPayload;
}

interface DraftState {
  pickOrdinal: number;
  firstPicker: DraftDuelParticipantId;
  claimedPlayers: string[];
}

interface GameProposal {
  gameNumber: number;
  resultDigest: string;
  tapeDigest: string;
  inputDigest: string;
  winner: DraftDuelParticipantId;
}

interface GameConfirmation {
  gameNumber: number;
  resultDigest: string;
  verified: boolean;
}

interface RoomRecord {
  snapshot: DraftDuelRoomSnapshot;
  commands: DraftDuelCommand[];
  commandIds: Set<string>;
  payloadHashes: Map<string, string>;
  code: DraftDuelRoomCode;
  codeExpiresAt: number;
  updatedAt: number;
  subscribers: Set<(snapshot: DraftDuelRoomSnapshot) => void>;
  transientSubscribers: Set<(event: DraftDuelTransientEvent) => void>;
  verificationChallenge: string | null;
  receipts: Map<string, DraftDuelVerificationReceipt>;
  fallback: FallbackCommitment | null;
  draftState: DraftState | null;
  proposals: Partial<Record<DraftDuelParticipantId, GameProposal>>;
  confirmations: Partial<Record<DraftDuelParticipantId, GameConfirmation>>;
  rematchRequests: Set<DraftDuelParticipantId>;
}

export interface InMemoryDraftDuelTransport extends DraftDuelMultiplayerTransport {
  publishTransient(roomId: string, event: DraftDuelTransientEvent): Promise<boolean>;
}

export function createInMemoryDraftDuelTransport(options?: {
  clock?: () => number;
  seed?: string;
  rng?: () => number;
}): InMemoryDraftDuelTransport {
  const clock = options?.clock ?? Date.now;
  const seededRng = options?.seed !== undefined ? mulberry32Seed(fnv1a32(options.seed)) : null;
  const rng = options?.rng ?? seededRng ?? cryptoRng;
  const useCrypto = options?.rng === undefined && options?.seed === undefined;
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

  function rejection(
    roomId: string,
    commandId: string,
    rejectionCode: string,
    revision: number,
  ): DraftDuelCommandReceipt {
    return {
      roomId: idSchema.parse(roomId),
      commandId: commandIdSchema.parse(commandId),
      ordinal: -1,
      accepted: false,
      rejectionCode,
      revision,
    };
  }

  function stagePickDeadline(record: RoomRecord, pickOrdinal: number): void {
    if (!record.draftState) return;
    record.snapshot = {
      ...record.snapshot,
      deadline: {
        roomId: record.snapshot.roomId,
        cursor: `t${String(pickOrdinal)}`,
        participantId: pickerFor(record.draftState.firstPicker, pickOrdinal),
        deadlineAt: new Date(clock() + DRAFT_DUEL_PICK_TIMEOUT_MS).toISOString(),
        fallback: null,
        pickOrdinal,
      },
    };
  }

  function advancePick(record: RoomRecord): void {
    const draftState = record.draftState;
    if (!draftState) return;
    const next = draftState.pickOrdinal + 1;
    record.draftState = { ...draftState, pickOrdinal: next };
    if (next >= 10) {
      record.snapshot = { ...record.snapshot, phase: 'lineup-showdown', deadline: null };
      record.fallback = null;
      return;
    }
    stagePickDeadline(record, next);
  }

  function completeGame(record: RoomRecord, resultDigest: string): void {
    const series = record.snapshot.series;
    const p1Confirmation = record.confirmations['p1'];
    const p2Confirmation = record.confirmations['p2'];
    if (!series || !p1Confirmation || !p2Confirmation) return;
    if (
      !p1Confirmation.verified ||
      !p2Confirmation.verified ||
      p1Confirmation.gameNumber !== p2Confirmation.gameNumber ||
      p1Confirmation.resultDigest !== p2Confirmation.resultDigest
    ) {
      return;
    }
    const digest = contentHashSchema.parse(resultDigest);
    const gameNumber = p1Confirmation.gameNumber;
    const winner = record.proposals['p1']?.winner ?? record.proposals['p2']?.winner ?? null;
    record.proposals = {};
    record.confirmations = {};
    record.snapshot = { ...record.snapshot, broadcast: null };
    if (winner === null) {
      const nextGameNumber = gameNumber >= 7 ? null : gameNumber + 1;
      record.snapshot = {
        ...record.snapshot,
        series: { ...series, currentGameNumber: nextGameNumber },
        phase: 'preparing-game',
        confirmedDigest: digest,
      };
      return;
    }
    const home = draftDuelHomeForGameFor(series.homeWinner, gameNumber);
    const away = otherParticipant(home);
    const p1Wins = series.p1Wins + (winner === 'p1' ? 1 : 0);
    const p2Wins = series.p2Wins + (winner === 'p2' ? 1 : 0);
    const champion = p1Wins >= 4 ? 'p1' : p2Wins >= 4 ? 'p2' : null;
    const games = [
      ...series.games,
      { gameNumber, homeParticipantId: home, awayParticipantId: away, winner },
    ];
    const nextSeries: DraftDuelSeriesSnapshot = {
      homeWinner: series.homeWinner,
      games,
      p1Wins,
      p2Wins,
      currentGameNumber: champion ? null : gameNumber + 1,
      champion,
    };
    record.snapshot = {
      ...record.snapshot,
      series: nextSeries,
      phase: champion ? 'championship' : 'preparing-game',
      resultDigest: digest,
      confirmedDigest: digest,
      code: champion ? null : record.snapshot.code,
      codeActive: champion ? false : record.snapshot.codeActive,
    };
    if (champion) {
      codeIndex.delete(record.code);
    }
  }

  function applyCommand(command: {
    schemaVersion: 1;
    roomId: string;
    commandId: string;
    ordinal?: number;
    actorParticipantId: DraftDuelParticipantId;
    payload: DraftDuelCommandPayload;
    expectedRevision?: number;
  }): DraftDuelCommandReceipt {
    const record = rooms.get(command.roomId);
    if (!record) {
      throw Object.assign(new Error('authorization'), {
        code: 'authorization',
        retryable: false,
      });
    }
    const commandIdParsed = commandIdSchema.safeParse(command.commandId);
    if (!commandIdParsed.success) {
      return rejection(
        command.roomId,
        'invalid-command-id',
        'illegal-move',
        record.snapshot.revision,
      );
    }
    const commandId = commandIdParsed.data;
    const payloadHash = canonicalJson(command.payload);
    if (new TextEncoder().encode(payloadHash).length > DRAFT_DUEL_ENVELOPE_MAX_BYTES) {
      return rejection(command.roomId, commandId, 'payload-too-large', record.snapshot.revision);
    }
    const existing = record.commands.find((entry) => entry.commandId === commandId);
    if (existing) {
      if (existing.actorParticipantId !== command.actorParticipantId) {
        return rejection(command.roomId, commandId, 'membership', record.snapshot.revision);
      }
      if (record.payloadHashes.get(commandId) !== payloadHash) {
        return rejection(command.roomId, commandId, 'duplicate-command', record.snapshot.revision);
      }
      return {
        roomId: record.snapshot.roomId,
        commandId,
        ordinal: existing.ordinal,
        accepted: true,
        rejectionCode: null,
        revision: record.snapshot.revision,
      };
    }
    if (
      command.expectedRevision !== undefined &&
      command.expectedRevision !== record.snapshot.revision
    ) {
      return rejection(command.roomId, commandId, 'stale-revision', record.snapshot.revision);
    }
    const expectedOrdinal = record.commands.length;
    const ordinal = command.ordinal ?? expectedOrdinal;
    if (ordinal !== expectedOrdinal) {
      return rejection(command.roomId, commandId, 'stale-revision', record.snapshot.revision);
    }
    const parsed = draftDuelCommandPayloadSchema.safeParse(command.payload);
    if (!parsed.success) {
      return rejection(command.roomId, commandId, 'illegal-move', record.snapshot.revision);
    }
    const payload = parsed.data;
    const actor = command.actorParticipantId;
    const phase = record.snapshot.phase;
    if (phase === 'integrity-failed' || phase === 'expired') {
      return rejection(command.roomId, commandId, 'phase', record.snapshot.revision);
    }
    if (payload.kind === 'ready') {
      if (phase !== 'lobby') {
        return rejection(command.roomId, commandId, 'phase', record.snapshot.revision);
      }
      record.snapshot = memberWith(record.snapshot, actor, {
        ready: payload.ready,
        lastSeenAt: nowIsoWith(clock),
      });
    } else if (payload.kind === 'settings') {
      if (phase !== 'lobby') {
        return rejection(command.roomId, commandId, 'phase', record.snapshot.revision);
      }
      if (actor !== 'p1') {
        return rejection(command.roomId, commandId, 'membership', record.snapshot.revision);
      }
      record.snapshot = {
        ...record.snapshot,
        settings: {
          ...record.snapshot.settings,
          fairness: payload.fairness,
          presentation: payload.presentation,
        },
        members: record.snapshot.members.map((member) => ({ ...member, ready: false })),
      };
    } else if (payload.kind === 'start') {
      if (phase !== 'lobby') {
        return rejection(command.roomId, commandId, 'phase', record.snapshot.revision);
      }
      if (actor !== 'p1') {
        return rejection(command.roomId, commandId, 'membership', record.snapshot.revision);
      }
      if (!record.snapshot.members.every((member) => member.ready)) {
        return rejection(command.roomId, commandId, 'not-ready', record.snapshot.revision);
      }
      const firstPicker = draftDuelFirstPickerFor(record.snapshot.rootSeed ?? '');
      record.draftState = { pickOrdinal: 0, firstPicker, claimedPlayers: [] };
      record.snapshot = {
        ...record.snapshot,
        phase: 'drafting',
        series: {
          homeWinner: draftDuelHomeWinnerFor(record.snapshot.rootSeed ?? ''),
          games: [],
          p1Wins: 0,
          p2Wins: 0,
          currentGameNumber: 1,
          champion: null,
        },
        members: record.snapshot.members.map((member) => ({
          ...member,
          nextGameReady: null,
          locked: false,
        })),
      };
      stagePickDeadline(record, 0);
    } else if (payload.kind === 'pick') {
      const draftState = record.draftState;
      if (phase !== 'drafting' || !draftState) {
        return rejection(command.roomId, commandId, 'phase', record.snapshot.revision);
      }
      if (
        actor !== pickerFor(draftState.firstPicker, draftState.pickOrdinal) ||
        payload.pickOrdinal !== draftState.pickOrdinal
      ) {
        return rejection(command.roomId, commandId, 'turn', record.snapshot.revision);
      }
      if (draftState.claimedPlayers.includes(payload.playerId)) {
        return rejection(command.roomId, commandId, 'claim-taken', record.snapshot.revision);
      }
      record.draftState = {
        ...draftState,
        claimedPlayers: [...draftState.claimedPlayers, payload.playerId],
      };
      advancePick(record);
    } else if (payload.kind === 'timeout-autopick') {
      const draftState = record.draftState;
      const deadline = record.snapshot.deadline;
      if (phase !== 'drafting' || !draftState) {
        return rejection(command.roomId, commandId, 'phase', record.snapshot.revision);
      }
      if (!deadline || clock() < Date.parse(deadline.deadlineAt)) {
        return rejection(command.roomId, commandId, 'turn', record.snapshot.revision);
      }
      if (
        deadline.participantId !== actor ||
        actor !== pickerFor(draftState.firstPicker, draftState.pickOrdinal) ||
        payload.pickOrdinal !== draftState.pickOrdinal
      ) {
        return rejection(command.roomId, commandId, 'turn', record.snapshot.revision);
      }
      if (
        !record.fallback ||
        record.fallback.cursor !== deadline.cursor ||
        record.fallback.pickOrdinal !== payload.pickOrdinal ||
        canonicalJson(record.fallback.payload) !== payloadHash
      ) {
        return rejection(command.roomId, commandId, 'illegal-move', record.snapshot.revision);
      }
      const timeoutCommandId = `timeout-${deadline.cursor}-${String(deadline.pickOrdinal)}`;
      if (commandId !== timeoutCommandId) {
        return rejection(command.roomId, commandId, 'illegal-move', record.snapshot.revision);
      }
      if (draftState.claimedPlayers.includes(payload.playerId)) {
        return rejection(command.roomId, commandId, 'claim-taken', record.snapshot.revision);
      }
      record.draftState = {
        ...draftState,
        claimedPlayers: [...draftState.claimedPlayers, payload.playerId],
      };
      advancePick(record);
    } else if (payload.kind === 'ready-next-game') {
      const series = record.snapshot.series;
      if (
        (phase !== 'lineup-showdown' && phase !== 'preparing-game' && phase !== 'game-results') ||
        !series
      ) {
        return rejection(command.roomId, commandId, 'phase', record.snapshot.revision);
      }
      if (payload.gameNumber !== series.currentGameNumber) {
        return rejection(command.roomId, commandId, 'turn', record.snapshot.revision);
      }
      record.snapshot = memberWith(record.snapshot, actor, {
        nextGameReady: payload.ready ? payload.gameNumber : null,
        lastSeenAt: nowIsoWith(clock),
      });
      if (payload.ready && phase !== 'preparing-game') {
        record.snapshot = { ...record.snapshot, phase: 'preparing-game' };
      }
    } else if (payload.kind === 'broadcast-start') {
      const series = record.snapshot.series;
      if (phase !== 'preparing-game' || !series) {
        return rejection(command.roomId, commandId, 'phase', record.snapshot.revision);
      }
      if (payload.gameNumber !== series.currentGameNumber) {
        return rejection(command.roomId, commandId, 'turn', record.snapshot.revision);
      }
      const readyCount = record.snapshot.members.filter(
        (member) => member.nextGameReady === payload.gameNumber,
      ).length;
      if (readyCount < 2) {
        const autoStart = payload.auto === true && clock() - record.updatedAt >= 60_000;
        if (!autoStart) {
          return rejection(command.roomId, commandId, 'not-ready', record.snapshot.revision);
        }
        record.snapshot = {
          ...record.snapshot,
          members: record.snapshot.members.map((member) => ({
            ...member,
            nextGameReady: payload.gameNumber,
          })),
        };
      }
      record.snapshot = {
        ...record.snapshot,
        phase: 'broadcasting',
        broadcast: {
          gameNumber: payload.gameNumber,
          startedAtIso: nowIsoWith(clock),
          durationMs: DRAFT_DUEL_BROADCAST_MS,
        },
        members: record.snapshot.members.map((member) => ({ ...member, nextGameReady: null })),
      };
    } else if (payload.kind === 'propose-result') {
      const series = record.snapshot.series;
      if ((phase !== 'broadcasting' && phase !== 'game-results') || !series) {
        return rejection(command.roomId, commandId, 'phase', record.snapshot.revision);
      }
      if (payload.gameNumber !== series.currentGameNumber) {
        return rejection(command.roomId, commandId, 'turn', record.snapshot.revision);
      }
      const home = draftDuelHomeForGameFor(series.homeWinner, payload.gameNumber);
      if (payload.winner !== home && payload.winner !== otherParticipant(home)) {
        return rejection(command.roomId, commandId, 'illegal-move', record.snapshot.revision);
      }
      record.proposals = {
        ...record.proposals,
        [actor]: {
          gameNumber: payload.gameNumber,
          resultDigest: payload.resultDigest,
          tapeDigest: payload.tapeDigest,
          inputDigest: payload.inputDigest,
          winner: payload.winner,
        },
      };
      record.snapshot = {
        ...record.snapshot,
        phase: phase === 'broadcasting' ? 'game-results' : phase,
        resultDigest: payload.resultDigest,
      };
    } else if (payload.kind === 'confirm-result') {
      const series = record.snapshot.series;
      if ((phase !== 'broadcasting' && phase !== 'game-results') || !series) {
        return rejection(command.roomId, commandId, 'phase', record.snapshot.revision);
      }
      if (payload.gameNumber !== series.currentGameNumber) {
        return rejection(command.roomId, commandId, 'turn', record.snapshot.revision);
      }
      const hasProposal = record.commands.some(
        (entry) =>
          entry.payload.kind === 'propose-result' &&
          entry.payload.gameNumber === payload.gameNumber &&
          entry.payload.resultDigest === payload.resultDigest,
      );
      if (!hasProposal) {
        return rejection(command.roomId, commandId, 'illegal-move', record.snapshot.revision);
      }
      record.confirmations = {
        ...record.confirmations,
        [actor]: {
          gameNumber: payload.gameNumber,
          resultDigest: payload.resultDigest,
          verified: payload.verified,
        },
      };
      record.snapshot = {
        ...record.snapshot,
        phase: phase === 'broadcasting' ? 'game-results' : phase,
      };
      completeGame(record, payload.resultDigest);
    } else if (payload.kind === 'rematch-request') {
      if (phase !== 'championship') {
        return rejection(command.roomId, commandId, 'phase', record.snapshot.revision);
      }
      record.rematchRequests.add(actor);
    } else if (payload.kind === 'rematch-confirm') {
      if (phase !== 'championship') {
        return rejection(command.roomId, commandId, 'phase', record.snapshot.revision);
      }
      if (![...record.rematchRequests].some((requester) => requester !== actor)) {
        return rejection(command.roomId, commandId, 'not-ready', record.snapshot.revision);
      }
    } else if (payload.kind === 'leave') {
      record.snapshot = memberWith(record.snapshot, actor, { online: false });
    } else {
      if (phase !== 'lobby') {
        return rejection(command.roomId, commandId, 'phase', record.snapshot.revision);
      }
      if (actor !== 'p1') {
        return rejection(command.roomId, commandId, 'membership', record.snapshot.revision);
      }
      const codes = new Set([...codeIndex.keys()].filter((code) => code !== record.code));
      const nextCode = randomCodeWith(codes, rng);
      codeIndex.delete(record.code);
      codeIndex.set(nextCode, record.snapshot.roomId);
      record.code = nextCode;
      record.codeExpiresAt = clock() + DRAFT_DUEL_CODE_TTL_MS;
      record.snapshot = memberWith(record.snapshot, 'p2', idleMember('p2'));
      record.snapshot = {
        ...record.snapshot,
        code: nextCode,
        codeActive: true,
      };
    }
    record.commands.push({
      schemaVersion: 1,
      roomId: record.snapshot.roomId,
      commandId,
      ordinal,
      actorParticipantId: actor,
      payload,
    });
    record.commandIds.add(commandId);
    record.payloadHashes.set(commandId, payloadHash);
    record.snapshot = {
      ...record.snapshot,
      commandCount: record.commands.length,
      revision: record.snapshot.revision + 1,
    };
    record.updatedAt = clock();
    emit(record);
    return {
      roomId: record.snapshot.roomId,
      commandId,
      ordinal,
      accepted: true,
      rejectionCode: null,
      revision: record.snapshot.revision,
    };
  }

  async function createRoom(
    settingsInput: Omit<DraftDuelRoomSettings, 'schemaVersion' | 'timerPolicyVersion'> &
      Partial<Pick<DraftDuelRoomSettings, 'schemaVersion' | 'timerPolicyVersion'>>,
  ): Promise<{
    snapshot: DraftDuelRoomSnapshot;
    code: DraftDuelRoomCode;
    membership: DraftDuelRoomMembership;
  }> {
    await Promise.resolve();
    pruneExpiredCodes();
    const now = clock();
    const recent = createTimestamps.filter((timestamp) => now - timestamp < 60000);
    if (recent.length >= 3) {
      throw Object.assign(new Error('rate-limit: too many rooms'), {
        code: 'rate-limit',
        retryable: true,
      });
    }
    createTimestamps.push(now);
    const settings: DraftDuelRoomSettings = draftDuelRoomSettingsSchema.parse({
      ...settingsInput,
      schemaVersion: settingsInput.schemaVersion ?? DRAFT_DUEL_ROOM_SCHEMA_VERSION,
      timerPolicyVersion: settingsInput.timerPolicyVersion ?? DRAFT_DUEL_AUTOPICK_VERSION,
      versions: settingsInput.versions,
    });
    if (
      settings.versions.multiplayerVersion !== DRAFT_DUEL_MULTIPLAYER_VERSION ||
      settings.versions.autopickVersion !== DRAFT_DUEL_AUTOPICK_VERSION
    ) {
      throw Object.assign(new Error('invalid versions'), {
        code: 'illegal-move',
        retryable: false,
      });
    }
    const roomId = randomRoomIdWith(rng, useCrypto);
    const codes = new Set(codeIndex.keys());
    const code = randomCodeWith(codes, rng);
    const rootSeed = seedSchema.parse(randomSeedWith(rng, useCrypto));
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + DRAFT_DUEL_ROOM_RETENTION_MS).toISOString();
    const snapshot: DraftDuelRoomSnapshot = {
      roomId,
      code,
      codeActive: true,
      settings,
      phase: 'lobby',
      revision: 0,
      commandCount: 0,
      members: [
        {
          participantId: 'p1',
          online: true,
          ready: false,
          nextGameReady: null,
          locked: false,
          lastSeenAt: createdAt,
        },
        idleMember('p2'),
      ],
      rootSeed,
      deadline: null,
      series: null,
      broadcast: null,
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
      payloadHashes: new Map(),
      code,
      codeExpiresAt: now + DRAFT_DUEL_CODE_TTL_MS,
      updatedAt: now,
      subscribers: new Set(),
      transientSubscribers: new Set(),
      verificationChallenge: null,
      receipts: new Map(),
      fallback: null,
      draftState: null,
      proposals: {},
      confirmations: {},
      rematchRequests: new Set(),
    };
    rooms.set(roomId, record);
    codeIndex.set(code, roomId);
    const membership: DraftDuelRoomMembership = { roomId, participantId: 'p1', code };
    return { snapshot, code, membership };
  }

  function recordFor(roomId: string): RoomRecord {
    const record = rooms.get(roomId);
    if (!record) {
      throw Object.assign(new Error('authorization'), {
        code: 'authorization',
        retryable: false,
      });
    }
    return record;
  }

  return {
    async create(settingsInput) {
      const created = await createRoom(settingsInput);
      const record = recordFor(created.snapshot.roomId);
      return { ...created, snapshot: record.snapshot };
    },
    async preview(code) {
      await Promise.resolve();
      pruneExpiredCodes();
      const roomId = codeIndex.get(code);
      if (!roomId) {
        throw Object.assign(new Error('invalid-code'), {
          code: 'invalid-code',
          retryable: false,
        });
      }
      const record = rooms.get(roomId);
      if (!record) {
        throw Object.assign(new Error('invalid-code'), {
          code: 'invalid-code',
          retryable: false,
        });
      }
      return record.snapshot;
    },
    async join(code) {
      await Promise.resolve();
      pruneExpiredCodes();
      const roomId = codeIndex.get(code);
      if (!roomId) {
        throw Object.assign(new Error('invalid-code'), {
          code: 'invalid-code',
          retryable: false,
        });
      }
      const record = rooms.get(roomId);
      if (!record) {
        throw Object.assign(new Error('invalid-code'), {
          code: 'invalid-code',
          retryable: false,
        });
      }
      if (record.snapshot.phase === 'expired') {
        throw Object.assign(new Error('code-expired'), {
          code: 'code-expired',
          retryable: false,
        });
      }
      record.snapshot = memberWith(record.snapshot, 'p2', {
        online: true,
        lastSeenAt: nowIsoWith(clock),
      });
      record.snapshot = { ...record.snapshot, revision: record.snapshot.revision + 1 };
      record.updatedAt = clock();
      emit(record);
      return {
        snapshot: record.snapshot,
        membership: { roomId: record.snapshot.roomId, participantId: 'p2', code: record.code },
      };
    },
    async resume(roomId) {
      await Promise.resolve();
      const record = recordFor(roomId);
      return {
        snapshot: record.snapshot,
        membership: { roomId: record.snapshot.roomId, participantId: 'p1', code: record.code },
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
    subscribeTransient(roomId, handler) {
      const record = rooms.get(roomId);
      if (!record) return { unsubscribe: () => {} };
      record.transientSubscribers.add(handler);
      return {
        unsubscribe: () => {
          record.transientSubscribers.delete(handler);
        },
      };
    },
    publishTransient(roomId, event) {
      const parsed = draftDuelTransientEventSchema.safeParse(event);
      if (!parsed.success || parsed.data.roomId !== roomId) return Promise.resolve(false);
      const record = rooms.get(roomId);
      if (!record) return Promise.resolve(false);
      for (const handler of record.transientSubscribers) {
        try {
          handler(parsed.data);
        } catch {
          continue;
        }
      }
      return Promise.resolve(true);
    },
    async refetch(roomId, afterOrdinal) {
      await Promise.resolve();
      const record = recordFor(roomId);
      return record.commands.filter((command) => command.ordinal > afterOrdinal);
    },
    async submitCommand(command) {
      await Promise.resolve();
      return applyCommand(command);
    },
    async verificationChallenge(roomId) {
      await Promise.resolve();
      const record = recordFor(roomId);
      record.verificationChallenge ??= randomChallengeWith(rng, useCrypto);
      return record.verificationChallenge;
    },
    async submitVerification(roomId, receipt, expectedRevision) {
      await Promise.resolve();
      const record = recordFor(roomId);
      const parsed = draftDuelVerificationReceiptSchema.safeParse(receipt);
      if (!parsed.success || parsed.data.roomId !== record.snapshot.roomId) {
        throw Object.assign(new Error('verification: invalid receipt'), {
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
      record.updatedAt = clock();
      return { receiptId: parsed.data.receiptDigest, revision: record.snapshot.revision };
    },
    async commitFallback(roomId, cursor, payload, expectedRevision) {
      await Promise.resolve();
      const record = recordFor(roomId);
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
      const parsed = draftDuelCommandPayloadSchema.safeParse(payload);
      if (
        !parsed.success ||
        parsed.data.kind !== 'timeout-autopick' ||
        parsed.data.pickOrdinal !== deadline.pickOrdinal
      ) {
        throw Object.assign(
          new Error('commit-fallback: payload must match the deadline autopick'),
          { code: 'illegal-move', retryable: false },
        );
      }
      record.fallback = {
        cursor,
        participantId: deadline.participantId,
        pickOrdinal: deadline.pickOrdinal,
        payload: parsed.data,
      };
      record.snapshot = {
        ...record.snapshot,
        deadline: { ...deadline, fallback: parsed.data },
      };
      record.updatedAt = clock();
      return { stored: true, revision: record.snapshot.revision };
    },
    async resolveTimeout(roomId) {
      await Promise.resolve();
      const record = rooms.get(roomId);
      if (!record) return null;
      const deadline = record.snapshot.deadline;
      if (!deadline) return null;
      if (clock() < Date.parse(deadline.deadlineAt)) return null;
      const commitment = record.fallback;
      if (!commitment || commitment.cursor !== deadline.cursor) return null;
      const commandId = `timeout-${deadline.cursor}-${String(commitment.pickOrdinal)}`;
      if (record.commandIds.has(commandId)) return null;
      return applyCommand({
        schemaVersion: 1,
        roomId: record.snapshot.roomId,
        commandId: commandIdSchema.parse(commandId),
        actorParticipantId: commitment.participantId,
        payload: commitment.payload,
      });
    },
    async removeGuest(roomId, targetParticipantId) {
      await Promise.resolve();
      const record = recordFor(roomId);
      if (record.snapshot.phase !== 'lobby') {
        throw Object.assign(new Error('phase'), { code: 'phase', retryable: false });
      }
      if (targetParticipantId !== 'p2') {
        throw Object.assign(new Error('membership'), {
          code: 'membership',
          retryable: false,
        });
      }
      const codes = new Set([...codeIndex.keys()].filter((code) => code !== record.code));
      const nextCode = randomCodeWith(codes, rng);
      codeIndex.delete(record.code);
      codeIndex.set(nextCode, record.snapshot.roomId);
      record.code = nextCode;
      record.codeExpiresAt = clock() + DRAFT_DUEL_CODE_TTL_MS;
      record.snapshot = memberWith(record.snapshot, 'p2', idleMember('p2'));
      record.snapshot = {
        ...record.snapshot,
        code: nextCode,
        codeActive: true,
        revision: record.snapshot.revision + 1,
      };
      record.updatedAt = clock();
      emit(record);
      return record.snapshot;
    },
    async leave(roomId, participantId) {
      await Promise.resolve();
      const record = rooms.get(roomId);
      if (!record) return;
      record.snapshot = memberWith(record.snapshot, participantId, { online: false });
      record.snapshot = { ...record.snapshot, revision: record.snapshot.revision + 1 };
      record.updatedAt = clock();
      emit(record);
    },
    async rematch(roomId) {
      const record = recordFor(roomId);
      if (record.snapshot.phase !== 'championship') {
        throw Object.assign(new Error('phase'), { code: 'phase', retryable: false });
      }
      if (record.snapshot.successorRoomId) {
        const successor = recordFor(record.snapshot.successorRoomId);
        return { snapshot: successor.snapshot, code: successor.code };
      }
      const created = await createRoom({
        fairness: record.snapshot.settings.fairness,
        presentation: record.snapshot.settings.presentation,
        versions: record.snapshot.settings.versions,
      });
      record.snapshot = { ...record.snapshot, successorRoomId: created.snapshot.roomId };
      record.updatedAt = clock();
      emit(record);
      return { snapshot: created.snapshot, code: created.code };
    },
    async complete(roomId, receiptId) {
      await Promise.resolve();
      const record = recordFor(roomId);
      const phase = record.snapshot.phase;
      if (phase === 'integrity-failed' || phase === 'expired') {
        return { completed: false, phase };
      }
      if (phase !== 'championship') return { completed: false, phase };
      const receipt = record.receipts.get(receiptId);
      if (!receipt) return { completed: false, phase };
      const matching = [...record.receipts.values()].filter(
        (entry) => entry.resultDigest === receipt.resultDigest,
      );
      const digestCount = new Set(matching.map((entry) => entry.receiptDigest)).size;
      if (digestCount < 2) return { completed: false, phase };
      record.snapshot = {
        ...record.snapshot,
        confirmedDigest: contentHashSchema.parse(receipt.resultDigest),
        members: record.snapshot.members.map((member) => ({ ...member, locked: true })),
      };
      record.updatedAt = clock();
      emit(record);
      return { completed: true, phase: record.snapshot.phase };
    },
    async fail(roomId) {
      await Promise.resolve();
      const record = recordFor(roomId);
      const phase = record.snapshot.phase;
      if (phase === 'integrity-failed') return { failed: true, phase };
      if (phase === 'expired') return { failed: false, phase };
      const receiptDigests = new Set(
        [...record.receipts.values()].map((entry) => entry.receiptDigest),
      );
      const mismatch =
        receiptDigests.size >= 2 ||
        (() => {
          const byGame = new Map<number, Set<string>>();
          for (const command of record.commands) {
            if (command.payload.kind !== 'propose-result') continue;
            const digests = byGame.get(command.payload.gameNumber) ?? new Set<string>();
            digests.add(command.payload.resultDigest);
            byGame.set(command.payload.gameNumber, digests);
          }
          const denied = record.commands.some(
            (command) => command.payload.kind === 'confirm-result' && !command.payload.verified,
          );
          return denied && [...byGame.values()].some((digests) => digests.size >= 2);
        })();
      if (!mismatch) return { failed: false, phase };
      record.snapshot = {
        ...record.snapshot,
        phase: 'integrity-failed',
        code: null,
        codeActive: false,
      };
      record.updatedAt = clock();
      emit(record);
      return { failed: true, phase: record.snapshot.phase };
    },
  };
}
