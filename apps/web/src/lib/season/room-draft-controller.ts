import type {
  SeasonRoomPublicSnapshot,
  SeasonRoomMembership,
  SeasonMultiplayerTransport,
  SeasonPublicCommandEnvelope,
  SeasonDraftCatalog,
  SeasonDraftState,
  SeasonDraftCommand,
  SeasonDraftCommandRecord,
  SeasonLeague,
  SeasonLeagueGenerationResult,
  SeasonRosterTargets,
  SeasonDraftOffer,
} from '@hoop-rush/data-contracts';
import {
  SEASON_DRAFT_OFFER_SIZE,
  SEASON_DRAFT_SAFE_MINIMUM,
  SEASON_DRAFT_VERSION,
  seasonDraftCatalogSchema,
  seasonLeagueSchema,
  seasonRosterTargetsSchema,
  seasonNamespaceSeed,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import {
  applySeasonDraftCommand,
  drawGlobalOffer,
  seasonDraftStateDigest,
  seasonDraftStateCanonical,
  generateAiLeague as engineGenerateAiLeague,
  DUO_BAND_QUOTAS,
  createRng,
} from '@hoop-rush/engine';

export type RoomDraftMode = SeasonRoomPublicSnapshot['mode'];

export interface RoomDraftControllerOptions {
  transport: SeasonMultiplayerTransport;
  roomId: string;
  snapshot: SeasonRoomPublicSnapshot;
  membership?: SeasonRoomMembership | null;
  catalog?: SeasonDraftCatalog | null;
  league?: SeasonLeague | null;
  rosterTargets?: SeasonRosterTargets | null;
  fetchImpl?: typeof fetch;
}

function commandIdFor(rootSeed: string, kind: string, ...parts: string[]): string {
  const seed = seasonNamespaceSeed(rootSeed, 'draft', kind, ...parts);
  const hex = seasonDigestHex(seed);
  return `${kind}-${hex.slice(0, 16)}`.slice(0, 64);
}

function isDraftCommand(value: unknown): value is SeasonDraftCommand {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.commandId === 'string' &&
    typeof v.expectedRevision === 'number' &&
    v.payload !== null &&
    typeof v.payload === 'object' &&
    typeof (v.payload as Record<string, unknown>).kind === 'string'
  );
}

function franchiseIdOfState(state: SeasonDraftState, participantId: string): string {
  const p = state.participants.find((x) => x.participantId === participantId);
  return p?.franchiseId ?? `franchise-${participantId}`;
}

function envelopeToDraftCommand(
  env: SeasonPublicCommandEnvelope,
  state: SeasonDraftState | null,
): SeasonDraftCommand | null {
  if ((env as SeasonPublicCommandEnvelope & { accepted?: boolean }).accepted === false) {
    return null;
  }
  const raw = env.payload;
  if (isDraftCommand(raw)) return raw;
  if (!raw || typeof raw !== 'object' || !('kind' in (raw as Record<string, unknown>))) {
    return null;
  }
  const payload = raw as SeasonDraftCommand['payload'];
  const kinds = [
    'create-season-draft',
    'draw-season-offer',
    'select-draft-player',
    'finalize-human-rosters',
    'generate-ai-league',
    'reveal-draft-roll',
    'claim-draft-pool',
  ];
  if (kinds.includes(payload.kind)) {
    return {
      commandId: env.commandId,
      expectedRevision: state?.revision ?? 0,
      payload,
    };
  }
  if ((payload as unknown as Record<string, unknown>).kind === 'room-draft-pick') {
    const p = payload as unknown as { participantId: string; playerVersionId: string };
    const pid = p.participantId as 'p1' | 'p2';
    const vid = p.playerVersionId;
    return {
      commandId: env.commandId,
      expectedRevision: state?.revision ?? 0,
      payload: { kind: 'select-draft-player', participantId: pid, playerVersionId: vid },
    };
  }
  return null;
}

export class RoomDraftController {
  private transport: SeasonMultiplayerTransport;
  private roomId: string;
  private snapshot: SeasonRoomPublicSnapshot;
  private membership: SeasonRoomMembership | null;
  private catalog: SeasonDraftCatalog | null;
  private league: SeasonLeague | null;
  private rosterTargets: SeasonRosterTargets | null;
  private fetchImpl: typeof fetch;
  private state: SeasonDraftState | null = null;
  private generation: SeasonLeagueGenerationResult | null = null;
  private lastOrdinal = -1;
  private turnStartedAt: number | null = null;
  // Claim 6: server-authoritative deadline handling (season_deadlines table)
  private deadlineAt: string | null = null;
  private fallbackPayload: unknown | null = null;
  private deadlineCursor: string | null = null;
  // Claim 8: surface replay integrity failures instead of silently discarding
  private lastReplayError: string | null = null;
  private integrityFailed = false;
  private skippedCommands = 0;
  private restoreInFlight: Promise<SeasonDraftState | null> | null = null;

  constructor(opts: RoomDraftControllerOptions) {
    this.transport = opts.transport;
    this.roomId = opts.roomId;
    this.snapshot = opts.snapshot;
    this.membership = opts.membership ?? null;
    this.catalog = opts.catalog ?? null;
    this.league = opts.league ?? null;
    this.rosterTargets = opts.rosterTargets ?? null;
    this.fetchImpl =
      opts.fetchImpl ??
      (typeof fetch !== 'undefined'
        ? fetch.bind(globalThis)
        : async () => {
            throw new Error('fetch unavailable');
          });
    // Claim 6: restore persisted turn start to avoid granting +90s on reload
    const persisted = this.loadPersistedTurn();
    if (persisted !== null) this.turnStartedAt = persisted;
    // If snapshot already carries a server deadline (coordinator may inject), honor it
    const snapWithDeadline = opts.snapshot as unknown as {
      deadlineAt?: string | null;
      deadlineCursor?: string | null;
      fallbackPayload?: unknown;
    };
    if (snapWithDeadline?.deadlineAt)
      this.setServerDeadline(
        snapWithDeadline.deadlineAt,
        snapWithDeadline.fallbackPayload ?? null,
        snapWithDeadline.deadlineCursor ?? null,
      );
  }

  getState(): SeasonDraftState | null {
    return this.state;
  }

  getGeneration(): SeasonLeagueGenerationResult | null {
    return this.generation;
  }

  getTurn(): string | null {
    return this.state?.currentTurnParticipantId ?? null;
  }

  getDigest(): string | null {
    if (!this.state) return null;
    return seasonDraftStateDigest(this.state);
  }

  getRevision(): number {
    return this.state?.revision ?? 0;
  }

  getLastOrdinal(): number {
    return this.lastOrdinal;
  }

  currentOfferFor(viewerParticipantId: string | null): SeasonDraftOffer | null {
    if (!this.state) return null;
    if (!this.state.currentOffer) return null;
    if (viewerParticipantId === null) return null;
    if (this.state.currentOffer.participantId !== viewerParticipantId) return null;
    return this.state.currentOffer;
  }

  currentOffer(): SeasonDraftOffer | null {
    return this.state?.currentOffer ?? null;
  }

  getTurnStartedAt(): number | null {
    return this.turnStartedAt;
  }

  // Claim 6: server deadline is authoritative; client timer is fallback only
  getDeadlineAt(): string | null {
    return this.deadlineAt;
  }
  getDeadlineCursor(): string | null {
    return this.deadlineCursor;
  }
  getFallbackPayload(): unknown | null {
    return this.fallbackPayload;
  }
  /**
   * Set server-authoritative deadline. Prefer supabase season_deadlines.deadline_at
   * over local turnStartedAt. When a deadline is set, getSecondsRemaining() derives
   * from deadlineAt. Fallback payload/cursor are stored for verification.
   */
  setServerDeadline(
    deadlineAt: string | null,
    fallbackPayload: unknown | null = null,
    deadlineCursor: string | null = null,
  ): void {
    this.deadlineAt = deadlineAt;
    this.fallbackPayload = fallbackPayload;
    this.deadlineCursor = deadlineCursor;
    // Persist for cross-reload stability when server deadline is present
    this.persistTurnStartedAt(this.turnStartedAt);
    // If server deadline is present, local timer is secondary; do not reset turnStartedAt
    // If server deadline cleared, fallback to local timer (may have persisted value)
  }

  /**
   * Attempt to fetch server deadline from Supabase REST if fetchImpl and env are available.
   * Uses season_deadlines table: room_id=eq.<roomId>&cursor=eq.<cursor>&select=deadline_at,fallback_payload,cursor
   * Falls back silently if not configured; caller may ignore failure and use local timer.
   */
  async fetchServerDeadline(cursor: string | null = null): Promise<string | null> {
    const c = cursor ?? this.deadlineCursor ?? (this.state ? `draft-${this.state.round}` : null);
    if (!c) return this.deadlineAt;
    // Try to derive Supabase URL from environment or window
    let baseUrl: string | null = null;
    try {
      const env = (import.meta as unknown as { env?: Record<string, string> })?.env;
      baseUrl = env?.VITE_SUPABASE_URL ?? null;
    } catch {}
    if (!baseUrl) {
      try {
        baseUrl = (globalThis as unknown as { __SUPABASE_URL?: string }).__SUPABASE_URL ?? null;
      } catch {}
    }
    if (!baseUrl) return this.deadlineAt;
    const url = `${baseUrl.replace(/\/$/, '')}/rest/v1/season_deadlines?room_id=eq.${encodeURIComponent(this.roomId)}&cursor=eq.${encodeURIComponent(c)}&select=deadline_at,fallback_payload,cursor&limit=1`;
    try {
      const res = await this.fetchImpl(url, { cache: 'no-store' });
      if (!res.ok) return this.deadlineAt;
      const rows = (await res.json()) as Array<{
        deadline_at: string;
        fallback_payload: unknown;
        cursor: string;
      }>;
      if (rows.length > 0 && rows[0]?.deadline_at) {
        this.setServerDeadline(
          rows[0].deadline_at,
          rows[0].fallback_payload ?? null,
          rows[0].cursor ?? c,
        );
        return this.deadlineAt;
      }
    } catch (e) {
      console.warn('[room-draft-controller] fetchServerDeadline failed', e);
    }
    return this.deadlineAt;
  }

  getSecondsRemaining(now = Date.now()): number | null {
    const pace = this.snapshot.settings.pace;
    if (pace !== 'live') return null;
    // Server deadline is authoritative — derive from deadlineAt if present
    if (this.deadlineAt) {
      const deadlineMs = new Date(this.deadlineAt).getTime();
      if (Number.isFinite(deadlineMs)) {
        return Math.max(0, Math.floor((deadlineMs - now) / 1000));
      }
    }
    if (!this.turnStartedAt) return null;
    const elapsed = (now - this.turnStartedAt) / 1000;
    return Math.max(0, 90 - Math.floor(elapsed));
  }

  // Claim 8: replay integrity surface
  getLastReplayError(): string | null {
    return this.lastReplayError;
  }
  hasIntegrityFailure(): boolean {
    return this.integrityFailed;
  }
  getSkippedCommandCount(): number {
    return this.skippedCommands;
  }
  clearReplayErrors(): void {
    this.lastReplayError = null;
    this.integrityFailed = false;
    this.skippedCommands = 0;
  }

  private storageKey(): string {
    return `hr:draft:turn:${this.roomId}`;
  }
  private loadPersistedTurn(): number | null {
    try {
      if (typeof window !== 'undefined') {
        const raw =
          window.sessionStorage?.getItem(this.storageKey()) ??
          window.localStorage?.getItem(this.storageKey()) ??
          null;
        if (raw) {
          const parsed = JSON.parse(raw) as { turnStartedAt?: number; deadlineAt?: string | null };
          if (typeof parsed.turnStartedAt === 'number' && Number.isFinite(parsed.turnStartedAt)) {
            // If persisted deadline exists and matches current deadlineAt, still return turnStartedAt
            return parsed.turnStartedAt;
          }
        }
      }
    } catch {}
    return null;
  }
  private persistTurnStartedAt(ts: number | null): void {
    try {
      if (typeof window === 'undefined') return;
      const key = this.storageKey();
      if (ts === null) {
        window.sessionStorage?.removeItem(key);
        window.localStorage?.removeItem(key);
        return;
      }
      const payload = JSON.stringify({
        turnStartedAt: ts,
        deadlineAt: this.deadlineAt,
        deadlineCursor: this.deadlineCursor,
        savedAt: Date.now(),
      });
      window.sessionStorage?.setItem(key, payload);
      window.localStorage?.setItem(key, payload);
    } catch {}
  }
  private setTurnStartedAtIfNeeded(): void {
    // Do not blindly reset: only set if no server deadline and no existing local start
    if (this.deadlineAt) return;
    if (this.turnStartedAt !== null) return;
    const persisted = this.loadPersistedTurn();
    if (persisted !== null) {
      this.turnStartedAt = persisted;
      return;
    }
    this.turnStartedAt = Date.now();
    this.persistTurnStartedAt(this.turnStartedAt);
  }

  private generationDeps(): {
    generate: (
      input: Omit<import('@hoop-rush/engine').SeasonAiGenerationInput, 'targets'>,
    ) => SeasonLeagueGenerationResult;
  } {
    const targets = this.rosterTargets;
    if (!targets) {
      return {
        generate: () => {
          throw new Error('roster targets not loaded');
        },
      };
    }
    return {
      generate: (input) => engineGenerateAiLeague({ ...input, targets }),
    };
  }

  private async ensureAssets(): Promise<void> {
    if (this.catalog && this.league && this.rosterTargets) return;
    const needCatalog = !this.catalog;
    const needLeague = !this.league;
    const needTargets = !this.rosterTargets;
    const fetchJson = async (url: string): Promise<unknown> => {
      const res = await this.fetchImpl(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`fetch ${url} failed ${res.status}`);
      return res.json();
    };
    const catalogUrl = '/data/season/draft-catalog.json';
    const leagueUrl = '/data/season/league.json';
    const targetsUrl = '/data/season/roster-targets.json';
    const tasks: Promise<void>[] = [];
    if (needCatalog) {
      tasks.push(
        (async () => {
          try {
            const raw = await fetchJson(catalogUrl);
            this.catalog = seasonDraftCatalogSchema.parse(raw);
          } catch (e) {
            if (typeof window !== 'undefined' && window.location?.origin) {
              const raw = await fetchJson(`${window.location.origin}${catalogUrl}`);
              this.catalog = seasonDraftCatalogSchema.parse(raw);
            } else throw e;
          }
        })(),
      );
    }
    if (needLeague) {
      tasks.push(
        (async () => {
          const raw = await fetchJson(leagueUrl);
          this.league = seasonLeagueSchema.parse(raw);
        })(),
      );
    }
    if (needTargets) {
      tasks.push(
        (async () => {
          const raw = await fetchJson(targetsUrl);
          this.rosterTargets = seasonRosterTargetsSchema.parse(raw);
        })(),
      );
    }
    if (tasks.length > 0) await Promise.all(tasks);
    if (this.catalog && this.catalog.candidates.length < SEASON_DRAFT_OFFER_SIZE) {
      throw new Error(
        `catalog has ${this.catalog.candidates.length} candidates; need ${SEASON_DRAFT_OFFER_SIZE}`,
      );
    }
  }

  private franchiseIdOf(participantId: string): string {
    if (this.membership?.participantId === participantId) return this.membership.franchiseId;
    if (this.state) return franchiseIdOfState(this.state, participantId);
    return participantId === 'p1' ? 'franchise-p1' : 'franchise-p2';
  }

  deriveOfferPreview(participantId: string): SeasonDraftOffer | null {
    if (!this.state || !this.catalog) return null;
    const result = drawGlobalOffer(this.state, this.catalog, participantId);
    if (result.status !== 'drawn') return null;
    const seedPath = result.offer.seedPath;
    const rootSeed = this.state.rootSeed;
    const offerSeed = seasonNamespaceSeed(
      rootSeed,
      'draft',
      'offer',
      participantId,
      String(this.state.round),
      String(this.state.picks.filter((p) => p.participantId === participantId).length + 1),
    );
    const rng = createRng(offerSeed);
    void rng.next();
    void seedPath;
    return result.offer;
  }

  async restoreFromLog(options?: { full?: boolean }): Promise<SeasonDraftState | null> {
    if (this.restoreInFlight) return this.restoreInFlight;
    const run = this.restoreFromLogInner(options?.full ?? false);
    this.restoreInFlight = run;
    try {
      return await run;
    } finally {
      if (this.restoreInFlight === run) this.restoreInFlight = null;
    }
  }

  async applyIncomingCommands(
    envelopes: SeasonPublicCommandEnvelope[],
  ): Promise<SeasonDraftState | null> {
    if (envelopes.length === 0) return this.state;
    await this.ensureAssets();
    if (!this.catalog || !this.league) throw new Error('catalog or league not loaded');
    if (this.state === null) return this.restoreFromLog({ full: true });
    const sorted = [...envelopes].sort((a, b) => a.ordinal - b.ordinal);
    const fresh = sorted.filter((env) => env.ordinal > this.lastOrdinal);
    if (fresh.length === 0) return this.state;
    return this.replayEnvelopes(fresh, { resetIntegrity: false });
  }

  private async restoreFromLogInner(full: boolean): Promise<SeasonDraftState | null> {
    await this.ensureAssets();
    if (!this.catalog || !this.league) throw new Error('catalog or league not loaded');
    let envelopes: SeasonPublicCommandEnvelope[] = [];
    const afterOrdinal = full || this.state === null ? -1 : this.lastOrdinal;
    try {
      envelopes = await this.transport.refetch(this.roomId, afterOrdinal);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[room-draft-controller] refetch failed', e);
      this.lastReplayError = `refetch failed: ${msg}`;
      this.integrityFailed = true;
      envelopes = [];
    }
    if (envelopes.length === 0 && this.state !== null && !full) return this.state;
    return this.replayEnvelopes(envelopes, { resetIntegrity: true, full });
  }

  private replayEnvelopes(
    envelopes: SeasonPublicCommandEnvelope[],
    options: { resetIntegrity: boolean; full?: boolean },
  ): SeasonDraftState | null {
    const catalog = this.catalog!;
    const deps = this.generationDeps();
    envelopes.sort((a, b) => a.ordinal - b.ordinal);
    let state: SeasonDraftState | null = options.full ? null : this.state;
    let lastOrdinal = options.full ? -1 : this.lastOrdinal;
    let generation: SeasonLeagueGenerationResult | null = this.generation;
    if (options.resetIntegrity) {
      let skipped = 0;
      let applyFailures = 0;
      for (const env of envelopes) {
        lastOrdinal = Math.max(lastOrdinal, env.ordinal);
        const command = envelopeToDraftCommand(env, state);
        if (!command) {
          skipped += 1;
          console.warn('[room-draft-controller] skipping invalid command', {
            ordinal: env.ordinal,
            commandId: env.commandId,
            raw: env.payload,
          });
          continue;
        }
        try {
          const result = applySeasonDraftCommand(state, catalog, command, deps);
          state = result.state;
          if (result.generation) generation = result.generation;
        } catch (e) {
          applyFailures += 1;
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[room-draft-controller] replay apply failed', {
            ordinal: env.ordinal,
            commandId: env.commandId,
            error: e,
          });
          this.lastReplayError = `replay failed at ordinal ${env.ordinal} (${env.commandId}): ${msg}`;
          this.integrityFailed = true;
          continue;
        }
      }
      if (skipped > 0) {
        this.skippedCommands = skipped;
        const msg = `skipped ${skipped} invalid command(s) during replay`;
        console.warn('[room-draft-controller]', msg);
        if (!this.lastReplayError) this.lastReplayError = msg;
      } else {
        this.skippedCommands = 0;
      }
      if (applyFailures > 0) {
        if (!this.lastReplayError)
          this.lastReplayError = `${applyFailures} command(s) failed to apply during replay`;
        this.integrityFailed = true;
      } else if (
        skipped === 0 &&
        this.lastReplayError &&
        this.lastReplayError.startsWith('refetch failed')
      ) {
        // keep refetch error
      } else if (skipped === 0 && applyFailures === 0 && envelopes.length > 0) {
        if (
          this.integrityFailed &&
          this.lastReplayError &&
          !this.lastReplayError.startsWith('refetch failed')
        ) {
          this.lastReplayError = null;
          this.integrityFailed = false;
        }
      }
      if (
        skipped === 0 &&
        applyFailures === 0 &&
        !this.lastReplayError?.startsWith('refetch failed')
      ) {
        if (this.integrityFailed && envelopes.length > 0) {
          this.lastReplayError = null;
          this.integrityFailed = false;
        }
      }
    } else {
      for (const env of envelopes) {
        lastOrdinal = Math.max(lastOrdinal, env.ordinal);
        const command = envelopeToDraftCommand(env, state);
        if (!command) continue;
        try {
          const result = applySeasonDraftCommand(state, catalog, command, deps);
          state = result.state;
          if (result.generation) generation = result.generation;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[room-draft-controller] incremental apply failed', {
            ordinal: env.ordinal,
            commandId: env.commandId,
            error: e,
          });
          this.lastReplayError = `incremental apply failed at ordinal ${env.ordinal}: ${msg}`;
          this.integrityFailed = true;
          break;
        }
      }
    }
    this.state = state;
    this.generation = generation;
    this.lastOrdinal = lastOrdinal;
    if (state?.currentTurnParticipantId) {
      if (this.deadlineAt) {
        void seasonNamespaceSeed(state.rootSeed, 'draft', 'first-pick');
        void createRng(seasonNamespaceSeed(state.rootSeed, 'draft', 'offer')).next();
      } else {
        this.setTurnStartedAtIfNeeded();
        void seasonNamespaceSeed(state.rootSeed, 'draft', 'first-pick');
        void createRng(seasonNamespaceSeed(state.rootSeed, 'draft', 'offer')).next();
      }
      void this.fetchServerDeadline(`draft-${state.round}`).catch(() => {});
    } else {
      this.turnStartedAt = null;
      this.persistTurnStartedAt(null);
    }
    return state;
  }

  async ensureDraftCreated(): Promise<SeasonDraftState | null> {
    // Claim 7: only Season draft is implemented for multiplayer; Classic/Sandbox remain solo-only
    const mode =
      (this.snapshot.settings as unknown as { mode?: string })?.mode ??
      (this.snapshot as unknown as { mode?: string })?.mode ??
      'season';
    if (mode !== 'season') {
      throw Object.assign(
        new Error(`Classic/Sandbox draft not yet available for multiplayer (mode=${mode})`),
        { code: 'NOT_IMPLEMENTED', errorCode: 'NOT_IMPLEMENTED' },
      );
    }
    if (this.state !== null) return this.state;
    if (this.membership?.participantId !== 'p1') {
      await this.restoreFromLog();
      return this.state;
    }
    await this.ensureAssets();
    if (!this.catalog || !this.league) throw new Error('assets not loaded');
    const rootSeed =
      (this.snapshot as unknown as { seed?: string | null }).seed ??
      this.snapshot.settings.mode + '-seed-' + this.roomId.slice(0, 6);
    const runId = this.roomId;
    const humanIds = ['p1', 'p2'] as const;
    const commandId = commandIdFor(
      rootSeed,
      'create',
      runId.slice(0, 8),
      String(this.snapshot.settingsRevision ?? 0),
    );
    const command: SeasonDraftCommand = {
      commandId,
      expectedRevision: 0,
      payload: {
        kind: 'create-season-draft',
        runId,
        rootSeed,
        league: this.league,
        humanParticipantIds: [...humanIds],
        catalogVersion: SEASON_DRAFT_VERSION,
      },
    };
    const deps = this.generationDeps();
    const local = applySeasonDraftCommand(null, this.catalog, command, deps);
    if (local.record.status === 'rejected') {
      throw Object.assign(new Error(local.record.message), {
        code: local.record.errorCode,
        errorCode: local.record.errorCode,
      });
    }
    const envelope: SeasonPublicCommandEnvelope = {
      schemaVersion: 2,
      roomId: this.roomId,
      commandId: command.commandId,
      ordinal: this.lastOrdinal + 1,
      runId,
      payload: command,
      actorParticipantId: 'p1',
      actorFranchiseId: this.franchiseIdOf('p1'),
    };
    try {
      const receipt = await this.transport.submitCommand(envelope);
      if (!receipt.accepted) {
        if (
          receipt.rejectionCode === 'stale-revision' ||
          receipt.rejectionCode === 'duplicate-command'
        ) {
          await this.restoreFromLog();
          return this.state;
        }
        throw Object.assign(new Error(receipt.rejectionCode ?? 'rejected'), {
          code: receipt.rejectionCode,
        });
      }
      this.lastOrdinal = receipt.ordinal;
      this.state = local.state;
      this.generation = local.generation;
      // Claim 6: do not blindly reset local timer if server deadline governs
      this.setTurnStartedAtIfNeeded();
      return this.state;
    } catch (e) {
      if ((e as { code?: string })?.code === 'duplicate-command') {
        await this.restoreFromLog();
        return this.state;
      }
      throw e;
    }
  }

  async drawOffer(
    participantId: 'p1' | 'p2',
    retryAfterStale = true,
  ): Promise<SeasonDraftCommandRecord> {
    await this.ensureAssets();
    if (!this.state) {
      await this.restoreFromLog();
      if (!this.state) await this.ensureDraftCreated();
    }
    const state = this.state;
    if (!state) throw new Error('draft not initialized');
    if (state.status !== 'drafting')
      throw Object.assign(new Error('draft not in drafting status'), { code: 'ILLEGAL_PICK' });
    if (state.currentTurnParticipantId !== participantId) {
      throw Object.assign(
        new Error(`it is ${state.currentTurnParticipantId}'s turn, not ${participantId}'s`),
        { code: 'WRONG_TURN', errorCode: 'WRONG_TURN' },
      );
    }
    const round = state.round;
    const pickOrdinal = state.picks.filter((p) => p.participantId === participantId).length + 1;
    const commandId = commandIdFor(
      state.rootSeed,
      'draw',
      participantId,
      String(round),
      String(pickOrdinal),
    );
    const command: SeasonDraftCommand = {
      commandId,
      expectedRevision: state.revision,
      payload: { kind: 'draw-season-offer', participantId },
    };
    const deps = this.generationDeps();
    const preview = applySeasonDraftCommand(state, this.catalog!, command, deps);
    if (preview.record.status === 'rejected') {
      throw Object.assign(new Error(preview.record.message), {
        code: preview.record.errorCode,
        errorCode: preview.record.errorCode,
      });
    }
    const envelope: SeasonPublicCommandEnvelope = {
      schemaVersion: 2,
      roomId: this.roomId,
      commandId,
      ordinal: this.lastOrdinal + 1,
      runId: this.roomId,
      payload: command,
      actorParticipantId: participantId,
      actorFranchiseId: this.franchiseIdOf(participantId),
    };
    const receipt = await this.transport.submitCommand(envelope);
    if (!receipt.accepted) {
      if (receipt.rejectionCode === 'stale-revision') {
        await this.restoreFromLog();
        const prior = this.state?.commandLog.find((record) => record.commandId === commandId);
        if (prior) return prior;
        if (
          retryAfterStale &&
          this.state?.currentTurnParticipantId === participantId &&
          !this.state.currentOffer
        ) {
          return this.drawOffer(participantId, false);
        }
        throw Object.assign(new Error('stale revision'), {
          code: 'STALE_REVISION',
          errorCode: 'STALE_REVISION',
        });
      }
      if (receipt.rejectionCode === 'duplicate-command') {
        await this.restoreFromLog();
        const prior = this.state?.commandLog.find((r) => r.commandId === commandId);
        if (prior) return prior;
      }
      throw Object.assign(new Error(receipt.rejectionCode ?? 'rejected'), {
        code: receipt.rejectionCode,
      });
    }
    this.lastOrdinal = receipt.ordinal;
    const applied = applySeasonDraftCommand(state, this.catalog!, command, deps);
    if (applied.record.status === 'rejected') {
      throw Object.assign(new Error(applied.record.message), { code: applied.record.errorCode });
    }
    this.state = applied.state;
    // Claim 6: draw does not advance turn — keep existing timer, only init if missing and no server deadline
    this.setTurnStartedAtIfNeeded();
    return applied.record;
  }

  async submitPick(
    participantId: 'p1' | 'p2',
    playerVersionId: string,
    retryAfterStale = true,
  ): Promise<SeasonDraftState> {
    await this.ensureAssets();
    if (!this.state) {
      await this.restoreFromLog();
      if (!this.state) throw new Error('draft not initialized');
    }
    const state = this.state;
    if (state.currentTurnParticipantId !== participantId) {
      throw Object.assign(new Error(`WRONG_TURN: it is ${state.currentTurnParticipantId}'s turn`), {
        code: 'WRONG_TURN',
        errorCode: 'WRONG_TURN',
      });
    }
    if (!state.currentOffer) {
      await this.drawOffer(participantId);
      return this.submitPick(participantId, playerVersionId);
    }
    const card = state.currentOffer.cards.find((c) => c.playerVersionId === playerVersionId);
    if (!card) {
      throw Object.assign(new Error(`version ${playerVersionId} is not in the current offer`), {
        code: 'UNAVAILABLE_POOL',
        errorCode: 'UNAVAILABLE_POOL',
      });
    }
    if (state.picks.some((p) => p.playerVersionId === playerVersionId)) {
      throw Object.assign(new Error('that player version is already owned'), {
        code: 'OWNED_VERSION',
        errorCode: 'OWNED_VERSION',
      });
    }
    if (this.catalog && state.participants.length > 1) {
      const candidate = this.catalog.candidates.find((c) => c.playerVersionId === playerVersionId);
      if (candidate) {
        const byVersion = new Map(
          this.catalog.candidates.map((entry) => [entry.playerVersionId, entry]),
        );
        const ownedIdentity = state.picks.some((pick) => {
          const owned = byVersion.get(pick.playerVersionId);
          return owned?.playerId === candidate.playerId;
        });
        if (ownedIdentity) {
          throw Object.assign(new Error('that player identity is already owned'), {
            code: 'OWNED_VERSION',
            errorCode: 'OWNED_VERSION',
          });
        }
      }
    }
    if (!card.selectable) {
      throw Object.assign(new Error(card.coverageReason ?? 'unselectable'), {
        code: 'UNCOMPLETABLE_ROSTER',
        errorCode: 'UNCOMPLETABLE_ROSTER',
      });
    }
    const commandId = commandIdFor(
      state.rootSeed,
      'pick',
      participantId,
      playerVersionId.slice(0, 20),
    );
    const command: SeasonDraftCommand = {
      commandId,
      expectedRevision: state.revision,
      payload: { kind: 'select-draft-player', participantId, playerVersionId },
    };
    const deps = this.generationDeps();
    const preview = applySeasonDraftCommand(state, this.catalog!, command, deps);
    if (preview.record.status === 'rejected') {
      throw Object.assign(new Error(preview.record.message), {
        code: preview.record.errorCode,
        errorCode: preview.record.errorCode,
      });
    }
    const envelope: SeasonPublicCommandEnvelope = {
      schemaVersion: 2,
      roomId: this.roomId,
      commandId,
      ordinal: this.lastOrdinal + 1,
      runId: this.roomId,
      payload: command,
      actorParticipantId: participantId,
      actorFranchiseId: this.franchiseIdOf(participantId),
    };
    const receipt = await this.transport.submitCommand(envelope);
    if (!receipt.accepted) {
      if (receipt.rejectionCode === 'stale-revision') {
        await this.restoreFromLog();
        if (this.state?.picks.some((pick) => pick.playerVersionId === playerVersionId)) {
          return this.state;
        }
        if (
          retryAfterStale &&
          this.state?.currentTurnParticipantId === participantId &&
          this.state.currentOffer?.cards.some((card) => card.playerVersionId === playerVersionId)
        ) {
          return this.submitPick(participantId, playerVersionId, false);
        }
        throw Object.assign(new Error('stale revision'), {
          code: 'STALE_REVISION',
          errorCode: 'STALE_REVISION',
        });
      }
      if (receipt.rejectionCode === 'duplicate-command') {
        await this.restoreFromLog();
        if (this.state) return this.state;
      }
      throw Object.assign(new Error(receipt.rejectionCode ?? 'rejected'), {
        code: receipt.rejectionCode,
      });
    }
    this.lastOrdinal = receipt.ordinal;
    const applied = applySeasonDraftCommand(state, this.catalog!, command, deps);
    if (applied.record.status === 'rejected') {
      throw Object.assign(new Error(applied.record.message), { code: applied.record.errorCode });
    }
    this.state = applied.state;
    // Claim 6: only reset local timer if no server deadline; otherwise server drives countdown
    if (!this.deadlineAt) {
      this.turnStartedAt = null;
      this.persistTurnStartedAt(null);
      if (this.state?.currentTurnParticipantId) this.setTurnStartedAtIfNeeded();
    }
    if (
      this.state?.currentOffer &&
      this.state.currentOffer.cards.length !== SEASON_DRAFT_OFFER_SIZE
    ) {
      throw new Error('offer size invariant failed');
    }
    if (this.state?.currentOffer) {
      const safe = this.state.currentOffer.cards.filter((c) => c.selectable).length;
      if (safe < SEASON_DRAFT_SAFE_MINIMUM) throw new Error('safe minimum invariant failed');
    }
    return this.state!;
  }

  async autoPickSafe(participantId: 'p1' | 'p2'): Promise<SeasonDraftState | null> {
    if (!this.state || !this.catalog) return null;
    if (this.state.currentTurnParticipantId !== participantId) return null;
    if (!this.state.currentOffer) {
      try {
        await this.drawOffer(participantId);
      } catch (e) {
        console.error('[room-draft-controller] autoPick drawOffer failed', e);
      }
    }
    const offer = this.state?.currentOffer;
    if (!offer) return null;
    const safe = offer.cards.filter((c) => c.selectable);
    if (safe.length === 0) return null;
    const seed = seasonNamespaceSeed(
      this.state.rootSeed,
      'draft',
      'auto-pick',
      participantId,
      String(offer.round),
      String(offer.pickOrdinal),
    );
    const rng = createRng(seed);
    const picked = rng.pick(safe);
    try {
      return await this.submitPick(participantId, picked.playerVersionId);
    } catch (e) {
      console.error('[room-draft-controller] autoPick first attempt failed', e);
      try {
        return await this.submitPick(participantId, safe[0]!.playerVersionId);
      } catch (e2) {
        console.error('[room-draft-controller] autoPick fallback failed', e2);
        return null;
      }
    }
  }

  async finalizeRosters(retryAfterStale = true): Promise<SeasonDraftCommandRecord> {
    await this.ensureAssets();
    if (!this.state) throw new Error('no draft state');
    const state = this.state;
    const commandId = commandIdFor(state.rootSeed, 'finalize', String(state.revision));
    const command: SeasonDraftCommand = {
      commandId,
      expectedRevision: state.revision,
      payload: { kind: 'finalize-human-rosters' },
    };
    const deps = this.generationDeps();
    const preview = applySeasonDraftCommand(state, this.catalog!, command, deps);
    if (preview.record.status === 'rejected') {
      throw Object.assign(new Error(preview.record.message), { code: preview.record.errorCode });
    }
    const envelope: SeasonPublicCommandEnvelope = {
      schemaVersion: 2,
      roomId: this.roomId,
      commandId,
      ordinal: this.lastOrdinal + 1,
      runId: this.roomId,
      payload: command,
      actorParticipantId: (this.membership?.participantId as 'p1' | 'p2') ?? 'p1',
      actorFranchiseId: this.franchiseIdOf((this.membership?.participantId as 'p1' | 'p2') ?? 'p1'),
    };
    const receipt = await this.transport.submitCommand(envelope);
    if (!receipt.accepted) {
      if (receipt.rejectionCode === 'stale-revision') {
        await this.restoreFromLog();
        const prior = this.state?.commandLog.find((record) => record.commandId === commandId);
        if (prior) return prior;
        if (retryAfterStale && this.state?.status === 'drafting') {
          return this.finalizeRosters(false);
        }
        throw Object.assign(new Error('stale revision'), { code: 'STALE_REVISION' });
      }
      throw Object.assign(new Error(receipt.rejectionCode ?? 'rejected'), {
        code: receipt.rejectionCode,
      });
    }
    this.lastOrdinal = receipt.ordinal;
    const applied = applySeasonDraftCommand(state, this.catalog!, command, deps);
    this.state = applied.state;
    return applied.record;
  }

  async generateAiLeague(retryAfterStale = true): Promise<{
    state: SeasonDraftState | null;
    generation: SeasonLeagueGenerationResult | null;
    digest: string | null;
  }> {
    await this.ensureAssets();
    if (!this.state) throw new Error('no draft state');
    if (this.state.status !== 'finalized')
      throw Object.assign(new Error('generate requires finalized'), { code: 'ILLEGAL_PICK' });
    if (!this.catalog || !this.league || !this.rosterTargets) throw new Error('assets not loaded');
    const state = this.state;
    const commandId = commandIdFor(state.rootSeed, 'generate', String(state.revision));
    const command: SeasonDraftCommand = {
      commandId,
      expectedRevision: state.revision,
      payload: { kind: 'generate-ai-league' },
    };
    const deps = this.generationDeps();
    const preview = applySeasonDraftCommand(state, this.catalog, command, deps);
    if (preview.record.status === 'rejected') {
      throw Object.assign(new Error(preview.record.message), { code: preview.record.errorCode });
    }
    const envelope: SeasonPublicCommandEnvelope = {
      schemaVersion: 2,
      roomId: this.roomId,
      commandId,
      ordinal: this.lastOrdinal + 1,
      runId: this.roomId,
      payload: command,
      actorParticipantId: (this.membership?.participantId as 'p1' | 'p2') ?? 'p1',
      actorFranchiseId: this.franchiseIdOf((this.membership?.participantId as 'p1' | 'p2') ?? 'p1'),
    };
    const receipt = await this.transport.submitCommand(envelope);
    if (!receipt.accepted) {
      if (receipt.rejectionCode === 'stale-revision') {
        await this.restoreFromLog();
        const restoredState = this.state as SeasonDraftState | null;
        if (restoredState?.status === 'complete' && this.generation) {
          return {
            state: restoredState,
            generation: this.generation,
            digest: this.generation.digest,
          };
        }
        if (retryAfterStale && restoredState?.status === 'finalized') {
          return this.generateAiLeague(false);
        }
        throw Object.assign(new Error('stale revision'), { code: 'STALE_REVISION' });
      }
      throw Object.assign(new Error(receipt.rejectionCode ?? 'rejected'), {
        code: receipt.rejectionCode,
      });
    }
    this.lastOrdinal = receipt.ordinal;
    const applied = applySeasonDraftCommand(state, this.catalog, command, deps);
    if (applied.record.status === 'rejected') {
      throw Object.assign(new Error(applied.record.message), { code: applied.record.errorCode });
    }
    this.state = applied.state;
    this.generation = applied.generation;
    if (applied.generation) {
      const gen = applied.generation;
      const counts = { contender: 0, playoff: 0, average: 0, weaker: 0 } as Record<string, number>;
      for (const a of gen.aiAssignments) {
        const isHuman = state.participants.some((p) => p.franchiseId === a.franchiseId);
        if (!isHuman) counts[a.band] = (counts[a.band] ?? 0) + 1;
      }
      const expected = DUO_BAND_QUOTAS;
      if (
        counts.contender !== expected.contender ||
        counts.playoff !== expected.playoff ||
        counts.average !== expected.average ||
        counts.weaker !== expected.weaker
      ) {
        throw new Error(
          `AI band quotas mismatch: got ${JSON.stringify(counts)} expected ${JSON.stringify(expected)}`,
        );
      }
      const humanOwned = new Set(state.picks.map((p) => p.playerVersionId));
      for (const roster of gen.rosters) {
        const isHuman = state.participants.some((p) => p.franchiseId === roster.franchiseId);
        if (isHuman) continue;
        for (const player of roster.players) {
          if (humanOwned.has(player.playerVersionId)) {
            throw Object.assign(new Error(`duplicate ownership ${player.playerVersionId}`), {
              code: 'OWNED_VERSION',
            });
          }
        }
      }
      const digest = gen.digest;
      void seasonDraftStateCanonical(applied.state!);
      void seasonDraftStateDigest(applied.state!);
      void seasonDigestHex(digest);
      return { state: applied.state, generation: gen, digest };
    }
    return { state: applied.state, generation: null, digest: null };
  }

  verifyLeagueDigest(expectedDigest: string): boolean {
    if (!this.generation) return false;
    return this.generation.digest === expectedDigest;
  }

  setCatalog(catalog: SeasonDraftCatalog): void {
    this.catalog = catalog;
  }
  setLeague(league: SeasonLeague): void {
    this.league = league;
  }
  setRosterTargets(targets: SeasonRosterTargets): void {
    this.rosterTargets = targets;
  }

  updateSnapshot(snapshot: SeasonRoomPublicSnapshot): void {
    this.snapshot = snapshot;
    const withDeadline = snapshot as unknown as {
      deadlineAt?: string | null;
      deadlineCursor?: string | null;
      fallbackPayload?: unknown;
    };
    if (withDeadline?.deadlineAt)
      this.setServerDeadline(
        withDeadline.deadlineAt,
        withDeadline.fallbackPayload ?? null,
        withDeadline.deadlineCursor ?? null,
      );
  }

  // Legacy: classicRollFor is a solo-mode stub; multiplayer uses season draft only (Claim 7)
  classicRollFor(_participantId: 'p1' | 'p2'): { franchiseId: string; eraId: string } {
    if (!this.state) return { franchiseId: 'lakers', eraId: '1990s' };
    const seed = seasonNamespaceSeed(this.state.rootSeed, 'draft', 'classic-roll', _participantId);
    const rng = createRng(seed);
    const franchises = ['lakers', 'celtics', 'bulls', 'warriors', 'heat'];
    const eras = ['era-80s', 'era-90s', 'era-00s', 'era-10s'];
    return { franchiseId: rng.pick(franchises), eraId: rng.pick(eras) };
  }
}
