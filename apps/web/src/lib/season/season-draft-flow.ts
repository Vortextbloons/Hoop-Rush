import type { PlayerVersionId, SeasonDraftCatalog, SeasonDraftCommandPayload, SeasonDraftCommandRecord, SeasonDraftPick, SeasonDraftState, SeasonLeague, Seed, SeasonLeagueGenerationResult, SeasonRosterTargets, } from '@hoop-rush/data-contracts';
import { SEASON_DRAFT_VERSION } from '@hoop-rush/data-contracts';
import { applySeasonDraftCommand, type SeasonAiGenerationDeps, type SeasonAiGenerationInput, } from '@hoop-rush/engine';
import { recordFromState, type SeasonDraftRepository } from '@hoop-rush/persistence';
import { newSeasonId } from './season-ids';
import { runOneShotWorker } from '$lib/one-shot-worker';
import { sleep } from '$lib/sleep';
import { GENERATION_WORKER_WIRE_SCHEMA_VERSION, type GenerationWorkerRequest, type GenerationWorkerResponse, } from './season-generation-wire.ts';
export const SOLO_PARTICIPANT_ID = 'human';
export const COVERAGE_TARGETS = { guards: 4, forwards: 4, centers: 3 } as const;
export type SeasonDraftFlowPhase = 'idle' | 'drafting' | 'finalized' | 'generating' | 'complete';
export interface SeasonDraftFlowState {
    draft: SeasonDraftState | null;
    generation: SeasonLeagueGenerationResult | null;
    lastRecord: SeasonDraftCommandRecord | null;
    phase: SeasonDraftFlowPhase;
}
export function coverageNeeds(picks: readonly SeasonDraftPick[], catalog: SeasonDraftCatalog): {
    guards: number;
    forwards: number;
    centers: number;
} {
    const byId = new Map(catalog.candidates.map((c) => [c.playerVersionId, c]));
    let guards = 0;
    let forwards = 0;
    let centers = 0;
    for (const pick of picks) {
        const candidate = byId.get(pick.playerVersionId);
        if (!candidate)
            continue;
        const playable = new Set(candidate.positions.playable);
        if (playable.has('PG') || playable.has('SG'))
            guards += 1;
        if (playable.has('SF') || playable.has('PF'))
            forwards += 1;
        if (playable.has('C'))
            centers += 1;
    }
    return { guards, forwards, centers };
}
function isGenerationDeps(value: SeasonAiGenerationDeps | SeasonRosterTargets): value is SeasonAiGenerationDeps {
    return typeof (value as SeasonAiGenerationDeps).generate === 'function';
}
export class SeasonDraftFlow {
    private readonly repo: SeasonDraftRepository;
    private readonly catalogRef: SeasonDraftCatalog;
    private readonly deps: SeasonAiGenerationDeps;
    private readonly targets: SeasonRosterTargets | null;
    private readonly useWorker: boolean;
    private readonly generationBridge: {
        precomputed: SeasonLeagueGenerationResult | null;
    };
    draft: SeasonDraftState | null = null;
    generation: SeasonLeagueGenerationResult | null = null;
    lastRecord: SeasonDraftCommandRecord | null = null;
    phase: SeasonDraftFlowPhase = 'idle';
    error: string | null = null;
    onPhaseChange: (() => void) | null = null;
    constructor(repo: SeasonDraftRepository, catalog: SeasonDraftCatalog, targetsOrDeps: SeasonRosterTargets | SeasonAiGenerationDeps) {
        this.repo = repo;
        this.catalogRef = catalog;
        this.generationBridge = { precomputed: null };
        if (isGenerationDeps(targetsOrDeps)) {
            this.deps = targetsOrDeps;
            this.targets = null;
            this.useWorker = false;
        }
        else {
            this.targets = targetsOrDeps;
            this.deps = engineGenerationDeps(this.generationBridge);
            this.useWorker = true;
        }
    }
    get catalog(): SeasonDraftCatalog {
        return this.catalogRef;
    }
    async load(): Promise<boolean> {
        const stored = await this.repo.loadSeasonDraft();
        if (stored) {
            this.draft = stored.draft;
            this.generation = stored.generation;
            this.phase =
                stored.draft.status === 'complete'
                    ? 'complete'
                    : stored.draft.status === 'finalized'
                        ? 'finalized'
                        : 'drafting';
            return true;
        }
        return false;
    }
    async clear(): Promise<void> {
        await this.repo.clearSeasonDraft();
        this.draft = null;
        this.generation = null;
        this.lastRecord = null;
        this.phase = 'idle';
        this.error = null;
    }
    state(): SeasonDraftFlowState {
        return {
            draft: this.draft,
            generation: this.generation,
            lastRecord: this.lastRecord,
            phase: this.phase,
        };
    }
    async create(input: {
        rootSeed: Seed;
        league: SeasonLeague;
    }): Promise<SeasonDraftCommandRecord> {
        this.error = null;
        const record = await this.apply({
            kind: 'create-season-draft',
            runId: newSeasonId('run'),
            rootSeed: input.rootSeed,
            league: input.league,
            humanParticipantIds: [SOLO_PARTICIPANT_ID],
            catalogVersion: SEASON_DRAFT_VERSION,
        }, 0);
        return record;
    }
    async draw(participantId: string = SOLO_PARTICIPANT_ID): Promise<SeasonDraftCommandRecord> {
        this.error = null;
        return this.apply({ kind: 'draw-season-offer', participantId }, this.revision());
    }
    async pick(participantId: string, playerVersionId: PlayerVersionId): Promise<SeasonDraftCommandRecord> {
        this.error = null;
        return this.apply({ kind: 'select-draft-player', participantId, playerVersionId }, this.revision());
    }
    async finalize(): Promise<SeasonDraftCommandRecord> {
        this.error = null;
        return this.apply({ kind: 'finalize-human-rosters' }, this.revision());
    }
    async generate(): Promise<SeasonLeagueGenerationResult | null> {
        if (this.draft?.status !== 'finalized') {
            throw new Error('generate requires finalized human rosters');
        }
        this.error = null;
        this.setPhase('generating');
        await sleep(0);
        try {
            if (this.useWorker && this.targets !== null) {
                this.generationBridge.precomputed = await this.runGenerationInWorker(this.buildGenerationInput(this.draft));
            }
            const record = await this.apply({ kind: 'generate-ai-league' }, this.revision());
            if (record.status === 'rejected') {
                this.error = record.message;
                this.setPhase('finalized');
                return null;
            }
            this.setPhase('complete');
            return this.generation;
        }
        catch (error) {
            this.setPhase('finalized');
            this.error = error instanceof Error ? error.message : String(error);
            throw error;
        }
        finally {
            this.generationBridge.precomputed = null;
        }
    }
    private setPhase(phase: SeasonDraftFlowPhase): void {
        this.phase = phase;
        this.onPhaseChange?.();
    }
    private buildGenerationInput(state: SeasonDraftState): Omit<SeasonAiGenerationInput, 'targets'> {
        return {
            seed: state.rootSeed,
            catalog: this.catalogRef,
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
    private runGenerationInWorker(input: Omit<SeasonAiGenerationInput, 'targets'>): Promise<SeasonLeagueGenerationResult> {
        const targets = this.targets;
        if (targets === null) {
            throw new Error('worker generation requires roster targets');
        }
        const request: GenerationWorkerRequest = {
            schemaVersion: GENERATION_WORKER_WIRE_SCHEMA_VERSION,
            type: 'generate',
            requestId: newSeasonId('gen'),
            input,
            targets,
        };
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
    private revision(): number {
        return this.draft?.revision ?? 0;
    }
    private async apply(payload: SeasonDraftCommandPayload, expectedRevision: number): Promise<SeasonDraftCommandRecord> {
        const command = { commandId: newSeasonId('cmd'), expectedRevision, payload };
        const result = applySeasonDraftCommand(this.draft, this.catalogRef, command, this.deps);
        this.lastRecord = result.record;
        if (result.state === null || result.record.status === 'rejected') {
            if (result.record.status === 'rejected') {
                this.error = result.record.message;
            }
            return result.record;
        }
        this.draft = result.state;
        this.generation = result.generation;
        await this.repo.saveSeasonDraft(recordFromState(result.state, result.generation ?? this.generation));
        if (result.generation) {
            this.phase = 'complete';
        }
        else if (this.draft.status === 'finalized') {
            this.phase = 'finalized';
        }
        else {
            this.phase = 'drafting';
        }
        return result.record;
    }
}
export function engineGenerationDeps(bridge: {
    precomputed: SeasonLeagueGenerationResult | null;
}): SeasonAiGenerationDeps {
    return {
        generate: () => {
            const precomputed = bridge.precomputed;
            if (precomputed === null) {
                throw new Error('AI league generation must finish in the worker before applying generate-ai-league');
            }
            return precomputed;
        },
    };
}
