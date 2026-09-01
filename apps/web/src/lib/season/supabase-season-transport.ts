import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  SeasonMultiplayerTransport,
  SeasonRoomPublicSnapshot,
  SeasonRoomSettings,
  SeasonRoomMembership,
  SeasonPublicCommandEnvelope,
  SeasonCommandReceipt,
  SeasonPrivateDecisionSubmission,
  SeasonCheckpointAttestation,
  SeasonAcceptedCheckpoint,
  SeasonRerunRequest,
  SeasonIntegrityFailure2,
  SeasonRoomCode,
  SeasonRoomMode,
  SeasonRoomPace,
} from '@hoop-rush/data-contracts';
import {
  PRESENCE_OFFLINE_AFTER_MS,
  SEASON_MULTIPLAYER_VERSION,
  SEASON_ROOM_PROTOCOL_SCHEMA_VERSION,
  isSeasonRoomProtocolOutdated,
} from '@hoop-rush/data-contracts';

export type SupabaseSeasonTransportConfig = {
  url: string;
  publishableKey: string;
  captchaSiteKey?: string;
};

type SupabaseSeasonTransportState = {
  client: SupabaseClient;
  config: SupabaseSeasonTransportConfig;
};

function getErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err)
    return String((err as { code: string }).code);
  return undefined;
}

let _memoDevUid: string | null = null;
let heartbeatFnMissing = false;
function getOrCreateDevUid(): string {
  if (_memoDevUid && /^[0-9a-f-]{36}$/.test(_memoDevUid)) return _memoDevUid;
  try {
    if (typeof localStorage !== 'undefined') {
      let uid = localStorage.getItem('hoop-rush:dev-uid');
      if (uid && /^[0-9a-f-]{36}$/.test(uid)) {
        _memoDevUid = uid;
        return uid;
      }
      uid = crypto.randomUUID();
      try {
        localStorage.setItem('hoop-rush:dev-uid', uid);
      } catch {}
      _memoDevUid = uid;
      return uid;
    }
  } catch {
    /* ignore */
  }
  // fallback in-memory (e.g., localStorage blocked) — keep stable for session via memo
  if (_memoDevUid) return _memoDevUid;
  _memoDevUid = crypto.randomUUID();
  return _memoDevUid;
}

async function ensureAnonAuth(client: SupabaseClient): Promise<void> {
  const { data } = await client.auth.getSession();
  if (data.session) return;
  const { error } = await client.auth.signInAnonymously();
  if (!error) return;
  const code = (error as { code?: string }).code ?? '';
  const msg = String(error.message ?? '');
  const isAnonDisabled =
    code === 'anonymous_provider_disabled' || msg.toLowerCase().includes('anonymous');
  if (!isAnonDisabled)
    throw Object.assign(new Error(`anonymous sign-in failed: ${error.message}`), {
      code: 'authorization',
    });
  // anonymous disabled: fall back to dev UID header (Edge Functions accept x-dev-uid when verify_jwt is bypassed via anon fallback)
  // persist a stable dev UID for this browser so membership remains stable across reloads
  getOrCreateDevUid();
}

async function callEdge<T>(
  client: SupabaseClient,
  config: SupabaseSeasonTransportConfig,
  fn: string,
  body: unknown,
  captchaSiteKey?: string,
): Promise<T> {
  await ensureAnonAuth(client);
  const { data: sess } = await client.auth.getSession();
  const token = sess.session?.access_token;
  const devUid = (() => {
    if (_memoDevUid && /^[0-9a-f-]{36}$/.test(_memoDevUid)) return _memoDevUid;
    try {
      if (typeof localStorage !== 'undefined') {
        const v = localStorage.getItem('hoop-rush:dev-uid');
        if (v && /^[0-9a-f-]{36}$/.test(v)) {
          _memoDevUid = v;
          return v;
        }
      }
    } catch {
      /* ignore */
    }
    return _memoDevUid;
  })();

  const headers: Record<string, string> = {
    apikey: config.publishableKey,
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  else if (devUid) headers['x-dev-uid'] = devUid;
  else throw Object.assign(new Error('missing session token'), { code: 'authorization' });
  if (captchaSiteKey) headers['x-captcha-token'] = captchaSiteKey;
  if (devUid) headers['x-dev-uid'] = devUid;

  const res = await fetch(`${config.url.replace(/\/$/, '')}/functions/v1/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text };
  }

  if (!res.ok) {
    const code = (json as { code?: string })?.code ?? 'authorization';
    const message =
      (json as { message?: string })?.message ?? text ?? `request failed ${res.status}`;
    throw Object.assign(new Error(message), { code, status: res.status, body: json });
  }
  return json as T;
}

function toPublicSnapshot(
  row: {
    id: string;
    pace: string;
    mode?: string | null;
    room_protocol_version: number;
    multiplayer_version: string;
    timer_policy_version: string;
    phase: string;
    cursor: string;
    revision: number;
    digest: string;
    code: string | null;
    code_expires_at: string | null;
    guest_ready?: boolean | null;
    settings_revision?: number | null;
    root_seed?: string | null;
    seed?: string | null;
    presence?: Array<{ participantId: 'p1' | 'p2'; online: boolean; lastSeenAt: string }> | null;
    members?: Array<{ participant_id: string; last_seen_at?: string | null }>;
  },
  memberCount = 0,
): SeasonRoomPublicSnapshot {
  const isOutdated = isSeasonRoomProtocolOutdated(row);
  // derive presence if server didn't include it but members did
  let presence: SeasonRoomPublicSnapshot['presence'] = [];
  if (row.presence) {
    presence = row.presence;
  } else if (row.members) {
    const now = Date.now();
    presence = row.members.map((m) => {
      const lastSeen = m.last_seen_at ? new Date(m.last_seen_at).getTime() : now;
      return {
        participantId: m.participant_id as 'p1' | 'p2',
        online: now - lastSeen <= PRESENCE_OFFLINE_AFTER_MS,
        lastSeenAt: m.last_seen_at ?? new Date(now).toISOString(),
      };
    });
  }
  const seed =
    (row as unknown as { root_seed?: string }).root_seed ??
    (row as unknown as { seed?: string }).seed ??
    null;
  return {
    roomId: row.id,
    settings: {
      schemaVersion: SEASON_ROOM_PROTOCOL_SCHEMA_VERSION,
      pace: row.pace as 'live' | 'async',
      mode: (row.mode as 'season' | 'classic' | 'sandbox' | null) ?? 'season',
      roomProtocolVersion: row.room_protocol_version as unknown as 2,
      multiplayerVersion: row.multiplayer_version as unknown as 'season-multiplayer-v2',
      timerPolicyVersion: row.timer_policy_version as 'season-timers-v1',
    },
    phase: row.phase as SeasonRoomPublicSnapshot['phase'],
    cursor: row.cursor,
    revision: row.revision,
    digest: row.digest,
    memberCount,
    codeActive:
      !!row.code && !!row.code_expires_at && new Date(row.code_expires_at).getTime() > Date.now(),
    expiresAt: row.code_expires_at,
    mode: (row.mode as SeasonRoomMode | null) ?? 'season',
    settingsRevision: (row.settings_revision as number | null) ?? 0,
    guestReady: !!(row.guest_ready as boolean | null),
    presence,
    seed: seed,
    isOutdated: isOutdated || undefined,
  };
}

export function createSupabaseSeasonTransport(
  config: SupabaseSeasonTransportConfig,
): SeasonMultiplayerTransport {
  if (!config.url || !config.publishableKey) {
    const notConfigured = (op: string): never => {
      throw Object.assign(
        new Error(
          `Supabase not configured: ${op} requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY`,
        ),
        { code: 'authorization' },
      );
    };
    return {
      async create() {
        return notConfigured('create');
      },
      async preview() {
        return notConfigured('preview');
      },
      async join() {
        return notConfigured('join');
      },
      async resume() {
        return notConfigured('resume');
      },
      async refresh() {
        return notConfigured('refresh');
      },
      subscribe() {
        return { unsubscribe() {} };
      },
      async refetch() {
        return notConfigured('refetch');
      },
      async submitCommand() {
        return notConfigured('submitCommand');
      },
      async submitPrivateDecision() {
        return notConfigured('submitPrivateDecision');
      },
      async publishAttestation() {
        return notConfigured('publishAttestation');
      },
      async requestReclaim() {
        return notConfigured('requestReclaim');
      },
      async surrender() {
        return notConfigured('surrender');
      },
      async preDraftRemoval() {
        return notConfigured('preDraftRemoval');
      },
      async close() {
        return notConfigured('close');
      },
      async startDraft() {
        return notConfigured('startDraft');
      },
      async updateSettings() {
        return notConfigured('updateSettings');
      },
      async setReady() {
        return notConfigured('setReady');
      },
      async heartbeat() {
        return notConfigured('heartbeat');
      },
      async leave() {
        return notConfigured('leave');
      },
    };
  }

  // singleton per URL to avoid "Multiple GoTrueClient instances" warning
  const _clientKey = `${config.url}::${config.publishableKey}`;
  const _global = globalThis as unknown as {
    __hoopRushSupabaseClients?: Map<string, SupabaseClient>;
  };
  if (!_global.__hoopRushSupabaseClients) _global.__hoopRushSupabaseClients = new Map();
  let client = _global.__hoopRushSupabaseClients.get(_clientKey);
  if (!client) {
    client = createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: `sb-${config.url}-auth-token`,
      },
    });
    _global.__hoopRushSupabaseClients.set(_clientKey, client);
  }

  // Finding 3 cache: Realtime payload.new envelopes keyed by roomId -> ordinal -> envelope, to make refetch() cache-hit and avoid 2nd RTT per notification
  const envelopeCacheByRoom = new Map<string, Map<number, SeasonPublicCommandEnvelope>>();
  const inflightSnapByRoom = new Map<string, Promise<SeasonRoomPublicSnapshot | null>>();

  const getMemberCount = async (roomId: string): Promise<number> => {
    try {
      const snap = await callEdge<{ snapshot: SeasonRoomPublicSnapshot }>(
        client,
        config,
        'season-room-resume',
        { roomId },
      );
      return snap.snapshot.memberCount ?? 0;
    } catch {
      await ensureAnonAuth(client);
      const { count } = await client
        .from('season_room_members')
        .select('participant_id', { count: 'exact', head: true })
        .eq('room_id', roomId);
      return count ?? 0;
    }
  };

  return {
    async create(
      settings: SeasonRoomSettings,
      rootSeed: string,
    ): Promise<SeasonRoomPublicSnapshot & { code?: string; membership?: SeasonRoomMembership }> {
      const res = await callEdge<{
        snapshot: SeasonRoomPublicSnapshot;
        code: string;
        roomId: string;
        membership?: SeasonRoomMembership;
      }>(
        client,
        config,
        'season-room-create',
        {
          pace: settings.pace,
          mode: settings.mode ?? 'season',
          rootSeed,
        },
        config.captchaSiteKey,
      );
      const snap = res.snapshot as SeasonRoomPublicSnapshot & {
        code?: string;
        membership?: SeasonRoomMembership;
      };
      (snap as unknown as { code?: string }).code = res.code;
      if (res.membership)
        (snap as unknown as { membership?: SeasonRoomMembership }).membership = res.membership;
      else {
        // fallback: host is p1 if resume works; try to fetch membership via resume-side uid?
        // membership will be hydrated via local devUid if edge didn't return it; keep snap without membership and coordinator will still treat as host via stored code
      }
      // ensure mode is reflected even if server still returns old shape without mode
      if (!(snap.settings as unknown as { mode?: string }).mode) {
        (snap.settings as unknown as { mode: string }).mode = settings.mode ?? 'season';
      }
      return snap;
    },

    async preview(code: string): Promise<SeasonRoomPublicSnapshot> {
      const res = await callEdge<{ snapshot: SeasonRoomPublicSnapshot }>(
        client,
        config,
        'season-room-preview',
        { code },
        config.captchaSiteKey,
      );
      return res.snapshot;
    },

    async join(code: string): Promise<SeasonRoomMembership> {
      const res = await callEdge<{ membership: SeasonRoomMembership }>(
        client,
        config,
        'season-room-join',
        { code },
        config.captchaSiteKey,
      );
      return res.membership;
    },

    async resume(
      roomId: string,
      afterOrdinal?: number,
    ): Promise<SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership; commands?: SeasonPublicCommandEnvelope[] }> {
      const body: Record<string, unknown> = { roomId };
      if (typeof afterOrdinal === 'number' && Number.isFinite(afterOrdinal)) body.afterOrdinal = afterOrdinal;
      const res = await callEdge<{
        snapshot: SeasonRoomPublicSnapshot;
        membership?: SeasonRoomMembership;
        commands?: SeasonPublicCommandEnvelope[];
      }>(client, config, 'season-room-resume', body);
      // edge may return membership for retain-private-membership requirement; preserve it on snapshot
      const snap = res.snapshot as SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership; commands?: SeasonPublicCommandEnvelope[] };
      if (res.membership)
        (snap as unknown as { membership?: SeasonRoomMembership }).membership = res.membership;
      // Wire up afterOrdinal scaffolding: if edge returned commands, populate realtime cache so next refetch is 0 RTT
      if (Array.isArray(res.commands) && res.commands.length > 0) {
        let byOrd = envelopeCacheByRoom.get(roomId);
        if (!byOrd) {
          byOrd = new Map();
          envelopeCacheByRoom.set(roomId, byOrd);
        }
        for (const c of res.commands) byOrd.set(c.ordinal, c as SeasonPublicCommandEnvelope);
        if (byOrd.size > 200) {
          const sortedKeys = [...byOrd.keys()].sort((a, b) => a - b);
          for (let i = 0; i < sortedKeys.length - 200; i += 1) byOrd.delete(sortedKeys[i]!);
        }
        (snap as unknown as { commands?: SeasonPublicCommandEnvelope[] }).commands = res.commands as SeasonPublicCommandEnvelope[];
      }
      return snap;
    },

    async refresh(
      roomId: string,
    ): Promise<SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership }> {
      // refresh is alias for resume but retains membership
      const res = await callEdge<{
        snapshot: SeasonRoomPublicSnapshot;
        membership?: SeasonRoomMembership;
        commands?: SeasonPublicCommandEnvelope[];
      }>(client, config, 'season-room-resume', { roomId });
      const snap = res.snapshot as SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership; commands?: SeasonPublicCommandEnvelope[] };
      if (res.membership)
        (snap as unknown as { membership?: SeasonRoomMembership }).membership = res.membership;
      if (Array.isArray(res.commands) && res.commands.length > 0) {
        (snap as unknown as { commands?: SeasonPublicCommandEnvelope[] }).commands = res.commands as SeasonPublicCommandEnvelope[];
      }
      return snap;
    },

    subscribe(roomId: string, handler: (snap: SeasonRoomPublicSnapshot) => void) {
      let closed = false;
      let channel: ReturnType<SupabaseClient['channel']> | null = null;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      // Trade-off: poll 5s is fallback only when realtime fails. Heartbeat 5s / offline 30s gives 6 missed beats before disconnected. Reducing poll grace to 1s improves Ready/start visibility without increasing overall poll frequency.

      function envelopeFromRealtimeRow(
        row: Record<string, unknown>,
      ): SeasonPublicCommandEnvelope | null {
        try {
          const command_id = (row.command_id ?? row.commandId) as unknown;
          const ordinal = row.ordinal as unknown;
          const run_id = (row.run_id ?? row.runId) as unknown;
          const payload = (row.payload ?? row.envelope) as unknown;
          const actor_participant_id = (row.actor_participant_id ??
            row.actorParticipantId) as unknown;
          const actor_franchise_id = (row.actor_franchise_id ?? row.actorFranchiseId) as unknown;
          const receipt = row.receipt as { accepted?: boolean } | null | undefined;
          if (typeof command_id !== 'string' || typeof ordinal !== 'number' || payload == null)
            return null;
          if (
            payload &&
            typeof payload === 'object' &&
            typeof (payload as { commandId?: unknown }).commandId === 'string' &&
            typeof (payload as { ordinal?: unknown }).ordinal === 'number'
          ) {
            const p = payload as SeasonPublicCommandEnvelope;
            if (p.roomId !== roomId) return null;
            return p;
          }
          if (
            typeof run_id !== 'string' ||
            typeof actor_participant_id !== 'string' ||
            typeof actor_franchise_id !== 'string'
          )
            return null;
          const env: SeasonPublicCommandEnvelope = {
            schemaVersion: 2 as const,
            roomId,
            commandId: command_id,
            ordinal,
            runId: run_id,
            payload: payload as unknown,
            actorParticipantId: actor_participant_id as 'p1' | 'p2',
            actorFranchiseId: actor_franchise_id,
          };
          void receipt;
          return env;
        } catch {
          return null;
        }
      }

      const fetchSnap = async (): Promise<SeasonRoomPublicSnapshot | null> => {
        try {
          // Include afterOrdinal when cache has entries so edge can return tail commands in same RTT
          const byOrd = envelopeCacheByRoom.get(roomId);
          const body: Record<string, unknown> = { roomId };
          if (byOrd && byOrd.size > 0) {
            const maxOrdinal = Math.max(...byOrd.keys());
            if (Number.isFinite(maxOrdinal)) body.afterOrdinal = maxOrdinal;
          }
          const res = await callEdge<{ snapshot: SeasonRoomPublicSnapshot; commands?: SeasonPublicCommandEnvelope[] }>(
            client,
            config,
            'season-room-resume',
            body,
          );
          // Cache any commands returned with snapshot so refetch is 0 RTT
          if (Array.isArray(res.commands)) {
            for (const c of res.commands) {
              if (c && typeof c.ordinal === 'number') cacheEnvelope(c as SeasonPublicCommandEnvelope);
            }
          }
          return res.snapshot;
        } catch {
          return null;
        }
      };

      const coalescedFetchSnap = async (): Promise<SeasonRoomPublicSnapshot | null> => {
        const existing = inflightSnapByRoom.get(roomId);
        if (existing) return existing;
        const p = fetchSnap().finally(() => {
          if (inflightSnapByRoom.get(roomId) === p) inflightSnapByRoom.delete(roomId);
        });
        inflightSnapByRoom.set(roomId, p);
        return p;
      };

      function cacheEnvelope(env: SeasonPublicCommandEnvelope): void {
        let byOrd = envelopeCacheByRoom.get(roomId);
        if (!byOrd) {
          byOrd = new Map();
          envelopeCacheByRoom.set(roomId, byOrd);
        }
        byOrd.set(env.ordinal, env);
        if (byOrd.size > 200) {
          const sorted = [...byOrd.keys()].sort((a, b) => a - b);
          for (let i = 0; i < sorted.length - 200; i += 1) byOrd.delete(sorted[i]!);
        }
      }

      const start = async () => {
        await ensureAnonAuth(client);
        let realtimeOk = false;
        const startPoll = () => {
          if (pollTimer || closed) return;
          let pollInFlight = false;
          pollTimer = setInterval(async () => {
            if (closed || pollInFlight) return;
            pollInFlight = true;
            try {
              const snap = await fetchSnap();
              if (snap && !closed) handler(snap);
            } finally {
              pollInFlight = false;
            }
          }, 5000); // polls only when realtime not SUBSCRIBED; deduped via realtimeOk guard + in-flight check
        };
        try {
          channel = client
            .channel(`season-room-${roomId}`)
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'season_rooms', filter: `id=eq.${roomId}` },
              (payload: unknown) => {
                void (async () => {
                  // payload.new is validated but snapshot still needs presence/memberCount (joins), so use coalesced fetch
                  void payload;
                  const snap = await coalescedFetchSnap();
                  if (snap && !closed) handler(snap);
                })();
              },
            )
            .on(
              'postgres_changes',
              {
                event: 'INSERT',
                schema: 'public',
                table: 'season_room_commands',
                filter: `room_id=eq.${roomId}`,
              },
              (payload: unknown) => {
                void (async () => {
                  try {
                    const p = payload as {
                      new?: Record<string, unknown>;
                      eventType?: string;
                    } | null;
                    const row = p?.new as Record<string, unknown> | undefined;
                    if (row && typeof row.ordinal === 'number') {
                      const env = envelopeFromRealtimeRow(row);
                      if (env && Number.isFinite(env.ordinal)) cacheEnvelope(env);
                    }
                  } catch {
                    /* ignore payload parse errors, fallback to fetch */
                  }
                  const snap = await coalescedFetchSnap();
                  if (snap && !closed) handler(snap);
                })();
              },
            )
            .subscribe((status) => {
              if (status === 'SUBSCRIBED') {
                realtimeOk = true;
                if (pollTimer) {
                  clearInterval(pollTimer);
                  pollTimer = null;
                }
              } else if (
                status === 'CHANNEL_ERROR' ||
                status === 'TIMED_OUT' ||
                status === 'CLOSED'
              ) {
                realtimeOk = false;
                startPoll();
              }
            });
        } catch {
          startPoll();
        }
        setTimeout(() => {
          if (!closed && !realtimeOk) startPoll();
        }, 1000); // reduced from 3000 to reduce snapshot staleness before fallback poll
      };

      void start();

      return {
        unsubscribe() {
          closed = true;
          if (channel) void client.removeChannel(channel);
          if (pollTimer) clearInterval(pollTimer);
        },
      };
    },

    async refetch(roomId: string, afterOrdinal: number): Promise<SeasonPublicCommandEnvelope[]> {
      const after = Number.isFinite(afterOrdinal) ? afterOrdinal : -1;
      // Finding 3: try Realtime payload cache first to avoid 2nd RTT per notification.
      // Cache is populated from postgres_changes payload.new (REPLICA IDENTITY FULL) and validated via envelopeFromRealtimeRow.
      // Only return cache hit when we have contiguous ordinals starting at after+1; otherwise fallback to network to preserve ordinal invariant.
      // Monitor in real two-client testing: if gaps appear (cache non-contiguous), fallback ensures correctness; log when fallback triggers for observability.
      const byOrd = envelopeCacheByRoom.get(roomId);
      if (byOrd && byOrd.size > 0) {
        const sorted = [...byOrd.values()]
          .filter((e) => e.ordinal > after)
          .sort((a, b) => a.ordinal - b.ordinal);
        if (sorted.length > 0 && sorted[0]!.ordinal === after + 1) {
          let contiguous = true;
          for (let i = 1; i < sorted.length; i += 1) {
            if (sorted[i]!.ordinal !== sorted[i - 1]!.ordinal + 1) {
              contiguous = false;
              break;
            }
          }
          // If contiguous and we believe cache is fresh (has at least one entry), return it.
          // Caller (coordinator) will still validate ordinal === lastOrdinal+1 and will fallback to network on gap via next notification's refetch.
          // To stay safe, only use cache when gap is contiguous; non-contiguous falls through to network.
          if (contiguous) {
            // We cannot guarantee we have latest tail if Realtime missed events, but coordinator's next refetch will be incremental.
            // For the common single-command notification, returning 1 cached envelope saves one RTT and preserves invariant.
            // If we suspect missing tail (e.g., cache size 1 but server may have more), the next snapshot notification will trigger another refetch that will be contiguous.
            // To avoid stale tail, we still perform parallel network fetch check? For now return cache for immediate ordinal.
            // Bounded: cache hit returns immediately, network not called.
            return sorted;
          }
        }
      }
      const res = await callEdge<{ commands: SeasonPublicCommandEnvelope[] }>(
        client,
        config,
        'season-room-refetch',
        { roomId, afterOrdinal: after },
      );
      const cmds = Array.isArray(res.commands) ? res.commands : [];
      // populate cache with fetched commands for future coalescing
      if (cmds.length > 0) {
        let map = envelopeCacheByRoom.get(roomId);
        if (!map) {
          map = new Map();
          envelopeCacheByRoom.set(roomId, map);
        }
        for (const c of cmds) map.set(c.ordinal, c);
        if (map.size > 200) {
          const sortedKeys = [...map.keys()].sort((a, b) => a - b);
          for (let i = 0; i < sortedKeys.length - 200; i += 1) map.delete(sortedKeys[i]!);
        }
      }
      return cmds;
    },

    async submitCommand(envelope: SeasonPublicCommandEnvelope): Promise<SeasonCommandReceipt> {
      const res = await callEdge<{ receipt: SeasonCommandReceipt }>(
        client,
        config,
        'season-room-command',
        { envelope },
      );
      return res.receipt;
    },

    async submitPrivateDecision(
      submission: SeasonPrivateDecisionSubmission,
    ): Promise<{ locked: boolean }> {
      const res = await callEdge<{ locked: boolean }>(client, config, 'season-private-decision', {
        submission,
      });
      return res;
    },

    async publishAttestation(
      attestation: SeasonCheckpointAttestation,
    ): Promise<SeasonAcceptedCheckpoint | SeasonRerunRequest | SeasonIntegrityFailure2> {
      const res = await callEdge<
        | { kind: 'accepted'; accepted: SeasonAcceptedCheckpoint }
        | { kind: 'rerun'; reason: string; attempt: number }
        | { kind: 'integrity-failed'; failure: SeasonIntegrityFailure2 }
      >(client, config, 'season-checkpoint-attest', { attestation });
      if ('kind' in res) {
        if (res.kind === 'accepted')
          return (res as { accepted: SeasonAcceptedCheckpoint }).accepted;
        if (res.kind === 'rerun')
          return {
            roomId: attestation.roomId,
            cursor: attestation.cursor,
            reason: (res as { reason: string }).reason,
            attempt: (res as { attempt: number }).attempt,
          };
        if (res.kind === 'integrity-failed')
          return (res as { failure: SeasonIntegrityFailure2 }).failure;
      }
      return res;
    },

    async requestReclaim(roomId: string, participantId: 'p1' | 'p2'): Promise<void> {
      await callEdge<{ ok: boolean }>(client, config, 'season-room-reclaim', {
        roomId,
        participantId,
      });
    },

    async surrender(roomId: string, participantId: 'p1' | 'p2'): Promise<void> {
      await callEdge<{ ok: boolean }>(client, config, 'season-room-surrender', {
        roomId,
        participantId,
      });
    },

    async preDraftRemoval(
      roomId: string,
      targetParticipantId: 'p1' | 'p2',
    ): Promise<SeasonRoomCode> {
      const res = await callEdge<{ code: SeasonRoomCode }>(
        client,
        config,
        'season-room-pre-draft-removal',
        { roomId, targetParticipantId },
      );
      return res.code;
    },

    async close(roomId: string): Promise<void> {
      await callEdge<{ ok: boolean }>(client, config, 'season-room-close', { roomId });
    },

    async startDraft(roomId: string): Promise<SeasonRoomPublicSnapshot> {
      const res = await callEdge<{ snapshot: SeasonRoomPublicSnapshot }>(
        client,
        config,
        'season-room-start-draft',
        { roomId },
      );
      return res.snapshot;
    },

    async updateSettings(
      roomId: string,
      settings: { mode: SeasonRoomMode; pace: SeasonRoomPace },
      expectedSettingsRevision?: number,
    ): Promise<SeasonRoomPublicSnapshot> {
      try {
        const res = await callEdge<{ snapshot: SeasonRoomPublicSnapshot }>(
          client,
          config,
          'season-room-update-settings',
          { roomId, mode: settings.mode, pace: settings.pace, expectedSettingsRevision },
        );
        return res.snapshot;
      } catch (err) {
        // fallback for older deployments without this edge: try direct RPC if available; otherwise throw
        const code = (err as { code?: string })?.code;
        if (code === 'outdated-room' || code === 'authorization' || code === 'stale-revision')
          throw err;
        // attempt to synthesize error for local test without supabase: if supabase not configured, this won't be called
        throw err;
      }
    },

    async setReady(
      roomId: string,
      participantId: 'p1' | 'p2',
      ready: boolean,
      expectedSettingsRevision?: number,
    ): Promise<SeasonRoomPublicSnapshot> {
      const res = await callEdge<{ snapshot: SeasonRoomPublicSnapshot }>(
        client,
        config,
        'season-room-set-ready',
        { roomId, participantId, ready, expectedSettingsRevision },
      );
      return res.snapshot;
    },

    async heartbeat(roomId: string, participantId: 'p1' | 'p2'): Promise<void> {
      if (heartbeatFnMissing) {
        // resume already stamps last_seen_at for the caller
        await callEdge(client, config, 'season-room-resume', { roomId }).catch(() => {});
        return;
      }
      try {
        await callEdge<{ ok: boolean }>(client, config, 'season-room-heartbeat', {
          roomId,
          participantId,
        });
      } catch (err) {
        const status = (err as { status?: number }).status;
        // undeployed functions 404 without CORS, so the browser often yields no status
        if (status && status !== 404) return;
        heartbeatFnMissing = true;
        await callEdge(client, config, 'season-room-resume', { roomId }).catch(() => {});
      }
    },

    async leave(roomId: string, participantId: 'p1' | 'p2'): Promise<void> {
      await callEdge<{ ok: boolean }>(client, config, 'season-room-leave', {
        roomId,
        participantId,
      });
    },
  };
}

export function isSupabaseConfigured(): boolean {
  const url = (import.meta as unknown as { env: Record<string, string | undefined> }).env
    ?.VITE_SUPABASE_URL;
  const key = (import.meta as unknown as { env: Record<string, string | undefined> }).env
    ?.VITE_SUPABASE_PUBLISHABLE_KEY;
  const flag = (import.meta as unknown as { env: Record<string, string | undefined> }).env
    ?.VITE_ENABLE_MULTIPLAYER;
  return Boolean(url && key && flag !== 'false');
}

export function multiplayerDisabledMessage(): string {
  return 'Multiplayer is not configured. Set VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_CAPTCHA_SITE_KEY and VITE_ENABLE_MULTIPLAYER=true, or continue in solo mode.';
}
