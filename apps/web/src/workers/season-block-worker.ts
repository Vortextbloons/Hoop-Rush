import {
  SEASON_WORKER_WIRE_SCHEMA_VERSION,
  seasonWorkerMessageSchema,
  seasonWorkerRequestSchema,
  type SeasonWorkerCompleteMessage,
  type SeasonWorkerErrorMessage,
  type SeasonWorkerProgressMessage,
  type SeasonWorkerWarmAckMessage,
} from '@hoop-rush/data-contracts';
import { sleep } from '../lib/sleep';
import {
  postWorkerMessage,
  seasonWorkerInternalError,
  workerErrorMessage,
} from '../lib/workers/worker-protocol';
import {
  describeSeasonBlockJobError,
  runSeasonBlockJob,
  warmSeasonBlockJob,
  type SeasonBlockJobIo,
} from '../lib/season/season-block-job';
let currentRequestId: string | null = null;
let cancelled = false;
function post(
  message:
    | SeasonWorkerProgressMessage
    | SeasonWorkerCompleteMessage
    | SeasonWorkerErrorMessage
    | SeasonWorkerWarmAckMessage,
): void {
  if (message.type === 'season-block-error') {
    console.error(
      `[season-block-worker] ${message.code} for request ${message.requestId}: ${message.message}`,
    );
  }
  self.postMessage(message);
}
if (typeof self !== 'undefined') {
  const io: SeasonBlockJobIo = {
    post,
    now: () => Date.now(),
    perfNow: () => performance.now(),
    isCancelled: () => cancelled,
    yield: () => sleep(0),
  };
  self.onmessage = (event: MessageEvent<unknown>): void => {
    const parsed = seasonWorkerRequestSchema.safeParse(event.data);
    if (!parsed.success) {
      const rawId =
        typeof event.data === 'object' &&
        event.data !== null &&
        typeof (event.data as { requestId?: unknown }).requestId === 'string'
          ? (event.data as { requestId: string }).requestId
          : null;
      if (rawId !== null && rawId.length > 0) {
        postWorkerMessage(
          seasonWorkerMessageSchema,
          seasonWorkerInternalError(rawId.slice(0, 64), 'season block wire mismatch'),
        );
      }
      return;
    }
    const request = parsed.data;
    if (request.type === 'season-block-warm') {
      void (async () => {
        try {
          await warmSeasonBlockJob(request);
          post({
            schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
            type: 'season-block-warm-ack',
            requestId: request.requestId,
          });
        } catch (error) {
          postWorkerMessage(
            seasonWorkerMessageSchema,
            seasonWorkerInternalError(request.requestId, workerErrorMessage(error)),
          );
        }
      })();
      return;
    }
    if (request.type === 'season-block-cancel') {
      if (request.requestId === currentRequestId) {
        cancelled = true;
      }
      return;
    }
    currentRequestId = request.requestId;
    cancelled = false;
    void runSeasonBlockJob(request, io).catch((error: unknown) => {
      postWorkerMessage(seasonWorkerMessageSchema, describeSeasonBlockJobError(error, request));
    });
  };
}
