import {
  createEngineContext,
  simulateFullCourtPlayoffGame,
  simulateFullCourtSeasonSlot,
  type FullCourtPlayoffLock,
  type FullCourtSeasonLock,
} from '@hoop-rush/engine';
import {
  FULL_COURT_WORKER_WIRE_SCHEMA_VERSION,
  fullCourtWorkerMessageSchema,
  fullCourtWorkerRequestSchema,
  type FullCourtWorkerErrorMessage,
  type FullCourtWorkerPlayoffPayload,
  type FullCourtWorkerSeasonLock,
} from '../lib/features/full-court/full-court-worker-protocol';

const engineContext = createEngineContext();

/**
 * Locked inputs are immutable for a run and dominate the request payload. The
 * first job hydrates these copies; later jobs reference them by run and digest
 * so the main thread does not clone the league for every slot or game. A
 * recreated worker starts empty and hydrates again from the next payload.
 */
let hydratedSeason: FullCourtSeasonLock | null = null;
let hydratedPlayoffs: FullCourtPlayoffLock | null = null;

class LockMissingError extends Error {}

function post(message: unknown): void {
  self.postMessage(fullCourtWorkerMessageSchema.parse(message));
}

function postError(
  requestId: string,
  code: FullCourtWorkerErrorMessage['code'],
  error: unknown,
): void {
  post({
    schemaVersion: FULL_COURT_WORKER_WIRE_SCHEMA_VERSION,
    type: 'full-court-error',
    requestId,
    code,
    message: (error instanceof Error ? error.message : 'unknown full court worker failure').slice(
      0,
      512,
    ),
  });
}

function seasonLockFor(input: {
  readonly runId: string;
  readonly lockDigest: string;
  readonly lock?: FullCourtWorkerSeasonLock;
}): FullCourtSeasonLock {
  if (input.lock !== undefined) {
    hydratedSeason = input.lock;
    return input.lock;
  }
  if (
    hydratedSeason !== null &&
    hydratedSeason.season.runId === input.runId &&
    hydratedSeason.digest === input.lockDigest
  ) {
    return hydratedSeason;
  }
  throw new LockMissingError('the worker has not hydrated this run; send the locked season again');
}

function playoffLockFor(input: {
  readonly runId: string;
  readonly lockDigest: string;
  readonly playoffLock?: FullCourtWorkerPlayoffPayload;
}): FullCourtPlayoffLock {
  const payload = input.playoffLock;
  if (payload === undefined) {
    if (
      hydratedPlayoffs !== null &&
      hydratedPlayoffs.seasonLock.season.runId === input.runId &&
      hydratedPlayoffs.digest === input.lockDigest
    ) {
      return hydratedPlayoffs;
    }
    throw new LockMissingError(
      'the worker has not hydrated this run; send the locked playoff inputs again',
    );
  }
  const seasonLock =
    payload.seasonLock ??
    seasonLockFor({ runId: input.runId, lockDigest: payload.seasonLockDigest });
  // The runner marks the season hydrated after a successful playoff bootstrap,
  // so the worker must remember a season lock supplied with that payload too.
  hydratedSeason = seasonLock;
  const lock: FullCourtPlayoffLock = {
    digest: payload.digest,
    seasonLock,
    standings: payload.standings,
    initialHealth: payload.initialHealth,
    regularScores: payload.regularScores,
    firstGameDay: payload.firstGameDay,
  };
  hydratedPlayoffs = lock;
  return lock;
}

self.onmessage = (event: MessageEvent<unknown>): void => {
  const parsed = fullCourtWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) {
    postError('unknown', 'internal', 'unrecognised full court worker request');
    return;
  }
  const request = parsed.data;
  try {
    if (request.type === 'full-court-simulate-slot') {
      const lock = seasonLockFor(request);
      const outcome = simulateFullCourtSeasonSlot(
        lock,
        request.checkpoint,
        engineContext,
        request.options,
      );
      post({
        schemaVersion: FULL_COURT_WORKER_WIRE_SCHEMA_VERSION,
        type: 'full-court-slot-result',
        requestId: request.requestId,
        outcome,
      });
      return;
    }
    const lock = playoffLockFor(request);
    const outcome = simulateFullCourtPlayoffGame(
      lock,
      request.checkpoint,
      engineContext,
      request.options,
    );
    post({
      schemaVersion: FULL_COURT_WORKER_WIRE_SCHEMA_VERSION,
      type: 'full-court-game-result',
      requestId: request.requestId,
      outcome,
    });
  } catch (error) {
    postError(
      request.requestId,
      error instanceof LockMissingError ? 'lock-missing' : 'internal',
      error,
    );
  }
};
