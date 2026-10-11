import type {
  SeasonRotation,
  SeasonGameSummary,
  SeasonPendingBlockCandidate,
} from '@hoop-rush/data-contracts';
import {
  SEASON_WORKER_WIRE_SCHEMA_VERSION,
  seasonWorkerCancelRequestSchema,
  seasonWorkerMessageSchema,
  seasonWorkerWarmRequestSchema,
  type SeasonSchedule,
  type SeasonWorkerStartRequest,
} from '@hoop-rush/data-contracts';
import {
  acceptWorkerResult,
  buildWorkerRequest,
  type SeasonBlockResumeInput,
  type SeasonBlockRunner,
  type SeasonBlockRunnerDeps,
  type SeasonBlockStartInput,
  type SeasonBlockTransport,
  type SeasonRunnerEvent,
} from '@hoop-rush/application/season';
import { newRequestId } from '$lib/ids';
export { acceptWorkerResult, buildWorkerRequest };
export type {
  SeasonBlockResumeInput,
  SeasonBlockRunner,
  SeasonBlockRunnerDeps,
  SeasonBlockStartInput,
  SeasonBlockTransport,
  SeasonRunnerEvent,
};
function createWorkerTransport(workerUrl?: string): SeasonBlockTransport {
  const worker =
    workerUrl !== undefined
      ? new Worker(workerUrl, { type: 'module' })
      : new Worker(new URL('../../workers/season-block-worker.ts', import.meta.url), {
          type: 'module',
        });
  return {
    postMessage(message: unknown): void {
      worker.postMessage(message);
    },
    onMessage(listener: (data: unknown) => void): void {
      worker.addEventListener('message', (event: MessageEvent<unknown>) => {
        listener(event.data);
      });
    },
    onError(listener: (message: string) => void): void {
      worker.addEventListener('error', (event) => {
        listener(event.message);
      });
    },
    terminate(): void {
      worker.terminate();
    },
  };
}
export function createSeasonBlockRunner(deps: SeasonBlockRunnerDeps = {}): SeasonBlockRunner {
  const listeners = new Set<(event: SeasonRunnerEvent) => void>();
  let transport: SeasonBlockTransport | null = null;
  let currentRequestId: string | null = null;
  let postedRequestId: string | null = null;
  let cancellationEpoch = 0;
  const cancelledRequestIds = new Map<string, number>();
  const requestActive = () => currentRequestId !== null;
  let warmRequestId: string | null = null;
  let warmed = false;
  let current: {
    blockIndex: number;
    expectedRevision: number;
    rotationDigest: string;
    commandId: string;
    rotations: SeasonRotation[];
    input: SeasonBlockStartInput;
    resumePending: SeasonPendingBlockCandidate | null;
    knownSummaries: SeasonGameSummary[];
  } | null = null;
  const schedulePromise = deps.schedule !== undefined ? Promise.resolve(deps.schedule) : null;
  function resolveSchedule(): Promise<SeasonSchedule> {
    if (schedulePromise !== null) return schedulePromise;
    return import('./season-assets').then((module) => module.loadSeasonSchedule());
  }
  function resolveArtifacts(): Promise<import('@hoop-rush/application/season').SeasonArtifactUrls> {
    return deps.artifacts !== undefined
      ? deps.artifacts()
      : import('./season-assets').then((module) => module.seasonArtifactUrls());
  }
  function emit(event: SeasonRunnerEvent): void {
    for (const listener of [...listeners]) listener(event);
  }
  function signalCancellation(requestId: string): void {
    const cancelledBlockIndex = cancelledRequestIds.get(requestId);
    if (cancelledBlockIndex === undefined) return;
    cancelledRequestIds.delete(requestId);
    emit({ type: 'cancelled', requestId, blockIndex: cancelledBlockIndex });
  }
  function failOnUnparsableEnvelope(): void {
    if (currentRequestId === null || current === null) return;
    const requestId = currentRequestId;
    const blockIndex = current.blockIndex;
    currentRequestId = null;
    current = null;
    postedRequestId = null;
    emit({
      type: 'error',
      requestId,
      blockIndex,
      code: 'invariant-failure',
      message: 'the season block worker sent a message outside the frozen wire schema',
      seed: null,
      gameId: null,
    });
  }
  function consumePreWorkerCancellation(requestId: string): boolean {
    if (!cancelledRequestIds.has(requestId)) return false;
    signalCancellation(requestId);
    if (currentRequestId === requestId) {
      currentRequestId = null;
      current = null;
      postedRequestId = null;
    }
    return true;
  }
  function requestLive(requestId: string, epoch: number): boolean {
    return (
      cancellationEpoch === epoch &&
      currentRequestId === requestId &&
      !cancelledRequestIds.has(requestId)
    );
  }
  function handleTransportError(message: string): void {
    if (warmRequestId !== null) {
      warmRequestId = null;
      if (currentRequestId === null) warmed = false;
    }
    if (currentRequestId === null || current === null) return;
    const requestId = currentRequestId;
    const blockIndex = current.blockIndex;
    emit({
      type: 'error',
      requestId,
      blockIndex,
      code: 'internal',
      message,
      seed: null,
      gameId: null,
    });
    currentRequestId = null;
    current = null;
    postedRequestId = null;
  }
  function handleTransportMessage(data: unknown): void {
    const parsed = seasonWorkerMessageSchema.safeParse(data);
    if (!parsed.success) {
      console.warn('[season-block-runner] dropped unparsable worker message', data);
      failOnUnparsableEnvelope();
      return;
    }
    if (parsed.data.type === 'season-block-warm-ack') {
      if (parsed.data.requestId === warmRequestId) {
        warmRequestId = null;
        warmed = true;
      }
      return;
    }
    if (parsed.data.type === 'season-block-error' && parsed.data.requestId === warmRequestId) {
      warmRequestId = null;
      warmed = false;
      return;
    }
    if (parsed.data.requestId !== currentRequestId) {
      // Stale but well-formed envelopes are expected during cancel/resume races and must
      // not fail the live request, so they stay a warn-and-drop.
      console.warn(
        `[season-block-runner] dropped message for stale requestId ${parsed.data.requestId} (expected ${String(currentRequestId)})`,
      );
      return;
    }
    const message = parsed.data;
    if (current === null) return;
    if (message.type === 'season-block-progress') {
      emit({
        type: 'progress',
        requestId: message.requestId,
        blockIndex: message.blockIndex,
        gamesCompleted: message.gamesCompleted,
        gamesTotal: message.gamesTotal,
        latestGameId: message.latestGameId,
        latestResult: message.latestResult,
        isHumanGame: message.isHumanGame,
        humanRecordInBlock: message.humanRecordInBlock,
        humanResults: message.humanResults,
        leaguePulse: message.leaguePulse,
      });
      return;
    }
    const requestId = message.requestId;
    const blockIndex = current.blockIndex;
    if (message.type === 'season-block-error') {
      if (message.code === 'cancelled') {
        if (cancelledRequestIds.has(requestId)) {
          signalCancellation(requestId);
        } else {
          emit({ type: 'cancelled', requestId, blockIndex });
        }
      } else if (cancelledRequestIds.has(requestId)) {
        signalCancellation(requestId);
      } else {
        emit({
          type: 'error',
          requestId,
          blockIndex,
          code: message.code,
          message: message.message,
          seed: message.seed,
          gameId: message.gameId,
        });
      }
      currentRequestId = null;
      current = null;
      postedRequestId = null;
      return;
    }
    const result = message.result;
    const wasCancelled = cancelledRequestIds.has(requestId);
    currentRequestId = null;
    current = null;
    postedRequestId = null;
    if (wasCancelled) {
      signalCancellation(requestId);
      return;
    }
    if (result.status === 'interrupted') {
      emit({
        type: 'interrupted',
        requestId,
        runId: result.pending.runId,
        blockIndex,
        pending: result.pending,
      });
      return;
    }
    emit({ type: 'candidate', requestId, blockIndex, checkpoint: result.checkpoint });
  }
  function createTransport(): SeasonBlockTransport {
    if (transport !== null) return transport;
    const factory = deps.transportFactory ?? (() => createWorkerTransport(deps.workerUrl));
    const target = factory();
    transport = target;
    target.onError(handleTransportError);
    target.onMessage(handleTransportMessage);
    return target;
  }
  function buildRequest(
    requestId: string,
    state: NonNullable<typeof current>,
    schedule: SeasonSchedule,
    artifacts: import('@hoop-rush/application/season').SeasonArtifactUrls,
  ): SeasonWorkerStartRequest {
    return buildWorkerRequest(requestId, state, {
      knownSummaries: state.knownSummaries,
      schedule,
      artifacts,
    });
  }
  function postRequest(
    requestId: string,
    requestEpoch: number,
    blockIndex: number,
    seed: string | null,
  ): void {
    void (async () => {
      try {
        const [schedule, artifacts] = await Promise.all([resolveSchedule(), resolveArtifacts()]);
        if (consumePreWorkerCancellation(requestId)) return;
        if (!requestLive(requestId, requestEpoch)) return;
        const state = current;
        if (state === null) return;
        const plainStart = buildRequest(requestId, state, schedule, artifacts);
        const target = createTransport();
        target.postMessage(plainStart);
        postedRequestId = requestId;
        warmed = true;
        emit({ type: 'started', requestId, blockIndex });
      } catch (error) {
        if (consumePreWorkerCancellation(requestId)) return;
        if (!requestLive(requestId, requestEpoch)) return;
        emit({
          type: 'error',
          requestId,
          blockIndex,
          code: 'internal',
          message: error instanceof Error ? error.message : String(error),
          seed,
          gameId: null,
        });
        currentRequestId = null;
        current = null;
        postedRequestId = null;
      }
    })();
  }
  return {
    startBlock(input: SeasonBlockStartInput): string {
      if (currentRequestId !== null) {
        throw new Error('a season block is already running; cancel it first');
      }
      const requestId = newRequestId('sb');
      const requestEpoch = cancellationEpoch;
      currentRequestId = requestId;
      current = {
        blockIndex: input.blockIndex,
        expectedRevision: input.expectedRevision,
        rotationDigest: input.rotationDigest,
        commandId: input.commandId,
        rotations: input.rotations,
        input,
        resumePending: null,
        knownSummaries: input.knownSummaries ?? [],
      };
      postRequest(requestId, requestEpoch, input.blockIndex, input.run.rootSeed);
      return requestId;
    },
    resumeBlock(input: SeasonBlockResumeInput): string {
      if (currentRequestId !== null) {
        throw new Error('a season block is already running; cancel it first');
      }
      const requestId = newRequestId('sb');
      const requestEpoch = cancellationEpoch;
      currentRequestId = requestId;
      const startInput: SeasonBlockStartInput = {
        run: input.run,
        effects: input.effects,
        rotations: input.rotations,
        blockIndex: input.blockIndex,
        expectedRevision: input.expectedRevision,
        rotationDigest: input.rotationDigest,
        commandId: input.commandId,
        humanFranchiseId: input.humanFranchiseId,
        objectiveId: input.pending.objectiveId ?? null,
        challengeDeal: input.pending.challengeDeal ?? null,
        campaignOpportunityId: input.pending.campaignOpportunityId ?? null,
        homeCourt: input.homeCourt,
        catalogUrl: input.catalogUrl,
        catalogHash: input.catalogHash,
        profileUrl: input.profileUrl,
        profileHash: input.profileHash,
        knownSummaries: input.knownSummaries,
      };
      current = {
        blockIndex: input.blockIndex,
        expectedRevision: input.expectedRevision,
        rotationDigest: input.rotationDigest,
        commandId: input.commandId,
        rotations: input.rotations,
        input: startInput,
        resumePending: input.pending,
        knownSummaries: input.knownSummaries,
      };
      postRequest(requestId, requestEpoch, input.blockIndex, null);
      return requestId;
    },
    cancel(requestId: string): void {
      if (requestId !== currentRequestId) return;
      if (!cancelledRequestIds.has(requestId)) {
        cancelledRequestIds.set(requestId, current?.blockIndex ?? 0);
      }
      if (transport === null || postedRequestId !== requestId) return;
      transport.postMessage(
        seasonWorkerCancelRequestSchema.parse({
          schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
          type: 'season-block-cancel',
          requestId,
        }),
      );
    },
    terminate(): void {
      transport?.terminate();
      transport = null;
      currentRequestId = null;
      current = null;
      postedRequestId = null;
      cancellationEpoch += 1;
      cancelledRequestIds.clear();
      warmRequestId = null;
      warmed = false;
    },
    prewarm(): void {
      if (currentRequestId !== null || warmed || warmRequestId !== null) return;
      const pendingWarmId = newRequestId('warm');
      warmRequestId = pendingWarmId;
      void (async () => {
        try {
          const artifacts = await resolveArtifacts();
          if (requestActive()) {
            if (warmRequestId === pendingWarmId) warmRequestId = null;
            return;
          }
          const target = createTransport();
          target.postMessage(
            seasonWorkerWarmRequestSchema.parse({
              schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
              type: 'season-block-warm',
              requestId: pendingWarmId,
              catalogUrl: artifacts.catalogUrl,
              catalogHash: artifacts.catalogHash,
              profileUrl: artifacts.profileUrl,
              profileHash: artifacts.profileHash,
            }),
          );
          warmed = true;
        } catch {
          if (warmRequestId === pendingWarmId) warmRequestId = null;
        }
      })();
    },
    subscribe(listener: (event: SeasonRunnerEvent) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
