import type { SeasonRoomPublicSnapshot, SeasonRoomMembership, SeasonMultiplayerTransport, SeasonPublicCommandEnvelope, SeasonDraftCatalog, SeasonDraftState, SeasonDraftCommand, SeasonDraftCommandRecord, SeasonLeague, SeasonLeagueGenerationResult, SeasonRosterTargets, SeasonDraftOffer, SeasonCommandReceipt, } from '@hoop-rush/data-contracts';
import { SEASON_DRAFT_OFFER_SIZE, SEASON_DRAFT_SAFE_MINIMUM, SEASON_DRAFT_VERSION, SEASON_ROOM_PROTOCOL_SCHEMA_VERSION, seasonNamespaceSeed, seasonDigestHex, } from '@hoop-rush/data-contracts';
import { applySeasonDraftCommand, drawGlobalOffer, seasonDraftStateDigest, seasonDraftStateCanonical, generateAiLeague as engineGenerateAiLeague, DUO_BAND_QUOTAS, createRng, } from '@hoop-rush/engine';
import { loadSeasonDraftCatalog, loadSeasonLeague, loadSeasonRosterTargets } from './season-assets';
import { draftCommandId, envelopeToDraftCommand } from './season-draft-command-log';
import { catalogCandidateMap } from './season-catalog-index';
import { runOneShotWorker } from '$lib/one-shot-worker';
import { GENERATION_WORKER_WIRE_SCHEMA_VERSION, type GenerationWorkerRequest, type GenerationWorkerResponse, } from './season-generation-wire';
export type RoomDraftMode = SeasonRoomPublicSnapshot['mode'];
export interface RoomDraftControllerOptions {
    transport: SeasonMultiplayerTransport;
    roomId: string;
    snapshot: SeasonRoomPublicSnapshot;
    membership?: SeasonRoomMembership | null;
    catalog?: SeasonDraftCatalog | null;
    league?: SeasonLeague | null;
    rosterTargets?: SeasonRosterTargets | null;
}
function commandIdFor(rootSeed: string, kind: string, ...parts: string[]): string {
    return draftCommandId(rootSeed, kind, ...parts);
}
function franchiseIdOfState(state: SeasonDraftState, participantId: string): string {
    const p = state.participants.find((x) => x.participantId === participantId);
    return p?.franchiseId ?? `franchise-${participantId}`;
}
export class RoomDraftController {
    private transport: SeasonMultiplayerTransport;
    private roomId: string;
    private snapshot: SeasonRoomPublicSnapshot;
    private membership: SeasonRoomMembership | null;
    private catalog: SeasonDraftCatalog | null;
    private league: SeasonLeague | null;
    private rosterTargets: SeasonRosterTargets | null;
    private state: SeasonDraftState | null = null;
    private generation: SeasonLeagueGenerationResult | null = null;
    private lastOrdinal = -1;
    private turnStartedAt: number | null = null;
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
        const persisted = this.loadPersistedTurn();
        if (persisted !== null)
            this.turnStartedAt = persisted;
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
        if (!this.state)
            return null;
        return seasonDraftStateDigest(this.state);
    }
    getRevision(): number {
        return this.state?.revision ?? 0;
    }
    getLastOrdinal(): number {
        return this.lastOrdinal;
    }
    currentOfferFor(viewerParticipantId: string | null): SeasonDraftOffer | null {
        if (!this.state)
            return null;
        if (!this.state.currentOffer)
            return null;
        if (viewerParticipantId === null)
            return null;
        if (this.state.currentOffer.participantId !== viewerParticipantId)
            return null;
        return this.state.currentOffer;
    }
    currentOffer(): SeasonDraftOffer | null {
        return this.state?.currentOffer ?? null;
    }
    getTurnStartedAt(): number | null {
        return this.turnStartedAt;
    }
    getSecondsRemaining(now = Date.now()): number | null {
        const pace = this.snapshot.settings.pace;
        if (pace !== 'live')
            return null;
        if (!this.turnStartedAt)
            return null;
        const elapsed = (now - this.turnStartedAt) / 1000;
        return Math.max(0, 90 - Math.floor(elapsed));
    }
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
            if (typeof window === 'undefined')
                return null;
            const raw = window.sessionStorage?.getItem(this.storageKey()) ?? null;
            if (!raw)
                return null;
            const parsed = JSON.parse(raw) as {
                turnStartedAt?: number;
            };
            if (typeof parsed.turnStartedAt === 'number' && Number.isFinite(parsed.turnStartedAt)) {
                return parsed.turnStartedAt;
            }
        }
        catch { }
        return null;
    }
    private persistTurnStartedAt(ts: number | null): void {
        try {
            if (typeof window === 'undefined')
                return;
            const key = this.storageKey();
            if (ts === null) {
                window.sessionStorage?.removeItem(key);
                return;
            }
            window.sessionStorage?.setItem(key, JSON.stringify({ turnStartedAt: ts, savedAt: Date.now() }));
        }
        catch { }
    }
    private setTurnStartedAtIfNeeded(): void {
        if (this.turnStartedAt !== null)
            return;
        const persisted = this.loadPersistedTurn();
        if (persisted !== null) {
            this.turnStartedAt = persisted;
            return;
        }
        this.turnStartedAt = Date.now();
        this.persistTurnStartedAt(this.turnStartedAt);
    }
    private generationDeps(): {
        generate: (input: Omit<import('@hoop-rush/engine').SeasonAiGenerationInput, 'targets'>) => SeasonLeagueGenerationResult;
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
    private engineGenerationDepsWithPrecomputed(precomputed: SeasonLeagueGenerationResult | null): {
        generate: (input: Omit<import('@hoop-rush/engine').SeasonAiGenerationInput, 'targets'>) => SeasonLeagueGenerationResult;
    } {
        if (precomputed !== null) {
            return { generate: () => precomputed };
        }
        return this.generationDeps();
    }
    private buildGenerationInput(state: SeasonDraftState): Omit<import('@hoop-rush/engine').SeasonAiGenerationInput, 'targets'> {
        if (!this.catalog)
            throw new Error('catalog not loaded');
        return {
            seed: state.rootSeed,
            catalog: this.catalog,
            league: state.league,
            humanFranchiseIds: state.participants.map((participant) => participant.franchiseId),
            humanRosters: state.participants.map((participant) => ({
                franchiseId: participant.franchiseId,
                playerVersionIds: state.picks
                    .filter((pick) => pick.participantId === participant.participantId)
                    .map((pick) => pick.playerVersionId),
            })),
        };
    }
    private async runGenerationInWorker(input: Omit<import('@hoop-rush/engine').SeasonAiGenerationInput, 'targets'>): Promise<SeasonLeagueGenerationResult> {
        const targets = this.rosterTargets;
        if (targets === null || targets === undefined) {
            throw new Error('worker generation requires roster targets');
        }
        const request: GenerationWorkerRequest = {
            schemaVersion: GENERATION_WORKER_WIRE_SCHEMA_VERSION,
            type: 'generate',
            requestId: `gen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            input,
            targets,
        };
        try {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                request.requestId = crypto.randomUUID();
            }
        }
        catch { }
        return runOneShotWorker<GenerationWorkerRequest, GenerationWorkerResponse, SeasonLeagueGenerationResult>({
            createWorker: () => new Worker(new URL('../../workers/season-draft-generation-worker.ts', import.meta.url), {
                type: 'module',
            }),
            request,
            resultOf: (message) => (message.type === 'complete' ? message.generation : null),
            errorOf: (message) => (message.type === 'error' ? message.message : null),
            errorFallback: 'AI league generation worker failed',
        });
    }
    private async ensureAssets(): Promise<void> {
        if (this.catalog && this.league && this.rosterTargets)
            return;
        const [catalog, league, rosterTargets] = await Promise.all([
            this.catalog ? Promise.resolve(this.catalog) : loadSeasonDraftCatalog(),
            this.league ? Promise.resolve(this.league) : loadSeasonLeague(),
            this.rosterTargets ? Promise.resolve(this.rosterTargets) : loadSeasonRosterTargets(),
        ]);
        this.catalog = catalog;
        this.league = league;
        this.rosterTargets = rosterTargets;
        if (this.catalog.candidates.length < SEASON_DRAFT_OFFER_SIZE) {
            throw new Error(`catalog has ${this.catalog.candidates.length} candidates; need ${SEASON_DRAFT_OFFER_SIZE}`);
        }
    }
    private actorId(): 'p1' | 'p2' {
        return (this.membership?.participantId as 'p1' | 'p2') ?? 'p1';
    }
    private async submitAndApply(state: SeasonDraftState | null, command: SeasonDraftCommand, actorParticipantId: 'p1' | 'p2', depsOverride?: {
        generate: (input: Omit<import('@hoop-rush/engine').SeasonAiGenerationInput, 'targets'>) => SeasonLeagueGenerationResult;
    }): Promise<{
        receipt: SeasonCommandReceipt;
        record: SeasonDraftCommandRecord | null;
    }> {
        if (!this.catalog)
            throw new Error('catalog not loaded');
        const deps = depsOverride ?? this.generationDeps();
        const preview = applySeasonDraftCommand(state, this.catalog, command, deps);
        if (preview.record.status === 'rejected') {
            throw Object.assign(new Error(preview.record.message), {
                code: preview.record.errorCode,
                errorCode: preview.record.errorCode,
            });
        }
        const envelope: SeasonPublicCommandEnvelope = {
            schemaVersion: SEASON_ROOM_PROTOCOL_SCHEMA_VERSION,
            roomId: this.roomId,
            commandId: command.commandId,
            ordinal: this.lastOrdinal + 1,
            runId: this.roomId,
            payload: command,
            actorParticipantId,
            actorFranchiseId: this.franchiseIdOf(actorParticipantId),
        };
        const receipt = await this.transport.submitCommand(envelope);
        if (!receipt.accepted)
            return { receipt, record: null };
        this.lastOrdinal = receipt.ordinal;
        const applied = applySeasonDraftCommand(state, this.catalog, command, deps);
        if (applied.record.status === 'rejected') {
            throw Object.assign(new Error(applied.record.message), {
                code: applied.record.errorCode,
                errorCode: applied.record.errorCode,
            });
        }
        this.state = applied.state;
        if (applied.generation)
            this.generation = applied.generation;
        return { receipt, record: applied.record };
    }
    private franchiseIdOf(participantId: string): string {
        if (this.membership?.participantId === participantId)
            return this.membership.franchiseId;
        if (this.state)
            return franchiseIdOfState(this.state, participantId);
        return participantId === 'p1' ? 'franchise-p1' : 'franchise-p2';
    }
    deriveOfferPreview(participantId: string): SeasonDraftOffer | null {
        if (!this.state || !this.catalog)
            return null;
        const result = drawGlobalOffer(this.state, this.catalog, participantId);
        if (result.status !== 'drawn')
            return null;
        const seedPath = result.offer.seedPath;
        const rootSeed = this.state.rootSeed;
        const offerSeed = seasonNamespaceSeed(rootSeed, 'draft', 'offer', participantId, String(this.state.round), String(this.state.picks.filter((p) => p.participantId === participantId).length + 1));
        const rng = createRng(offerSeed);
        void rng.next();
        void seedPath;
        return result.offer;
    }
    async restoreFromLog(options?: {
        full?: boolean;
    }): Promise<SeasonDraftState | null> {
        if (this.restoreInFlight)
            return this.restoreInFlight;
        const run = this.restoreFromLogInner(options?.full ?? false);
        this.restoreInFlight = run;
        try {
            return await run;
        }
        finally {
            if (this.restoreInFlight === run)
                this.restoreInFlight = null;
        }
    }
    async applyIncomingCommands(envelopes: SeasonPublicCommandEnvelope[]): Promise<SeasonDraftState | null> {
        if (envelopes.length === 0)
            return this.state;
        await this.ensureAssets();
        if (!this.catalog || !this.league)
            throw new Error('catalog or league not loaded');
        if (this.state === null)
            return this.restoreFromLog({ full: true });
        const sorted = [...envelopes].sort((a, b) => a.ordinal - b.ordinal);
        const fresh = sorted.filter((env) => env.ordinal > this.lastOrdinal);
        if (fresh.length === 0)
            return this.state;
        return this.replayEnvelopes(fresh, { resetIntegrity: false });
    }
    async restoreFromLogWithPrefetched(prefetched: SeasonPublicCommandEnvelope[] | null, options?: {
        full?: boolean;
    }): Promise<SeasonDraftState | null> {
        if (prefetched && prefetched.length >= 0) {
            try {
                await this.ensureAssets();
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('[room-draft-controller] ensureAssets failed (prefetched)', e);
                this.lastReplayError = `ensureAssets failed: ${msg}`;
                this.integrityFailed = true;
            }
            if (!this.catalog || !this.league)
                throw new Error('catalog or league not loaded');
            if (prefetched.length === 0 && this.state !== null && !options?.full)
                return this.state;
            return this.replayEnvelopes(prefetched, { resetIntegrity: true, full: options?.full ?? true });
        }
        return this.restoreFromLog(options);
    }
    private async restoreFromLogInner(full: boolean): Promise<SeasonDraftState | null> {
        const afterOrdinal = full || this.state === null ? -1 : this.lastOrdinal;
        const assetsPromise = this.ensureAssets().catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('[room-draft-controller] ensureAssets failed', e);
            this.lastReplayError = `ensureAssets failed: ${msg}`;
            this.integrityFailed = true;
            throw e;
        });
        const refetchPromise = this.transport.refetch(this.roomId, afterOrdinal).catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('[room-draft-controller] refetch failed', e);
            this.lastReplayError = `refetch failed: ${msg}`;
            this.integrityFailed = true;
            return [] as SeasonPublicCommandEnvelope[];
        });
        const [, envelopesRaw] = await Promise.all([assetsPromise, refetchPromise]);
        const envelopes = (envelopesRaw ?? []) as SeasonPublicCommandEnvelope[];
        if (!this.catalog || !this.league)
            throw new Error('catalog or league not loaded');
        if (envelopes.length === 0 && this.state !== null && !full)
            return this.state;
        return this.replayEnvelopes(envelopes, { resetIntegrity: true, full });
    }
    private async replayEnvelopes(envelopes: SeasonPublicCommandEnvelope[], options: {
        resetIntegrity: boolean;
        full?: boolean;
    }): Promise<SeasonDraftState | null> {
        const catalog = this.catalog!;
        const deps = this.generationDeps();
        envelopes.sort((a, b) => a.ordinal - b.ordinal);
        let state: SeasonDraftState | null = options.full ? null : this.state;
        let lastOrdinal = options.full ? -1 : this.lastOrdinal;
        let generation: SeasonLeagueGenerationResult | null = this.generation;
        if (options.resetIntegrity) {
            let skipped = 0;
            let applyFailures = 0;
            for (let idx = 0; idx < envelopes.length; idx += 1) {
                const env = envelopes[idx]!;
                lastOrdinal = Math.max(lastOrdinal, env.ordinal);
                const command = envelopeToDraftCommand(env, state);
                if (!command) {
                    skipped += 1;
                    console.warn('[room-draft-controller] skipping invalid command', {
                        ordinal: env.ordinal,
                        commandId: env.commandId,
                        raw: env.payload,
                    });
                    if (idx % 5 === 4)
                        await new Promise<void>((r) => setTimeout(r, 0));
                    continue;
                }
                try {
                    const result = applySeasonDraftCommand(state, catalog, command, deps);
                    state = result.state;
                    if (result.generation)
                        generation = result.generation;
                }
                catch (e) {
                    applyFailures += 1;
                    const msg = e instanceof Error ? e.message : String(e);
                    console.error('[room-draft-controller] replay apply failed', {
                        ordinal: env.ordinal,
                        commandId: env.commandId,
                        error: e,
                    });
                    this.lastReplayError = `replay failed at ordinal ${env.ordinal} (${env.commandId}): ${msg}`;
                    this.integrityFailed = true;
                    if (idx % 5 === 4)
                        await new Promise<void>((r) => setTimeout(r, 0));
                    continue;
                }
                if (idx % 5 === 4)
                    await new Promise<void>((r) => setTimeout(r, 0));
            }
            if (skipped > 0) {
                this.skippedCommands = skipped;
                const msg = `skipped ${skipped} invalid command(s) during replay`;
                console.warn('[room-draft-controller]', msg);
                if (!this.lastReplayError)
                    this.lastReplayError = msg;
            }
            else {
                this.skippedCommands = 0;
            }
            if (applyFailures > 0) {
                if (!this.lastReplayError)
                    this.lastReplayError = `${applyFailures} command(s) failed to apply during replay`;
                this.integrityFailed = true;
            }
            else if (skipped === 0 &&
                this.lastReplayError &&
                this.lastReplayError.startsWith('refetch failed')) {
            }
            else if (skipped === 0 && applyFailures === 0 && envelopes.length > 0) {
                if (this.integrityFailed &&
                    this.lastReplayError &&
                    !this.lastReplayError.startsWith('refetch failed')) {
                    this.lastReplayError = null;
                    this.integrityFailed = false;
                }
            }
            if (skipped === 0 &&
                applyFailures === 0 &&
                !this.lastReplayError?.startsWith('refetch failed')) {
                if (this.integrityFailed && envelopes.length > 0) {
                    this.lastReplayError = null;
                    this.integrityFailed = false;
                }
            }
        }
        else {
            for (let idx = 0; idx < envelopes.length; idx += 1) {
                const env = envelopes[idx]!;
                lastOrdinal = Math.max(lastOrdinal, env.ordinal);
                const command = envelopeToDraftCommand(env, state);
                if (!command) {
                    if (idx % 5 === 4)
                        await new Promise<void>((r) => setTimeout(r, 0));
                    continue;
                }
                try {
                    const result = applySeasonDraftCommand(state, catalog, command, deps);
                    state = result.state;
                    if (result.generation)
                        generation = result.generation;
                }
                catch (e) {
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
                if (idx % 5 === 4)
                    await new Promise<void>((r) => setTimeout(r, 0));
            }
        }
        this.state = state;
        this.generation = generation;
        this.lastOrdinal = lastOrdinal;
        if (state?.currentTurnParticipantId) {
            this.setTurnStartedAtIfNeeded();
        }
        else {
            this.turnStartedAt = null;
            this.persistTurnStartedAt(null);
        }
        return state;
    }
    async ensureDraftCreated(): Promise<SeasonDraftState | null> {
        const mode = (this.snapshot.settings as unknown as {
            mode?: string;
        })?.mode ??
            (this.snapshot as unknown as {
                mode?: string;
            })?.mode ??
            'season';
        if (mode !== 'season') {
            throw Object.assign(new Error(`Classic/Sandbox draft not yet available for multiplayer (mode=${mode})`), { code: 'NOT_IMPLEMENTED', errorCode: 'NOT_IMPLEMENTED' });
        }
        if (this.state !== null)
            return this.state;
        if (this.membership?.participantId !== 'p1') {
            await this.restoreFromLog();
            return this.state;
        }
        await this.ensureAssets();
        if (!this.catalog || !this.league)
            throw new Error('assets not loaded');
        const rootSeed = (this.snapshot as unknown as {
            seed?: string | null;
        }).seed ??
            this.snapshot.settings.mode + '-seed-' + this.roomId.slice(0, 6);
        const runId = this.roomId;
        const humanIds = ['p1', 'p2'] as const;
        const commandId = commandIdFor(rootSeed, 'create', runId.slice(0, 8), String(this.snapshot.settingsRevision ?? 0));
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
        const { receipt } = await this.submitAndApply(null, command, 'p1');
        if (!receipt.accepted) {
            if (receipt.rejectionCode === 'stale-revision' ||
                receipt.rejectionCode === 'duplicate-command') {
                await this.restoreFromLog();
                return this.state;
            }
            throw Object.assign(new Error(receipt.rejectionCode ?? 'rejected'), {
                code: receipt.rejectionCode,
            });
        }
        this.setTurnStartedAtIfNeeded();
        return this.state;
    }
    async drawOffer(participantId: 'p1' | 'p2', retryAfterStale = true): Promise<SeasonDraftCommandRecord> {
        await this.ensureAssets();
        if (!this.state) {
            await this.restoreFromLog();
            if (!this.state)
                await this.ensureDraftCreated();
        }
        const state = this.state;
        if (!state)
            throw new Error('draft not initialized');
        if (state.status !== 'drafting')
            throw Object.assign(new Error('draft not in drafting status'), { code: 'ILLEGAL_PICK' });
        if (state.currentTurnParticipantId !== participantId) {
            throw Object.assign(new Error(`it is ${state.currentTurnParticipantId}'s turn, not ${participantId}'s`), { code: 'WRONG_TURN', errorCode: 'WRONG_TURN' });
        }
        const round = state.round;
        const pickOrdinal = state.picks.filter((p) => p.participantId === participantId).length + 1;
        const commandId = commandIdFor(state.rootSeed, 'draw', participantId, String(round), String(pickOrdinal));
        const command: SeasonDraftCommand = {
            commandId,
            expectedRevision: state.revision,
            payload: { kind: 'draw-season-offer', participantId },
        };
        const { receipt, record } = await this.submitAndApply(state, command, participantId);
        if (!receipt.accepted) {
            if (receipt.rejectionCode === 'stale-revision') {
                await this.restoreFromLog();
                const prior = this.state?.commandLog.find((entry) => entry.commandId === commandId);
                if (prior)
                    return prior;
                if (retryAfterStale &&
                    this.state?.currentTurnParticipantId === participantId &&
                    !this.state.currentOffer) {
                    return this.drawOffer(participantId, false);
                }
                throw Object.assign(new Error('stale revision'), {
                    code: 'STALE_REVISION',
                    errorCode: 'STALE_REVISION',
                });
            }
            if (receipt.rejectionCode === 'duplicate-command') {
                await this.restoreFromLog();
                const prior = this.state?.commandLog.find((entry) => entry.commandId === commandId);
                if (prior)
                    return prior;
            }
            throw Object.assign(new Error(receipt.rejectionCode ?? 'rejected'), {
                code: receipt.rejectionCode,
            });
        }
        this.setTurnStartedAtIfNeeded();
        return record!;
    }
    async submitPick(participantId: 'p1' | 'p2', playerVersionId: string, retryAfterStale = true): Promise<SeasonDraftState> {
        await this.ensureAssets();
        if (!this.state) {
            await this.restoreFromLog();
            if (!this.state)
                throw new Error('draft not initialized');
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
            const map = catalogCandidateMap(this.catalog);
            const candidate = map.get(playerVersionId) ?? null;
            if (candidate) {
                const ownedIdentity = state.picks.some((pick) => {
                    const owned = map.get(pick.playerVersionId);
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
        const commandId = commandIdFor(state.rootSeed, 'pick', participantId, playerVersionId.slice(0, 20));
        const command: SeasonDraftCommand = {
            commandId,
            expectedRevision: state.revision,
            payload: { kind: 'select-draft-player', participantId, playerVersionId },
        };
        const { receipt } = await this.submitAndApply(state, command, participantId);
        if (!receipt.accepted) {
            if (receipt.rejectionCode === 'stale-revision') {
                await this.restoreFromLog();
                if (this.state?.picks.some((pick) => pick.playerVersionId === playerVersionId)) {
                    return this.state;
                }
                if (retryAfterStale &&
                    this.state?.currentTurnParticipantId === participantId &&
                    this.state.currentOffer?.cards.some((card) => card.playerVersionId === playerVersionId)) {
                    return this.submitPick(participantId, playerVersionId, false);
                }
                throw Object.assign(new Error('stale revision'), {
                    code: 'STALE_REVISION',
                    errorCode: 'STALE_REVISION',
                });
            }
            if (receipt.rejectionCode === 'duplicate-command') {
                await this.restoreFromLog();
                if (this.state)
                    return this.state;
            }
            throw Object.assign(new Error(receipt.rejectionCode ?? 'rejected'), {
                code: receipt.rejectionCode,
            });
        }
        this.turnStartedAt = null;
        this.persistTurnStartedAt(null);
        if (this.state?.currentTurnParticipantId)
            this.setTurnStartedAtIfNeeded();
        if (this.state?.currentOffer &&
            this.state.currentOffer.cards.length !== SEASON_DRAFT_OFFER_SIZE) {
            throw new Error('offer size invariant failed');
        }
        if (this.state?.currentOffer) {
            const safe = this.state.currentOffer.cards.filter((c) => c.selectable).length;
            if (safe < SEASON_DRAFT_SAFE_MINIMUM)
                throw new Error('safe minimum invariant failed');
        }
        return this.state!;
    }
    async autoPickSafe(participantId: 'p1' | 'p2'): Promise<SeasonDraftState | null> {
        if (!this.state || !this.catalog)
            return null;
        if (this.state.currentTurnParticipantId !== participantId)
            return null;
        if (!this.state.currentOffer) {
            try {
                await this.drawOffer(participantId);
            }
            catch (e) {
                console.error('[room-draft-controller] autoPick drawOffer failed', e);
            }
        }
        const offer = this.state?.currentOffer;
        if (!offer)
            return null;
        const safe = offer.cards.filter((c) => c.selectable);
        if (safe.length === 0)
            return null;
        const seed = seasonNamespaceSeed(this.state.rootSeed, 'draft', 'auto-pick', participantId, String(offer.round), String(offer.pickOrdinal));
        const rng = createRng(seed);
        const picked = rng.pick(safe);
        try {
            return await this.submitPick(participantId, picked.playerVersionId);
        }
        catch (e) {
            console.error('[room-draft-controller] autoPick first attempt failed', e);
            try {
                return await this.submitPick(participantId, safe[0]!.playerVersionId);
            }
            catch (e2) {
                console.error('[room-draft-controller] autoPick fallback failed', e2);
                return null;
            }
        }
    }
    async finalizeRosters(retryAfterStale = true): Promise<SeasonDraftCommandRecord> {
        await this.ensureAssets();
        if (!this.state)
            throw new Error('no draft state');
        const state = this.state;
        const commandId = commandIdFor(state.rootSeed, 'finalize', String(state.revision));
        const command: SeasonDraftCommand = {
            commandId,
            expectedRevision: state.revision,
            payload: { kind: 'finalize-human-rosters' },
        };
        const { receipt, record } = await this.submitAndApply(state, command, this.actorId());
        if (!receipt.accepted) {
            if (receipt.rejectionCode === 'stale-revision') {
                await this.restoreFromLog();
                const prior = this.state?.commandLog.find((entry) => entry.commandId === commandId);
                if (prior)
                    return prior;
                if (retryAfterStale && this.state?.status === 'drafting') {
                    return this.finalizeRosters(false);
                }
                throw Object.assign(new Error('stale revision'), { code: 'STALE_REVISION' });
            }
            throw Object.assign(new Error(receipt.rejectionCode ?? 'rejected'), {
                code: receipt.rejectionCode,
            });
        }
        return record!;
    }
    async generateAiLeague(retryAfterStale = true): Promise<{
        state: SeasonDraftState | null;
        generation: SeasonLeagueGenerationResult | null;
        digest: string | null;
    }> {
        await this.ensureAssets();
        if (!this.state)
            throw new Error('no draft state');
        if (this.state.status !== 'finalized')
            throw Object.assign(new Error('generate requires finalized'), { code: 'ILLEGAL_PICK' });
        if (!this.catalog || !this.league || !this.rosterTargets)
            throw new Error('assets not loaded');
        const state = this.state;
        const commandId = commandIdFor(state.rootSeed, 'generate', String(state.revision));
        const command: SeasonDraftCommand = {
            commandId,
            expectedRevision: state.revision,
            payload: { kind: 'generate-ai-league' },
        };
        let precomputed: SeasonLeagueGenerationResult | null = null;
        let workerFailed = false;
        if (this.rosterTargets && typeof Worker !== 'undefined') {
            try {
                const input = this.buildGenerationInput(state);
                precomputed = await this.runGenerationInWorker(input);
            }
            catch (e) {
                workerFailed = true;
                console.warn('[room-draft-controller] worker generation failed, falling back to sync', e);
                precomputed = null;
            }
        }
        const depsOverride = this.engineGenerationDepsWithPrecomputed(precomputed);
        if (workerFailed)
            await new Promise<void>((r) => setTimeout(r, 0));
        const { receipt } = await this.submitAndApply(state, command, this.actorId(), depsOverride);
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
        if (this.generation) {
            const gen = this.generation;
            const appliedState = this.state;
            const counts = { contender: 0, playoff: 0, average: 0, weaker: 0 } as Record<string, number>;
            for (const a of gen.aiAssignments) {
                const isHuman = state.participants.some((p) => p.franchiseId === a.franchiseId);
                if (!isHuman)
                    counts[a.band] = (counts[a.band] ?? 0) + 1;
            }
            const expected = DUO_BAND_QUOTAS;
            if (counts.contender !== expected.contender ||
                counts.playoff !== expected.playoff ||
                counts.average !== expected.average ||
                counts.weaker !== expected.weaker) {
                throw new Error(`AI band quotas mismatch: got ${JSON.stringify(counts)} expected ${JSON.stringify(expected)}`);
            }
            const humanOwned = new Set(state.picks.map((p) => p.playerVersionId));
            for (const roster of gen.rosters) {
                const isHuman = state.participants.some((p) => p.franchiseId === roster.franchiseId);
                if (isHuman)
                    continue;
                for (const player of roster.players) {
                    if (humanOwned.has(player.playerVersionId)) {
                        throw Object.assign(new Error(`duplicate ownership ${player.playerVersionId}`), {
                            code: 'OWNED_VERSION',
                        });
                    }
                }
            }
            const digest = gen.digest;
            if (appliedState) {
                void seasonDraftStateCanonical(appliedState);
                void seasonDraftStateDigest(appliedState);
            }
            void seasonDigestHex(digest);
            return { state: appliedState, generation: gen, digest };
        }
        return { state: this.state, generation: null, digest: null };
    }
    verifyLeagueDigest(expectedDigest: string): boolean {
        if (!this.generation)
            return false;
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
    }
    classicRollFor(_participantId: 'p1' | 'p2'): {
        franchiseId: string;
        eraId: string;
    } {
        if (!this.state)
            return { franchiseId: 'lakers', eraId: '1990s' };
        const seed = seasonNamespaceSeed(this.state.rootSeed, 'draft', 'classic-roll', _participantId);
        const rng = createRng(seed);
        const franchises = ['lakers', 'celtics', 'bulls', 'warriors', 'heat'];
        const eras = ['era-80s', 'era-90s', 'era-00s', 'era-10s'];
        return { franchiseId: rng.pick(franchises), eraId: rng.pick(eras) };
    }
}
