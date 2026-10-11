import {
  seasonPostseasonWorkerCancelRequestSchema,
  seasonPostseasonWorkerMessageSchema,
  seasonPostseasonWorkerWarmRequestSchema,
  type SeasonPostseasonWorkerCompleteMessage,
  type SeasonPostseasonWorkerErrorMessage,
  type SeasonPostseasonWorkerProgressMessage,
  type SeasonPostseasonWorkerStartRequest,
} from '@hoop-rush/data-contracts';
import type {
  SeasonPostseasonJob,
  SeasonPostseasonJobOutcome,
} from '@hoop-rush/application/season';
import type { SeasonArtifactUrls } from './season-assets';
import { newRequestId } from '$lib/ids';
export type { SeasonPostseasonJob, SeasonPostseasonJobOutcome };
export type SeasonPostseasonSimulatorFn = (
  request: SeasonPostseasonWorkerStartRequest,
  onProgress: (progress: SeasonPostseasonWorkerProgressMessage) => void,
) => Promise<SeasonPostseasonWorkerCompleteMessage | SeasonPostseasonWorkerErrorMessage>;
export interface SeasonPostseasonJobDeps {
  workerUrl?: string;
  artifacts?: () => Promise<SeasonArtifactUrls>;
  simulate?: SeasonPostseasonSimulatorFn;
}
export function createSeasonPostseasonJob(deps: SeasonPostseasonJobDeps = {}): SeasonPostseasonJob {
  let worker: Worker | null = null;
  let currentRequestId: string | null = null;
  let currentProgress: ((progress: SeasonPostseasonWorkerProgressMessage) => void) | null = null;
  const requestActive = (): boolean => currentRequestId !== null;
  let warmRequestId: string | null = null;
  let warmed = false;
  const pending = new Map<
    string,
    (message: SeasonPostseasonWorkerCompleteMessage | SeasonPostseasonWorkerErrorMessage) => void
  >();
  function outcomeOf(
    message: SeasonPostseasonWorkerCompleteMessage | SeasonPostseasonWorkerErrorMessage,
  ): SeasonPostseasonJobOutcome {
    if (message.type === 'season-postseason-error') {
      return {
        kind: 'error',
        code: message.code,
        message: message.message,
        seed: message.seed,
        gameId: message.gameId,
      };
    }
    if (message.result.status === 'rejected') {
      return {
        kind: 'rejected',
        commandId: message.result.commandId,
        rejection: message.result.rejection,
      };
    }
    return { kind: 'accepted', result: message.result };
  }
  function failPendingOnUnparsableEnvelope(data: unknown): void {
    console.warn('[season-postseason-runner] dropped unparsable worker message', data);
    if (pending.size === 0) return;
    const failure: SeasonPostseasonWorkerErrorMessage = {
      schemaVersion: 1,
      type: 'season-postseason-error',
      requestId: currentRequestId ?? '',
      code: 'invariant-failure',
      message: 'the postseason worker sent a message outside the wire schema',
      seed: null,
      gameId: null,
    };
    for (const resolve of [...pending.values()]) resolve(failure);
    pending.clear();
  }
  function createWorker(): Worker {
    if (worker !== null) return worker;
    worker =
      deps.workerUrl !== undefined
        ? new Worker(deps.workerUrl, { type: 'module' })
        : new Worker(new URL('../../workers/season-postseason-worker.ts', import.meta.url), {
            type: 'module',
          });
    worker.addEventListener('error', (event) => {
      const failure: SeasonPostseasonWorkerErrorMessage = {
        schemaVersion: 1,
        type: 'season-postseason-error',
        requestId: currentRequestId ?? '',
        code: 'internal',
        message: event.message.slice(0, 512),
        seed: null,
        gameId: null,
      };
      for (const resolve of [...pending.values()]) resolve(failure);
      pending.clear();
    });
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      const parsed = seasonPostseasonWorkerMessageSchema.safeParse(event.data);
      if (!parsed.success) {
        failPendingOnUnparsableEnvelope(event.data);
        return;
      }
      const message = parsed.data;
      if (message.type === 'season-postseason-warm-ack') {
        if (message.requestId === warmRequestId) warmRequestId = null;
        return;
      }
      if (message.type === 'season-postseason-progress') {
        if (currentRequestId === null) return;
        currentProgress?.(message);
        return;
      }
      const resolve = pending.get(message.requestId);
      if (resolve === undefined) return;
      pending.delete(message.requestId);
      resolve(message);
    });
    return worker;
  }
  return {
    async simulate(
      request: SeasonPostseasonWorkerStartRequest,
      onProgress?: (progress: SeasonPostseasonWorkerProgressMessage) => void,
    ): Promise<SeasonPostseasonJobOutcome> {
      currentRequestId = request.requestId;
      currentProgress = onProgress ?? null;
      const finish = (
        message: SeasonPostseasonWorkerCompleteMessage | SeasonPostseasonWorkerErrorMessage,
      ): SeasonPostseasonJobOutcome => {
        if (currentRequestId === request.requestId) {
          currentRequestId = null;
          currentProgress = null;
        }
        return outcomeOf(message);
      };
      if (deps.simulate !== undefined) {
        return deps
          .simulate(request, (progress) => {
            if (currentRequestId !== request.requestId) return;
            onProgress?.(progress);
          })
          .then(finish);
      }
      const target = createWorker();
      return new Promise((resolve) => {
        pending.set(request.requestId, (message) => {
          resolve(finish(message));
        });
        target.postMessage(request);
      });
    },
    cancel(requestId: string): void {
      if (requestId !== currentRequestId) return;
      if (worker !== null) {
        worker.postMessage(
          seasonPostseasonWorkerCancelRequestSchema.parse({
            schemaVersion: 1,
            type: 'season-postseason-cancel',
            requestId,
          }),
        );
      }
    },
    terminate(): void {
      worker?.terminate();
      worker = null;
      currentRequestId = null;
      currentProgress = null;
      warmRequestId = null;
      warmed = false;
      const failure: SeasonPostseasonWorkerErrorMessage = {
        schemaVersion: 1,
        type: 'season-postseason-error',
        requestId: '',
        code: 'cancelled',
        message: 'postseason worker terminated',
        seed: null,
        gameId: null,
      };
      for (const resolve of [...pending.values()]) resolve(failure);
      pending.clear();
    },
    prewarm(): void {
      if (currentRequestId !== null || warmed) return;
      warmed = true;
      void (async () => {
        try {
          const artifacts =
            deps.artifacts !== undefined
              ? await deps.artifacts()
              : await import('./season-assets').then((module) => module.seasonArtifactUrls());
          if (requestActive()) return;
          const target = createWorker();
          const requestId = newRequestId('warm');
          warmRequestId = requestId;
          target.postMessage(
            seasonPostseasonWorkerWarmRequestSchema.parse({
              schemaVersion: 1,
              type: 'season-postseason-warm',
              requestId,
              catalogUrl: artifacts.catalogUrl,
              catalogHash: artifacts.catalogHash,
              profileUrl: artifacts.profileUrl,
              profileHash: artifacts.profileHash,
            }),
          );
        } catch {
          warmRequestId = null;
        }
      })();
    },
  };
}
export function getSeasonPostseasonJob(): SeasonPostseasonJob {
  if (typeof window !== 'undefined' && window.__HOOP_RUSH_SEASON_POSTSEASON_RUNNER__) {
    return window.__HOOP_RUSH_SEASON_POSTSEASON_RUNNER__;
  }
  if (postseasonJobSingleton === null) {
    postseasonJobSingleton = createSeasonPostseasonJob();
  }
  return postseasonJobSingleton;
}
let postseasonJobSingleton: SeasonPostseasonJob | null = null;
declare global {
  interface Window {
    __HOOP_RUSH_SEASON_POSTSEASON_RUNNER__?: SeasonPostseasonJob;
  }
}
