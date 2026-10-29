import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { idSchema, multiplayerRoomSyncSchema, type Id } from '@hoop-rush/data-contracts';

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

export async function ensureAnonymous(client: SupabaseClient): Promise<void> {
  try {
    const session = await client.auth.getSession();
    if (session.data.session) return;
  } catch {
    throw new Error('anonymous sign-in unreachable: failed to fetch');
  }
  try {
    const signed = await client.auth.signInAnonymously();
    if (signed.error) throw new Error(`anonymous sign-in failed: ${signed.error.message}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('anonymous sign-in failed:')) throw e;
    throw new Error('anonymous sign-in unreachable: failed to fetch');
  }
}

export async function getMultiplayerClient(): Promise<SupabaseClient> {
  const { url, publishableKey } = readSupabaseEnv();
  if (!url || !publishableKey) throw new Error('Online rooms are unavailable in this setup.');
  const client = await supabaseClient(url, publishableKey);
  await ensureAnonymous(client);
  return client;
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
  mode: 'fixed-five' | 'draft-duel' | 'havoc',
  roomId: string,
  afterOrdinal: number,
) {
  await ensureAnonymous(client);
  const response = await client.rpc('multiplayer_room_sync', {
    p_mode: mode,
    p_room_id: roomId,
    p_after_ordinal: afterOrdinal,
  });
  if (response.error) throw new Error(`room sync failed: ${response.error.message}`);
  return multiplayerRoomSyncSchema.parse(response.data);
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

const transientSenderChannels = new Map<string, Promise<RealtimeChannel>>();

async function transientSenderChannel(
  topic: string,
  client: SupabaseClient,
): Promise<RealtimeChannel> {
  const existing = transientSenderChannels.get(topic);
  if (existing) return existing;
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
  transientSenderChannels.set(topic, creating);
  creating.catch(() => {
    if (transientSenderChannels.get(topic) === creating) {
      transientSenderChannels.delete(topic);
    }
  });
  return creating;
}

export async function publishTransientPayload(
  getClient: () => Promise<SupabaseClient>,
  topic: string,
  event: string,
  payload: unknown,
): Promise<boolean> {
  try {
    const client = await getClient();
    await ensureAnonymous(client);
    const channel = await transientSenderChannel(topic, client);
    const status = await channel.send({ type: 'broadcast', event, payload });
    return status === 'ok';
  } catch {
    return false;
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
