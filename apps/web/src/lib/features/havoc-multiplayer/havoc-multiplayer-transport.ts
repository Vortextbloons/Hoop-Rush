import type { SupabaseClient } from '@supabase/supabase-js';
import {
  HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
  HAVOC_MULTIPLAYER_SERIES_GAMES,
  HAVOC_MULTIPLAYER_SERIES_WINS,
  commandIdSchema,
  havocMultiplayerBroadcastSchema,
  havocMultiplayerCommandPayloadSchema,
  havocMultiplayerCommandRejectionCodeSchema,
  havocMultiplayerCommandSchema,
  havocMultiplayerDeadlineSchema,
  havocMultiplayerPhaseSchema,
  havocMultiplayerRoomCodeSchema,
  havocMultiplayerRoomSettingsSchema,
  havocMultiplayerRoomSnapshotSchema,
  havocMultiplayerSeriesSnapshotSchema,
  havocMultiplayerTransientEventSchema,
  havocMultiplayerVariantSchema,
  havocMultiplayerVersionLocksSchema,
  havocMultiplayerVerificationReceiptSchema,
  idSchema,
  seedSchema,
  type HavocMultiplayerCommandReceipt,
  type HavocMultiplayerCommandRejectionCode,
  type HavocMultiplayerDraftState,
  type HavocMultiplayerParticipantId,
  type HavocMultiplayerRoomCode,
  type HavocMultiplayerRoomSnapshot,
  type HavocMultiplayerSeriesGame,
  type HavocMultiplayerSeriesSnapshot,
  type HavocMultiplayerTransientEvent,
  type HavocMultiplayerTransport,
  type Id,
} from '@hoop-rush/data-contracts';
import { randomBytes, randomUUID } from '#lib/ids.js';
import {
  createInMemoryHavocMultiplayerTransport,
  havocMultiplayerHomeForGame,
} from '@hoop-rush/application/havoc-multiplayer';
import { replayHavocMultiplayerDraft } from '@hoop-rush/engine';
import {
  cachedRoomTransport,
  commitRoomFallback,
  createRealtimeRoomRegistry,
  createRoomClientFactory,
  fetchRoomRows,
  parseRoomCommandRows,
  readRoomParticipant,
  readRoomSync,
  ensureAnonymous,
  parseRoomCode,
  publishTransientPayload,
  resolveRoomTimeout,
  rpcChallenge,
  rpcCommandResult,
  stringField,
  submitRoomVerification,
  subscribeTransientPayloads,
} from '#lib/supabase-runtime.js';
import {
  loadHavocMultiplayerDraftAssets,
  type HavocMultiplayerDraftAssets,
} from './havoc-multiplayer-assets';

type HavocMultiplayerClient = SupabaseClient;

interface HavocMultiplayerRoomRow {
  id: Id;
  code: string | null;
  code_active: boolean;
  versions: unknown;
  variant: unknown;
  root_seed: string;
  phase: string;
  revision: number;
  command_count: number;
  result_digest: string | null;
  confirmed_digest: string | null;
  successor_room_id: string | null;
  deadline_at: string | null;
  deadline_cursor: string | null;
  deadline_participant: string | null;
  deadline_fallback: unknown;
  deadline_pick_ordinal: number | null;
  draft_state: unknown;
  series: unknown;
  broadcast: unknown;
  game_state: unknown;
  created_at: string;
  expires_at: string;
}

interface HavocMultiplayerMemberRow {
  participant_id: string;
  online: boolean;
  ready: boolean;
  next_game_ready: number;
  locked: boolean;
  last_seen_at: string | null;
}

interface HavocMultiplayerCommandRow {
  command_id: string;
  ordinal: number;
  actor_participant_id: string;
  payload: unknown;
}

interface ServerDraftState {
  turn_ordinal: number;
  first_picker: HavocMultiplayerParticipantId;
}

interface ServerSeriesGame {
  gameNumber: number;
  winner: HavocMultiplayerParticipantId;
  inputDigest: string;
  resultDigest: string;
  tapeDigest: string;
}

interface ServerSeries {
  homeParticipantId: HavocMultiplayerParticipantId;
  games: ServerSeriesGame[];
}

const ROOM_COLUMNS =
  'id, code, code_active, versions, variant, root_seed, phase, revision, command_count, result_digest, confirmed_digest, successor_room_id, deadline_at, deadline_cursor, deadline_participant, deadline_fallback, deadline_pick_ordinal, draft_state, series, broadcast, game_state, created_at, expires_at';
const MEMBER_COLUMNS = 'participant_id, online, ready, next_game_ready, locked, last_seen_at';
const COMMAND_COLUMNS = 'command_id, ordinal, actor_participant_id, payload';
const MEMBERS_TABLE = 'havoc_multiplayer_room_members';
const COMMANDS_TABLE = 'havoc_multiplayer_room_commands';

function participantOf(value: unknown): HavocMultiplayerParticipantId | null {
  return value === 'p1' || value === 'p2' ? value : null;
}

function memberFallback(participantId: HavocMultiplayerParticipantId) {
  return {
    participantId,
    displayName: participantId === 'p1' ? 'Host' : 'Guest',
    online: false,
    ready: false,
    nextGameReady: null,
  };
}

function serverDraftStateOf(value: unknown): ServerDraftState | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const turnOrdinal = record['turn_ordinal'];
  const firstPicker = participantOf(record['first_picker']);
  if (typeof turnOrdinal !== 'number' || !Number.isInteger(turnOrdinal)) return null;
  if (firstPicker === null) return null;
  return { turn_ordinal: turnOrdinal, first_picker: firstPicker };
}

function serverSeriesOf(value: unknown): ServerSeries | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const homeParticipantId = participantOf(record['homeParticipantId']);
  if (homeParticipantId === null) return null;
  const rawGames = Array.isArray(record['games']) ? record['games'] : [];
  const games: ServerSeriesGame[] = [];
  for (const rawGame of rawGames) {
    if (typeof rawGame !== 'object' || rawGame === null) continue;
    const game = rawGame as Record<string, unknown>;
    const winner = participantOf(game['winner']);
    if (
      typeof game['gameNumber'] !== 'number' ||
      winner === null ||
      typeof game['inputDigest'] !== 'string' ||
      typeof game['resultDigest'] !== 'string' ||
      typeof game['tapeDigest'] !== 'string'
    ) {
      continue;
    }
    games.push({
      gameNumber: game['gameNumber'],
      winner,
      inputDigest: game['inputDigest'],
      resultDigest: game['resultDigest'],
      tapeDigest: game['tapeDigest'],
    });
  }
  return { homeParticipantId, games };
}

function seriesSnapshotOf(
  server: ServerSeries | null,
  phase: string,
  broadcastGameNumber: number | null,
  readyGames: ReadonlySet<number>,
): HavocMultiplayerSeriesSnapshot | null {
  if (server === null) return null;
  const verified = new Map<number, ServerSeriesGame>();
  for (const game of server.games) verified.set(game.gameNumber, game);
  const wins = { p1: 0, p2: 0 };
  const games: HavocMultiplayerSeriesGame[] = [];
  let championIndex = -1;
  for (let gameNumber = 1; gameNumber <= HAVOC_MULTIPLAYER_SERIES_GAMES; gameNumber += 1) {
    const home = havocMultiplayerHomeForGame(server.homeParticipantId, gameNumber);
    const away: HavocMultiplayerParticipantId = home === 'p1' ? 'p2' : 'p1';
    const recorded = verified.get(gameNumber);
    if (recorded !== undefined) {
      wins[recorded.winner] += 1;
      games.push({
        gameNumber,
        homeParticipantId: home,
        awayParticipantId: away,
        status: 'verified',
        winner: recorded.winner,
        inputDigest: recorded.inputDigest,
        resultDigest: recorded.resultDigest,
        tapeDigest: recorded.tapeDigest,
      });
      if (wins[recorded.winner] === HAVOC_MULTIPLAYER_SERIES_WINS && championIndex < 0) {
        championIndex = games.length - 1;
      }
      continue;
    }
    const status: HavocMultiplayerSeriesGame['status'] =
      phase === 'broadcasting' && broadcastGameNumber === gameNumber
        ? 'broadcast'
        : readyGames.has(gameNumber)
          ? 'ready'
          : 'scheduled';
    games.push({
      gameNumber,
      homeParticipantId: home,
      awayParticipantId: away,
      status,
      winner: null,
      inputDigest: null,
      resultDigest: null,
      tapeDigest: null,
    });
  }
  const champion =
    wins.p1 >= HAVOC_MULTIPLAYER_SERIES_WINS
      ? 'p1'
      : wins.p2 >= HAVOC_MULTIPLAYER_SERIES_WINS
        ? 'p2'
        : null;
  const sliced =
    champion !== null && championIndex >= 0 ? games.slice(0, championIndex + 1) : games;
  return havocMultiplayerSeriesSnapshotSchema.parse({ wins, games: sliced, champion });
}

function roomRowToSnapshot(
  row: HavocMultiplayerRoomRow,
  memberRows: readonly HavocMultiplayerMemberRow[],
  draft: HavocMultiplayerDraftState | null,
): HavocMultiplayerRoomSnapshot {
  const byId = new Map<
    HavocMultiplayerParticipantId,
    HavocMultiplayerRoomSnapshot['members'][number]
  >();
  for (const memberRow of memberRows) {
    const participantId = participantOf(memberRow.participant_id);
    if (participantId === null) continue;
    byId.set(participantId, {
      participantId,
      displayName: participantId === 'p1' ? 'Host' : 'Guest',
      online: memberRow.online,
      ready: memberRow.ready,
      nextGameReady: memberRow.next_game_ready === 0 ? null : memberRow.next_game_ready,
    });
  }
  const members: HavocMultiplayerRoomSnapshot['members'] = [
    byId.get('p1') ?? memberFallback('p1'),
    byId.get('p2') ?? memberFallback('p2'),
  ];
  const phase = havocMultiplayerPhaseSchema.parse(row.phase);
  const versions = havocMultiplayerVersionLocksSchema.parse(row.versions);
  const settings = havocMultiplayerRoomSettingsSchema.parse({
    schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
    variant: row.variant,
    versions,
  });
  let broadcast: HavocMultiplayerRoomSnapshot['broadcast'] = null;
  if (row.broadcast !== null && row.broadcast !== undefined) {
    const raw = row.broadcast as Record<string, unknown>;
    broadcast = havocMultiplayerBroadcastSchema.parse({
      gameNumber: raw['gameNumber'],
      durationMs: raw['durationMs'],
      startedAt: raw['startedAtIso'],
    });
  }
  let deadline: HavocMultiplayerRoomSnapshot['deadline'] = null;
  const deadlineParticipant = participantOf(row.deadline_participant);
  if (row.deadline_at !== null && row.deadline_cursor !== null && deadlineParticipant !== null) {
    const fallback = havocMultiplayerCommandPayloadSchema.safeParse(row.deadline_fallback);
    deadline = havocMultiplayerDeadlineSchema.parse({
      at: row.deadline_at,
      cursor: row.deadline_cursor,
      participantId: deadlineParticipant,
      fallback: fallback.success ? fallback.data : null,
    });
  }
  const readyGames = new Set(
    memberRows.map((memberRow) => memberRow.next_game_ready).filter((gameNumber) => gameNumber > 0),
  );
  const series = seriesSnapshotOf(
    serverSeriesOf(row.series),
    phase,
    broadcast?.gameNumber ?? null,
    readyGames,
  );
  return havocMultiplayerRoomSnapshotSchema.parse({
    roomId: idSchema.parse(row.id),
    code: row.code ?? '0000',
    phase,
    revision: row.revision,
    settings,
    members,
    draft,
    series,
    broadcast,
    deadline,
    successorRoomId: row.successor_room_id === null ? null : idSchema.parse(row.successor_room_id),
  });
}

interface RpcRoomPayload {
  room_id: Id;
  code: HavocMultiplayerRoomCode | null;
  participant_id?: HavocMultiplayerParticipantId;
}

function rpcPayload(value: unknown): RpcRoomPayload {
  const record = value as Record<string, unknown>;
  const participant = participantOf(record['participant_id']);
  const rawCode = record['code'];
  return {
    room_id: idSchema.parse(stringField(record, 'room_id')),
    code: typeof rawCode === 'string' ? havocMultiplayerRoomCodeSchema.parse(rawCode) : null,
    ...(participant === null ? {} : { participant_id: participant }),
  };
}

function mapRejectionCode(raw: string | undefined): HavocMultiplayerCommandRejectionCode | null {
  if (raw === undefined) return null;
  const direct = havocMultiplayerCommandRejectionCodeSchema.safeParse(raw);
  if (direct.success) return direct.data;
  switch (raw) {
    case 'phase':
      return 'invalid-phase';
    case 'turn':
      return 'wrong-turn';
    case 'membership':
    case 'authorization':
      return 'not-a-member';
    case 'expiry':
      return 'expired';
    case 'duplicate-command':
      return 'command-conflict';
    case 'not-ready':
      return 'invalid-phase';
    default:
      return 'unknown-command';
  }
}

const configuredTransportCache = new Map<string, HavocMultiplayerTransport>();

export interface HavocMultiplayerTransportOptions {
  url?: string;
  publishableKey?: string;
  storageKey?: string;
  loadDraftAssets?: () => Promise<HavocMultiplayerDraftAssets>;
}

export function getHavocMultiplayerTransport(options?: {
  url?: string;
  publishableKey?: string;
  storageKey?: string;
}): HavocMultiplayerTransport {
  return cachedRoomTransport(configuredTransportCache, options, createHavocMultiplayerTransport);
}

export function createHavocMultiplayerTransport(
  options?: HavocMultiplayerTransportOptions,
): HavocMultiplayerTransport {
  const clientFactory = createRoomClientFactory(options);
  if (clientFactory === null) {
    return createInMemoryHavocMultiplayerTransport({
      clock: Date.now,
      random: { bytes: randomBytes },
    });
  }
  const getClient = clientFactory;
  const loadDraftAssets = options?.loadDraftAssets ?? loadHavocMultiplayerDraftAssets;
  let replayedDraft: { key: string; draft: HavocMultiplayerDraftState } | null = null;
  let acceptedLog: { roomId: string; rows: HavocMultiplayerCommandRow[] } | null = null;
  async function draftFromRow(
    row: HavocMultiplayerRoomRow,
    client: HavocMultiplayerClient,
    acceptedCommands?: HavocMultiplayerCommandRow[],
  ): Promise<HavocMultiplayerDraftState | null> {
    const server = serverDraftStateOf(row.draft_state);
    if (server === null) return null;
    let commandRows = acceptedCommands;
    if (commandRows === undefined) {
      const commandsResponse = await client
        .from('havoc_multiplayer_room_commands')
        .select(COMMAND_COLUMNS)
        .eq('room_id', row.id)
        .order('ordinal', { ascending: true });
      if (commandsResponse.error) {
        throw new Error('draft failed: cannot read the accepted command log');
      }
      const commandData: unknown = commandsResponse.data;
      commandRows = (Array.isArray(commandData) ? commandData : []) as HavocMultiplayerCommandRow[];
    }
    const versions = havocMultiplayerVersionLocksSchema.parse(row.versions);
    const rootSeed = seedSchema.parse(row.root_seed);
    const variant = havocMultiplayerVariantSchema.parse(row.variant ?? 'standard');
    const commands = commandRows.map((command) =>
      havocMultiplayerCommandPayloadSchema.parse(command.payload),
    );
    const key = JSON.stringify([row.id, rootSeed, variant, versions, commands]);
    if (replayedDraft?.key === key) return replayedDraft.draft;
    const assets = await loadDraftAssets();
    const draft = replayHavocMultiplayerDraft({
      rootSeed,
      catalog: assets.catalog,
      environment: assets.environment,
      commands,
      settings: {
        variant,
        rulesVersion: versions.rulesVersion,
      },
    });
    replayedDraft = { key, draft };
    return draft;
  }
  async function fetchSnapshot(roomId: string): Promise<HavocMultiplayerRoomSnapshot> {
    const client = await getClient();
    const { room, members } = await fetchRoomRows({
      client,
      roomsTable: 'havoc_multiplayer_rooms',
      roomSelect: ROOM_COLUMNS,
      membersTable: MEMBERS_TABLE,
      membersSelect: MEMBER_COLUMNS,
      roomId,
    });
    const row = room as HavocMultiplayerRoomRow;
    const draft = await draftFromRow(row, client);
    return roomRowToSnapshot(row, members as HavocMultiplayerMemberRow[], draft);
  }
  const registry = createRealtimeRoomRegistry({
    label: 'Havoc Multiplayer',
    roomsTable: 'havoc_multiplayer_rooms',
    commandsTable: 'havoc_multiplayer_room_commands',
    topic: (roomId) => `havoc-multiplayer-room-${roomId}`,
    getClient,
  });
  const transientTopic = (roomId: string): string => `havoc-multiplayer:${roomId}`;
  return {
    async create(settingsInput) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('havoc_multiplayer_room_create', {
        p_versions: settingsInput.versions,
        p_variant: settingsInput.variant ?? 'standard',
      });
      if (response.error || !response.data) {
        throw new Error(`create failed: ${response.error?.message ?? 'unknown'}`);
      }
      const payload = rpcPayload(response.data);
      const snapshot = await fetchSnapshot(payload.room_id);
      if (!payload.code) throw new Error('create failed: room code missing');
      const code = payload.code;
      return {
        snapshot,
        code,
        membership: { roomId: payload.room_id, participantId: 'p1', code },
      };
    },
    async preview(code) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('havoc_multiplayer_room_preview', { p_code: code });
      if (response.error || !response.data)
        throw new Error(`invalid-code: ${response.error?.message ?? code}`);
      const record = response.data as unknown as Record<string, unknown>;
      const versions = havocMultiplayerVersionLocksSchema.parse(record['versions']);
      const variant = havocMultiplayerVariantSchema.parse(record['variant'] ?? 'standard');
      const phase = havocMultiplayerPhaseSchema.parse(
        typeof record['phase'] === 'string' ? record['phase'] : 'lobby',
      );
      const revision = typeof record['revision'] === 'number' ? record['revision'] : 0;
      return havocMultiplayerRoomSnapshotSchema.parse({
        roomId: idSchema.parse(stringField(record, 'room_id')),
        code: parseRoomCode(code, havocMultiplayerRoomCodeSchema),
        phase,
        revision,
        settings: havocMultiplayerRoomSettingsSchema.parse({
          schemaVersion: HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
          variant,
          versions,
        }),
        members: [memberFallback('p1'), memberFallback('p2')],
        draft: null,
        series: null,
        broadcast: null,
        deadline: null,
        successorRoomId: null,
      });
    },
    async join(code) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('havoc_multiplayer_room_join', { p_code: code });
      if (response.error || !response.data)
        throw new Error(`join failed: ${response.error?.message ?? code}`);
      const payload = rpcPayload(response.data);
      const snapshot = await fetchSnapshot(payload.room_id);
      const participantId: HavocMultiplayerParticipantId = payload.participant_id ?? 'p2';
      const membershipCode = parseRoomCode(code, havocMultiplayerRoomCodeSchema);
      return {
        snapshot,
        membership: { roomId: payload.room_id, participantId, code: membershipCode },
      };
    },
    async resume(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const snapshot = await fetchSnapshot(roomId);
      const participantId = await readRoomParticipant(client, MEMBERS_TABLE, roomId);
      return {
        snapshot,
        membership: { roomId: idSchema.parse(roomId), participantId, code: snapshot.code },
      };
    },
    async sync(roomId, afterOrdinal = -1) {
      const client = await getClient();
      const cached = acceptedLog?.roomId === roomId ? acceptedLog.rows : [];
      const cursor = afterOrdinal >= 0 && cached.length === afterOrdinal + 1 ? afterOrdinal : -1;
      let payload = await readRoomSync(client, 'havoc', roomId, cursor);
      let fullRows = [
        ...(cursor < 0 ? [] : cached),
        ...(payload.commands as unknown as HavocMultiplayerCommandRow[]),
      ];
      if (
        fullRows.length !== payload.room['command_count'] ||
        fullRows.some((command, ordinal) => command.ordinal !== ordinal)
      ) {
        payload = await readRoomSync(client, 'havoc', roomId, -1);
        fullRows = payload.commands as unknown as HavocMultiplayerCommandRow[];
        if (
          fullRows.length !== payload.room['command_count'] ||
          fullRows.some((command, ordinal) => command.ordinal !== ordinal)
        )
          throw new Error('room sync returned an incomplete command log');
      }
      const row = payload.room as unknown as HavocMultiplayerRoomRow;
      const members = payload.members as unknown as HavocMultiplayerMemberRow[];
      const rows = fullRows.filter((command) => command.ordinal > afterOrdinal);
      const commands = parseRoomCommandRows(
        rows,
        idSchema.parse(roomId),
        HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
        havocMultiplayerCommandSchema,
        false,
      );
      const draft = await draftFromRow(row, client, fullRows);
      acceptedLog = { roomId, rows: fullRows };
      return {
        snapshot: roomRowToSnapshot(row, members, draft),
        commands,
        commandCount: fullRows.length,
      };
    },
    subscribe(roomId, handler, onError) {
      return registry.subscribe(roomId, handler, onError);
    },
    subscribeTransient(roomId, handler) {
      return subscribeTransientPayloads({
        getClient,
        topic: transientTopic(roomId),
        event: 'transient',
        onPayload: (payload) => {
          const parsed = havocMultiplayerTransientEventSchema.safeParse(payload);
          if (!parsed.success) return;
          handler(parsed.data);
        },
      });
    },
    async publishTransient(roomId, event: HavocMultiplayerTransientEvent) {
      const parsed = havocMultiplayerTransientEventSchema.safeParse(event);
      if (!parsed.success) return false;
      return publishTransientPayload(getClient, transientTopic(roomId), 'transient', parsed.data);
    },
    async refetch(roomId, afterRevision) {
      const client = await getClient();
      await ensureAnonymous(client);
      const parsedRoomId = idSchema.parse(roomId);
      const response = await client
        .from(COMMANDS_TABLE)
        .select(COMMAND_COLUMNS)
        .eq('room_id', parsedRoomId)
        .gt('ordinal', afterRevision)
        .order('ordinal', { ascending: true });
      if (response.error) throw new Error(`refetch failed: ${response.error.message}`);
      return parseRoomCommandRows(
        response.data as unknown as HavocMultiplayerCommandRow[],
        parsedRoomId,
        HAVOC_MULTIPLAYER_SAVE_SCHEMA_VERSION,
        havocMultiplayerCommandSchema,
        false,
      );
    },
    async submitCommand(command) {
      const client = await getClient();
      await ensureAnonymous(client);
      const commandId = command.commandId || commandIdSchema.parse(randomUUID());
      const response = await client.rpc('havoc_multiplayer_command_submit', {
        p_room_id: command.roomId,
        p_command_id: commandId,
        p_expected_revision: command.expectedRevision ?? null,
        p_payload: command.payload,
      });
      if (response.error) throw new Error(`command failed: ${response.error.message}`);
      const result = rpcCommandResult(response.data);
      const accepted = result.accepted;
      const receipt: HavocMultiplayerCommandReceipt = {
        roomId: idSchema.parse(command.roomId),
        commandId: result.commandId ? commandIdSchema.parse(result.commandId) : commandId,
        accepted,
        rejectionCode: accepted
          ? null
          : (mapRejectionCode(result.rejectionCode) ?? 'unknown-command'),
        revision: result.revision ?? 0,
      };
      return receipt;
    },
    async verificationChallenge(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('havoc_multiplayer_verification_challenge', {
        p_room_id: roomId,
      });
      if (response.error)
        throw new Error(`verification challenge failed: ${response.error.message}`);
      return rpcChallenge(response.data);
    },
    async submitVerification(roomId, receipt, expectedRevision) {
      const client = await getClient();
      await ensureAnonymous(client);
      const parsed = havocMultiplayerVerificationReceiptSchema.parse(receipt);
      return submitRoomVerification({
        client,
        rpc: 'havoc_multiplayer_verification_submit',
        roomId,
        receipt: parsed,
        ownReceiptId: parsed.receiptId,
        expectedRevision,
      });
    },
    async commitFallback(roomId, cursor, payload, expectedRevision) {
      const client = await getClient();
      await ensureAnonymous(client);
      return commitRoomFallback({
        client,
        rpc: 'havoc_multiplayer_commit_fallback',
        roomId,
        cursor,
        payload,
        expectedRevision,
      });
    },
    async resolveTimeout(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const timeout = await resolveRoomTimeout({
        client,
        rpc: 'havoc_multiplayer_timeout_resolve',
        roomId,
        acceptedField: 'accepted',
      });
      return timeout === null
        ? null
        : {
            roomId: timeout.roomId,
            commandId: timeout.commandId,
            accepted: true,
            rejectionCode: null,
            revision: timeout.revision,
          };
    },
    async removeGuest(roomId, targetParticipantId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const commandId = commandIdSchema.parse(randomUUID());
      const response = await client.rpc('havoc_multiplayer_command_submit', {
        p_room_id: roomId,
        p_command_id: commandId,
        p_expected_revision: null,
        p_payload: { kind: 'remove-guest', targetParticipantId },
      });
      if (response.error) throw new Error(`remove-guest failed: ${response.error.message}`);
      const payload = rpcCommandResult(response.data);
      if (!payload.accepted) {
        throw new Error(`remove-guest failed: ${payload.rejectionCode ?? 'rejected'}`);
      }
      return fetchSnapshot(roomId);
    },
    async leave(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('havoc_multiplayer_leave', { p_room_id: roomId });
      if (response.error) throw new Error(`leave failed: ${response.error.message}`);
    },
    async rematch(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('havoc_multiplayer_rematch', { p_room_id: roomId });
      if (response.error || !response.data)
        throw new Error(`rematch failed: ${response.error?.message ?? 'unknown'}`);
      const payload = rpcPayload(response.data);
      const snapshot = await fetchSnapshot(payload.room_id);
      if (!payload.code) throw new Error('rematch failed: room code missing');
      return { snapshot, code: payload.code };
    },
    async complete(roomId, receiptId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('havoc_multiplayer_complete', {
        p_room_id: roomId,
        p_receipt_id: receiptId,
      });
      if (response.error || !response.data)
        throw new Error(`complete failed: ${response.error?.message ?? 'unknown'}`);
      const record = response.data as unknown as Record<string, unknown>;
      const phase = havocMultiplayerPhaseSchema.parse(
        typeof record['phase'] === 'string' ? record['phase'] : 'championship',
      );
      return { completed: record['completed'] === true, phase };
    },
    async fail(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('havoc_multiplayer_fail', { p_room_id: roomId });
      if (response.error || !response.data)
        throw new Error(`fail failed: ${response.error?.message ?? 'unknown'}`);
      const record = response.data as unknown as Record<string, unknown>;
      const phase = havocMultiplayerPhaseSchema.parse(
        typeof record['phase'] === 'string' ? record['phase'] : 'integrity-failed',
      );
      return { failed: record['failed'] === true, phase };
    },
  };
}
