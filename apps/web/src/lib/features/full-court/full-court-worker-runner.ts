import type {
  FullCourtPlayoffCheckpoint,
  FullCourtSeasonCheckpoint,
  Seed,
} from '@hoop-rush/data-contracts';
import type {
  FullCourtPlayoffGameOutcome,
  FullCourtPlayoffLock,
  FullCourtSeasonLock,
  FullCourtSeasonSlotOptions,
  FullCourtSeasonSlotOutcome,
} from '@hoop-rush/engine';
import { newRequestId } from '#lib/ids.js';
import { StreamingWorkerRunner } from '#lib/workers/streaming-worker.js';
import {
  FULL_COURT_WORKER_WIRE_SCHEMA_VERSION,
  fullCourtWorkerMessageSchema,
  fullCourtWorkerRequestSchema,
  type FullCourtWorkerGameRequestInput,
  type FullCourtWorkerMessage,
  type FullCourtWorkerPlayoffPayloadInput,
  type FullCourtWorkerRequestInput,
  type FullCourtWorkerSlotRequestInput,
} from './full-court-worker-protocol';

export interface FullCourtWorkerRunnerOptions {
  createWorker?: () => Worker;
  newRequestId?: () => string;
}

export interface FullCourtWorkerRunner {
  simulateSlot(
    lock: FullCourtSeasonLock,
    checkpoint: FullCourtSeasonCheckpoint,
    options?: FullCourtSeasonSlotOptions,
  ): Promise<FullCourtSeasonSlotOutcome>;
  simulateGame(
    lock: FullCourtPlayoffLock,
    checkpoint: FullCourtPlayoffCheckpoint,
    options?: FullCourtSeasonSlotOptions,
  ): Promise<FullCourtPlayoffGameOutcome>;
  dispose(): void;
}

function defaultWorker(): Worker {
  return new Worker(new URL('../../../workers/full-court-worker.ts', import.meta.url), {
    type: 'module',
  });
}

interface HydratedSeason {
  readonly runId: string;
  readonly digest: Seed;
}

interface HydratedPlayoffs extends HydratedSeason {
  readonly seasonDigest: Seed;
}

class BrowserFullCourtWorkerRunner implements FullCourtWorkerRunner {
  private readonly transport: StreamingWorkerRunner<FullCourtWorkerMessage>;
  private readonly nextRequestId: () => string;
  private hydratedSeason: HydratedSeason | null = null;
  private hydratedPlayoffs: HydratedPlayoffs | null = null;
  private generation = 0;

  constructor(options: FullCourtWorkerRunnerOptions) {
    this.nextRequestId = options.newRequestId ?? (() => newRequestId('full-court'));
    this.transport = new StreamingWorkerRunner({
      createWorker: options.createWorker ?? defaultWorker,
      responseSchema: fullCourtWorkerMessageSchema,
      invalidMessage: 'the full court worker sent an unrecognised message',
      crashed: 'the full court worker crashed',
    });
  }

  simulateSlot(
    lock: FullCourtSeasonLock,
    checkpoint: FullCourtSeasonCheckpoint,
    options: FullCourtSeasonSlotOptions = {},
  ): Promise<FullCourtSeasonSlotOutcome> {
    const runId = lock.season.runId;
    const includeLock = !this.seasonIsHydrated(runId, lock.digest);
    const request: FullCourtWorkerSlotRequestInput = {
      schemaVersion: FULL_COURT_WORKER_WIRE_SCHEMA_VERSION,
      type: 'full-court-simulate-slot',
      requestId: this.nextRequestId(),
      runId,
      lockDigest: lock.digest,
      ...(includeLock ? { lock } : {}),
      checkpoint,
      options,
    };
    const generation = this.generation;
    return this.runJob<FullCourtSeasonSlotOutcome>(request, (message) =>
      message.type === 'full-court-slot-result' ? message.outcome : null,
    ).then(
      (outcome) => {
        if (this.generation === generation) {
          this.hydratedSeason = { runId, digest: lock.digest };
          if (this.hydratedPlayoffs?.runId !== runId) this.hydratedPlayoffs = null;
        }
        return outcome;
      },
      (error: unknown) => {
        if (this.generation === generation) this.clearHydration();
        throw error;
      },
    );
  }

  simulateGame(
    lock: FullCourtPlayoffLock,
    checkpoint: FullCourtPlayoffCheckpoint,
    options: FullCourtSeasonSlotOptions = {},
  ): Promise<FullCourtPlayoffGameOutcome> {
    const runId = lock.seasonLock.season.runId;
    const seasonDigest = lock.seasonLock.digest;
    const includeSeason = !this.seasonIsHydrated(runId, seasonDigest);
    const includePlayoffs =
      includeSeason ||
      this.hydratedPlayoffs?.runId !== runId ||
      this.hydratedPlayoffs.digest !== lock.digest ||
      this.hydratedPlayoffs.seasonDigest !== seasonDigest;
    const playoffLock: FullCourtWorkerPlayoffPayloadInput = {
      digest: lock.digest,
      seasonLockDigest: seasonDigest,
      ...(includeSeason ? { seasonLock: lock.seasonLock } : {}),
      standings: lock.standings,
      initialHealth: lock.initialHealth,
      regularScores: lock.regularScores,
      firstGameDay: lock.firstGameDay,
    };
    const request: FullCourtWorkerGameRequestInput = {
      schemaVersion: FULL_COURT_WORKER_WIRE_SCHEMA_VERSION,
      type: 'full-court-simulate-game',
      requestId: this.nextRequestId(),
      runId,
      lockDigest: lock.digest,
      ...(includePlayoffs ? { playoffLock } : {}),
      checkpoint,
      options,
    };
    const generation = this.generation;
    return this.runJob<FullCourtPlayoffGameOutcome>(request, (message) =>
      message.type === 'full-court-game-result' ? message.outcome : null,
    ).then(
      (outcome) => {
        if (this.generation === generation) {
          this.hydratedSeason = { runId, digest: seasonDigest };
          this.hydratedPlayoffs = { runId, digest: lock.digest, seasonDigest };
        }
        return outcome;
      },
      (error: unknown) => {
        if (this.generation === generation) this.clearHydration();
        throw error;
      },
    );
  }

  dispose(): void {
    this.generation += 1;
    this.clearHydration();
    this.transport.dispose('the full court worker runner was disposed');
  }

  private async runJob<T>(
    request: FullCourtWorkerRequestInput,
    completeOf: (message: FullCourtWorkerMessage) => T | null,
  ): Promise<T> {
    if (this.transport.busy) throw new Error('a full court job is already running');
    const validated = fullCourtWorkerRequestSchema.safeParse(request);
    if (!validated.success) {
      throw new Error(`invalid full court worker request: ${validated.error.message}`);
    }
    return this.transport.run({
      request,
      requestId: request.requestId,
      concurrent: { kind: 'reject', message: 'a full court job is already running' },
      completeOf,
      errorOf: (message) =>
        message.type === 'full-court-error'
          ? new Error(`${message.code}: ${message.message}`)
          : null,
      drainOnError: false,
      handle: () => {},
    });
  }

  private seasonIsHydrated(runId: string, digest: Seed): boolean {
    return this.hydratedSeason?.runId === runId && this.hydratedSeason.digest === digest;
  }

  private clearHydration(): void {
    this.hydratedSeason = null;
    this.hydratedPlayoffs = null;
  }
}

export function createFullCourtWorkerRunner(
  options: FullCourtWorkerRunnerOptions = {},
): FullCourtWorkerRunner {
  return new BrowserFullCourtWorkerRunner(options);
}
