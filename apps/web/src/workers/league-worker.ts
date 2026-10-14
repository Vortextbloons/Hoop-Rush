import { createEngineContext, createLeagueSimulation } from '@hoop-rush/engine';
import {
  leagueWorkerMessageSchema,
  leagueWorkerRequestSchema,
  type LeagueWorkerMessage,
} from '@hoop-rush/data-contracts';
import { postWorkerMessage, workerErrorMessage } from '../lib/workers/worker-protocol';
import { sleep } from '../lib/sleep';

const CHUNK_GAMES = 96;
let currentRequestId: string | null = null;
let requestToken = 0;

function postError(requestId: string, message: string): void {
  const payload: LeagueWorkerMessage = {
    schemaVersion: 1,
    type: 'error',
    requestId,
    message: message.slice(0, 512),
  };
  self.postMessage(payload);
}

self.onmessage = (event: MessageEvent<unknown>): void => {
  const parsed = leagueWorkerRequestSchema.safeParse(event.data);
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
  void (async () => {
    try {
      const context = createEngineContext();
      const simulation = createLeagueSimulation(
        { seed: request.seed, bracket: request.bracket, profile: request.profile },
        context,
      );
      postWorkerMessage(leagueWorkerMessageSchema, {
        schemaVersion: 1,
        type: 'progress',
        requestId: request.requestId,
        gamesDone: simulation.gamesDone,
        gamesTotal: simulation.gamesTotal,
      });
      while (simulation.gamesDone < simulation.gamesTotal && token === requestToken) {
        simulation.advance(CHUNK_GAMES);
        postWorkerMessage(leagueWorkerMessageSchema, {
          schemaVersion: 1,
          type: 'progress',
          requestId: request.requestId,
          gamesDone: simulation.gamesDone,
          gamesTotal: simulation.gamesTotal,
        });
        await sleep(0);
      }
      if (token !== requestToken) return;
      postWorkerMessage(leagueWorkerMessageSchema, {
        schemaVersion: 1,
        type: 'result',
        requestId: request.requestId,
        record: simulation.finish(),
      });
    } catch (error) {
      postError(request.requestId, workerErrorMessage(error));
    }
  })();
};

export {};
