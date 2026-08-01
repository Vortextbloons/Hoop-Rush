import {
  createEngineContext,
  createGameInput,
  simulateGame,
  type EngineContext,
} from '@hoop-rush/engine';
import {
  workerMessageSchema,
  workerRequestSchema,
  type WorkerErrorMessage,
  type WorkerResultMessage,
} from '@hoop-rush/data-contracts';

/**
 * Challenge worker entry (spec/04 static deployment and workers). Receives
 * runtime-validated, versioned requests; simulates games from the start game
 * through game 82 through the authoritative challenge command path, and
 * posts runtime-validated results. It never writes IndexedDB and holds no
 * domain state: results are a pure function of the request.
 */

let currentRequestId: string | null = null;
let requestToken = 0;

function post(
  message:
    | WorkerResultMessage
    | WorkerErrorMessage
    | {
        schemaVersion: 1;
        type: 'complete';
        requestId: string;
        gamesDelivered: number;
        cancelled: boolean;
      },
): void {
  const parsed = workerMessageSchema.safeParse(message);
  if (!parsed.success) {
    postError(currentRequestId ?? 'unknown', 'worker produced an invalid message');
    return;
  }
  self.postMessage(parsed.data);
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

  void (async () => {
    let delivered = 0;
    try {
      for (
        let gameNumber = request.startGameNumber;
        gameNumber <= 82 && token === requestToken;
        gameNumber += 1
      ) {
        const input = createGameInput(request.run, request.profile, gameNumber);
        const result = simulateGame(input, context);
        delivered += 1;
        const message: WorkerResultMessage = {
          schemaVersion: 1,
          type: 'result',
          requestId: request.requestId,
          gameNumber,
          result,
        };
        post(message);
        // Yield between games so the main thread stays responsive on slower
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
