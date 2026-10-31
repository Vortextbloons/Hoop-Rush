import {
  commandIdSchema,
  fixedFiveCommandPayloadSchema,
  fixedFiveCommandSchema,
  fixedFiveRoomCodeSchema,
  fixedFiveRoomPhaseSchema,
  fixedFiveRoomSettingsSchema,
  fixedFiveRoomSnapshotSchema,
  fixedFiveVerificationReceiptSchema,
  idSchema,
  type FixedFiveCommandReceipt,
  type FixedFiveMemberSnapshot,
  type FixedFiveMultiplayerTransport,
  type FixedFiveParticipantId,
  type FixedFiveRoomCode,
  type FixedFiveRoomSettings,
  type FixedFiveRoomSnapshot,
  type Id,
} from '@hoop-rush/data-contracts';
import { randomBytes, randomUUID } from '#lib/ids.js';
import { createInMemoryFixedFiveTransport } from '@hoop-rush/application/fixed-five';
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
  resolveRoomTimeout,
  rpcChallenge,
  rpcCommandResult,
  rpcRoomPayload,
  roomPreviewFields,
  submitRoomVerification,
} from '#lib/supabase-runtime.js';

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

interface FixedFiveCommandRow {
  command_id: string;
  ordinal: number;
  actor_participant_id: string;
  payload: unknown;
}

const ROOM_COLUMNS =
  'id, code, code_active, mode, source_mode, variant, versions, phase, revision, command_count, digest, result_digest, confirmed_digest, successor_room_id, series, broadcast, game_state, root_seed, deadline_at, deadline_cursor, deadline_participant, deadline_fallback, deadline_pick_ordinal, expires_at, created_at';
const MEMBER_COLUMNS =
  'participant_id, online, ready, picks_committed, locked, next_game_ready, last_seen_at';
const COMMAND_COLUMNS = 'command_id, ordinal, actor_participant_id, payload';
const MEMBERS_TABLE = 'fixed_five_room_members';

const rpcPayload = (value: unknown) => rpcRoomPayload(value, fixedFiveRoomCodeSchema);

const configuredTransportCache = new Map<string, FixedFiveMultiplayerTransport>();

export function getFixedFiveTransport(options?: {
  url?: string;
  publishableKey?: string;
  storageKey?: string;
}): FixedFiveMultiplayerTransport {
  return cachedRoomTransport(configuredTransportCache, options, createFixedFiveTransport);
}

export function createFixedFiveTransport(options?: {
  url?: string;
  publishableKey?: string;
  storageKey?: string;
}): FixedFiveMultiplayerTransport {
  const clientFactory = createRoomClientFactory(options);
  if (clientFactory === null) {
    return createInMemoryFixedFiveTransport({ clock: Date.now, random: { bytes: randomBytes } });
  }
  const getClient = clientFactory;
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
  async function fetchSnapshot(roomId: string): Promise<FixedFiveRoomSnapshot> {
    const { room, members } = await fetchRoomRows({
      client: await getClient(),
      roomsTable: 'fixed_five_rooms',
      roomSelect: ROOM_COLUMNS,
      membersTable: MEMBERS_TABLE,
      membersSelect: MEMBER_COLUMNS,
      roomId,
    });
    return roomRowToSnapshot(room as FixedFiveRoomRow, members as FixedFiveMemberRow[]);
  }
  const registry = createRealtimeRoomRegistry({
    label: 'Fixed-five',
    roomsTable: 'fixed_five_rooms',
    commandsTable: 'fixed_five_room_commands',
    topic: (roomId) => `fixed-five-room-${roomId}`,
    getClient,
  });
  return {
    async create(settingsInput) {
      const client = await getClient();
      await ensureAnonymous(client);
      const settings: FixedFiveRoomSettings = {
        schemaVersion: 1,
        timerPolicyVersion: 'fixed-five-autopick-v1',
        ...settingsInput,
        versions: settingsInput.versions,
      };
      const response = await client.rpc('fixed_five_room_create', {
        p_mode: settings.mode,
        p_source_mode: settings.sourceMode,
        p_variant: settings.variant,
        p_versions: settings.versions,
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
      const response = await client.rpc('fixed_five_room_preview', { p_code: code });
      if (response.error || !response.data)
        throw new Error(`invalid-code: ${response.error?.message ?? code}`);
      const record = response.data as unknown as Record<string, unknown>;
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
    },
    async join(code) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_room_join', { p_code: code });
      if (response.error || !response.data)
        throw new Error(`join failed: ${response.error?.message ?? code}`);
      const payload = rpcPayload(response.data);
      const snapshot = await fetchSnapshot(payload.room_id);
      const participantId: FixedFiveParticipantId = payload.participant_id ?? 'p2';
      const membershipCode = parseRoomCode(code, fixedFiveRoomCodeSchema);
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
        membership: {
          roomId: idSchema.parse(roomId),
          participantId,
          code: snapshot.code ?? fixedFiveRoomCodeSchema.parse('0000'),
        },
      };
    },
    async snapshot(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      return fetchSnapshot(roomId);
    },
    async sync(roomId, afterOrdinal) {
      const client = await getClient();
      const payload = await readRoomSync(client, 'fixed-five', roomId, afterOrdinal);
      const parsedRoomId = idSchema.parse(roomId);
      return {
        snapshot: roomRowToSnapshot(
          payload.room as unknown as FixedFiveRoomRow,
          payload.members as unknown as FixedFiveMemberRow[],
        ),
        commands: parseRoomCommandRows(
          payload.commands as unknown as FixedFiveCommandRow[],
          parsedRoomId,
          1,
          fixedFiveCommandSchema,
          true,
        ),
      };
    },
    subscribe(roomId, handler, onError) {
      return registry.subscribe(roomId, handler, onError);
    },
    async refetch(roomId, afterOrdinal) {
      const client = await getClient();
      await ensureAnonymous(client);
      const parsedRoomId = idSchema.parse(roomId);
      const response = await client
        .from('fixed_five_room_commands')
        .select(COMMAND_COLUMNS)
        .eq('room_id', parsedRoomId)
        .gt('ordinal', afterOrdinal)
        .order('ordinal', { ascending: true });
      if (response.error) throw new Error(`refetch failed: ${response.error.message}`);
      return parseRoomCommandRows(
        response.data as unknown as FixedFiveCommandRow[],
        parsedRoomId,
        1,
        fixedFiveCommandSchema,
        true,
      );
    },
    async submitCommand(command) {
      const client = await getClient();
      await ensureAnonymous(client);
      const commandId = command.commandId || commandIdSchema.parse(randomUUID());
      const withRevision = command as unknown as {
        expectedRevision?: unknown;
      };
      const expectedRevision =
        typeof withRevision.expectedRevision === 'number' ? withRevision.expectedRevision : null;
      const response = await client.rpc('fixed_five_command_submit', {
        p_room_id: command.roomId,
        p_command_id: commandId,
        p_expected_revision: expectedRevision,
        p_actor: command.actorParticipantId,
        p_payload: command.payload,
      });
      if (response.error) throw new Error(`command failed: ${response.error.message}`);
      const result = rpcCommandResult(response.data);
      const receipt: FixedFiveCommandReceipt = {
        roomId: command.roomId,
        commandId,
        ordinal: result.ordinal ?? -1,
        accepted: result.accepted,
        rejectionCode: result.rejectionCode ?? null,
        revision: result.revision ?? 0,
      };
      return receipt;
    },
    async verificationChallenge(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_verification_challenge', {
        p_room_id: roomId,
      });
      if (response.error)
        throw new Error(`verification challenge failed: ${response.error.message}`);
      return rpcChallenge(response.data);
    },
    async submitVerification(roomId, receipt, expectedRevision) {
      const client = await getClient();
      await ensureAnonymous(client);
      const parsed = fixedFiveVerificationReceiptSchema.parse(receipt);
      return submitRoomVerification({
        client,
        rpc: 'fixed_five_verification_submit',
        roomId,
        receipt: parsed,
        ownReceiptId: parsed.receiptDigest,
        expectedRevision,
      });
    },
    async commitFallback(roomId, cursor, payload, expectedRevision) {
      const client = await getClient();
      await ensureAnonymous(client);
      return commitRoomFallback({
        client,
        rpc: 'fixed_five_commit_fallback',
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
        rpc: 'fixed_five_timeout_resolve',
        roomId,
        acceptedField: 'resolved',
      });
      return timeout === null
        ? null
        : { ...timeout, ordinal: -1, accepted: true, rejectionCode: null };
    },
    async removeGuest(roomId, targetParticipantId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_guest_remove', {
        p_room_id: roomId,
        p_target: targetParticipantId,
      });
      if (response.error) throw new Error(`remove-guest failed: ${response.error.message}`);
      return fetchSnapshot(roomId);
    },
    async leave(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_leave', { p_room_id: roomId });
      if (response.error) throw new Error(`leave failed: ${response.error.message}`);
    },
    async rematch(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_rematch', { p_room_id: roomId });
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
      const response = await client.rpc('fixed_five_complete', {
        p_room_id: roomId,
        p_receipt_id: receiptId,
      });
      if (response.error || !response.data)
        throw new Error(`complete failed: ${response.error?.message ?? 'unknown'}`);
      const record = response.data as unknown as Record<string, unknown>;
      const phase = fixedFiveRoomPhaseSchema.parse(
        typeof record['phase'] === 'string' ? record['phase'] : 'awaiting-confirmation',
      );
      return { completed: record['completed'] === true, phase };
    },
    async fail(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('fixed_five_fail', { p_room_id: roomId });
      if (response.error || !response.data)
        throw new Error(`fail failed: ${response.error?.message ?? 'unknown'}`);
      const record = response.data as unknown as Record<string, unknown>;
      const phase = fixedFiveRoomPhaseSchema.parse(
        typeof record['phase'] === 'string' ? record['phase'] : 'awaiting-confirmation',
      );
      return { failed: record['failed'] === true, phase };
    },
  };
}
