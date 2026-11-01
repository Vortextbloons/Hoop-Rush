import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import {
  ROOM_PROTOCOL_VERSION,
  commandIdSchema,
  describeLegacyRoomRejection,
  idSchema,
  multiplayerRoomSyncSchema,
  type CommandId,
  type Id,
} from '@hoop-rush/data-contracts';

let supabaseModulePromise: Promise<typeof import('@supabase/supabase-js')> | null = null;

function loadSupabaseModule(): Promise<typeof import('@supabase/supabase-js')> {
  if (!supabaseModulePromise) supabaseModulePromise = import('@supabase/supabase-js');
  return supabaseModulePromise;
}

const sharedClients = new Map<string, SupabaseClient>();

export async function supabaseClient(
  url: string,
  publishableKey: string,
  storageKey?: string,
): Promise<SupabaseClient> {
  const key = `${url}${publishableKey}${storageKey ?? ''}`;
  const existing = sharedClients.get(key);
  if (existing) return existing;
  const { createClient } = await loadSupabaseModule();
  const loadedClient = sharedClients.get(key);
  if (loadedClient) return loadedClient;
  const client = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      ...(storageKey ? { storageKey } : {}),
    },
  });
  sharedClients.set(key, client);
  return client;
}

export function isUsableSupabaseUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return parsed.protocol === 'http:';
  return parsed.protocol === 'https:' && host.endsWith('.supabase.co');
}

function legacyJwtRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  const segment = parts[1];
  if (!segment) return null;
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload: unknown = JSON.parse(atob(padded));
    if (typeof payload !== 'object' || payload === null) return null;
    const role = (payload as Record<string, unknown>)['role'];
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

export function isUsablePublishableKey(key: string): boolean {
  if (key.length < 20 || /\s/.test(key)) return false;
  const lower = key.toLowerCase();
  if (lower.includes('your-') || lower.includes('example') || lower.includes('placeholder'))
    return false;
  if (key.startsWith('sb_secret_')) return false;
  if (key.startsWith('sb_publishable_')) return true;
  if (!key.startsWith('eyJ')) return false;
  return legacyJwtRole(key) === 'anon';
}

export function readSupabaseEnv(): {
  url?: string;
  publishableKey?: string;
} {
  const env = import.meta.env as Record<string, unknown>;
  const rawUrl = env['VITE_SUPABASE_URL'];
  const rawKey = env['VITE_SUPABASE_PUBLISHABLE_KEY'];
  const url = typeof rawUrl === 'string' ? rawUrl.trim().replace(/\/+$/, '') : undefined;
  const publishableKey = typeof rawKey === 'string' ? rawKey.trim() : undefined;
  return {
    url: url && isUsableSupabaseUrl(url) ? url : undefined,
    publishableKey:
      publishableKey && isUsablePublishableKey(publishableKey) ? publishableKey : undefined,
  };
}

export function isMultiplayerConfigured(): boolean {
  const { url, publishableKey } = readSupabaseEnv();
  return Boolean(url && publishableKey);
}

/**
 * Ensure an anonymous session and return its user id when the client reports
 * one.
 *
 * Callers that also need their own seat pass the id instead of asking the auth
 * server again: `getSession` reads the persisted session locally, while
 * `getUser` costs a round trip. A null id just means the caller falls back to
 * that round trip.
 */
export async function ensureAnonymousUser(client: SupabaseClient): Promise<string | null> {
  try {
    const session = await client.auth.getSession();
    const uid = session.data.session?.user.id;
    if (uid) return uid;
  } catch {
    throw new Error('anonymous sign-in unreachable: failed to fetch');
  }
  try {
    const signed = await client.auth.signInAnonymously();
    if (signed.error) throw new Error(`anonymous sign-in failed: ${signed.error.message}`);
    return signed.data.user?.id ?? null;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('anonymous sign-in failed:')) throw e;
    throw new Error('anonymous sign-in unreachable: failed to fetch');
  }
}

export async function ensureAnonymous(client: SupabaseClient): Promise<void> {
  await ensureAnonymousUser(client);
}

export async function getMultiplayerClient(): Promise<SupabaseClient> {
  const { url, publishableKey } = readSupabaseEnv();
  if (!url || !publishableKey) throw new Error('Online rooms are unavailable in this setup.');
  const client = await supabaseClient(url, publishableKey);
  await ensureAnonymous(client);
  return client;
}

export function cachedRoomTransport<T>(
  cache: Map<string, T>,
  options: { url?: string; publishableKey?: string; storageKey?: string } | undefined,
  create: (options: { url?: string; publishableKey?: string; storageKey: string }) => T,
): T {
  const env = readSupabaseEnv();
  const url = options?.url ?? env.url;
  const publishableKey = options?.publishableKey ?? env.publishableKey;
  const storageKey = options?.storageKey ?? '';
  return getCachedTransport(cache, `${url ?? 'memory'}${publishableKey ?? ''}${storageKey}`, () =>
    create({ url, publishableKey, storageKey }),
  );
}

export function createRoomClientFactory(options?: {
  url?: string;
  publishableKey?: string;
  storageKey?: string;
}): (() => Promise<SupabaseClient>) | null {
  const candidateUrl =
    typeof options?.url === 'string' ? options.url.trim().replace(/\/+$/, '') : undefined;
  const candidateKey =
    typeof options?.publishableKey === 'string' ? options.publishableKey.trim() : undefined;
  if (
    !candidateUrl ||
    !candidateKey ||
    !isUsableSupabaseUrl(candidateUrl) ||
    !isUsablePublishableKey(candidateKey)
  ) {
    return null;
  }
  let clientPromise: Promise<SupabaseClient> | null = null;
  return () => {
    clientPromise ??= supabaseClient(candidateUrl, candidateKey, options?.storageKey);
    return clientPromise;
  };
}

export function rpcRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function rpcNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

function rpcString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

export function rpcCommandResult(value: unknown): {
  accepted: boolean;
  ordinal: number | undefined;
  revision: number | undefined;
  rejectionCode: string | undefined;
  commandId: string | undefined;
} {
  const record = rpcRecord(value);
  return {
    accepted: record['accepted'] === true,
    ordinal: rpcNumber(record, 'ordinal'),
    revision: rpcNumber(record, 'revision'),
    rejectionCode: rpcString(record, 'rejectionCode') ?? rpcString(record, 'rejection_code'),
    commandId: rpcString(record, 'commandId'),
  };
}

export function rpcChallenge(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value;
  const record = rpcRecord(value);
  for (const key of ['challenge', 'challenge_string', 'value', 'token']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  throw new Error('verification challenge failed: server returned no challenge');
}

export interface RoomCommandRow {
  command_id: string;
  ordinal: number;
  actor_participant_id: string;
  payload: unknown;
}

export function parseRoomCommandRows<C>(
  rows: readonly RoomCommandRow[],
  roomId: Id,
  schemaVersion: number,
  schema: { parse(value: unknown): C },
  includeOrdinal: boolean,
): C[] {
  return rows.map((row) =>
    schema.parse({
      schemaVersion,
      roomId,
      commandId: row.command_id,
      ...(includeOrdinal ? { ordinal: row.ordinal } : {}),
      actorParticipantId: row.actor_participant_id,
      payload: row.payload,
    }),
  );
}

export function roomPreviewFields(record: Record<string, unknown>): {
  roomId: Id;
  revision: number;
  expiresAt: string | null;
  createdAt: string | null;
} {
  const timestamp = (key: string): string | null => {
    const value = record[key];
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
  };
  return {
    roomId: idSchema.parse(stringField(record, 'room_id')),
    revision: rpcNumber(record, 'revision') ?? 0,
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at'),
  };
}

export async function fetchRoomRows(options: {
  client: SupabaseClient;
  roomsTable: string;
  roomSelect: string;
  membersTable: string;
  membersSelect: string;
  roomId: string;
}): Promise<{ room: unknown; members: unknown[] }> {
  // Both reads are keyed by the room id the caller already holds, so they run
  // together instead of one round trip after the other. Error precedence stays
  // the room's: a missing room is reported before missing membership.
  const [roomResponse, memberResponse] = await Promise.all([
    options.client
      .from(options.roomsTable)
      .select(options.roomSelect)
      .eq('id', options.roomId)
      .single(),
    options.client
      .from(options.membersTable)
      .select(options.membersSelect)
      .eq('room_id', options.roomId),
  ]);
  const roomData: unknown = roomResponse.data;
  if (roomResponse.error) throw new Error('authorization: cannot read room');
  if (roomData == null) throw new Error('authorization: cannot read room');
  const memberData: unknown = memberResponse.data;
  if (memberResponse.error || !Array.isArray(memberData) || memberData.length === 0) {
    throw new Error('members failed: cannot verify room membership');
  }
  return { room: roomData, members: memberData };
}

/**
 * Resolve the caller's own seat.
 *
 * Pass `uid` when the caller already established the anonymous session; it
 * avoids a second auth round trip. The query is still filtered by that uid and
 * guarded by row-level security, so a wrong uid yields no row rather than
 * someone else's seat. A null uid falls back to the auth lookup.
 */
export async function readRoomParticipant(
  client: SupabaseClient,
  membersTable: string,
  roomId: string,
  uid?: string | null,
): Promise<'p1' | 'p2'> {
  let resolvedUid = uid ?? undefined;
  if (resolvedUid === undefined) {
    const user = await client.auth.getUser();
    resolvedUid = user.data.user?.id;
  }
  if (!resolvedUid) throw new Error('membership: not signed in');
  const memberResponse = await client
    .from(membersTable)
    .select('participant_id')
    .eq('room_id', roomId)
    .eq('uid', resolvedUid)
    .single();
  const seat: unknown = memberResponse.data;
  if (memberResponse.error || seat == null) {
    throw new Error('membership: no seat in this room');
  }
  const participantId = (seat as { participant_id?: unknown }).participant_id;
  if (participantId !== 'p1' && participantId !== 'p2') {
    throw new Error('membership: no seat in this room');
  }
  return participantId;
}

export async function submitRoomVerification(options: {
  client: SupabaseClient;
  rpc: string;
  roomId: string;
  receipt: unknown;
  ownReceiptId: string;
  expectedRevision: number | undefined;
}): Promise<{ receiptId: string; revision: number }> {
  const response = await options.client.rpc(options.rpc, {
    p_room_id: options.roomId,
    p_receipt_id: options.ownReceiptId,
    p_receipt: options.receipt,
    p_expected_revision: options.expectedRevision ?? null,
  });
  if (response.error) throw new Error(`verification submit failed: ${response.error.message}`);
  const record = rpcRecord(response.data);
  if (record['accepted'] !== true) {
    const rejectionCode =
      typeof record['rejectionCode'] === 'string' ? record['rejectionCode'] : 'invalid-receipt';
    const rejectionRevision = rpcNumber(record, 'revision') ?? null;
    throw Object.assign(new Error(`verification submit rejected: ${rejectionCode}`), {
      rejectionCode,
      revision: rejectionRevision,
    });
  }
  const receiptId =
    typeof record['receiptId'] === 'string' && record['receiptId'].length > 0
      ? record['receiptId']
      : options.ownReceiptId;
  return { receiptId, revision: rpcNumber(record, 'revision') ?? 0 };
}

export async function commitRoomFallback(options: {
  client: SupabaseClient;
  rpc: string;
  roomId: string;
  cursor: string;
  payload: unknown;
  expectedRevision: number | undefined;
}): Promise<{ stored: boolean; revision: number }> {
  const response = await options.client.rpc(options.rpc, {
    p_room_id: options.roomId,
    p_cursor: options.cursor,
    p_payload: options.payload,
    p_expected_revision: options.expectedRevision ?? null,
  });
  if (response.error) throw new Error(`commit fallback failed: ${response.error.message}`);
  const record = rpcRecord(response.data);
  return { stored: record['stored'] === true, revision: rpcNumber(record, 'revision') ?? 0 };
}

export async function resolveRoomTimeout(options: {
  client: SupabaseClient;
  rpc: string;
  roomId: string;
  acceptedField: 'resolved' | 'accepted';
}): Promise<{
  roomId: Id;
  commandId: CommandId;
  ordinal: number;
  revision: number;
} | null> {
  const response = await options.client.rpc(options.rpc, { p_room_id: options.roomId });
  if (response.error || !response.data) return null;
  const record = rpcRecord(response.data);
  if (record[options.acceptedField] !== true) return null;
  const rawCommandId = rpcString(record, 'commandId') ?? rpcString(record, 'command_id');
  return {
    roomId: idSchema.parse(options.roomId),
    commandId: commandIdSchema.parse(rawCommandId ?? 'timeout'),
    ordinal: rpcNumber(record, 'ordinal') ?? -1,
    revision: rpcNumber(record, 'revision') ?? 0,
  };
}

export function getCachedTransport<T>(cache: Map<string, T>, key: string, create: () => T): T {
  const existing = cache.get(key);
  if (existing) return existing;
  const created = create();
  cache.set(key, created);
  return created;
}

export function parseRoomCode<T>(
  code: string,
  schema: {
    safeParse(value: string): { success: true; data: T } | { success: false };
  },
): T {
  const clean = code.replace(/\D/g, '').slice(0, 4);
  const parsed = schema.safeParse(clean);
  if (!parsed.success) {
    throw new Error(`invalid-code: expected the host's 4-digit code (got ${code})`);
  }
  return parsed.data;
}

export function stringField(record: Record<string, unknown>, key: string, fallback = ''): string {
  const value = record[key];
  return typeof value === 'string' ? value : fallback;
}

export interface RpcRoomPayload<Code> {
  room_id: Id;
  code: Code | null;
  participant_id: 'p1' | 'p2' | undefined;
}

export function rpcRoomPayload<Code>(
  value: unknown,
  codeSchema: { parse(value: string): Code },
): RpcRoomPayload<Code> {
  const record = value as Record<string, unknown>;
  const participantRaw = record['participant_id'];
  const rawCode = record['code'];
  return {
    room_id: idSchema.parse(stringField(record, 'room_id')),
    code: typeof rawCode === 'string' ? codeSchema.parse(rawCode) : null,
    participant_id: participantRaw === 'p1' || participantRaw === 'p2' ? participantRaw : undefined,
  };
}

export async function readRoomSync(
  client: SupabaseClient,
  mode: 'fixed-five' | 'draft-duel' | 'havoc' | 'cap-rush',
  roomId: string,
  afterOrdinal: number,
) {
  await ensureAnonymous(client);
  const response = await client.rpc('multiplayer_room_sync', {
    p_mode: mode,
    p_room_id: roomId,
    p_after_ordinal: afterOrdinal,
    p_protocol_version: ROOM_PROTOCOL_VERSION,
  });
  if (response.error) throw roomProtocolError(response.error);
  return multiplayerRoomSyncSchema.parse(response.data);
}

/**
 * Turn a protocol refusal into a message a player can act on.
 *
 * The server refuses outdated rooms and versionless clients with stable error
 * codes; the spec requires old clients be told to start a new room rather than
 * silently half-work. Anything else passes through unchanged.
 */
export function roomProtocolError(error: { message: string; details?: string | null }): Error {
  const message = error.message;
  if (message.includes('outdated-room')) {
    return new Error(describeLegacyRoomRejection(ROOM_PROTOCOL_VERSION));
  }
  if (message.includes('unsupported-protocol')) {
    return new Error(
      'This version of the game cannot talk to the server. Reload the page, then start a new room.',
    );
  }
  return new Error(`room sync failed: ${message}`);
}

export interface RealtimeRoomRegistryOptions {
  label: string;
  roomsTable: string;
  commandsTable?: string;
  topic: (roomId: string) => string;
  getClient: () => Promise<SupabaseClient>;
}

export function createRealtimeRoomRegistry(options: RealtimeRoomRegistryOptions) {
  const rooms = new Map<
    string,
    {
      handlers: Map<() => void, ((error: Error) => void) | undefined>;
      channel: RealtimeChannel | null;
    }
  >();

  function invalidate(roomId: string): void {
    for (const handler of rooms.get(roomId)?.handlers.keys() ?? []) handler();
  }

  function failed(roomId: string, error: Error): void {
    for (const onError of rooms.get(roomId)?.handlers.values() ?? []) onError?.(error);
  }

  return {
    subscribe(roomId: string, handler: () => void, onError?: (error: Error) => void) {
      let record = rooms.get(roomId);
      if (!record) {
        record = { handlers: new Map(), channel: null };
        rooms.set(roomId, record);
      }
      record.handlers.set(handler, onError);
      if (!record.channel) {
        const target = record;
        void options
          .getClient()
          .then(async (client) => {
            await ensureAnonymous(client);
            const { REALTIME_SUBSCRIBE_STATES } = await loadSupabaseModule();
            const current = rooms.get(roomId);
            if (!current || current !== target || current.channel || current.handlers.size === 0)
              return;
            const channel = client.channel(options.topic(roomId)).on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: options.roomsTable,
                filter: `id=eq.${roomId}`,
              },
              () => {
                invalidate(roomId);
              },
            );
            if (options.commandsTable)
              channel.on(
                'postgres_changes',
                {
                  event: 'INSERT',
                  schema: 'public',
                  table: options.commandsTable,
                  filter: `room_id=eq.${roomId}`,
                },
                () => {
                  invalidate(roomId);
                },
              );
            current.channel = channel.subscribe((status) => {
              if (rooms.get(roomId) !== target) return;
              if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) invalidate(roomId);
              else {
                failed(
                  roomId,
                  new Error(`${options.label} realtime connection ${status.toLowerCase()}`),
                );
              }
            });
          })
          .catch((error: unknown) => {
            if (rooms.get(roomId) === target)
              failed(roomId, error instanceof Error ? error : new Error(String(error)));
          });
      }
      return {
        unsubscribe: () => {
          const existing = rooms.get(roomId);
          if (!existing) return;
          existing.handlers.delete(handler);
          if (existing.handlers.size === 0) {
            const channel = existing.channel;
            rooms.delete(roomId);
            if (channel)
              void channel
                .unsubscribe()
                .then(() => options.getClient())
                .then((client) => client.removeChannel(channel))
                .catch(() => {});
          }
        },
      };
    },
  };
}

/**
 * Realtime broadcast sender channels.
 *
 * A private broadcast channel is scoped to one room topic, so channels cannot
 * be shared across rooms. Without a bound, every room a client ever published
 * to (`rematch` allocates a new room each series) would keep a live channel for
 * the rest of the page's life. Keep only the most recently used senders and
 * release the rest; a later publish to an evicted room transparently recreates
 * its channel.
 */
const TRANSIENT_SENDER_LIMIT = 3;

interface TransientSender {
  channel: Promise<RealtimeChannel>;
  lastUsed: number;
  active: number;
}

/** Senders are per client: a channel created on one client must be removed from it. */
const transientSendersByClient = new WeakMap<SupabaseClient, Map<string, TransientSender>>();

function transientSenders(client: SupabaseClient): Map<string, TransientSender> {
  let senders = transientSendersByClient.get(client);
  if (!senders) {
    senders = new Map();
    transientSendersByClient.set(client, senders);
  }
  return senders;
}

function releaseTransientSender(
  client: SupabaseClient,
  topic: string,
  sender: TransientSender,
): void {
  transientSenders(client).delete(topic);
  void sender.channel
    .then((channel) => channel.unsubscribe().then(() => client.removeChannel(channel)))
    .catch(() => {});
}

function trimTransientSenders(client: SupabaseClient): void {
  const senders = transientSenders(client);
  const idle = [...senders.entries()]
    .filter(([, sender]) => sender.active === 0)
    .sort((left, right) => left[1].lastUsed - right[1].lastUsed);
  let excess = senders.size - TRANSIENT_SENDER_LIMIT;
  for (const [topic, sender] of idle) {
    if (excess <= 0) break;
    releaseTransientSender(client, topic, sender);
    excess -= 1;
  }
}

/**
 * Acquire the sender for `topic` and mark it in use.
 *
 * The usage count is taken synchronously so a concurrent trim cannot evict a
 * channel that is about to send. The caller clears it once the send settles.
 */
async function acquireTransientSender(
  client: SupabaseClient,
  topic: string,
): Promise<{ sender: TransientSender; channel: RealtimeChannel }> {
  const senders = transientSenders(client);
  let sender = senders.get(topic);
  if (!sender) {
    const creating = (async (): Promise<RealtimeChannel> => {
      const { REALTIME_SUBSCRIBE_STATES } = await loadSupabaseModule();
      try {
        await client.realtime.setAuth();
      } catch {
        await Promise.resolve();
      }
      const channel = client.channel(topic, {
        config: { private: true, broadcast: { self: false } },
      });
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          resolve();
        }, 1500);
        channel.subscribe((status) => {
          if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      return channel;
    })();
    sender = { channel: creating, lastUsed: Date.now(), active: 0 };
    senders.set(topic, sender);
    const owned = sender;
    creating.catch(() => {
      if (senders.get(topic) === owned) senders.delete(topic);
    });
  }
  sender.active += 1;
  sender.lastUsed = Date.now();
  return { sender, channel: await sender.channel };
}

export async function publishTransientPayload(
  getClient: () => Promise<SupabaseClient>,
  topic: string,
  event: string,
  payload: unknown,
): Promise<boolean> {
  let client: SupabaseClient | null = null;
  let sender: TransientSender | null = null;
  try {
    client = await getClient();
    await ensureAnonymous(client);
    const acquired = await acquireTransientSender(client, topic);
    sender = acquired.sender;
    const status = await acquired.channel.send({ type: 'broadcast', event, payload });
    return status === 'ok';
  } catch {
    return false;
  } finally {
    if (sender !== null && client !== null) {
      sender.active -= 1;
      sender.lastUsed = Date.now();
      trimTransientSenders(client);
    }
  }
}

export function subscribeTransientPayloads(options: {
  getClient: () => Promise<SupabaseClient>;
  topic: string;
  event: string;
  onPayload: (payload: unknown) => void;
}): {
  unsubscribe: () => void;
} {
  let channel: RealtimeChannel | null = null;
  let cancelled = false;
  void options
    .getClient()
    .then(async (client) => {
      try {
        await client.realtime.setAuth();
      } catch {
        await Promise.resolve();
      }
      if (cancelled) return;
      channel = client
        .channel(options.topic, { config: { private: true, broadcast: { self: false } } })
        .on('broadcast', { event: options.event }, (message) => {
          options.onPayload(message.payload);
        })
        .subscribe();
    })
    .catch(() => {});
  return {
    unsubscribe: () => {
      cancelled = true;
      const existing = channel;
      channel = null;
      if (existing) {
        void existing.unsubscribe().then(() => {
          void options
            .getClient()
            .then((client) => client.removeChannel(existing))
            .catch(() => {});
        });
      }
    },
  };
}
