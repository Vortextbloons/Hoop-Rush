import {
  HAVOC_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
  havocMultiplayerWorkerRequestSchema,
  havocMultiplayerWorkerResponseSchema,
  type HavocBattleInput,
  type HavocMultiplayerWorkerGameOutput,
  type HavocMultiplayerWorkerRequest,
  type HavocMultiplayerWorkerResponse,
} from '@hoop-rush/data-contracts';
import {
  OneShotWorkerRunner,
  type OneShotWorkerErrorMessages,
} from '#lib/workers/one-shot-worker.js';

export interface HavocMultiplayerRunnerInput {
  roomId: string;
  gameNumber: number;
  input: HavocBattleInput;
}

export interface HavocMultiplayerRunnerOptions {
  timeoutMs?: number;
  createWorker?: (url: URL) => Worker;
}

const HAVOC_MULTIPLAYER_WORKER_URL = new URL(
  '../../../workers/havoc-multiplayer-worker.ts',
  import.meta.url,
);

const HAVOC_MULTIPLAYER_RUNNER_ERRORS: OneShotWorkerErrorMessages = {
  superseded: 'the havoc multiplayer run was superseded',
  disposed: 'the havoc multiplayer runner was disposed',
  timeout: 'the havoc multiplayer game worker timed out',
  crashed: 'the havoc multiplayer game worker crashed',
  invalidMessage: 'the havoc multiplayer game worker returned an invalid message',
};

export class HavocMultiplayerRunner {
  private readonly transport: OneShotWorkerRunner<
    HavocMultiplayerRunnerInput,
    HavocMultiplayerWorkerResponse,
    HavocMultiplayerWorkerGameOutput
  >;

  constructor(options: HavocMultiplayerRunnerOptions = {}) {
    this.transport = new OneShotWorkerRunner({
      workerUrl: HAVOC_MULTIPLAYER_WORKER_URL,
      buildRequest: (payload, requestId): HavocMultiplayerWorkerRequest =>
        havocMultiplayerWorkerRequestSchema.parse({
          schemaVersion: HAVOC_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
          kind: 'havoc-multiplayer-game',
          requestId,
          roomId: payload.roomId,
          gameNumber: payload.gameNumber,
          input: payload.input,
        }),
      responseSchema: havocMultiplayerWorkerResponseSchema,
      requestIdOf: (response) => response.requestId,
      resultOf: (response) =>
        response.kind === 'havoc-multiplayer-error'
          ? { kind: 'error', message: response.message }
          : { kind: 'output', output: response.output },
      errorMessages: HAVOC_MULTIPLAYER_RUNNER_ERRORS,
      timeoutMs: options.timeoutMs,
      createWorker: options.createWorker,
    });
  }

  runGame(request: HavocMultiplayerRunnerInput): Promise<HavocMultiplayerWorkerGameOutput> {
    return this.transport.run(request);
  }

  dispose(): void {
    this.transport.dispose();
  }
}
