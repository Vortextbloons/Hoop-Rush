import {
  HAVOC_MULTIPLAYER_BROADCAST_MS,
  HAVOC_MULTIPLAYER_CODE_TTL_MS,
  HAVOC_MULTIPLAYER_GAME_READY_TIMEOUT_MS,
  HAVOC_MULTIPLAYER_PICK_TIMEOUT_MS,
  HAVOC_MULTIPLAYER_REROLLS_PER_PARTICIPANT,
  HAVOC_MULTIPLAYER_ROOM_RETENTION_MS,
  HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
  HAVOC_MULTIPLAYER_SERIES_GAMES,
  HAVOC_MULTIPLAYER_SERIES_WINS,
  HAVOC_MULTIPLAYER_TURNS,
} from './havoc-multiplayer-versions.ts';
import {
  havocMultiplayerCommandPayloadSchema,
  havocMultiplayerDraftStateSchema,
  havocMultiplayerRoomCodeSchema,
  havocMultiplayerRoomSettingsSchema,
  havocMultiplayerRoomSnapshotSchema,
  havocMultiplayerSeriesSnapshotSchema,
  havocMultiplayerTransientEventSchema,
  havocMultiplayerVerificationReceiptSchema,
  type HavocMultiplayerCommand,
  type HavocMultiplayerCommandPayload,
  type HavocMultiplayerCommandReceipt,
  type HavocMultiplayerCommandRejectionCode,
  type HavocMultiplayerDeadline,
  type HavocMultiplayerDraftPick,
  type HavocMultiplayerDraftState,
  type HavocMultiplayerMemberSnapshot,
  type HavocMultiplayerParticipantId,
  type HavocMultiplayerRoomCode,
  type HavocMultiplayerRoomMembership,
  type HavocMultiplayerRoomSettings,
  type HavocMultiplayerRoomSnapshot,
  type HavocMultiplayerSeriesGame,
  type HavocMultiplayerSeriesSnapshot,
  type HavocMultiplayerTransientEvent,
  type HavocMultiplayerTransport,
  type HavocMultiplayerVerificationReceipt,
} from './havoc-multiplayer.ts';
import {
  havocCardIdSchema,
  havocDraftOfferSchema,
  havocOfferIdSchema,
  type HavocDraftCard,
  type HavocDraftOffer,
} from './havoc-draft.ts';
import { HAVOC_TENDENCY_FIELDS } from './havoc-mutations.ts';
import { POSITIONS, type Position } from './positions.ts';
import {
  REQUIRED_RATING_KEYS,
  type SimulationRatings,
  type SimulationTendencies,
} from './simulation.ts';
import {
  commandIdSchema,
  idSchema,
  playerIdSchema,
  seasonKeySchema,
  seedSchema,
  type Id,
} from './ids.ts';
import { canonicalJson, fnv1a32, seasonDigestHex } from './season-hash.ts';

function mulberry32Seed(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cryptoRng(): number {
  const word = new Uint32Array(1);
  crypto.getRandomValues(word);
  return (word[0] as number) / 4294967296;
}

function nowIsoWith(clock: () => number): string {
  return new Date(clock()).toISOString();
}

function seedByteParity(rootSeed: string, offset: number): boolean {
  return Number.parseInt(rootSeed.slice(offset, offset + 2), 16) % 2 === 0;
}

export function havocMultiplayerFirstPickerFor(rootSeed: string): HavocMultiplayerParticipantId {
  return seedByteParity(rootSeed, 0) ? 'p1' : 'p2';
}

export function havocMultiplayerHomeWinnerFor(rootSeed: string): HavocMultiplayerParticipantId {
  return seedByteParity(rootSeed, 2) ? 'p1' : 'p2';
}

function otherParticipant(
  participantId: HavocMultiplayerParticipantId,
): HavocMultiplayerParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}

function pickerFor(
  firstPicker: HavocMultiplayerParticipantId,
  turnOrdinal: number,
): HavocMultiplayerParticipantId {
  return turnOrdinal % 2 === 0 ? firstPicker : otherParticipant(firstPicker);
}

const HAVOC_HOME_GAMES: ReadonlySet<number> = new Set([1, 2, 5, 7]);

export function havocMultiplayerHomeForGame(
  homeWinner: HavocMultiplayerParticipantId,
  gameNumber: number,
): HavocMultiplayerParticipantId {
  if (
    !Number.isInteger(gameNumber) ||
    gameNumber < 1 ||
    gameNumber > HAVOC_MULTIPLAYER_SERIES_GAMES
  ) {
    throw new Error(
      `havoc multiplayer gameNumber must be an integer in 1..${String(HAVOC_MULTIPLAYER_SERIES_GAMES)} (got ${String(gameNumber)})`,
    );
  }
  return HAVOC_HOME_GAMES.has(gameNumber) ? homeWinner : otherParticipant(homeWinner);
}

function randomBytesWith(rng: () => number, useCrypto: boolean, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (useCrypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(rng() * 256);
    }
  }
  return bytes;
}

function randomSeedWith(rng: () => number, useCrypto: boolean): string {
  return [...randomBytesWith(rng, useCrypto, 16)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomCodeWith(existing: Set<string>, rng: () => number): HavocMultiplayerRoomCode {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const n = Math.floor(rng() * 10000);
    const code = String(n).padStart(4, '0');
    if (!existing.has(code)) return havocMultiplayerRoomCodeSchema.parse(code);
  }
  throw new Error('in-memory havoc multiplayer: code space exhausted');
}

function randomRoomIdWith(rng: () => number, useCrypto: boolean): Id {
  return idSchema.parse(
    `hm-${[...randomBytesWith(rng, useCrypto, 12)]
      .map((b) => b.toString(36))
      .join('')
      .slice(0, 12)
      .toLowerCase()
      .replace(/[^a-z0-9._:-]/g, 'a')}`,
  );
}

function randomChallengeWith(rng: () => number, useCrypto: boolean): string {
  return [...randomBytesWith(rng, useCrypto, 32)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const SYNTHETIC_RATING = 70;
const SYNTHETIC_TENDENCY = 50;
const SYNTHETIC_SEASONS = ['1999-00', '2000-01', '2001-02'] as const;
const SYNTHETIC_PLAYER_POOL_SIZE = 12;

function syntheticRatings(): SimulationRatings {
  return Object.fromEntries(
    REQUIRED_RATING_KEYS.map((key) => [key, SYNTHETIC_RATING]),
  ) as SimulationRatings;
}

function syntheticTendencies(): SimulationTendencies {
  return Object.fromEntries(
    HAVOC_TENDENCY_FIELDS.map((key) => [key, SYNTHETIC_TENDENCY]),
  ) as SimulationTendencies;
}

function syntheticHavocCard(input: {
  rootSeed: string;
  participantId: HavocMultiplayerParticipantId;
  turnOrdinal: number;
  offerIndex: number;
  cardIndex: number;
  offerId: string;
  slot: Position;
}): HavocDraftCard {
  const namespace = input.offerIndex === 0 ? 'a' : 'b';
  const playerId = playerIdSchema.parse(
    `player-${namespace}-${String((input.turnOrdinal + input.cardIndex) % SYNTHETIC_PLAYER_POOL_SIZE)}`,
  );
  const seasonKey = seasonKeySchema.parse(SYNTHETIC_SEASONS[input.cardIndex] ?? '1999-00');
  const ratings = syntheticRatings();
  const tendencies = syntheticTendencies();
  const tier = (((input.cardIndex + input.offerIndex) % 3) + 1) as HavocDraftCard['tier'];
  const cardId = havocCardIdSchema.parse(
    `hvc-${seasonDigestHex(
      canonicalJson({
        rootSeed: input.rootSeed,
        participantId: input.participantId,
        turnOrdinal: input.turnOrdinal,
        offerIndex: input.offerIndex,
        cardIndex: input.cardIndex,
        playerId,
        seasonKey,
      }),
    )}`,
  );
  return {
    cardId,
    offerId: input.offerId,
    cardIndex: input.cardIndex,
    slot: input.slot,
    tier,
    source: {
      playerId,
      playerVersionId: null,
      displayName: `Player ${playerId}`,
      franchiseId: null,
      eraId: null,
      seasonKey,
      positions: [input.slot],
      originalOverall: 70 + input.cardIndex,
      overallSource: 'catalog',
      profile: { ratings, tendencies },
      physical: { heightInches: 78, weightLbs: 200 },
    },
    mutations: [{ mutationId: 'sniper-gene' }],
    effective: {
      ratings,
      tendencies,
      physical: {
        baselineHeightInches: 78,
        baselineHeightSource: 'source',
        heightInches: 78,
        weightLbs: 200,
        wingspanDeltaInches: 0,
        reachUnits: 0,
      },
      authoritativeChannels: [],
    },
    nickname: `${playerId} ${input.slot}`,
  };
}

function syntheticHavocOffer(input: {
  rootSeed: string;
  participantId: HavocMultiplayerParticipantId;
  turnOrdinal: number;
  offerIndex: number;
}): HavocDraftOffer {
  const roundIndex = Math.floor(input.turnOrdinal / 2);
  const slot = POSITIONS[roundIndex];
  if (slot === undefined) {
    throw new Error(`in-memory havoc multiplayer: turn ${String(input.turnOrdinal)} has no slot`);
  }
  const offerId = havocOfferIdSchema.parse(`hvo-${seasonDigestHex(canonicalJson({ ...input }))}`);
  return havocDraftOfferSchema.parse({
    offerId,
    offerIndex: input.offerIndex,
    round: roundIndex + 1,
    slot,
    cards: [0, 1, 2].map((cardIndex) => syntheticHavocCard({ ...input, cardIndex, offerId, slot })),
  });
}

function idleMember(participantId: HavocMultiplayerParticipantId): HavocMultiplayerMemberSnapshot {
  return {
    participantId,
    displayName: participantId === 'p1' ? 'Host' : 'Guest',
    online: false,
    ready: false,
    nextGameReady: null,
  };
}

function memberWith(
  snapshot: HavocMultiplayerRoomSnapshot,
  participantId: HavocMultiplayerParticipantId,
  patch: Partial<HavocMultiplayerMemberSnapshot>,
): HavocMultiplayerRoomSnapshot {
  return {
    ...snapshot,
    members: snapshot.members.map((member) =>
      member.participantId === participantId ? { ...member, ...patch } : member,
    ),
  };
}

function withSeriesGame(
  snapshot: HavocMultiplayerRoomSnapshot,
  gameNumber: number,
  update: (game: HavocMultiplayerSeriesGame) => HavocMultiplayerSeriesGame,
): HavocMultiplayerRoomSnapshot {
  const series = snapshot.series;
  if (!series) return snapshot;
  return {
    ...snapshot,
    series: havocMultiplayerSeriesSnapshotSchema.parse({
      ...series,
      games: series.games.map((game) => (game.gameNumber === gameNumber ? update(game) : game)),
    }),
  };
}

function currentGameNumberOf(series: HavocMultiplayerSeriesSnapshot): number | null {
  return series.games.find((game) => game.status !== 'verified')?.gameNumber ?? null;
}

function createHavocSeries(rootSeed: string): HavocMultiplayerSeriesSnapshot {
  const homeWinner = havocMultiplayerHomeWinnerFor(rootSeed);
  return havocMultiplayerSeriesSnapshotSchema.parse({
    wins: { p1: 0, p2: 0 },
    games: Array.from({ length: HAVOC_MULTIPLAYER_SERIES_GAMES }, (_, index) => {
      const gameNumber = index + 1;
      const homeParticipantId = havocMultiplayerHomeForGame(homeWinner, gameNumber);
      return {
        gameNumber,
        homeParticipantId,
        awayParticipantId: otherParticipant(homeParticipantId),
        status: 'scheduled',
        winner: null,
        inputDigest: null,
        resultDigest: null,
        tapeDigest: null,
      };
    }),
    champion: null,
  });
}

interface FallbackCommitment {
  cursor: string;
  participantId: HavocMultiplayerParticipantId;
  turnOrdinal: number;
  payload: HavocMultiplayerCommandPayload;
}

interface GameProposal {
  gameNumber: number;
  winner: HavocMultiplayerParticipantId;
  inputDigest: string;
  resultDigest: string;
  tapeDigest: string;
}

interface GameConfirmation {
  gameNumber: number;
  verified: boolean;
  inputDigest: string;
  resultDigest: string;
  tapeDigest: string;
}

interface CommandLogEntry {
  command: HavocMultiplayerCommand;
  revision: number;
}

interface RoomRecord {
  snapshot: HavocMultiplayerRoomSnapshot;
  commandLog: CommandLogEntry[];
  commandIds: Set<string>;
  payloadHashes: Map<string, string>;
  rootSeed: string;
  code: HavocMultiplayerRoomCode;
  codeExpiresAt: number;
  expiresAt: number;
  updatedAt: number;
  subscribers: Set<(snapshot: HavocMultiplayerRoomSnapshot) => void>;
  transientSubscribers: Set<(event: HavocMultiplayerTransientEvent) => void>;
  verificationChallenge: string | null;
  receipts: Map<string, HavocMultiplayerVerificationReceipt>;
  fallback: FallbackCommitment | null;
  proposals: Partial<Record<HavocMultiplayerParticipantId, GameProposal>>;
  confirmations: Partial<Record<HavocMultiplayerParticipantId, GameConfirmation>>;
  rematchRequests: Set<HavocMultiplayerParticipantId>;
}

type CreateInput = Omit<HavocMultiplayerRoomSettings, 'schemaVersion'> &
  Partial<Pick<HavocMultiplayerRoomSettings, 'schemaVersion'>>;

export interface InMemoryHavocMultiplayerTransport extends HavocMultiplayerTransport {
  expireRooms(): Promise<HavocMultiplayerRoomSnapshot[]>;
}

export function createInMemoryHavocMultiplayerTransport(options?: {
  clock?: () => number;
  seed?: string;
  rng?: () => number;
}): InMemoryHavocMultiplayerTransport {
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
    rejectionCode: HavocMultiplayerCommandRejectionCode,
    revision: number,
  ): HavocMultiplayerCommandReceipt {
    return {
      roomId: idSchema.parse(roomId),
      commandId: commandIdSchema.parse(commandId),
      accepted: false,
      rejectionCode,
      revision,
    };
  }

  function stageDraftDeadline(record: RoomRecord): void {
    const draft = record.snapshot.draft;
    if (!draft || draft.activeParticipantId === null) return;
    const deadline: HavocMultiplayerDeadline = {
      at: new Date(clock() + HAVOC_MULTIPLAYER_PICK_TIMEOUT_MS).toISOString(),
      cursor: `t${String(draft.turnOrdinal)}`,
      participantId: draft.activeParticipantId,
      fallback: null,
    };
    record.snapshot = { ...record.snapshot, deadline };
  }

  function applyDraftPick(record: RoomRecord, card: HavocDraftCard): void {
    const draft = record.snapshot.draft;
    if (!draft || draft.activeParticipantId === null || draft.offer === null) return;
    const seasonKey = card.source.seasonKey;
    if (seasonKey === null) return;
    const pick: HavocMultiplayerDraftPick = {
      turnOrdinal: draft.turnOrdinal,
      participantId: draft.activeParticipantId,
      slot: draft.offer.slot,
      claimKey: { playerId: card.source.playerId, seasonKey },
      card,
    };
    const picks = [...draft.picks, pick];
    const claimedPlayerIds = [...draft.claimedPlayerIds, card.source.playerId];
    record.fallback = null;
    if (picks.length >= HAVOC_MULTIPLAYER_TURNS) {
      record.snapshot = {
        ...record.snapshot,
        draft: havocMultiplayerDraftStateSchema.parse({
          ...draft,
          revision: draft.revision + 1,
          turnOrdinal: HAVOC_MULTIPLAYER_TURNS,
          activeParticipantId: null,
          offer: null,
          picks,
          claimedPlayerIds,
          status: 'complete',
        }),
        phase: 'lineup-showdown',
        deadline: null,
      };
      return;
    }
    const turnOrdinal = draft.turnOrdinal + 1;
    const activeParticipantId = pickerFor(draft.firstPicker, turnOrdinal);
    record.snapshot = {
      ...record.snapshot,
      draft: havocMultiplayerDraftStateSchema.parse({
        ...draft,
        revision: draft.revision + 1,
        turnOrdinal,
        activeParticipantId,
        offer: syntheticHavocOffer({
          rootSeed: record.rootSeed,
          participantId: activeParticipantId,
          turnOrdinal,
          offerIndex: 0,
        }),
        picks,
        claimedPlayerIds,
      }),
      deadline: null,
    };
    stageDraftDeadline(record);
  }

  function failRoom(record: RoomRecord): void {
    record.snapshot = {
      ...record.snapshot,
      phase: 'integrity-failed',
      deadline: null,
      broadcast: null,
    };
  }

  function verifySeriesGame(
    record: RoomRecord,
    gameNumber: number,
    confirmation: GameConfirmation,
  ): void {
    const series = record.snapshot.series;
    if (!series) return;
    const index = series.games.findIndex((game) => game.gameNumber === gameNumber);
    const game = series.games[index];
    if (!game || game.winner === null) return;
    const winner = game.winner;
    const recorded: HavocMultiplayerSeriesGame = {
      ...game,
      status: 'verified',
      winner,
      inputDigest: confirmation.inputDigest,
      resultDigest: confirmation.resultDigest,
      tapeDigest: confirmation.tapeDigest,
    };
    const wins =
      winner === 'p1'
        ? { p1: series.wins.p1 + 1, p2: series.wins.p2 }
        : { p1: series.wins.p1, p2: series.wins.p2 + 1 };
    const champion =
      wins.p1 >= HAVOC_MULTIPLAYER_SERIES_WINS
        ? 'p1'
        : wins.p2 >= HAVOC_MULTIPLAYER_SERIES_WINS
          ? 'p2'
          : null;
    const games = series.games.map((entry, entryIndex) =>
      entryIndex === index ? recorded : entry,
    );
    record.proposals = {};
    record.confirmations = {};
    record.snapshot = {
      ...record.snapshot,
      series: havocMultiplayerSeriesSnapshotSchema.parse({
        wins,
        games: champion === null ? games : games.slice(0, index + 1),
        champion,
      }),
      broadcast: null,
      phase: champion === null ? 'preparing-game' : 'championship',
    };
  }

  function resolveConfirmations(record: RoomRecord, gameNumber: number): void {
    const p1 = record.confirmations['p1'];
    const p2 = record.confirmations['p2'];
    if (!p1 || !p2 || p1.gameNumber !== gameNumber || p2.gameNumber !== gameNumber) return;
    if (
      p1.resultDigest === p2.resultDigest &&
      p1.inputDigest === p2.inputDigest &&
      p1.tapeDigest === p2.tapeDigest &&
      p1.verified &&
      p2.verified
    ) {
      verifySeriesGame(record, gameNumber, p1);
      return;
    }
    record.snapshot = withSeriesGame(record.snapshot, gameNumber, (game) => ({
      ...game,
      status: 'mismatch',
      inputDigest: p1.inputDigest,
      resultDigest: p1.resultDigest,
      tapeDigest: p1.tapeDigest,
    }));
    failRoom(record);
  }

  function hasIntegrityMismatch(record: RoomRecord): boolean {
    const receiptDigests = new Set(
      [...record.receipts.values()].map((receipt) => receipt.receiptDigest),
    );
    if (receiptDigests.size >= 2) return true;
    const p1 = record.confirmations['p1'];
    const p2 = record.confirmations['p2'];
    if (
      p1 &&
      p2 &&
      p1.gameNumber === p2.gameNumber &&
      (p1.resultDigest !== p2.resultDigest ||
        p1.inputDigest !== p2.inputDigest ||
        p1.tapeDigest !== p2.tapeDigest ||
        !p1.verified ||
        !p2.verified)
    ) {
      return true;
    }
    const byGame = new Map<number, Set<string>>();
    let denied = false;
    for (const entry of record.commandLog) {
      const payload = entry.command.payload;
      if (payload.kind !== 'propose-result' && payload.kind !== 'confirm-result') continue;
      const digests = byGame.get(payload.gameNumber) ?? new Set<string>();
      digests.add(payload.resultDigest);
      byGame.set(payload.gameNumber, digests);
      if (payload.kind === 'confirm-result' && !payload.verified) denied = true;
    }
    return denied && [...byGame.values()].some((digests) => digests.size >= 2);
  }

  function createRoomRecord(
    settingsInput: CreateInput,
    memberOnline?: { p1: boolean; p2: boolean },
  ): {
    snapshot: HavocMultiplayerRoomSnapshot;
    code: HavocMultiplayerRoomCode;
    membership: HavocMultiplayerRoomMembership;
  } {
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
    const settings = havocMultiplayerRoomSettingsSchema.parse({
      schemaVersion: settingsInput.schemaVersion ?? HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
      versions: settingsInput.versions,
    });
    const roomId = randomRoomIdWith(rng, useCrypto);
    const code = randomCodeWith(new Set(codeIndex.keys()), rng);
    const rootSeed = randomSeedWith(rng, useCrypto);
    const snapshot = havocMultiplayerRoomSnapshotSchema.parse({
      roomId,
      code,
      phase: 'lobby',
      revision: 0,
      settings,
      members: [
        { ...idleMember('p1'), online: memberOnline?.p1 ?? true },
        { ...idleMember('p2'), online: memberOnline?.p2 ?? false },
      ],
      draft: null,
      series: null,
      broadcast: null,
      deadline: null,
      successorRoomId: null,
    });
    const record: RoomRecord = {
      snapshot,
      commandLog: [],
      commandIds: new Set(),
      payloadHashes: new Map(),
      rootSeed,
      code,
      codeExpiresAt: now + HAVOC_MULTIPLAYER_CODE_TTL_MS,
      expiresAt: now + HAVOC_MULTIPLAYER_ROOM_RETENTION_MS,
      updatedAt: now,
      subscribers: new Set(),
      transientSubscribers: new Set(),
      verificationChallenge: null,
      receipts: new Map(),
      fallback: null,
      proposals: {},
      confirmations: {},
      rematchRequests: new Set(),
    };
    rooms.set(roomId, record);
    codeIndex.set(code, roomId);
    return { snapshot, code, membership: { roomId, participantId: 'p1', code } };
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

  function applyCommand(command: HavocMultiplayerCommand): HavocMultiplayerCommandReceipt {
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
        'unknown-command',
        record.snapshot.revision,
      );
    }
    const commandId = commandIdParsed.data;
    const payloadHash = canonicalJson(command.payload);
    const existing = record.commandLog.find((entry) => entry.command.commandId === commandId);
    if (existing) {
      if (existing.command.actorParticipantId !== command.actorParticipantId) {
        return rejection(command.roomId, commandId, 'not-a-member', record.snapshot.revision);
      }
      if (record.payloadHashes.get(commandId) !== payloadHash) {
        return rejection(command.roomId, commandId, 'command-conflict', record.snapshot.revision);
      }
      return {
        roomId: record.snapshot.roomId,
        commandId,
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
    const parsed = havocMultiplayerCommandPayloadSchema.safeParse(command.payload);
    if (!parsed.success) {
      return rejection(command.roomId, commandId, 'unknown-command', record.snapshot.revision);
    }
    const payload = parsed.data;
    const actor = command.actorParticipantId;
    const phase = record.snapshot.phase;
    if (phase === 'expired') {
      return rejection(command.roomId, commandId, 'expired', record.snapshot.revision);
    }
    if (phase === 'integrity-failed') {
      return rejection(command.roomId, commandId, 'invalid-phase', record.snapshot.revision);
    }
    if (payload.kind === 'ready') {
      if (phase !== 'lobby') {
        return rejection(command.roomId, commandId, 'invalid-phase', record.snapshot.revision);
      }
      record.snapshot = memberWith(record.snapshot, actor, { ready: true });
    } else if (payload.kind === 'start') {
      if (phase !== 'lobby') {
        return rejection(command.roomId, commandId, 'invalid-phase', record.snapshot.revision);
      }
      if (actor !== 'p1') {
        return rejection(command.roomId, commandId, 'not-a-member', record.snapshot.revision);
      }
      if (!record.snapshot.members.every((member) => member.online)) {
        return rejection(command.roomId, commandId, 'invalid-phase', record.snapshot.revision);
      }
      const firstPicker = havocMultiplayerFirstPickerFor(record.rootSeed);
      record.snapshot = {
        ...record.snapshot,
        phase: 'drafting',
        draft: havocMultiplayerDraftStateSchema.parse({
          schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
          revision: 0,
          rootSeed: seedSchema.parse(record.rootSeed),
          firstPicker,
          turnOrdinal: 0,
          activeParticipantId: firstPicker,
          offer: syntheticHavocOffer({
            rootSeed: record.rootSeed,
            participantId: firstPicker,
            turnOrdinal: 0,
            offerIndex: 0,
          }),
          rerollsUsed: { p1: 0, p2: 0 },
          picks: [],
          claimedPlayerIds: [],
          status: 'drafting',
        }),
        series: createHavocSeries(record.rootSeed),
        deadline: null,
      };
      stageDraftDeadline(record);
    } else if (payload.kind === 'pick') {
      const draft = record.snapshot.draft;
      if (phase !== 'drafting' || !draft || draft.status !== 'drafting' || draft.offer === null) {
        return rejection(command.roomId, commandId, 'invalid-phase', record.snapshot.revision);
      }
      if (payload.turnOrdinal !== draft.turnOrdinal || actor !== draft.activeParticipantId) {
        return rejection(command.roomId, commandId, 'wrong-turn', record.snapshot.revision);
      }
      if (payload.offerId !== draft.offer.offerId) {
        return rejection(command.roomId, commandId, 'offer-mismatch', record.snapshot.revision);
      }
      const card = draft.offer.cards.find((candidate) => candidate.cardId === payload.cardId);
      if (card === undefined) {
        return rejection(command.roomId, commandId, 'card-unavailable', record.snapshot.revision);
      }
      if (
        payload.claimKey.playerId !== card.source.playerId ||
        payload.claimKey.seasonKey !== card.source.seasonKey
      ) {
        return rejection(command.roomId, commandId, 'offer-mismatch', record.snapshot.revision);
      }
      if (draft.claimedPlayerIds.includes(card.source.playerId)) {
        return rejection(command.roomId, commandId, 'claim-taken', record.snapshot.revision);
      }
      applyDraftPick(record, card);
    } else if (payload.kind === 'reroll') {
      const draft = record.snapshot.draft;
      if (phase !== 'drafting' || !draft || draft.status !== 'drafting' || draft.offer === null) {
        return rejection(command.roomId, commandId, 'invalid-phase', record.snapshot.revision);
      }
      if (payload.turnOrdinal !== draft.turnOrdinal || actor !== draft.activeParticipantId) {
        return rejection(command.roomId, commandId, 'wrong-turn', record.snapshot.revision);
      }
      if (payload.offerId !== draft.offer.offerId) {
        return rejection(command.roomId, commandId, 'offer-mismatch', record.snapshot.revision);
      }
      if (draft.rerollsUsed[actor] >= HAVOC_MULTIPLAYER_REROLLS_PER_PARTICIPANT) {
        return rejection(command.roomId, commandId, 'reroll-unavailable', record.snapshot.revision);
      }
      const rerollsUsed: HavocMultiplayerDraftState['rerollsUsed'] =
        actor === 'p1' ? { p1: 1, p2: draft.rerollsUsed.p2 } : { p1: draft.rerollsUsed.p1, p2: 1 };
      record.fallback = null;
      record.snapshot = {
        ...record.snapshot,
        draft: havocMultiplayerDraftStateSchema.parse({
          ...draft,
          revision: draft.revision + 1,
          offer: syntheticHavocOffer({
            rootSeed: record.rootSeed,
            participantId: actor,
            turnOrdinal: draft.turnOrdinal,
            offerIndex: 1,
          }),
          rerollsUsed,
        }),
        deadline: record.snapshot.deadline ? { ...record.snapshot.deadline, fallback: null } : null,
      };
    } else if (payload.kind === 'timeout-pick') {
      const draft = record.snapshot.draft;
      const deadline = record.snapshot.deadline;
      if (phase !== 'drafting' || !draft || draft.status !== 'drafting' || draft.offer === null) {
        return rejection(command.roomId, commandId, 'invalid-phase', record.snapshot.revision);
      }
      if (!deadline || clock() < Date.parse(deadline.at)) {
        return rejection(command.roomId, commandId, 'deadline-passed', record.snapshot.revision);
      }
      if (
        payload.turnOrdinal !== draft.turnOrdinal ||
        actor !== deadline.participantId ||
        actor !== draft.activeParticipantId
      ) {
        return rejection(command.roomId, commandId, 'wrong-turn', record.snapshot.revision);
      }
      const commitment = record.fallback;
      if (
        !commitment ||
        commitment.cursor !== deadline.cursor ||
        commitment.turnOrdinal !== payload.turnOrdinal ||
        commandId !== `timeout-${deadline.cursor}`
      ) {
        return rejection(command.roomId, commandId, 'command-conflict', record.snapshot.revision);
      }
      if (payload.offerId !== draft.offer.offerId) {
        return rejection(command.roomId, commandId, 'offer-mismatch', record.snapshot.revision);
      }
      const card = draft.offer.cards.find((candidate) => candidate.cardId === payload.cardId);
      if (card === undefined || canonicalJson(commitment.payload) !== payloadHash) {
        return rejection(command.roomId, commandId, 'command-conflict', record.snapshot.revision);
      }
      if (draft.claimedPlayerIds.includes(card.source.playerId)) {
        return rejection(command.roomId, commandId, 'claim-taken', record.snapshot.revision);
      }
      if (card.source.seasonKey === null) {
        return rejection(command.roomId, commandId, 'card-unavailable', record.snapshot.revision);
      }
      applyDraftPick(record, card);
    } else if (payload.kind === 'ready-next-game') {
      const series = record.snapshot.series;
      const current = series ? currentGameNumberOf(series) : null;
      if (
        !series ||
        current === null ||
        (phase !== 'lineup-showdown' && phase !== 'preparing-game' && phase !== 'game-results')
      ) {
        return rejection(command.roomId, commandId, 'invalid-phase', record.snapshot.revision);
      }
      if (payload.gameNumber !== current) {
        return rejection(command.roomId, commandId, 'wrong-turn', record.snapshot.revision);
      }
      record.snapshot = memberWith(record.snapshot, actor, {
        nextGameReady: payload.gameNumber,
      });
      if (phase !== 'preparing-game') {
        record.snapshot = { ...record.snapshot, phase: 'preparing-game' };
      }
      record.snapshot = withSeriesGame(record.snapshot, payload.gameNumber, (game) =>
        game.status === 'scheduled' ? { ...game, status: 'ready' } : game,
      );
    } else if (payload.kind === 'broadcast-start') {
      const series = record.snapshot.series;
      const current = series ? currentGameNumberOf(series) : null;
      if (!series || current === null || phase !== 'preparing-game') {
        return rejection(command.roomId, commandId, 'invalid-phase', record.snapshot.revision);
      }
      if (payload.gameNumber !== current) {
        return rejection(command.roomId, commandId, 'wrong-turn', record.snapshot.revision);
      }
      const readyCount = record.snapshot.members.filter(
        (member) => member.nextGameReady === payload.gameNumber,
      ).length;
      if (readyCount < 2) {
        const autoStart =
          payload.auto === true &&
          clock() - record.updatedAt >= HAVOC_MULTIPLAYER_GAME_READY_TIMEOUT_MS;
        if (!autoStart) {
          return rejection(command.roomId, commandId, 'deadline-passed', record.snapshot.revision);
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
          durationMs: HAVOC_MULTIPLAYER_BROADCAST_MS,
          startedAt: nowIsoWith(clock),
        },
        members: record.snapshot.members.map((member) => ({
          ...member,
          nextGameReady: null,
        })),
      };
      record.snapshot = withSeriesGame(record.snapshot, payload.gameNumber, (game) => ({
        ...game,
        status: 'broadcast',
      }));
    } else if (payload.kind === 'propose-result') {
      const series = record.snapshot.series;
      const current = series ? currentGameNumberOf(series) : null;
      if (!series || current === null || (phase !== 'broadcasting' && phase !== 'game-results')) {
        return rejection(command.roomId, commandId, 'invalid-phase', record.snapshot.revision);
      }
      if (payload.gameNumber !== current) {
        return rejection(command.roomId, commandId, 'wrong-turn', record.snapshot.revision);
      }
      record.proposals = {
        ...record.proposals,
        [actor]: {
          gameNumber: payload.gameNumber,
          winner: payload.winner,
          inputDigest: payload.inputDigest,
          resultDigest: payload.resultDigest,
          tapeDigest: payload.tapeDigest,
        },
      };
      record.snapshot = {
        ...record.snapshot,
        phase: phase === 'broadcasting' ? 'game-results' : phase,
      };
      record.snapshot = withSeriesGame(record.snapshot, payload.gameNumber, (game) => ({
        ...game,
        status: 'proposed',
        winner: payload.winner,
        inputDigest: payload.inputDigest,
        resultDigest: payload.resultDigest,
        tapeDigest: payload.tapeDigest,
      }));
    } else if (payload.kind === 'confirm-result') {
      const series = record.snapshot.series;
      const current = series ? currentGameNumberOf(series) : null;
      if (!series || current === null || (phase !== 'broadcasting' && phase !== 'game-results')) {
        return rejection(command.roomId, commandId, 'invalid-phase', record.snapshot.revision);
      }
      if (payload.gameNumber !== current) {
        return rejection(command.roomId, commandId, 'wrong-turn', record.snapshot.revision);
      }
      const hasProposal = record.commandLog.some(
        (entry) =>
          entry.command.payload.kind === 'propose-result' &&
          entry.command.payload.gameNumber === payload.gameNumber &&
          entry.command.payload.resultDigest === payload.resultDigest,
      );
      if (!hasProposal) {
        return rejection(command.roomId, commandId, 'command-conflict', record.snapshot.revision);
      }
      record.confirmations = {
        ...record.confirmations,
        [actor]: {
          gameNumber: payload.gameNumber,
          verified: payload.verified,
          inputDigest: payload.inputDigest,
          resultDigest: payload.resultDigest,
          tapeDigest: payload.tapeDigest,
        },
      };
      record.snapshot = {
        ...record.snapshot,
        phase: phase === 'broadcasting' ? 'game-results' : phase,
      };
      resolveConfirmations(record, payload.gameNumber);
    } else if (payload.kind === 'rematch-request') {
      if (phase !== 'championship') {
        return rejection(command.roomId, commandId, 'invalid-phase', record.snapshot.revision);
      }
      record.rematchRequests.add(actor);
    } else if (payload.kind === 'rematch-confirm') {
      if (phase !== 'championship') {
        return rejection(command.roomId, commandId, 'invalid-phase', record.snapshot.revision);
      }
      if (
        record.snapshot.successorRoomId === null &&
        ![...record.rematchRequests].some((requester) => requester !== actor)
      ) {
        return rejection(command.roomId, commandId, 'command-conflict', record.snapshot.revision);
      }
      if (record.snapshot.successorRoomId === null) {
        const successor = createRoomRecord(
          { versions: record.snapshot.settings.versions },
          {
            p1:
              record.snapshot.members.find((member) => member.participantId === 'p1')?.online ??
              true,
            p2:
              record.snapshot.members.find((member) => member.participantId === 'p2')?.online ??
              false,
          },
        );
        record.snapshot = {
          ...record.snapshot,
          successorRoomId: successor.snapshot.roomId,
        };
      }
    } else {
      record.snapshot = memberWith(record.snapshot, actor, { online: false });
    }
    const revision = record.snapshot.revision + 1;
    record.commandLog.push({
      command: {
        schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
        roomId: record.snapshot.roomId,
        commandId,
        actorParticipantId: actor,
        payload,
      },
      revision,
    });
    record.commandIds.add(commandId);
    record.payloadHashes.set(commandId, payloadHash);
    record.snapshot = { ...record.snapshot, revision };
    record.updatedAt = clock();
    emit(record);
    return {
      roomId: record.snapshot.roomId,
      commandId,
      accepted: true,
      rejectionCode: null,
      revision,
    };
  }

  return {
    async create(settingsInput) {
      await Promise.resolve();
      return createRoomRecord(settingsInput);
    },
    async preview(code) {
      await Promise.resolve();
      pruneExpiredCodes();
      const roomId = codeIndex.get(code);
      const record = roomId === undefined ? undefined : rooms.get(roomId);
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
      const record = roomId === undefined ? undefined : rooms.get(roomId);
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
      if (
        record.snapshot.phase === 'championship' ||
        record.snapshot.phase === 'integrity-failed'
      ) {
        throw Object.assign(new Error('room-full'), {
          code: 'room-full',
          retryable: false,
        });
      }
      record.snapshot = memberWith(record.snapshot, 'p2', { online: true });
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
      const parsed = havocMultiplayerTransientEventSchema.safeParse(event);
      if (!parsed.success) return Promise.resolve(false);
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
    async refetch(roomId, afterRevision) {
      await Promise.resolve();
      const record = recordFor(roomId);
      return record.commandLog
        .filter((entry) => entry.revision > afterRevision)
        .map((entry) => entry.command);
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
      const parsed = havocMultiplayerVerificationReceiptSchema.safeParse(receipt);
      if (!parsed.success) {
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
      const parsed = havocMultiplayerCommandPayloadSchema.safeParse(payload);
      const draft = record.snapshot.draft;
      const timeoutPick =
        parsed.success && parsed.data.kind === 'timeout-pick' ? parsed.data : null;
      if (
        !timeoutPick ||
        !draft ||
        draft.offer === null ||
        timeoutPick.turnOrdinal !== draft.turnOrdinal ||
        timeoutPick.offerId !== draft.offer.offerId ||
        !draft.offer.cards.some((card) => card.cardId === timeoutPick.cardId)
      ) {
        throw Object.assign(
          new Error('commit-fallback: payload must match the deadline timeout-pick'),
          { code: 'illegal-move', retryable: false },
        );
      }
      record.fallback = {
        cursor,
        participantId: deadline.participantId,
        turnOrdinal: timeoutPick.turnOrdinal,
        payload: timeoutPick,
      };
      record.snapshot = {
        ...record.snapshot,
        deadline: { ...deadline, fallback: timeoutPick },
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
      if (clock() < Date.parse(deadline.at)) return null;
      const commitment = record.fallback;
      if (!commitment || commitment.cursor !== deadline.cursor) return null;
      const commandId = commandIdSchema.parse(`timeout-${deadline.cursor}`);
      if (record.commandIds.has(commandId)) return null;
      return applyCommand({
        schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
        roomId: record.snapshot.roomId,
        commandId,
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
      const nextCode = randomCodeWith(
        new Set([...codeIndex.keys()].filter((code) => code !== record.code)),
        rng,
      );
      codeIndex.delete(record.code);
      codeIndex.set(nextCode, record.snapshot.roomId);
      record.code = nextCode;
      record.codeExpiresAt = clock() + HAVOC_MULTIPLAYER_CODE_TTL_MS;
      record.snapshot = memberWith(record.snapshot, 'p2', idleMember('p2'));
      record.snapshot = {
        ...record.snapshot,
        code: nextCode,
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
      await Promise.resolve();
      const record = recordFor(roomId);
      if (record.snapshot.phase !== 'championship') {
        throw Object.assign(new Error('phase'), { code: 'phase', retryable: false });
      }
      if (record.snapshot.successorRoomId) {
        const successor = recordFor(record.snapshot.successorRoomId);
        return { snapshot: successor.snapshot, code: successor.code };
      }
      const created = createRoomRecord(
        { versions: record.snapshot.settings.versions },
        {
          p1:
            record.snapshot.members.find((member) => member.participantId === 'p1')?.online ?? true,
          p2:
            record.snapshot.members.find((member) => member.participantId === 'p2')?.online ??
            false,
        },
      );
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
      record.updatedAt = clock();
      return { completed: true, phase: record.snapshot.phase };
    },
    async fail(roomId) {
      await Promise.resolve();
      const record = recordFor(roomId);
      const phase = record.snapshot.phase;
      if (phase === 'integrity-failed') return { failed: true, phase };
      if (phase === 'expired') return { failed: false, phase };
      if (!hasIntegrityMismatch(record)) return { failed: false, phase };
      failRoom(record);
      record.updatedAt = clock();
      emit(record);
      return { failed: true, phase: record.snapshot.phase };
    },
    async expireRooms() {
      await Promise.resolve();
      const now = clock();
      const expired: HavocMultiplayerRoomSnapshot[] = [];
      pruneExpiredCodes();
      for (const record of rooms.values()) {
        if (record.expiresAt <= now && record.snapshot.phase !== 'expired') {
          record.snapshot = { ...record.snapshot, phase: 'expired', deadline: null };
          record.updatedAt = now;
          emit(record);
          expired.push(record.snapshot);
        }
      }
      return expired;
    },
  };
}
