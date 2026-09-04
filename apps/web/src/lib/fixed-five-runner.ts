import { FIXED_FIVE_WORKER_WIRE_VERSION, fixedFiveWorkerMessageSchema, fixedFiveWorkerRequestSchema, type EraSimulationProfile, type FixedFiveWorkerMessage, type FixedFiveWorkerRequest, type FixedFiveWorkerResultEntry, type FixedFiveWorkerTeam, type OpponentBracketCore, type Seed, } from '@hoop-rush/data-contracts';
import { randomUUID } from '$lib/random-id';
export type FixedFiveRunnerEvent = {
    kind: 'progress';
    completedGames: number;
    totalGames: number;
} | {
    kind: 'results';
    entries: FixedFiveWorkerResultEntry[];
} | {
    kind: 'complete';
    gamesDelivered: number;
} | {
    kind: 'error';
    message: string;
};
export class FixedFiveRunner {
    private worker: Worker | null = null;
    private requestId: string | null = null;
    private disposed = false;
    constructor(private readonly onEvent: (event: FixedFiveRunnerEvent) => void) { }
    runShared82(input: {
        rootSeed: Seed;
        p1Team: FixedFiveWorkerTeam;
        p2Team: FixedFiveWorkerTeam;
        bracket: OpponentBracketCore;
        profile: EraSimulationProfile;
        dataVersion: string;
        engineVersion: string;
        startGameNumber?: number;
    }): void {
        this.start({
            schemaVersion: FIXED_FIVE_WORKER_WIRE_VERSION,
            type: 'fixed-five-shared-82',
            requestId: randomUUID(),
            rootSeed: input.rootSeed,
            p1Team: input.p1Team,
            p2Team: input.p2Team,
            bracket: input.bracket,
            profile: input.profile,
            dataVersion: input.dataVersion,
            engineVersion: input.engineVersion,
            startGameNumber: input.startGameNumber ?? 1,
        });
    }
    runDuel(input: {
        rootSeed: Seed;
        p1Team: FixedFiveWorkerTeam;
        p2Team: FixedFiveWorkerTeam;
        profile: EraSimulationProfile;
        dataVersion: string;
        engineVersion: string;
    }): void {
        this.start({
            schemaVersion: FIXED_FIVE_WORKER_WIRE_VERSION,
            type: 'fixed-five-duel',
            requestId: randomUUID(),
            rootSeed: input.rootSeed,
            p1Team: input.p1Team,
            p2Team: input.p2Team,
            profile: input.profile,
            dataVersion: input.dataVersion,
            engineVersion: input.engineVersion,
        });
    }
    cancel(): void {
        if (this.worker && this.requestId) {
            try {
                this.worker.postMessage(fixedFiveWorkerRequestSchema.parse({
                    schemaVersion: FIXED_FIVE_WORKER_WIRE_VERSION,
                    type: 'fixed-five-cancel',
                    requestId: this.requestId,
                }));
            }
            catch {
            }
        }
        this.teardown();
    }
    dispose(): void {
        this.disposed = true;
        this.teardown();
    }
    private start(request: FixedFiveWorkerRequest): void {
        this.cancel();
        this.disposed = false;
        this.requestId = request.requestId;
        this.worker = new Worker(new URL('../workers/fixed-five-worker.ts', import.meta.url), {
            type: 'module',
        });
        this.worker.onmessage = (event: MessageEvent<unknown>) => {
            const parsed = fixedFiveWorkerMessageSchema.safeParse(event.data);
            if (!parsed.success) {
                this.onEvent({ kind: 'error', message: 'fixed-five worker returned an invalid message' });
                return;
            }
            const message: FixedFiveWorkerMessage = parsed.data;
            if (message.requestId !== this.requestId)
                return;
            if (this.disposed)
                return;
            if (message.type === 'fixed-five-progress') {
                this.onEvent({
                    kind: 'progress',
                    completedGames: message.completedGames,
                    totalGames: message.totalGames,
                });
            }
            else if (message.type === 'fixed-five-results') {
                this.onEvent({ kind: 'results', entries: message.entries });
            }
            else if (message.type === 'fixed-five-complete') {
                this.onEvent({ kind: 'complete', gamesDelivered: message.gamesDelivered });
            }
            else {
                this.onEvent({ kind: 'error', message: message.message });
            }
        };
        this.worker.onerror = () => {
            this.onEvent({ kind: 'error', message: 'the fixed-five worker crashed' });
        };
        this.worker.postMessage(fixedFiveWorkerRequestSchema.parse(request));
    }
    private teardown(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.requestId = null;
    }
}
