import {
  SEASON_WORKER_WIRE_SCHEMA_VERSION,
  type SeasonWorkerErrorMessage,
} from '@hoop-rush/data-contracts';

export function postWorkerMessage<Output>(
  schema: { parse: (value: unknown) => Output },
  message: Output,
): void {
  schema.parse(message);
  self.postMessage(message);
}

export function workerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function normalizeSimulationError(message: string): string {
  return message.replace(/ failed invariants: [\s\S]*$/, ' failed invariants');
}

export function normalizeShared82SimulationError(message: string): string {
  return normalizeSimulationError(message).replace(
    /^shared82 (?:p1|p2) game (\d+) failed invariants$/,
    'shared82 game $1 failed invariants',
  );
}

export function seasonWorkerInternalError(
  requestId: string,
  message: string,
): SeasonWorkerErrorMessage {
  return {
    schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
    type: 'season-block-error',
    requestId,
    code: 'internal',
    message: message.slice(0, 512),
    seed: null,
    gameId: null,
    blockIndex: null,
  };
}
