import {
  FIXED_FIVE_CODE_TTL_MS,
  FIXED_FIVE_DUEL_BROADCAST_MS,
  FIXED_FIVE_ENVELOPE_MAX_BYTES,
  FIXED_FIVE_MULTIPLAYER_VERSION,
  FIXED_FIVE_ROOM_SCHEMA_VERSION,
  fixedFiveCommandPayloadSchema,
  fixedFiveCommandSchema,
  fixedFiveRoomCodeSchema,
  fixedFiveTimeoutMsForMode,
  fixedFiveVerificationReceiptSchema,
  type FixedFiveCommand,
  type FixedFiveCommandPayload,
  type FixedFiveCommandReceipt,
  type FixedFiveMultiplayerTransport,
  type FixedFiveParticipantId,
  type FixedFiveRoomMembership,
  type FixedFiveRoomSettings,
  type FixedFiveRoomSnapshot,
  type FixedFiveVerificationReceipt,
  canonicalJson,
  commandIdSchema,
  contentHashSchema,
} from '@hoop-rush/data-contracts';
import {
  createInMemoryRoomStore,
  roomError,
  type InMemoryRoomRecord,
} from '../multiplayer/in-memory-room-store.ts';
import {
  allocateInMemoryRoom,
  baseRoomRecord,
  commandReceipt,
  createRoomTransportMechanics,
  nowIso,
  otherParticipantId,
  patchMember,
} from '../multiplayer/in-memory-transport-support.ts';

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
interface RoomRecord extends InMemoryRoomRecord<
  FixedFiveRoomSnapshot,
  never,
  FixedFiveVerificationReceipt,
  FallbackCommitment
> {
  commands: FixedFiveCommand[];
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
  const store = createInMemoryRoomStore<
    FixedFiveRoomSnapshot,
    never,
    FixedFiveVerificationReceipt,
    FallbackCommitment,
    RoomRecord
  >({
    clock,
    random: options.random,
    roomIdPrefix: 'ff-',
    codeTtlMs: FIXED_FIVE_CODE_TTL_MS,
    codeSchema: fixedFiveRoomCodeSchema,
    challengePrefix: 'ff-challenge-',
    challengeBytes: 24,
    codeExhaustedMessage: 'in-memory fixed-five: code space exhausted',
    clearCode: (snapshot) =>
      snapshot.codeActive ? { ...snapshot, codeActive: false, code: null } : snapshot,
  });
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
          startedAtIso: nowIso(clock),
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
          startedAtIso: nowIso(clock),
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
  type CreateInput = Omit<FixedFiveRoomSettings, 'schemaVersion' | 'timerPolicyVersion'> &
    Partial<Pick<FixedFiveRoomSettings, 'schemaVersion' | 'timerPolicyVersion'>>;

  async function createRoom(settingsInput: CreateInput): Promise<{
    snapshot: FixedFiveRoomSnapshot;
    code: string;
    membership: FixedFiveRoomMembership;
  }> {
    await Promise.resolve();
    const now = store.claimCreateSlot();
    const settings: FixedFiveRoomSettings = {
      schemaVersion: FIXED_FIVE_ROOM_SCHEMA_VERSION,
      timerPolicyVersion: 'fixed-five-autopick-v1',
      ...settingsInput,
      versions: settingsInput.versions,
    };
    const { roomId, code, rootSeed, codeExpiresAt, createdAt, expiresAt } = allocateInMemoryRoom(
      store,
      24 * 60 * 60 * 1000,
      now,
    );
    const timeoutMs = fixedFiveTimeoutMsForMode(settings.mode);
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
      ...baseRoomRecord({ snapshot, code, codeExpiresAt, now }),
      commands: [],
      gameState: emptyDuelGameState(),
    };
    store.add(roomId, record);
    const membership: FixedFiveRoomMembership = { roomId, participantId: 'p1', code };
    return { snapshot, code, membership };
  }

  async function applyCommand(
    command: Omit<FixedFiveCommand, 'ordinal'> & {
      ordinal?: number;
      expectedRevision?: number;
    },
  ): Promise<FixedFiveCommandReceipt> {
    await Promise.resolve();
    const record = store.require(command.roomId);
    const reject = (rejectionCode: string) =>
      commandReceipt(
        command.roomId,
        command.commandId,
        -1,
        rejectionCode,
        record.snapshot.revision,
      );
    const payloadBytes = new TextEncoder().encode(canonicalJson(command.payload)).length;
    if (payloadBytes > FIXED_FIVE_ENVELOPE_MAX_BYTES) {
      return reject('payload-too-large');
    }
    if (record.commandIds.has(command.commandId)) {
      const existing = record.commands.find((c) => c.commandId === command.commandId);
      return commandReceipt(
        command.roomId,
        command.commandId,
        existing?.ordinal ?? -1,
        null,
        record.snapshot.revision,
      );
    }
    if (
      command.expectedRevision !== undefined &&
      command.expectedRevision !== record.snapshot.revision
    ) {
      return reject('stale-revision');
    }
    const expectedOrdinal = record.commands.length;
    const ordinal = command.ordinal ?? expectedOrdinal;
    if (ordinal !== expectedOrdinal) return reject('stale-revision');
    const full = { ...command, ordinal, schemaVersion: 1 as const };
    const parsed = fixedFiveCommandSchema.safeParse(full);
    if (!parsed.success) {
      return reject('illegal-move');
    }
    const sandboxSnake =
      isSandboxSnakeRoom(record.snapshot.settings) &&
      FIXED_FIVE_SNAKE_ROOM_VERSIONS.has(record.snapshot.settings.versions.multiplayerVersion);
    const repositionAware = isRepositionAwareRoom(record.snapshot.settings);
    if (
      parsed.data.payload.kind === 'duel-reposition' &&
      (record.snapshot.settings.mode !== 'duel' || !repositionAware)
    ) {
      return reject('illegal-move');
    }
    if (parsed.data.payload.kind === 'sandbox-reposition' && sandboxSnake && !repositionAware) {
      return reject('illegal-move');
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
          if (entry.payload.kind !== 'sandbox-place' && entry.payload.kind !== 'timeout-autopick') {
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
        return reject('illegal-move');
      }
    }
    if (
      sandboxSnake &&
      pickedPayload?.kind === 'sandbox-place' &&
      record.snapshot.deadline &&
      record.snapshot.deadline.participantId !== parsed.data.actorParticipantId
    ) {
      return reject('turn');
    }
    const broadcastRejection = duelBroadcastRejection(record, parsed.data);
    if (broadcastRejection !== null) return reject(broadcastRejection);
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
    store.emit(record);
    return commandReceipt(
      command.roomId,
      command.commandId,
      ordinal,
      null,
      record.snapshot.revision,
    );
  }

  const mechanics = createRoomTransportMechanics<
    FixedFiveRoomSnapshot,
    never,
    FixedFiveVerificationReceipt,
    FallbackCommitment,
    RoomRecord,
    FixedFiveCommand,
    FixedFiveCommandPayload,
    FixedFiveCommandReceipt,
    string
  >({
    store,
    clock,
    markOnline: (snapshot, participantId, online, atIso) => ({
      ...snapshot,
      members: patchMember(
        snapshot.members,
        participantId,
        online ? { online, lastSeenAt: atIso } : { online },
      ),
    }),
    removeGuest: (snapshot, nextCode) => ({
      ...snapshot,
      code: nextCode,
      codeActive: true,
    }),
    touchOnRemoveGuest: false,
    findForSync: (roomId) => store.find(roomId),
    syncCommands: (record, afterOrdinal) =>
      record.commands.filter((command) => command.ordinal > afterOrdinal),
    receiptSchema: fixedFiveVerificationReceiptSchema,
    verificationOptions: {
      foreignReceiptMessage: 'verification: receipt does not belong to the room',
    },
    buildFallback: ({ cursor, payload, deadline }) => {
      const parsed = fixedFiveCommandPayloadSchema.safeParse(payload);
      if (
        !parsed.success ||
        parsed.data.kind !== 'timeout-autopick' ||
        parsed.data.pickOrdinal !== deadline.pickOrdinal
      ) {
        throw roomError(
          'commit-fallback: payload must match the deadline autopick',
          'illegal-move',
          false,
        );
      }
      return {
        cursor,
        participantId: deadline.participantId,
        pickOrdinal: deadline.pickOrdinal,
        payload: parsed.data,
      };
    },
    deadlineAt: (deadline) => deadline.deadlineAt,
    timeoutCommandId: (deadline, commitment) =>
      `timeout-${deadline.cursor}-${String(commitment.pickOrdinal)}`,
    submitTimeout: (record, commitment, commandId) =>
      applyCommand({
        schemaVersion: 1,
        roomId: record.snapshot.roomId,
        commandId: commandIdSchema.parse(commandId),
        actorParticipantId: commitment.participantId,
        payload: commitment.payload,
      }),
    rematch: {
      phase: 'completed',
      reuseSuccessor: false,
      touch: false,
      create: async (record) => {
        const created = await createRoom({
          mode: record.snapshot.settings.mode,
          sourceMode: record.snapshot.settings.sourceMode,
          variant: record.snapshot.settings.variant,
          versions: record.snapshot.settings.versions,
        });
        return { snapshot: created.snapshot, code: created.code };
      },
    },
  });

  return {
    ...mechanics,
    create: createRoom,
    async snapshot(roomId) {
      await Promise.resolve();
      return store.require(roomId).snapshot;
    },
    submitCommand: applyCommand,
    async complete(roomId, receiptId) {
      await Promise.resolve();
      const record = store.require(roomId);
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
      store.emit(record);
      return { completed: true, phase: record.snapshot.phase };
    },
    async fail(roomId) {
      await Promise.resolve();
      const record = store.require(roomId);
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
      store.emit(record);
      return { failed: true, phase: record.snapshot.phase };
    },
  };
}
