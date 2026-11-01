import {
  chooseBestRunSeedWithGames,
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
import {
  CHALLENGE_GAMES_PER_RUN,
  ChallengeAttemptCache,
} from '../lib/workers/challenge-attempt-cache';
import { sleep } from '../lib/sleep';
const BATCH_SIZE = 4;
let currentRequestId: string | null = null;
let requestToken = 0;
const retainedAttempts = new ChallengeAttemptCache();
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
      retainedAttempts.clear();
    }
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
      const chosen = chooseBestRunSeedWithGames(request.run, request.profile, context);
      if (token !== requestToken) return;
      retainedAttempts.retain(
        { ...request.run, runSeed: chosen.chosenRunSeed, games: [] },
        request.profile,
        request.engineVersion,
        chosen.chosenGames,
      );
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
      retainedAttempts.clear();
      postError(request.requestId, workerErrorMessage(error));
    }
    return;
  }
  void (async () => {
    // The winning best-of attempt was simulated in this worker moments ago; replay
    // those results instead of simulating the same seeded 82 games a second time.
    const retained = retainedAttempts.take(
      request.run,
      request.profile,
      request.engineVersion,
      request.startGameNumber,
    );
    let nextResult: (gameNumber: number) => GameResult;
    if (retained === null) {
      const simulate = createGameBatchSimulator(context);
      nextResult = (gameNumber) =>
        simulate(createGameInput(request.run, request.profile, gameNumber));
    } else {
      nextResult = (gameNumber) => {
        const result = retained[gameNumber - 1];
        if (result === undefined || result.gameNumber !== gameNumber) {
          throw new Error(`worker lost the retained result for game ${String(gameNumber)}`);
        }
        return result;
      };
    }
    let delivered = 0;
    try {
      for (
        let gameNumber = request.startGameNumber;
        gameNumber <= CHALLENGE_GAMES_PER_RUN && token === requestToken;
        gameNumber += BATCH_SIZE
      ) {
        const results: GameResult[] = [];
        const last = Math.min(gameNumber + BATCH_SIZE - 1, CHALLENGE_GAMES_PER_RUN);
        for (let n = gameNumber; n <= last; n += 1) {
          results.push(nextResult(n));
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
