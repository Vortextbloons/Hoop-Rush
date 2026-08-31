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
    ): Promise<SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership }> {
      const res = await callEdge<{
        snapshot: SeasonRoomPublicSnapshot;
        membership?: SeasonRoomMembership;
      }>(client, config, 'season-room-resume', { roomId });
      // edge may return membership for retain-private-membership requirement; preserve it on snapshot
      const snap = res.snapshot as SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership };
      if (res.membership)
        (snap as unknown as { membership?: SeasonRoomMembership }).membership = res.membership;
      return snap;
    },

    async refresh(
      roomId: string,
    ): Promise<SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership }> {
      // refresh is alias for resume but retains membership
      const res = await callEdge<{
        snapshot: SeasonRoomPublicSnapshot;
        membership?: SeasonRoomMembership;
      }>(client, config, 'season-room-resume', { roomId });
      const snap = res.snapshot as SeasonRoomPublicSnapshot & { membership?: SeasonRoomMembership };
      if (res.membership)
        (snap as unknown as { membership?: SeasonRoomMembership }).membership = res.membership;
      return snap;
    },

    subscribe(roomId: string, handler: (snap: SeasonRoomPublicSnapshot) => void) {
      let closed = false;
      let channel: ReturnType<SupabaseClient['channel']> | null = null;
      let pollTimer: ReturnType<typeof setInterval> | null = null;

      const fetchSnap = async (): Promise<SeasonRoomPublicSnapshot | null> => {
        try {
          const res = await callEdge<{ snapshot: SeasonRoomPublicSnapshot }>(
            client,
            config,
            'season-room-resume',
            { roomId },
          );
          return res.snapshot;
        } catch {
          return null;
        }
      };

      const start = async () => {
        await ensureAnonAuth(client);
        let realtimeOk = false;
        const startPoll = () => {
          if (pollTimer || closed) return;
          pollTimer = setInterval(async () => {
            if (closed) return;
            const snap = await fetchSnap();
            if (snap && !closed) handler(snap);
          }, 5000);
        };
        try {
          channel = client
            .channel(`season-room-${roomId}`)
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'season_rooms', filter: `id=eq.${roomId}` },
              () => {
                void (async () => {
                  const snap = await fetchSnap();
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
              () => {
                void (async () => {
                  const snap = await fetchSnap();
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
        }, 3000);
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
      const res = await callEdge<{ commands: SeasonPublicCommandEnvelope[] }>(
        client,
        config,
        'season-room-refetch',
        { roomId, afterOrdinal: after },
      );
      return Array.isArray(res.commands) ? res.commands : [];
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
