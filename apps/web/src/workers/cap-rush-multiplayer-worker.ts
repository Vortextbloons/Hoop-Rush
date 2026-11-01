import {
  CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
  capRushMultiplayerWorkerMessageSchema,
  capRushMultiplayerWorkerRequestSchema,
  type CapRushPlayoffGameSummary,
} from '@hoop-rush/data-contracts';
import {
  capRushMultiplayerSimulateGame,
  applyCapRushMultiplayerCommand,
  type CapRushMultiplayerEnvironment,
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
    if (request.kind === 'cap-rush-multiplayer-project') {
      let state = request.state;
      for (const command of request.commands) {
        const outcome = applyCapRushMultiplayerCommand(
          state,
          command,
          request.environment as CapRushMultiplayerEnvironment,
          request.variant,
        );
        if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.message}`);
        state = outcome.state;
      }
      post({
        schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
        kind: 'cap-rush-multiplayer-projection',
        requestId: request.requestId,
        state,
      });
      return;
    }
    if (request.kind === 'cap-rush-multiplayer-slot') {
      const games = [];
      const tapes = [];
      const through = request.throughSlot ?? request.slot;
      if (through < request.slot || through - request.slot > 4)
        throw new Error('invalid simulation range');
      for (let slot = request.slot; slot <= through; slot += 1) {
        const simulated = simulateCapRushMultiplayerSlot({
          locked: request.locked,
          slot,
          context,
          tapeGameIds: request.tapeGameIds,
        });
        games.push(...simulated.games);
        tapes.push(...[...simulated.tapes].map(([gameId, tape]) => ({ gameId, tape })));
      }
      post({
        schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
        kind: 'cap-rush-multiplayer-slot',
        requestId: request.requestId,
        slot: request.slot,
        games,
        tapes,
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
