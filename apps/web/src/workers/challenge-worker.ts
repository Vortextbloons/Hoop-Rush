import {
  chooseBestRunSeed,
  createEngineContext,
  createGameInput,
  simulateGame,
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
const BATCH_SIZE = 4;
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
    if (request.requestId === currentRequestId) requestToken += 1;
    return;
  }
  currentRequestId = request.requestId;
  requestToken += 1;
  const token = requestToken;
  const context: EngineContext = createEngineContext({
    engineVersion: request.engineVersion,
  });
  if (request.type === 'start') {
    try {
      const chosen = chooseBestRunSeed(request.run, request.profile, context);
      if (token !== requestToken) return;
      postWorkerMessage(workerMessageSchema, {
        schemaVersion: 1,
        type: 'start-result',
        requestId: request.requestId,
        chosenRunSeed: chosen.chosenRunSeed,
        chosenWins: chosen.chosenWins,
        chosenLosses: chosen.chosenLosses,
        chosenDifferential: chosen.chosenDifferential,
      });
    } catch (error) {
      postError(request.requestId, workerErrorMessage(error));
    }
    return;
  }
  void (async () => {
    let delivered = 0;
    try {
      for (
        let gameNumber = request.startGameNumber;
        gameNumber <= 82 && token === requestToken;
        gameNumber += BATCH_SIZE
      ) {
        const results: GameResult[] = [];
        const last = Math.min(gameNumber + BATCH_SIZE - 1, 82);
        for (let n = gameNumber; n <= last; n += 1) {
          const input = createGameInput(request.run, request.profile, n);
          results.push(simulateGame(input, context));
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
        await sleep(0);
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
