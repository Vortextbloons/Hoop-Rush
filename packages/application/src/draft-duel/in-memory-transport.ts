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
  commandIdSchema,
  contentHashSchema,
  idSchema,
  seedSchema,
  canonicalJson,
} from '@hoop-rush/data-contracts';
import {
  createInMemoryRoomStore,
  membershipError,
  phaseError,
  roomError,
  type InMemoryRoomRecord,
} from '../multiplayer/in-memory-room-store.ts';

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

function nowIsoWith(clock: () => number): string {
  return new Date(clock()).toISOString();
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

interface RoomRecord extends InMemoryRoomRecord<
  DraftDuelRoomSnapshot,
  DraftDuelTransientEvent,
  DraftDuelVerificationReceipt,
  FallbackCommitment
> {
  commands: DraftDuelCommand[];
  payloadHashes: Map<string, string>;
  draftState: DraftState | null;
  proposals: Partial<Record<DraftDuelParticipantId, GameProposal>>;
  confirmations: Partial<Record<DraftDuelParticipantId, GameConfirmation>>;
  rematchRequests: Set<DraftDuelParticipantId>;
}

export interface InMemoryDraftDuelTransport extends DraftDuelMultiplayerTransport {
  publishTransient(roomId: string, event: DraftDuelTransientEvent): Promise<boolean>;
}

export function createInMemoryDraftDuelTransport(options: {
  clock: () => number;
  random: { seed: string } | { rng: () => number } | { bytes: (length: number) => Uint8Array };
}): InMemoryDraftDuelTransport {
  const clock = options.clock;
  const store = createInMemoryRoomStore<
    DraftDuelRoomSnapshot,
    DraftDuelTransientEvent,
    DraftDuelVerificationReceipt,
    FallbackCommitment,
    RoomRecord
  >({
    clock,
    random: options.random,
    roomIdPrefix: 'dd-',
    codeTtlMs: DRAFT_DUEL_CODE_TTL_MS,
    codeSchema: draftDuelRoomCodeSchema,
    challengePrefix: 'dd-challenge-',
    challengeBytes: 24,
    codeExhaustedMessage: 'in-memory draft-duel: code space exhausted',
    clearCode: (snapshot) =>
      snapshot.codeActive ? { ...snapshot, codeActive: false, code: null } : snapshot,
  });

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
      store.retireCode(record);
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
    const record = store.require(command.roomId);
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
      if (
        record.snapshot.members.length !== 2 ||
        !record.snapshot.members.every((member) => member.online)
      ) {
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
    } else if (payload.kind === 'reposition') {
      const draftState = record.draftState;
      if (phase !== 'drafting' || !draftState) {
        return rejection(command.roomId, commandId, 'phase', record.snapshot.revision);
      }
      if (!draftState.claimedPlayers.includes(payload.playerId)) {
        return rejection(command.roomId, commandId, 'illegal-move', record.snapshot.revision);
      }
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
      const nextCode = store.rotateCode(record);
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
    store.emit(record);
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
    const now = store.claimCreateSlot();
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
      throw roomError('invalid versions', 'illegal-move', false);
    }
    const allocation = store.allocateRoom(now);
    const roomId = idSchema.parse(allocation.roomId);
    const code = allocation.code;
    const rootSeed = seedSchema.parse(allocation.rootSeed);
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
      codeExpiresAt: allocation.codeExpiresAt,
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
    store.add(roomId, record);
    const membership: DraftDuelRoomMembership = { roomId, participantId: 'p1', code };
    return { snapshot, code, membership };
  }

  function recordFor(roomId: string): RoomRecord {
    return store.require(roomId);
  }

  return {
    async create(settingsInput) {
      const created = await createRoom(settingsInput);
      const record = recordFor(created.snapshot.roomId);
      return { ...created, snapshot: record.snapshot };
    },
    async preview(code) {
      await Promise.resolve();
      return store.roomByCode(code).snapshot;
    },
    async join(code) {
      await Promise.resolve();
      const record = store.joinableRoom(code);
      record.snapshot = memberWith(record.snapshot, 'p2', {
        online: true,
        lastSeenAt: nowIsoWith(clock),
      });
      record.snapshot = { ...record.snapshot, revision: record.snapshot.revision + 1 };
      record.updatedAt = clock();
      store.emit(record);
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
    async sync(roomId, afterOrdinal) {
      await Promise.resolve();
      const record = recordFor(roomId);
      return {
        snapshot: record.snapshot,
        commands: record.commands.filter((command) => command.ordinal > afterOrdinal),
      };
    },
    subscribe(roomId, handler) {
      return store.subscribe(roomId, handler);
    },
    subscribeTransient(roomId, handler) {
      return store.subscribeTransient(roomId, handler);
    },
    publishTransient(roomId, event) {
      const parsed = draftDuelTransientEventSchema.safeParse(event);
      if (!parsed.success || parsed.data.roomId !== roomId) return Promise.resolve(false);
      return Promise.resolve(store.publishTransient(roomId, parsed.data));
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
      return store.verificationChallenge(recordFor(roomId));
    },
    async submitVerification(roomId, receipt, expectedRevision) {
      await Promise.resolve();
      return store.submitVerification(
        recordFor(roomId),
        receipt,
        expectedRevision,
        draftDuelVerificationReceiptSchema,
        { touch: true },
      );
    },
    async commitFallback(roomId, cursor, payload, expectedRevision) {
      await Promise.resolve();
      const record = recordFor(roomId);
      return store.commitFallback(record, cursor, expectedRevision, (deadline) => {
        const parsed = draftDuelCommandPayloadSchema.safeParse(payload);
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
        record.snapshot = {
          ...record.snapshot,
          deadline: { ...deadline, fallback: parsed.data },
        };
        record.updatedAt = clock();
        return {
          cursor,
          participantId: deadline.participantId,
          pickOrdinal: deadline.pickOrdinal,
          payload: parsed.data,
        };
      });
    },
    async resolveTimeout(roomId) {
      await Promise.resolve();
      const record = store.find(roomId);
      return store.resolveTimeout(
        record,
        (deadline) => deadline.deadlineAt,
        (deadline, commitment) => `timeout-${deadline.cursor}-${String(commitment.pickOrdinal)}`,
        (commitment, commandId) =>
          record === undefined
            ? Promise.resolve(null)
            : applyCommand({
                schemaVersion: 1,
                roomId: record.snapshot.roomId,
                commandId: commandIdSchema.parse(commandId),
                actorParticipantId: commitment.participantId,
                payload: commitment.payload,
              }),
      );
    },
    async removeGuest(roomId, targetParticipantId) {
      await Promise.resolve();
      const record = recordFor(roomId);
      if (record.snapshot.phase !== 'lobby') {
        throw phaseError();
      }
      if (targetParticipantId !== 'p2') {
        throw membershipError();
      }
      const nextCode = store.rotateCode(record);
      record.snapshot = memberWith(record.snapshot, 'p2', idleMember('p2'));
      record.snapshot = {
        ...record.snapshot,
        code: nextCode,
        codeActive: true,
        revision: record.snapshot.revision + 1,
      };
      record.updatedAt = clock();
      store.emit(record);
      return record.snapshot;
    },
    async leave(roomId, participantId) {
      await Promise.resolve();
      const record = store.find(roomId);
      if (!record) return;
      record.snapshot = memberWith(record.snapshot, participantId, { online: false });
      record.snapshot = { ...record.snapshot, revision: record.snapshot.revision + 1 };
      record.updatedAt = clock();
      store.emit(record);
    },
    async rematch(roomId) {
      const record = recordFor(roomId);
      if (record.snapshot.phase !== 'championship') {
        throw phaseError();
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
      store.emit(record);
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
      store.emit(record);
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
      store.emit(record);
      return { failed: true, phase: record.snapshot.phase };
    },
  };
}
