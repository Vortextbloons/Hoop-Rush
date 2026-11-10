import type { SupabaseClient } from '@supabase/supabase-js';
import { commandIdSchema, idSchema, type CommandId, type Id } from '@hoop-rush/data-contracts';
import { randomUUID } from '#lib/ids.js';
import {
  commitRoomFallback,
  createRealtimeRoomRegistry,
  ensureAnonymous,
  ensureAnonymousUser,
  fetchRoomRows,
  parseRoomCommandRows,
  parseRoomCode,
  publishTransientPayload,
  readRoomParticipant,
  readRoomSync,
  resolveRoomTimeout,
  rpcChallenge,
  rpcCommandResult,
  rpcRoomPayload,
  submitRoomVerification,
  subscribeTransientPayloads,
  type RoomCommandRow,
} from '#lib/supabase-runtime.js';

export type RoomParticipantId = 'p1' | 'p2';

export interface RoomTransportOptions {
  url?: string;
  publishableKey?: string;
  storageKey?: string;
}

/**
 * The command shape every mode transport forwards. Mode command types are
 * structurally assignable to this; only the RPC argument builder cares about
 * the extra per-mode fields.
 */
export interface RoomCommandInput {
  roomId: string;
  commandId: CommandId;
  actorParticipantId: RoomParticipantId;
  payload: unknown;
  expectedRevision?: number;
}

export interface RoomCommandResult {
  accepted: boolean;
  ordinal: number | undefined;
  revision: number | undefined;
  rejectionCode: string | undefined;
  commandId: string | undefined;
}

export interface RoomTimeoutResult {
  roomId: Id;
  commandId: CommandId;
  ordinal: number;
  revision: number;
}

type CodeSchema<Code> = {
  parse(value: string): Code;
  safeParse(value: string): { success: true; data: Code } | { success: false };
};

type ParseSchema<T> = { parse(value: unknown): T };
type SafeParseSchema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

export interface RoomTransportDescriptor<
  Snapshot,
  SettingsInput,
  Code,
  Member,
  Command,
  Receipt,
  Phase,
  TransientEvent = never,
  Extra = undefined,
  Sync = { snapshot: Snapshot; commands: Command[] },
> {
  /** Human label used in realtime error messages. */
  label: string;
  /** RPC namespace, e.g. `draft_duel` → `draft_duel_room_create`. */
  rpcPrefix: string;
  roomsTable: string;
  membersTable: string;
  commandsTable: string;
  roomColumns: string;
  memberColumns: string;
  commandColumns: string;
  /** Protocol mode passed to `multiplayer_room_sync`. */
  syncMode: 'fixed-five' | 'draft-duel' | 'havoc';
  topic: (roomId: string) => string;
  transientTopic: (roomId: string) => string;
  codeSchema: CodeSchema<Code>;
  commandSchema: ParseSchema<Command>;
  commandSchemaVersion: number;
  commandIncludeOrdinal: boolean;
  memberFallback: (participantId: RoomParticipantId) => Member;
  roomRowToSnapshot: (row: unknown, memberRows: unknown[], extra: Extra) => Snapshot;
  /** Async data a mode needs before mapping a room row (Havoc replays its draft). */
  snapshotExtra?: (row: unknown, client: SupabaseClient) => Promise<Extra>;
  previewSnapshot: (code: string, record: Record<string, unknown>) => Snapshot;
  createArgs: (settingsInput: SettingsInput) => Record<string, unknown>;
  resumeCode: (snapshot: Snapshot) => Code;
  /** Built-in command RPC args; modes with extra fields (Fixed-five's actor) override. */
  commandArgs?: (
    command: RoomCommandInput,
    commandId: CommandId,
    expectedRevision: number | null,
  ) => Record<string, unknown>;
  receipt: (command: RoomCommandInput, result: RoomCommandResult, commandId: CommandId) => Receipt;
  receiptSchema: ParseSchema<unknown>;
  verificationReceiptId: (receipt: unknown) => string;
  timeoutAcceptedField: 'resolved' | 'accepted';
  timeoutReceipt: (timeout: RoomTimeoutResult) => Receipt;
  parsePhase: (value: string) => Phase;
  completeFallbackPhase: string;
  failFallbackPhase: string;
  transientEventSchema?: SafeParseSchema<TransientEvent>;
  /** When set, transient events are scoped to a room (Havoc events carry no room id). */
  transientRoomId?: (event: TransientEvent) => string;
  /** Fixed-five removes guests through its own RPC; the others submit a command. */
  guestRemoval?: 'command' | 'rpc';
  /** Havoc keeps a command-log cache and reports commandCount, so it overrides sync. */
  sync?: (client: SupabaseClient, roomId: string, afterOrdinal: number) => Promise<Sync>;
}

export function createRoomTransport<
  Snapshot,
  SettingsInput,
  Code,
  Member,
  Command,
  Receipt,
  Phase,
  TransientEvent = never,
  Extra = undefined,
  Sync = { snapshot: Snapshot; commands: Command[] },
>(
  descriptor: RoomTransportDescriptor<
    Snapshot,
    SettingsInput,
    Code,
    Member,
    Command,
    Receipt,
    Phase,
    TransientEvent,
    Extra,
    Sync
  >,
  getClient: () => Promise<SupabaseClient>,
) {
  const rpc = (name: string): string => `${descriptor.rpcPrefix}_${name}`;
  const commandArgs =
    descriptor.commandArgs ??
    ((command: RoomCommandInput, commandId: CommandId, expectedRevision: number | null) => ({
      p_room_id: command.roomId,
      p_command_id: commandId,
      p_expected_revision: expectedRevision,
      p_payload: command.payload,
    }));

  async function fetchSnapshot(roomId: string): Promise<Snapshot> {
    const client = await getClient();
    const { room, members } = await fetchRoomRows({
      client,
      roomsTable: descriptor.roomsTable,
      roomSelect: descriptor.roomColumns,
      membersTable: descriptor.membersTable,
      membersSelect: descriptor.memberColumns,
      roomId,
    });
    const extra =
      descriptor.snapshotExtra === undefined
        ? (undefined as Extra)
        : await descriptor.snapshotExtra(room, client);
    return descriptor.roomRowToSnapshot(room, members, extra);
  }

  const registry = createRealtimeRoomRegistry({
    label: descriptor.label,
    roomsTable: descriptor.roomsTable,
    commandsTable: descriptor.commandsTable,
    topic: descriptor.topic,
    getClient,
  });

  return {
    async create(settingsInput: SettingsInput) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc(rpc('room_create'), descriptor.createArgs(settingsInput));
      if (response.error || !response.data) {
        throw new Error(`create failed: ${response.error?.message ?? 'unknown'}`);
      }
      const payload = rpcRoomPayload(response.data, descriptor.codeSchema);
      const snapshot = await fetchSnapshot(payload.room_id);
      if (!payload.code) throw new Error('create failed: room code missing');
      const code = payload.code;
      const participantId: RoomParticipantId = 'p1';
      return {
        snapshot,
        code,
        membership: { roomId: payload.room_id, participantId, code },
      };
    },
    async preview(code: string) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc(rpc('room_preview'), { p_code: code });
      if (response.error || !response.data)
        throw new Error(`invalid-code: ${response.error?.message ?? code}`);
      const record = response.data as Record<string, unknown>;
      return descriptor.previewSnapshot(code, record);
    },
    async join(code: string) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc(rpc('room_join'), { p_code: code });
      if (response.error || !response.data)
        throw new Error(`join failed: ${response.error?.message ?? code}`);
      const payload = rpcRoomPayload(response.data, descriptor.codeSchema);
      const snapshot = await fetchSnapshot(payload.room_id);
      const participantId: RoomParticipantId = payload.participant_id ?? 'p2';
      const membershipCode = parseRoomCode(code, descriptor.codeSchema);
      return {
        snapshot,
        membership: { roomId: payload.room_id, participantId, code: membershipCode },
      };
    },
    async resume(roomId: string) {
      const client = await getClient();
      // One shared session check; its uid also resolves our seat below.
      const uid = await ensureAnonymousUser(client);
      // Snapshot and seat are independent reads, so run them together. Room
      // errors still win so a non-member sees the room failure, not the seat one.
      const [snapshotResult, seatResult] = await Promise.allSettled([
        fetchSnapshot(roomId),
        readRoomParticipant(client, descriptor.membersTable, roomId, uid),
      ]);
      if (snapshotResult.status === 'rejected') throw snapshotResult.reason;
      if (seatResult.status === 'rejected') throw seatResult.reason;
      const snapshot = snapshotResult.value;
      const participantId = seatResult.value;
      return {
        snapshot,
        membership: {
          roomId: idSchema.parse(roomId),
          participantId,
          code: descriptor.resumeCode(snapshot),
        },
      };
    },
    async snapshot(roomId: string) {
      const client = await getClient();
      await ensureAnonymous(client);
      return fetchSnapshot(roomId);
    },
    async sync(roomId: string, afterOrdinal = -1): Promise<Sync> {
      if (descriptor.sync) {
        const client = await getClient();
        return descriptor.sync(client, roomId, afterOrdinal);
      }
      const client = await getClient();
      const payload = await readRoomSync(client, descriptor.syncMode, roomId, afterOrdinal);
      const parsedRoomId = idSchema.parse(roomId);
      return {
        snapshot: descriptor.roomRowToSnapshot(payload.room, payload.members, undefined as Extra),
        commands: parseRoomCommandRows(
          payload.commands as unknown as RoomCommandRow[],
          parsedRoomId,
          descriptor.commandSchemaVersion,
          descriptor.commandSchema,
          descriptor.commandIncludeOrdinal,
        ),
      } as Sync;
    },
    subscribe(roomId: string, handler: () => void, onError?: (error: Error) => void) {
      return registry.subscribe(roomId, handler, onError);
    },
    subscribeTransient(roomId: string, handler: (event: TransientEvent) => void) {
      if (!descriptor.transientEventSchema) return { unsubscribe: () => {} };
      const schema = descriptor.transientEventSchema;
      return subscribeTransientPayloads({
        getClient,
        topic: descriptor.transientTopic(roomId),
        event: 'transient',
        onPayload: (payload) => {
          const parsed = schema.safeParse(payload);
          if (!parsed.success) return;
          if (descriptor.transientRoomId?.(parsed.data) !== undefined) {
            if (descriptor.transientRoomId(parsed.data) !== roomId) return;
          }
          handler(parsed.data);
        },
      });
    },
    async publishTransient(roomId: string, event: TransientEvent) {
      if (!descriptor.transientEventSchema) return false;
      const parsed = descriptor.transientEventSchema.safeParse(event);
      if (!parsed.success) return false;
      if (descriptor.transientRoomId?.(parsed.data) !== undefined) {
        if (descriptor.transientRoomId(parsed.data) !== roomId) return false;
      }
      return publishTransientPayload(
        getClient,
        descriptor.transientTopic(roomId),
        'transient',
        parsed.data,
      );
    },
    async refetch(roomId: string, afterOrdinal: number) {
      const client = await getClient();
      await ensureAnonymous(client);
      const parsedRoomId = idSchema.parse(roomId);
      const response = await client
        .from(descriptor.commandsTable)
        .select(descriptor.commandColumns)
        .eq('room_id', parsedRoomId)
        .gt('ordinal', afterOrdinal)
        .order('ordinal', { ascending: true });
      if (response.error) throw new Error(`refetch failed: ${response.error.message}`);
      return parseRoomCommandRows(
        response.data as unknown as RoomCommandRow[],
        parsedRoomId,
        descriptor.commandSchemaVersion,
        descriptor.commandSchema,
        descriptor.commandIncludeOrdinal,
      );
    },
    async submitCommand(command: RoomCommandInput) {
      const client = await getClient();
      await ensureAnonymous(client);
      const commandId = command.commandId || commandIdSchema.parse(randomUUID());
      const withRevision = command as unknown as {
        expectedRevision?: unknown;
      };
      const expectedRevision =
        typeof withRevision.expectedRevision === 'number' ? withRevision.expectedRevision : null;
      const response = await client.rpc(
        rpc('command_submit'),
        commandArgs(command, commandId, expectedRevision),
      );
      if (response.error) throw new Error(`command failed: ${response.error.message}`);
      const result = rpcCommandResult(response.data);
      return descriptor.receipt(command, result, commandId);
    },
    async verificationChallenge(roomId: string) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc(rpc('verification_challenge'), {
        p_room_id: roomId,
      });
      if (response.error)
        throw new Error(`verification challenge failed: ${response.error.message}`);
      return rpcChallenge(response.data);
    },
    async submitVerification(roomId: string, receipt: unknown, expectedRevision?: number) {
      const client = await getClient();
      await ensureAnonymous(client);
      const parsed = descriptor.receiptSchema.parse(receipt);
      return submitRoomVerification({
        client,
        rpc: rpc('verification_submit'),
        roomId,
        receipt: parsed,
        ownReceiptId: descriptor.verificationReceiptId(parsed),
        expectedRevision,
      });
    },
    async commitFallback(
      roomId: string,
      cursor: string,
      payload: unknown,
      expectedRevision?: number,
    ) {
      const client = await getClient();
      await ensureAnonymous(client);
      return commitRoomFallback({
        client,
        rpc: rpc('commit_fallback'),
        roomId,
        cursor,
        payload,
        expectedRevision,
      });
    },
    async resolveTimeout(roomId: string) {
      const client = await getClient();
      await ensureAnonymous(client);
      const timeout = await resolveRoomTimeout({
        client,
        rpc: rpc('timeout_resolve'),
        roomId,
        acceptedField: descriptor.timeoutAcceptedField,
      });
      return timeout === null ? null : descriptor.timeoutReceipt(timeout);
    },
    async removeGuest(roomId: string, targetParticipantId: RoomParticipantId) {
      const client = await getClient();
      await ensureAnonymous(client);
      if (descriptor.guestRemoval === 'rpc') {
        const response = await client.rpc(rpc('guest_remove'), {
          p_room_id: roomId,
          p_target: targetParticipantId,
        });
        if (response.error) throw new Error(`remove-guest failed: ${response.error.message}`);
        return fetchSnapshot(roomId);
      }
      const commandId = commandIdSchema.parse(randomUUID());
      const response = await client.rpc(rpc('command_submit'), {
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
    async leave(roomId: string) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc(rpc('leave'), { p_room_id: roomId });
      if (response.error) throw new Error(`leave failed: ${response.error.message}`);
    },
    async rematch(roomId: string) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc(rpc('rematch'), { p_room_id: roomId });
      if (response.error || !response.data)
        throw new Error(`rematch failed: ${response.error?.message ?? 'unknown'}`);
      const payload = rpcRoomPayload(response.data, descriptor.codeSchema);
      const snapshot = await fetchSnapshot(payload.room_id);
      if (!payload.code) throw new Error('rematch failed: room code missing');
      return { snapshot, code: payload.code };
    },
    async complete(roomId: string, receiptId: string) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc(rpc('complete'), {
        p_room_id: roomId,
        p_receipt_id: receiptId,
      });
      if (response.error || !response.data)
        throw new Error(`complete failed: ${response.error?.message ?? 'unknown'}`);
      const record = response.data as unknown as Record<string, unknown>;
      return {
        completed: record['completed'] === true,
        phase: descriptor.parsePhase(
          typeof record['phase'] === 'string' ? record['phase'] : descriptor.completeFallbackPhase,
        ),
      };
    },
    async fail(roomId: string) {
      const client = await getClient();
      await ensureAnonymous(client);
      const response = await client.rpc(rpc('fail'), { p_room_id: roomId });
      if (response.error || !response.data)
        throw new Error(`fail failed: ${response.error?.message ?? 'unknown'}`);
      const record = response.data as unknown as Record<string, unknown>;
      return {
        failed: record['failed'] === true,
        phase: descriptor.parsePhase(
          typeof record['phase'] === 'string' ? record['phase'] : descriptor.failFallbackPhase,
        ),
      };
    },
  };
}
