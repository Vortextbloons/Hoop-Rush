import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_TAKEOVER_TEAMS,
  type FullCourtPlayoffCheckpoint,
  type FullCourtPracticeReport,
  type FullCourtSeasonCheckpoint,
  type FullCourtSeasonScore,
  type Seed,
} from '@hoop-rush/data-contracts';
import type {
  FullCourtAiGameChunk,
  FullCourtPlayoffGameOutcome,
  FullCourtPlayoffLock,
  FullCourtSeasonLock,
  FullCourtSeasonSlotOptions,
  FullCourtSeasonSlotOutcome,
  FullCourtTrainingCampOptions,
  FullCourtUserSlotOutcome,
} from '@hoop-rush/engine';
import { newRequestId } from '#lib/ids.js';
import { StreamingWorkerRunner } from '#lib/workers/streaming-worker.js';
import {
  FULL_COURT_WORKER_WIRE_SCHEMA_VERSION,
  fullCourtWorkerMessageSchema,
  fullCourtWorkerRequestSchema,
  type FullCourtWorkerAiGamesRequestInput,
  type FullCourtWorkerGameRequestInput,
  type FullCourtWorkerMessage,
  type FullCourtWorkerPlayoffPayloadInput,
  type FullCourtWorkerPracticeRequestInput,
  type FullCourtWorkerRequestInput,
  type FullCourtWorkerSlotRequestInput,
  type FullCourtWorkerUserSlotRequestInput,
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
  simulatePractice?(
    lock: FullCourtSeasonLock,
    input: {
      readonly seed: Seed;
      readonly opponentTeamId: string;
      readonly options?: FullCourtTrainingCampOptions;
    },
  ): Promise<FullCourtPracticeReport>;
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

interface AuxLane {
  readonly transport: StreamingWorkerRunner<FullCourtWorkerMessage>;
  hydratedSeason: HydratedSeason | null;
}

class BrowserFullCourtWorkerRunner implements FullCourtWorkerRunner {
  private readonly transport: StreamingWorkerRunner<FullCourtWorkerMessage>;
  private readonly lanes: AuxLane[] = [];
  private readonly nextRequestId: () => string;
  private hydratedSeason: HydratedSeason | null = null;
  private hydratedPlayoffs: HydratedPlayoffs | null = null;
  private generation = 0;

  constructor(options: FullCourtWorkerRunnerOptions) {
    this.nextRequestId = options.newRequestId ?? (() => newRequestId('full-court'));
    const create = options.createWorker ?? defaultWorker;
    this.transport = new StreamingWorkerRunner({
      createWorker: create,
      responseSchema: fullCourtWorkerMessageSchema,
      invalidMessage: 'the full court worker sent an unrecognised message',
      crashed: 'the full court worker crashed',
    });
    if (
      options.createWorker === undefined &&
      typeof navigator !== 'undefined' &&
      navigator.hardwareConcurrency > 1
    ) {
      const auxCount = Math.min(5, Math.max(0, navigator.hardwareConcurrency - 1));
      for (let index = 0; index < auxCount; index += 1) {
        this.lanes.push({
          transport: new StreamingWorkerRunner({
            createWorker: defaultWorker,
            responseSchema: fullCourtWorkerMessageSchema,
            invalidMessage: 'the full court worker sent an unrecognised message',
            crashed: 'the full court worker crashed',
          }),
          hydratedSeason: null,
        });
      }
    }
  }

  simulateSlot(
    lock: FullCourtSeasonLock,
    checkpoint: FullCourtSeasonCheckpoint,
    options: FullCourtSeasonSlotOptions = {},
  ): Promise<FullCourtSeasonSlotOutcome> {
    if (
      this.lanes.length > 0 &&
      checkpoint.completedThroughSlot < CAP_RUSH_CONFERENCE_GAMES_PER_TEAM
    ) {
      return this.simulateSlotParallel(lock, checkpoint, options);
    }
    return this.runSingleSlot(lock, checkpoint, options);
  }

  private async simulateSlotParallel(
    lock: FullCourtSeasonLock,
    checkpoint: FullCourtSeasonCheckpoint,
    options: FullCourtSeasonSlotOptions,
  ): Promise<FullCourtSeasonSlotOutcome> {
    const slot = checkpoint.completedThroughSlot + 1;
    const entries = lock.season.games.filter((game) => game.slot === slot);
    const userTeamId = lock.season.userTeamId;
    const aiGameIds = entries
      .filter((game) => game.homeTeamId !== userTeamId && game.awayTeamId !== userTeamId)
      .map((game) => game.gameId);
    if (entries.length !== CAP_RUSH_TAKEOVER_TEAMS / 2 || aiGameIds.length !== entries.length - 1) {
      // Fall back to single-worker validation if the schedule is malformed.
      return this.runSingleSlot(lock, checkpoint, options);
    }
    const runId = lock.season.runId;
    const generation = this.generation;
    const includeUserLock = !this.seasonIsHydrated(runId, lock.digest);
    const userRequest: FullCourtWorkerUserSlotRequestInput = {
      schemaVersion: FULL_COURT_WORKER_WIRE_SCHEMA_VERSION,
      type: 'full-court-simulate-user-slot',
      requestId: this.nextRequestId(),
      runId,
      lockDigest: lock.digest,
      ...(includeUserLock ? { lock } : {}),
      checkpoint,
      options,
    };

    const activeLanes = Math.min(this.lanes.length, aiGameIds.length);
    const chunkSize = Math.ceil(aiGameIds.length / activeLanes);
    const aiPromises: Promise<FullCourtAiGameChunk>[] = [];
    for (let laneIndex = 0; laneIndex < activeLanes; laneIndex += 1) {
      const slice = aiGameIds.slice(laneIndex * chunkSize, (laneIndex + 1) * chunkSize);
      if (slice.length === 0) continue;
      const lane = this.lanes[laneIndex];
      if (lane === undefined) continue;
      const includeLaneLock =
        lane.hydratedSeason?.runId !== runId || lane.hydratedSeason.digest !== lock.digest;
      const aiRequest: FullCourtWorkerAiGamesRequestInput = {
        schemaVersion: FULL_COURT_WORKER_WIRE_SCHEMA_VERSION,
        type: 'full-court-simulate-ai-games',
        requestId: this.nextRequestId(),
        runId,
        lockDigest: lock.digest,
        ...(includeLaneLock ? { lock } : {}),
        checkpoint,
        gameIds: slice,
      };
      aiPromises.push(
        this.runOnTransport<FullCourtAiGameChunk>(lane.transport, aiRequest, (message) =>
          message.type === 'full-court-ai-games-result' ? message.chunk : null,
        ).then(
          (chunk) => {
            if (this.generation === generation)
              lane.hydratedSeason = { runId, digest: lock.digest };
            return chunk;
          },
          (error: unknown) => {
            if (this.generation === generation) lane.hydratedSeason = null;
            throw error;
          },
        ),
      );
    }

    const userPromise = this.runJob<FullCourtUserSlotOutcome>(userRequest, (message) =>
      message.type === 'full-court-user-slot-result' ? message.outcome : null,
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

    const [userOutcome, ...aiChunks] = await Promise.all([userPromise, ...aiPromises]);
    if (userOutcome.kind !== 'user-ready') return userOutcome;

    const scoreByGameId = new Map<string, FullCourtSeasonScore>();
    scoreByGameId.set(userOutcome.userGameId, userOutcome.userScore);
    const healthByTeam: FullCourtSeasonCheckpoint['healthByTeam'] = {
      ...userOutcome.healthByTeam,
    };
    for (const chunk of aiChunks) {
      for (const score of chunk.scores) scoreByGameId.set(score.gameId, score);
      Object.assign(healthByTeam, chunk.healthByTeam);
    }
    const scores = entries.map((fixture) => {
      const score = scoreByGameId.get(fixture.gameId);
      if (score === undefined) {
        throw new Error(`missing parallel Full Court score for ${fixture.gameId}`);
      }
      return score;
    });
    return {
      kind: 'simulated',
      checkpoint: { ...checkpoint, completedThroughSlot: userOutcome.slot, healthByTeam },
      scores,
      userGame: userOutcome.userGame,
    };
  }

  private runSingleSlot(
    lock: FullCourtSeasonLock,
    checkpoint: FullCourtSeasonCheckpoint,
    options: FullCourtSeasonSlotOptions,
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

  simulatePractice(
    lock: FullCourtSeasonLock,
    input: {
      readonly seed: Seed;
      readonly opponentTeamId: string;
      readonly options?: FullCourtTrainingCampOptions;
    },
  ): Promise<FullCourtPracticeReport> {
    const runId = lock.season.runId;
    const includeLock = !this.seasonIsHydrated(runId, lock.digest);
    const request: FullCourtWorkerPracticeRequestInput = {
      schemaVersion: FULL_COURT_WORKER_WIRE_SCHEMA_VERSION,
      type: 'full-court-simulate-practice',
      requestId: this.nextRequestId(),
      runId,
      lockDigest: lock.digest,
      ...(includeLock ? { lock } : {}),
      seed: input.seed,
      opponentTeamId: input.opponentTeamId,
      ...(input.options === undefined ? {} : { options: input.options }),
    };
    const generation = this.generation;
    return this.runJob<FullCourtPracticeReport>(request, (message) =>
      message.type === 'full-court-practice-result' ? message.report : null,
    ).then(
      (report) => {
        if (this.generation === generation) {
          this.hydratedSeason = { runId, digest: lock.digest };
          if (this.hydratedPlayoffs?.runId !== runId) this.hydratedPlayoffs = null;
        }
        return report;
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
    for (const lane of this.lanes) {
      lane.transport.dispose('the full court worker runner was disposed');
    }
  }

  private async runJob<T>(
    request: FullCourtWorkerRequestInput,
    completeOf: (message: FullCourtWorkerMessage) => T | null,
  ): Promise<T> {
    return this.runOnTransport(this.transport, request, completeOf);
  }

  private async runOnTransport<T>(
    transport: StreamingWorkerRunner<FullCourtWorkerMessage>,
    request: FullCourtWorkerRequestInput,
    completeOf: (message: FullCourtWorkerMessage) => T | null,
  ): Promise<T> {
    if (transport.busy) throw new Error('a full court job is already running');
    const validated = fullCourtWorkerRequestSchema.safeParse(request);
    if (!validated.success) {
      throw new Error(`invalid full court worker request: ${validated.error.message}`);
    }
    return transport.run({
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
    for (const lane of this.lanes) lane.hydratedSeason = null;
  }
}

export function createFullCourtWorkerRunner(
  options: FullCourtWorkerRunnerOptions = {},
): FullCourtWorkerRunner {
  return new BrowserFullCourtWorkerRunner(options);
}
