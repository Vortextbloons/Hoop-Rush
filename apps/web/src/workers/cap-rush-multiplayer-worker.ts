import {
  CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
  capRushMultiplayerWorkerMessageSchema,
  capRushMultiplayerWorkerRequestSchema,
  type CapRushPlayoffGameSummary,
} from '@hoop-rush/data-contracts';
import {
  capRushMultiplayerSimulateGame,
  createEngineContext,
  simulateCapRushMultiplayerPlayoffGame,
  simulateCapRushMultiplayerSlot,
} from '@hoop-rush/engine';

const context = createEngineContext();

function post(message: unknown): void {
  self.postMessage(capRushMultiplayerWorkerMessageSchema.parse(message));
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown cap rush multiplayer worker failure';
}

self.onmessage = (event: MessageEvent<unknown>) => {
  const parsed = capRushMultiplayerWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) return;
  const request = parsed.data;
  if (request.kind === 'cap-rush-multiplayer-cancel') return;
  try {
    if (request.kind === 'cap-rush-multiplayer-slot') {
      const simulated = simulateCapRushMultiplayerSlot({
        locked: request.locked,
        slot: request.slot,
        context,
        tapeGameIds: request.tapeGameIds,
      });
      post({
        schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
        kind: 'cap-rush-multiplayer-slot',
        requestId: request.requestId,
        slot: request.slot,
        games: simulated.games,
        tapes: [...simulated.tapes].map(([gameId, tape]) => ({ gameId, tape })),
      });
      return;
    }
    if (request.kind === 'cap-rush-multiplayer-playoff-games') {
      const tapeIds = new Set(request.tapeGameIds);
      const games: CapRushPlayoffGameSummary[] = [];
      const tapes: { gameId: string; tape: unknown }[] = [];
      for (const plan of request.plans) {
        const simulated = simulateCapRushMultiplayerPlayoffGame({
          locked: request.locked,
          plan,
          context,
        });
        games.push(simulated.game);
        if (tapeIds.has(simulated.game.gameId)) {
          tapes.push({ gameId: simulated.game.gameId, tape: simulated.tape });
        }
      }
      post({
        schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
        kind: 'cap-rush-multiplayer-playoff-games',
        requestId: request.requestId,
        games,
        tapes,
      });
      return;
    }
    {
      if (request.entry !== undefined) {
        const simulated = capRushMultiplayerSimulateGame({
          locked: request.locked,
          entry: request.entry,
          context,
        });
        post({
          schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
          kind: 'cap-rush-multiplayer-tape',
          requestId: request.requestId,
          gameId: simulated.game.gameId,
          input: simulated.input,
          result: simulated.result,
          tape: simulated.tape,
        });
        return;
      }
      if (request.plan !== undefined) {
        const simulated = simulateCapRushMultiplayerPlayoffGame({
          locked: request.locked,
          plan: request.plan,
          context,
        });
        post({
          schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
          kind: 'cap-rush-multiplayer-tape',
          requestId: request.requestId,
          gameId: simulated.game.gameId,
          input: simulated.input,
          result: simulated.result,
          tape: simulated.tape,
        });
        return;
      }
    }
  } catch (error) {
    post({
      schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
      kind: 'cap-rush-multiplayer-error',
      requestId: request.requestId,
      code: 'internal',
      message: failureMessage(error).slice(0, 400),
    });
  }
};
