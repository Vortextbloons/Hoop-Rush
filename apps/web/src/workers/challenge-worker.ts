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
  type WorkerCompleteMessage,
  type WorkerErrorMessage,
  type WorkerResultsMessage,
  type WorkerStartResultMessage,
} from '@hoop-rush/data-contracts';
import { sleep } from '../lib/sleep';

/**
 * Challenge worker entry (spec/04 static deployment and workers). Receives
 * runtime-validated, versioned requests; a `start` request simulates the
 * whole-run best-of-N and reports the chosen attempt seed, and a `simulate`
 * request simulates games from the start game through game 82 through the
 * authoritative challenge command path, posting results in batches of up to
 * BATCH_SIZE games. It never writes IndexedDB and holds no domain state:
 * results are a pure function of the request. The main thread validates every
 * message once at its boundary.
 */

const BATCH_SIZE = 4;

let currentRequestId: string | null = null;
let requestToken = 0;

function post(
  message:
    WorkerResultsMessage | WorkerErrorMessage | WorkerCompleteMessage | WorkerStartResultMessage,
): void {
  // The pinned wire contract is enforced at its only emission point (the
  // main thread keeps a cheap shape check; acceptGameResult stays the
  // authoritative per-game validator).
  workerMessageSchema.parse(message);
  self.postMessage(message);
}

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
      post({
        schemaVersion: 1,
        type: 'start-result',
        requestId: request.requestId,
        chosenRunSeed: chosen.chosenRunSeed,
        chosenWins: chosen.chosenWins,
        chosenLosses: chosen.chosenLosses,
        chosenDifferential: chosen.chosenDifferential,
      });
    } catch (error) {
      postError(request.requestId, error instanceof Error ? error.message : String(error));
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
        post({
          schemaVersion: 1,
          type: 'results',
          requestId: request.requestId,
          fromGameNumber: gameNumber,
          results,
        });
        // Yield once per batch so the main thread stays responsive on slower
        // devices; pacing of the presentation is the main thread's job.
        await sleep(0);
      }
      if (token === requestToken) {
        post({
          schemaVersion: 1,
          type: 'complete',
          requestId: request.requestId,
          gamesDelivered: delivered,
          cancelled: false,
        });
      }
    } catch (error) {
      postError(request.requestId, error instanceof Error ? error.message : String(error));
    }
  })();
};

export {};
