import {
  CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
  capRushMultiplayerWorkerMessageSchema,
  capRushMultiplayerWorkerRequestSchema,
} from '@hoop-rush/data-contracts';
import { createEngineContext, simulateCapRushMultiplayerSlot } from '@hoop-rush/engine';

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
    post({
      schemaVersion: CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
      kind: 'cap-rush-multiplayer-error',
      requestId: request.requestId,
      code: 'internal',
      message: 'the playoff worker path is not wired',
    });
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
