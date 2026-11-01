import {
  commandIdSchema,
  DRAFT_DUEL_AUTOPICK_VERSION,
  draftDuelBroadcastSchema,
  draftDuelCommandPayloadSchema,
  draftDuelCommandSchema,
  draftDuelRoomCodeSchema,
  draftDuelRoomPhaseSchema,
  draftDuelRoomSettingsSchema,
  draftDuelRoomSnapshotSchema,
  draftDuelSeriesSnapshotSchema,
  draftDuelTransientEventSchema,
  draftDuelVerificationReceiptSchema,
  type DraftDuelCommandReceipt,
  type DraftDuelMemberSnapshot,
  type DraftDuelMultiplayerTransport,
  type DraftDuelParticipantId,
  type DraftDuelRoomCode,
  type DraftDuelRoomSnapshot,
  type DraftDuelTransientEvent,
  type Id,
} from '@hoop-rush/data-contracts';
import { randomBytes } from '#lib/ids.js';
import { createInMemoryDraftDuelTransport } from '@hoop-rush/application/draft-duel';
import {
  cachedRoomTransport,
  createRoomClientFactory,
  parseRoomCode,
  roomPreviewFields,
} from '#lib/supabase-runtime.js';
import { createRoomTransport, type RoomTransportOptions } from '#lib/room-transport.js';

interface DraftDuelRoomRow {
  id: Id;
  code: DraftDuelRoomCode | null;
  code_active: boolean;
  fairness: unknown;
  presentation: unknown;
  versions: unknown;
  phase: string;
  revision: number;
  command_count: number;
  result_digest: DraftDuelRoomSnapshot['resultDigest'];
  confirmed_digest: DraftDuelRoomSnapshot['confirmedDigest'];
  successor_room_id: DraftDuelRoomSnapshot['successorRoomId'];
  root_seed: NonNullable<DraftDuelRoomSnapshot['rootSeed']>;
  deadline_at: string | null;
  deadline_cursor: string | null;
  deadline_participant: string | null;
  deadline_fallback: unknown;
  deadline_pick_ordinal: number | null;
  series: unknown;
  broadcast: unknown;
  expires_at: string;
  created_at: string;
}

interface DraftDuelMemberRow {
  participant_id: string;
  online: boolean;
  ready: boolean;
  next_game_ready: number;
  locked: boolean;
  last_seen_at: string | null;
}

const ROOM_COLUMNS =
  'id, code, code_active, fairness, presentation, versions, phase, revision, command_count, result_digest, confirmed_digest, successor_room_id, root_seed, deadline_at, deadline_cursor, deadline_participant, deadline_fallback, deadline_pick_ordinal, series, broadcast, expires_at, created_at';
const MEMBER_COLUMNS = 'participant_id, online, ready, next_game_ready, locked, last_seen_at';
const COMMAND_COLUMNS = 'command_id, ordinal, actor_participant_id, payload';
const MEMBERS_TABLE = 'draft_duel_room_members';

type DraftDuelCreateInput = Parameters<DraftDuelMultiplayerTransport['create']>[0];

function memberFallback(participantId: DraftDuelParticipantId): DraftDuelMemberSnapshot {
  return {
    participantId,
    online: false,
    ready: false,
    nextGameReady: null,
    locked: false,
    lastSeenAt: null,
  };
}

function memberFromRow(row: DraftDuelMemberRow): DraftDuelMemberSnapshot | null {
  if (row.participant_id !== 'p1' && row.participant_id !== 'p2') return null;
  return {
    participantId: row.participant_id,
    online: row.online,
    ready: row.ready,
    nextGameReady: row.next_game_ready === 0 ? null : row.next_game_ready,
    locked: row.locked,
    lastSeenAt: row.last_seen_at,
  };
}

function roomRowToSnapshot(
  row: DraftDuelRoomRow,
  memberRows: DraftDuelMemberRow[],
): DraftDuelRoomSnapshot {
  const byId = new Map<DraftDuelParticipantId, DraftDuelMemberSnapshot>();
  for (const memberRow of memberRows) {
    const member = memberFromRow(memberRow);
    if (member) byId.set(member.participantId, member);
  }
  const members: DraftDuelRoomSnapshot['members'] = [
    byId.get('p1') ?? memberFallback('p1'),
    byId.get('p2') ?? memberFallback('p2'),
  ];
  const phase = draftDuelRoomPhaseSchema.parse(row.phase);
  let deadline: DraftDuelRoomSnapshot['deadline'] = null;
  if (row.deadline_at) {
    const fallback = draftDuelCommandPayloadSchema.safeParse(row.deadline_fallback);
    deadline = {
      roomId: row.id,
      cursor: row.deadline_cursor ?? 'lobby',
      participantId: row.deadline_participant === 'p2' ? 'p2' : 'p1',
      deadlineAt: row.deadline_at,
      fallback: fallback.success ? fallback.data : null,
      pickOrdinal: row.deadline_pick_ordinal ?? 0,
    };
  }
  const settings = draftDuelRoomSettingsSchema.parse({
    schemaVersion: 1,
    fairness: row.fairness,
    presentation: row.presentation,
    timerPolicyVersion: DRAFT_DUEL_AUTOPICK_VERSION,
    versions: row.versions,
  });
  const series =
    row.series === null || row.series === undefined
      ? null
      : draftDuelSeriesSnapshotSchema.parse(row.series);
  const broadcast =
    row.broadcast === null || row.broadcast === undefined
      ? null
      : draftDuelBroadcastSchema.parse(row.broadcast);
  return draftDuelRoomSnapshotSchema.parse({
    roomId: row.id,
    code: row.code,
    codeActive: row.code_active,
    settings,
    phase,
    revision: row.revision,
    commandCount: row.command_count,
    members,
    rootSeed: row.root_seed,
    deadline,
    series,
    broadcast,
    resultDigest: row.result_digest,
    confirmedDigest: row.confirmed_digest,
    successorRoomId: row.successor_room_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  });
}

function previewSnapshot(code: string, record: Record<string, unknown>): DraftDuelRoomSnapshot {
  const settings = draftDuelRoomSettingsSchema.parse({
    schemaVersion: 1,
    fairness: record['fairness'],
    presentation: record['presentation'],
    timerPolicyVersion: DRAFT_DUEL_AUTOPICK_VERSION,
    versions: record['versions'],
  });
  const phase = draftDuelRoomPhaseSchema.parse(
    typeof record['phase'] === 'string' ? record['phase'] : 'lobby',
  );
  const preview = roomPreviewFields(record);
  return {
    roomId: preview.roomId,
    code: parseRoomCode(code, draftDuelRoomCodeSchema),
    codeActive: true,
    settings,
    phase,
    revision: preview.revision,
    commandCount: 0,
    members: [memberFallback('p1'), memberFallback('p2')],
    rootSeed: null,
    deadline: null,
    series: null,
    broadcast: null,
    resultDigest: null,
    confirmedDigest: null,
    successorRoomId: null,
    expiresAt: preview.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    createdAt: preview.createdAt ?? new Date().toISOString(),
  };
}

const configuredTransportCache = new Map<string, DraftDuelMultiplayerTransport>();

export function getDraftDuelTransport(
  options?: RoomTransportOptions,
): DraftDuelMultiplayerTransport {
  return cachedRoomTransport(configuredTransportCache, options, createDraftDuelTransport);
}

export function createDraftDuelTransport(
  options?: RoomTransportOptions,
): DraftDuelMultiplayerTransport {
  const clientFactory = createRoomClientFactory(options);
  if (clientFactory === null) {
    return createInMemoryDraftDuelTransport({ clock: Date.now, random: { bytes: randomBytes } });
  }
  const getClient = clientFactory;
  return createRoomTransport(
    {
      label: 'Draft Duel',
      rpcPrefix: 'draft_duel',
      roomsTable: 'draft_duel_rooms',
      membersTable: MEMBERS_TABLE,
      commandsTable: 'draft_duel_room_commands',
      roomColumns: ROOM_COLUMNS,
      memberColumns: MEMBER_COLUMNS,
      commandColumns: COMMAND_COLUMNS,
      syncMode: 'draft-duel',
      topic: (roomId) => `draft-duel-room-${roomId}`,
      transientTopic: (roomId) => `draft-duel:${roomId}`,
      codeSchema: draftDuelRoomCodeSchema,
      commandSchema: draftDuelCommandSchema,
      commandSchemaVersion: 1,
      commandIncludeOrdinal: true,
      memberFallback,
      roomRowToSnapshot: (row, memberRows) =>
        roomRowToSnapshot(row as DraftDuelRoomRow, memberRows as DraftDuelMemberRow[]),
      previewSnapshot,
      createArgs: (settingsInput: DraftDuelCreateInput) => ({
        p_fairness: settingsInput.fairness,
        p_presentation: settingsInput.presentation,
        p_versions: settingsInput.versions,
      }),
      resumeCode: (snapshot) => snapshot.code ?? draftDuelRoomCodeSchema.parse('0000'),
      receipt: (command, result, commandId): DraftDuelCommandReceipt => ({
        roomId: command.roomId as Id,
        commandId: result.commandId ? commandIdSchema.parse(result.commandId) : commandId,
        ordinal: result.ordinal ?? -1,
        accepted: result.accepted,
        rejectionCode: result.rejectionCode ?? null,
        revision: result.revision ?? 0,
      }),
      receiptSchema: draftDuelVerificationReceiptSchema,
      verificationReceiptId: (receipt) => (receipt as { receiptDigest: string }).receiptDigest,
      timeoutAcceptedField: 'accepted',
      timeoutReceipt: (timeout) => ({ ...timeout, accepted: true, rejectionCode: null }),
      parsePhase: (value) => draftDuelRoomPhaseSchema.parse(value),
      completeFallbackPhase: 'championship',
      failFallbackPhase: 'championship',
      transientEventSchema: draftDuelTransientEventSchema,
      transientRoomId: (event: DraftDuelTransientEvent) => event.roomId,
    },
    getClient,
  );
}
