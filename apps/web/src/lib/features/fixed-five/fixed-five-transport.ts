import {
  fixedFiveCommandPayloadSchema,
  fixedFiveCommandSchema,
  fixedFiveRoomCodeSchema,
  fixedFiveRoomPhaseSchema,
  fixedFiveRoomSettingsSchema,
  fixedFiveRoomSnapshotSchema,
  fixedFiveVerificationReceiptSchema,
  type FixedFiveCommandReceipt,
  type FixedFiveMemberSnapshot,
  type FixedFiveMultiplayerTransport,
  type FixedFiveParticipantId,
  type FixedFiveRoomCode,
  type FixedFiveRoomSnapshot,
  type Id,
} from '@hoop-rush/data-contracts';
import { randomBytes } from '#lib/ids.js';
import { createInMemoryFixedFiveTransport } from '@hoop-rush/application/fixed-five';
import {
  cachedRoomTransport,
  createRoomClientFactory,
  parseRoomCode,
  roomPreviewFields,
} from '#lib/supabase-runtime.js';
import { createRoomTransport, type RoomTransportOptions } from '#lib/room-transport.js';

interface FixedFiveRoomRow {
  id: Id;
  code: FixedFiveRoomCode | null;
  code_active: boolean;
  mode: unknown;
  source_mode: unknown;
  variant: unknown;
  versions: unknown;
  phase: string;
  revision: number;
  command_count: number;
  digest: FixedFiveRoomSnapshot['digest'];
  result_digest: FixedFiveRoomSnapshot['resultDigest'];
  confirmed_digest: FixedFiveRoomSnapshot['confirmedDigest'];
  successor_room_id: FixedFiveRoomSnapshot['successorRoomId'];
  series: unknown;
  broadcast: unknown;
  game_state: unknown;
  root_seed: NonNullable<FixedFiveRoomSnapshot['rootSeed']>;
  deadline_at: string | null;
  deadline_cursor: string | null;
  deadline_participant: string | null;
  deadline_fallback: unknown;
  deadline_pick_ordinal: number | null;
  expires_at: string;
  created_at: string;
}

interface FixedFiveMemberRow {
  participant_id: string;
  online: boolean;
  ready: boolean;
  picks_committed: number;
  locked: boolean;
  next_game_ready: number | null;
  last_seen_at: string | null;
}

const ROOM_COLUMNS =
  'id, code, code_active, mode, source_mode, variant, versions, phase, revision, command_count, digest, result_digest, confirmed_digest, successor_room_id, series, broadcast, game_state, root_seed, deadline_at, deadline_cursor, deadline_participant, deadline_fallback, deadline_pick_ordinal, expires_at, created_at';
const MEMBER_COLUMNS =
  'participant_id, online, ready, picks_committed, locked, next_game_ready, last_seen_at';
const COMMAND_COLUMNS = 'command_id, ordinal, actor_participant_id, payload';
const MEMBERS_TABLE = 'fixed_five_room_members';

type FixedFiveCreateInput = Parameters<FixedFiveMultiplayerTransport['create']>[0];

function memberFallback(participantId: FixedFiveParticipantId): FixedFiveMemberSnapshot {
  return {
    participantId,
    online: false,
    ready: false,
    picksCommitted: 0,
    locked: false,
    nextGameReady: null,
    lastSeenAt: null,
  };
}

function memberFromRow(row: FixedFiveMemberRow): FixedFiveMemberSnapshot | null {
  if (row.participant_id !== 'p1' && row.participant_id !== 'p2') return null;
  return {
    participantId: row.participant_id,
    online: row.online,
    ready: row.ready,
    picksCommitted: row.picks_committed,
    locked: row.locked,
    nextGameReady:
      typeof row.next_game_ready === 'number' &&
      row.next_game_ready >= 1 &&
      row.next_game_ready <= 7
        ? row.next_game_ready
        : null,
    lastSeenAt: row.last_seen_at,
  };
}

function roomRowToSnapshot(
  row: FixedFiveRoomRow,
  memberRows: FixedFiveMemberRow[],
): FixedFiveRoomSnapshot {
  const byId = new Map<FixedFiveParticipantId, FixedFiveMemberSnapshot>();
  for (const memberRow of memberRows) {
    const member = memberFromRow(memberRow);
    if (member) byId.set(member.participantId, member);
  }
  const members: FixedFiveRoomSnapshot['members'] = [
    byId.get('p1') ?? memberFallback('p1'),
    byId.get('p2') ?? memberFallback('p2'),
  ];
  const phase = fixedFiveRoomPhaseSchema.parse(row.phase);
  let deadline: FixedFiveRoomSnapshot['deadline'] = null;
  if (row.deadline_at) {
    const fallback = fixedFiveCommandPayloadSchema.safeParse(row.deadline_fallback);
    deadline = {
      roomId: row.id,
      cursor: row.deadline_cursor ?? 'lobby',
      participantId: row.deadline_participant === 'p2' ? 'p2' : 'p1',
      deadlineAt: row.deadline_at,
      fallback: fallback.success ? fallback.data : null,
      pickOrdinal: row.deadline_pick_ordinal ?? 0,
    };
  }
  const settings = fixedFiveRoomSettingsSchema.parse({
    schemaVersion: 1,
    mode: row.mode,
    sourceMode: row.source_mode,
    variant: row.variant,
    timerPolicyVersion: 'fixed-five-autopick-v1',
    versions: row.versions,
  });
  return fixedFiveRoomSnapshotSchema.parse({
    roomId: row.id,
    code: row.code,
    codeActive: row.code_active,
    settings,
    phase,
    revision: row.revision,
    commandCount: row.command_count,
    digest: row.digest,
    members,
    rootSeed: row.root_seed,
    deadline,
    series: row.series ?? null,
    broadcast: row.broadcast ?? null,
    seasonBroadcast:
      row.game_state && typeof row.game_state === 'object' && 'season' in row.game_state
        ? (row.game_state as { season: FixedFiveRoomSnapshot['seasonBroadcast'] }).season
        : null,
    resultDigest: row.result_digest,
    confirmedDigest: row.confirmed_digest,
    successorRoomId: row.successor_room_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  });
}

function previewSnapshot(code: string, record: Record<string, unknown>): FixedFiveRoomSnapshot {
  const settings = fixedFiveRoomSettingsSchema.parse({
    schemaVersion: 1,
    mode: record['mode'],
    sourceMode: record['source_mode'],
    variant: record['variant'],
    timerPolicyVersion: 'fixed-five-autopick-v1',
    versions: record['versions'],
  });
  const phase = fixedFiveRoomPhaseSchema.parse(
    typeof record['phase'] === 'string' ? record['phase'] : 'lobby',
  );
  const preview = roomPreviewFields(record);
  return {
    roomId: preview.roomId,
    code: parseRoomCode(code, fixedFiveRoomCodeSchema),
    codeActive: true,
    settings,
    phase,
    revision: preview.revision,
    commandCount: 0,
    digest: null,
    members: [memberFallback('p1'), memberFallback('p2')],
    rootSeed: null,
    deadline: null,
    series: null,
    broadcast: null,
    seasonBroadcast: null,
    resultDigest: null,
    confirmedDigest: null,
    successorRoomId: null,
    expiresAt: preview.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    createdAt: preview.createdAt ?? new Date().toISOString(),
  };
}

const configuredTransportCache = new Map<string, FixedFiveMultiplayerTransport>();

export function getFixedFiveTransport(
  options?: RoomTransportOptions,
): FixedFiveMultiplayerTransport {
  return cachedRoomTransport(configuredTransportCache, options, createFixedFiveTransport);
}

export function createFixedFiveTransport(
  options?: RoomTransportOptions,
): FixedFiveMultiplayerTransport {
  const clientFactory = createRoomClientFactory(options);
  if (clientFactory === null) {
    return createInMemoryFixedFiveTransport({ clock: Date.now, random: { bytes: randomBytes } });
  }
  const getClient = clientFactory;
  return createRoomTransport(
    {
      label: 'Fixed-five',
      rpcPrefix: 'fixed_five',
      roomsTable: 'fixed_five_rooms',
      membersTable: MEMBERS_TABLE,
      commandsTable: 'fixed_five_room_commands',
      roomColumns: ROOM_COLUMNS,
      memberColumns: MEMBER_COLUMNS,
      commandColumns: COMMAND_COLUMNS,
      syncMode: 'fixed-five',
      topic: (roomId) => `fixed-five-room-${roomId}`,
      transientTopic: (roomId) => `fixed-five:${roomId}`,
      codeSchema: fixedFiveRoomCodeSchema,
      commandSchema: fixedFiveCommandSchema,
      commandSchemaVersion: 1,
      commandIncludeOrdinal: true,
      memberFallback,
      roomRowToSnapshot: (row, memberRows) =>
        roomRowToSnapshot(row as FixedFiveRoomRow, memberRows as FixedFiveMemberRow[]),
      previewSnapshot,
      createArgs: (settingsInput: FixedFiveCreateInput) => ({
        p_mode: settingsInput.mode,
        p_source_mode: settingsInput.sourceMode,
        p_variant: settingsInput.variant,
        p_versions: settingsInput.versions,
      }),
      resumeCode: (snapshot) => snapshot.code ?? fixedFiveRoomCodeSchema.parse('0000'),
      commandArgs: (command, commandId, expectedRevision) => ({
        p_room_id: command.roomId,
        p_command_id: commandId,
        p_expected_revision: expectedRevision,
        p_actor: command.actorParticipantId,
        p_payload: command.payload,
      }),
      receipt: (command, result, commandId): FixedFiveCommandReceipt => ({
        roomId: command.roomId as Id,
        commandId,
        ordinal: result.ordinal ?? -1,
        accepted: result.accepted,
        rejectionCode: result.rejectionCode ?? null,
        revision: result.revision ?? 0,
      }),
      receiptSchema: fixedFiveVerificationReceiptSchema,
      verificationReceiptId: (receipt) => (receipt as { receiptDigest: string }).receiptDigest,
      timeoutAcceptedField: 'resolved',
      timeoutReceipt: (timeout) => ({
        ...timeout,
        ordinal: -1,
        accepted: true,
        rejectionCode: null,
      }),
      parsePhase: (value) => fixedFiveRoomPhaseSchema.parse(value),
      completeFallbackPhase: 'awaiting-confirmation',
      failFallbackPhase: 'awaiting-confirmation',
      guestRemoval: 'rpc',
    },
    getClient,
  );
}
