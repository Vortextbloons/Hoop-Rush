import {
  createEngineContext,
  createGameInput,
  createGameBatchSimulator,
  type EngineContext,
} from '@hoop-rush/engine';
import type { GameResult } from '@hoop-rush/data-contracts';
import {
  workerMessageSchema,
  workerRequestSchema,
  type WorkerErrorMessage,
} from '@hoop-rush/data-contracts';
import { postWorkerMessage, workerErrorMessage } from '../lib/workers/worker-protocol';
import { sleep } from '../lib/sleep';
const CHALLENGE_GAMES_PER_RUN = 82;
const BATCH_SIZE = 8;
const YIELD_INTERVAL_MS = 8;
let currentRequestId: string | null = null;
let requestToken = 0;
function postError(requestId: string, message: string): void {
  const payload: WorkerErrorMessage = {
    schemaVersion: 1,
    type: 'error',
    requestId,
    message: message.slice(0, 512),
  };
  self.postMessage(payload);
}
self.onmessage = (event: MessageEvent<unknown>): void => {
  const parsed = workerRequestSchema.safeParse(event.data);
  if (!parsed.success) {
    postError(currentRequestId ?? 'unknown', 'worker received an invalid request');
    return;
  }
  const request = parsed.data;
  if (request.type === 'cancel') {
    if (request.requestId === currentRequestId) {
      requestToken += 1;
    }
    return;
  }
  currentRequestId = request.requestId;
  requestToken += 1;
  const token = requestToken;
  const context: EngineContext = createEngineContext({
    engineVersion: request.engineVersion,
  });
  void (async () => {
    const simulate = createGameBatchSimulator(context);
    let delivered = 0;
    let lastYieldAt = Date.now();
    try {
      for (
        let gameNumber = request.startGameNumber;
        gameNumber <= CHALLENGE_GAMES_PER_RUN && token === requestToken;
        gameNumber += BATCH_SIZE
      ) {
        const results: GameResult[] = [];
        const last = Math.min(gameNumber + BATCH_SIZE - 1, CHALLENGE_GAMES_PER_RUN);
        for (let n = gameNumber; n <= last; n += 1) {
          results.push(simulate(createGameInput(request.run, request.profile, n)));
          delivered += 1;
        }
        if (token !== requestToken) break;
        postWorkerMessage(workerMessageSchema, {
          schemaVersion: 1,
          type: 'results',
          requestId: request.requestId,
          fromGameNumber: gameNumber,
          results,
        });
        if (Date.now() - lastYieldAt >= YIELD_INTERVAL_MS) {
          lastYieldAt = Date.now();
          await sleep(0);
        }
      }
      if (token === requestToken) {
        postWorkerMessage(workerMessageSchema, {
          schemaVersion: 1,
          type: 'complete',
          requestId: request.requestId,
          gamesDelivered: delivered,
          cancelled: false,
        });
      }
    } catch (error) {
      postError(request.requestId, workerErrorMessage(error));
    }
  })();
};
export {};
