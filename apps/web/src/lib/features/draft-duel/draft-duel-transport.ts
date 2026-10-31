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
  idSchema,
  type DraftDuelCommandReceipt,
  type DraftDuelMemberSnapshot,
  type DraftDuelMultiplayerTransport,
  type DraftDuelParticipantId,
  type DraftDuelRoomCode,
  type DraftDuelRoomSettings,
  type DraftDuelRoomSnapshot,
  type DraftDuelTransientEvent,
  type Id,
} from '@hoop-rush/data-contracts';
import { randomBytes, randomUUID } from '#lib/ids.js';
import { createInMemoryDraftDuelTransport } from '@hoop-rush/application/draft-duel';
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
  rpcRoomPayload,
  roomPreviewFields,
  submitRoomVerification,
  subscribeTransientPayloads,
} from '#lib/supabase-runtime.js';

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

interface DraftDuelCommandRow {
  command_id: string;
  ordinal: number;
  actor_participant_id: string;
  payload: unknown;
}

const ROOM_COLUMNS =
  'id, code, code_active, fairness, presentation, versions, phase, revision, command_count, result_digest, confirmed_digest, successor_room_id, root_seed, deadline_at, deadline_cursor, deadline_participant, deadline_fallback, deadline_pick_ordinal, series, broadcast, expires_at, created_at';
const MEMBER_COLUMNS = 'participant_id, online, ready, next_game_ready, locked, last_seen_at';
const COMMAND_COLUMNS = 'command_id, ordinal, actor_participant_id, payload';
const MEMBERS_TABLE = 'draft_duel_room_members';

const rpcPayload = (value: unknown) => rpcRoomPayload(value, draftDuelRoomCodeSchema);

const configuredTransportCache = new Map<string, DraftDuelMultiplayerTransport>();

export function getDraftDuelTransport(options?: {
  url?: string;
  publishableKey?: string;
  storageKey?: string;
}): DraftDuelMultiplayerTransport {
  return cachedRoomTransport(configuredTransportCache, options, createDraftDuelTransport);
}

export function createDraftDuelTransport(options?: {
  url?: string;
  publishableKey?: string;
  storageKey?: string;
}): DraftDuelMultiplayerTransport {
  const clientFactory = createRoomClientFactory(options);
  if (clientFactory === null) {
    return createInMemoryDraftDuelTransport({ clock: Date.now, random: { bytes: randomBytes } });
  }
  const getClient = clientFactory;
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
  async function fetchSnapshot(roomId: string): Promise<DraftDuelRoomSnapshot> {
    const { room, members } = await fetchRoomRows({
      client: await getClient(),
      roomsTable: 'draft_duel_rooms',
      roomSelect: ROOM_COLUMNS,
      membersTable: MEMBERS_TABLE,
      membersSelect: MEMBER_COLUMNS,
      roomId,
    });
    return roomRowToSnapshot(room as DraftDuelRoomRow, members as DraftDuelMemberRow[]);
  }
  const registry = createRealtimeRoomRegistry({
    label: 'Draft Duel',
    roomsTable: 'draft_duel_rooms',
    commandsTable: 'draft_duel_room_commands',
    topic: (roomId) => `draft-duel-room-${roomId}`,
    getClient,
  });
  const transientTopic = (roomId: string): string => `draft-duel:${roomId}`;
  return {
    async create(settingsInput) {
      const client = await getClient();
      await ensureAnonymous(client);
      const settings: DraftDuelRoomSettings = {
        schemaVersion: 1,
        timerPolicyVersion: DRAFT_DUEL_AUTOPICK_VERSION,
        ...settingsInput,
        versions: settingsInput.versions,
      };
      const response = await client.rpc('draft_duel_room_create', {
        p_fairness: settings.fairness,
        p_presentation: settings.presentation,
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
      const response = await client.rpc('draft_duel_room_preview', { p_code: code });
      if (response.error || !response.data)
        throw new Error(`invalid-code: ${response.error?.message ?? code}`);
      const record = response.data as unknown as Record<string, unknown>;
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
    },
    async join(code) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('draft_duel_room_join', { p_code: code });
      if (response.error || !response.data)
        throw new Error(`join failed: ${response.error?.message ?? code}`);
      const payload = rpcPayload(response.data);
      const snapshot = await fetchSnapshot(payload.room_id);
      const participantId: DraftDuelParticipantId = payload.participant_id ?? 'p2';
      const membershipCode = parseRoomCode(code, draftDuelRoomCodeSchema);
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
          code: snapshot.code ?? draftDuelRoomCodeSchema.parse('0000'),
        },
      };
    },
    async sync(roomId, afterOrdinal) {
      const client = await getClient();
      const payload = await readRoomSync(client, 'draft-duel', roomId, afterOrdinal);
      const parsedRoomId = idSchema.parse(roomId);
      return {
        snapshot: roomRowToSnapshot(
          payload.room as unknown as DraftDuelRoomRow,
          payload.members as unknown as DraftDuelMemberRow[],
        ),
        commands: parseRoomCommandRows(
          payload.commands as unknown as DraftDuelCommandRow[],
          parsedRoomId,
          1,
          draftDuelCommandSchema,
          true,
        ),
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
          const parsed = draftDuelTransientEventSchema.safeParse(payload);
          if (!parsed.success) return;
          if (parsed.data.roomId !== roomId) return;
          handler(parsed.data);
        },
      });
    },
    async publishTransient(roomId, event: DraftDuelTransientEvent) {
      const parsed = draftDuelTransientEventSchema.safeParse(event);
      if (!parsed.success || parsed.data.roomId !== roomId) return false;
      return publishTransientPayload(getClient, transientTopic(roomId), 'transient', parsed.data);
    },
    async refetch(roomId, afterOrdinal) {
      const client = await getClient();
      await ensureAnonymous(client);
      const parsedRoomId = idSchema.parse(roomId);
      const response = await client
        .from('draft_duel_room_commands')
        .select(COMMAND_COLUMNS)
        .eq('room_id', parsedRoomId)
        .gt('ordinal', afterOrdinal)
        .order('ordinal', { ascending: true });
      if (response.error) throw new Error(`refetch failed: ${response.error.message}`);
      return parseRoomCommandRows(
        response.data as unknown as DraftDuelCommandRow[],
        parsedRoomId,
        1,
        draftDuelCommandSchema,
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
      const response = await client.rpc('draft_duel_command_submit', {
        p_room_id: command.roomId,
        p_command_id: commandId,
        p_expected_revision: expectedRevision,
        p_payload: command.payload,
      });
      if (response.error) throw new Error(`command failed: ${response.error.message}`);
      const result = rpcCommandResult(response.data);
      const receipt: DraftDuelCommandReceipt = {
        roomId: command.roomId,
        commandId: result.commandId ? commandIdSchema.parse(result.commandId) : commandId,
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
      const response = await client.rpc('draft_duel_verification_challenge', {
        p_room_id: roomId,
      });
      if (response.error)
        throw new Error(`verification challenge failed: ${response.error.message}`);
      return rpcChallenge(response.data);
    },
    async submitVerification(roomId, receipt, expectedRevision) {
      const client = await getClient();
      await ensureAnonymous(client);
      const parsed = draftDuelVerificationReceiptSchema.parse(receipt);
      return submitRoomVerification({
        client,
        rpc: 'draft_duel_verification_submit',
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
        rpc: 'draft_duel_commit_fallback',
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
        rpc: 'draft_duel_timeout_resolve',
        roomId,
        acceptedField: 'accepted',
      });
      return timeout === null ? null : { ...timeout, accepted: true, rejectionCode: null };
    },
    async removeGuest(roomId, targetParticipantId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const commandId = commandIdSchema.parse(randomUUID());
      const response = await client.rpc('draft_duel_command_submit', {
        p_room_id: roomId,
        p_command_id: commandId,
        p_expected_revision: null,
        p_payload: { kind: 'remove-guest', targetParticipantId },
      });
      if (response.error) throw new Error(`remove-guest failed: ${response.error.message}`);
      const result = rpcCommandResult(response.data);
      if (!result.accepted) {
        throw new Error(`remove-guest failed: ${result.rejectionCode ?? 'rejected'}`);
      }
      return fetchSnapshot(roomId);
    },
    async leave(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('draft_duel_leave', { p_room_id: roomId });
      if (response.error) throw new Error(`leave failed: ${response.error.message}`);
    },
    async rematch(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('draft_duel_rematch', { p_room_id: roomId });
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
      const response = await client.rpc('draft_duel_complete', {
        p_room_id: roomId,
        p_receipt_id: receiptId,
      });
      if (response.error || !response.data)
        throw new Error(`complete failed: ${response.error?.message ?? 'unknown'}`);
      const record = response.data as unknown as Record<string, unknown>;
      const phase = draftDuelRoomPhaseSchema.parse(
        typeof record['phase'] === 'string' ? record['phase'] : 'championship',
      );
      return { completed: record['completed'] === true, phase };
    },
    async fail(roomId) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc('draft_duel_fail', { p_room_id: roomId });
      if (response.error || !response.data)
        throw new Error(`fail failed: ${response.error?.message ?? 'unknown'}`);
      const record = response.data as unknown as Record<string, unknown>;
      const phase = draftDuelRoomPhaseSchema.parse(
        typeof record['phase'] === 'string' ? record['phase'] : 'championship',
      );
      return { failed: record['failed'] === true, phase };
    },
  };
}
