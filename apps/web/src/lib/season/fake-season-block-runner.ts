import {
  SEASON_WORKER_WIRE_SCHEMA_VERSION,
  seasonWorkerMessageSchema,
  seasonWorkerRequestSchema,
  type EraSimulationProfile,
  type SeasonDraftCatalog,
  type SeasonSchedule,
  type SeasonWorkerErrorMessage,
  type SeasonWorkerStartRequest,
  type SeasonWorkerWarmAckMessage,
  type SeasonWorkerWarmRequest,
} from '@hoop-rush/data-contracts';
import type { SeasonRunRepository } from '@hoop-rush/persistence';
import {
  createSeasonBlockRunner,
  type SeasonBlockRunner,
  type SeasonBlockTransport,
} from '$lib/season/season-block-runner';
import type { SeasonArtifactUrls } from './season-assets';
import {
  describeSeasonBlockJobError,
  runSeasonBlockJob,
  warmSeasonBlockJob,
  type SeasonBlockJobIo,
} from './season-block-job';

export interface FakeSeasonBlockRunnerDeps {
  repository?: SeasonRunRepository;
  schedule?: SeasonSchedule;
  catalog?: SeasonDraftCatalog;
  profile?: EraSimulationProfile;
}

const IN_PROCESS_ARTIFACTS: SeasonArtifactUrls = {
  catalogUrl: 'in-process:season-draft-catalog',
  catalogHash: '0'.repeat(64),
  profileUrl: 'in-process:era-simulation-profile',
  profileHash: '0'.repeat(64),
};

function inProcessArtifacts(): Promise<SeasonArtifactUrls> {
  return Promise.resolve({ ...IN_PROCESS_ARTIFACTS });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function internalError(requestId: string, message: string): SeasonWorkerErrorMessage {
  return {
    schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
    type: 'season-block-error',
    requestId,
    code: 'internal',
    message: message.slice(0, 512),
    seed: null,
    gameId: null,
    blockIndex: null,
  };
}

function createInProcessTransport(deps: FakeSeasonBlockRunnerDeps): SeasonBlockTransport {
  const messageListeners = new Set<(data: unknown) => void>();
  const errorListeners = new Set<(message: string) => void>();
  let currentRequestId: string | null = null;
  let cancelled = false;
  let terminated = false;
  function deliver(message: unknown): void {
    setTimeout(() => {
      if (terminated) return;
      for (const listener of [...messageListeners]) listener(message);
    }, 0);
  }
  function postError(payload: SeasonWorkerErrorMessage): void {
    seasonWorkerMessageSchema.parse(payload);
    deliver(payload);
  }
  function fail(message: string): void {
    setTimeout(() => {
      if (terminated) return;
      for (const listener of [...errorListeners]) listener(message);
    }, 0);
  }
  function io(requestId: string): SeasonBlockJobIo {
    return {
      post: deliver,
      now: () => Date.now(),
      perfNow: () => performance.now(),
      isCancelled: () => terminated || (currentRequestId === requestId && cancelled),
      yield: () =>
        new Promise((resolve) => {
          setTimeout(resolve, 0);
        }),
    };
  }
  async function warm(request: SeasonWorkerWarmRequest): Promise<void> {
    try {
      await warmSeasonBlockJob(request, { catalog: deps.catalog, profile: deps.profile });
      if (terminated) return;
      const ack: SeasonWorkerWarmAckMessage = {
        schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
        type: 'season-block-warm-ack',
        requestId: request.requestId,
      };
      deliver(ack);
    } catch (error) {
      if (terminated) return;
      postError(internalError(request.requestId, errorMessage(error)));
    }
  }
  function start(request: SeasonWorkerStartRequest): void {
    void runSeasonBlockJob(request, io(request.requestId), {
      catalog: deps.catalog,
      profile: deps.profile,
    }).catch((error: unknown) => {
      if (terminated) return;
      try {
        postError(describeSeasonBlockJobError(error, request));
      } catch (describeError) {
        fail(errorMessage(describeError));
      }
    });
  }
  return {
    postMessage(message: unknown): void {
      if (terminated) return;
      const parsed = seasonWorkerRequestSchema.safeParse(message);
      if (!parsed.success) {
        fail('the in-process season block transport received a message outside the wire schema');
        return;
      }
      const request = parsed.data;
      if (request.type === 'season-block-cancel') {
        if (request.requestId === currentRequestId) cancelled = true;
        return;
      }
      if (request.type === 'season-block-warm') {
        void warm(request);
        return;
      }
      currentRequestId = request.requestId;
      cancelled = false;
      start(request);
    },
    onMessage(listener: (data: unknown) => void): void {
      messageListeners.add(listener);
    },
    onError(listener: (message: string) => void): void {
      errorListeners.add(listener);
    },
    terminate(): void {
      terminated = true;
      cancelled = true;
      currentRequestId = null;
      messageListeners.clear();
      errorListeners.clear();
    },
  };
}

export function createFakeSeasonBlockRunner(
  deps: FakeSeasonBlockRunnerDeps = {},
): SeasonBlockRunner {
  return createSeasonBlockRunner({
    repository: deps.repository,
    schedule: deps.schedule,
    artifacts:
      deps.catalog !== undefined && deps.profile !== undefined ? inProcessArtifacts : undefined,
    transportFactory: () => createInProcessTransport(deps),
  });
}
