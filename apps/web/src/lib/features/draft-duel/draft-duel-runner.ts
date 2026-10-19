import {
  DRAFT_DUEL_WORKER_WIRE_VERSION,
  draftDuelWorkerRequestSchema,
  draftDuelWorkerResponseSchema,
  type DraftDuelGameOutput,
  type DraftDuelWorkerRequest,
  type DraftDuelWorkerResponse,
  type GameSimulationInput,
} from '@hoop-rush/data-contracts';
import {
  OneShotWorkerRunner,
  type OneShotWorkerErrorMessages,
} from '#lib/workers/one-shot-worker.js';
import workerUrl from '../../../workers/draft-duel-game-worker.ts?worker&url';

export interface DraftDuelRunnerInput {
  roomId: string;
  input: GameSimulationInput;
}

export interface DraftDuelRunnerOptions {
  timeoutMs?: number;
  createWorker?: (url: URL) => Worker;
}

const DRAFT_DUEL_WORKER_URL = new URL(workerUrl, import.meta.url);

const DRAFT_DUEL_RUNNER_ERRORS: OneShotWorkerErrorMessages = {
  superseded: 'the draft duel run was superseded',
  disposed: 'the draft duel runner was disposed',
  timeout: 'the draft duel game worker timed out',
  crashed: 'the draft duel game worker crashed',
  invalidMessage: 'the draft duel game worker returned an invalid message',
};

export class DraftDuelRunner {
  private readonly transport: OneShotWorkerRunner<
    DraftDuelRunnerInput,
    DraftDuelWorkerResponse,
    DraftDuelGameOutput
  >;

  constructor(options: DraftDuelRunnerOptions = {}) {
    this.transport = new OneShotWorkerRunner({
      workerUrl: DRAFT_DUEL_WORKER_URL,
      buildRequest: (payload, requestId): DraftDuelWorkerRequest =>
        draftDuelWorkerRequestSchema.parse({
          schemaVersion: DRAFT_DUEL_WORKER_WIRE_VERSION,
          kind: 'draft-duel-game',
          requestId,
          roomId: payload.roomId,
          input: payload.input,
        }),
      responseSchema: draftDuelWorkerResponseSchema,
      requestIdOf: (response) => response.requestId,
      resultOf: (response) =>
        response.kind === 'draft-duel-error'
          ? { kind: 'error', message: response.message }
          : { kind: 'output', output: response.output },
      errorMessages: DRAFT_DUEL_RUNNER_ERRORS,
      timeoutMs: options.timeoutMs,
      createWorker: options.createWorker,
    });
  }

  runDraftDuelGame(request: DraftDuelRunnerInput): Promise<DraftDuelGameOutput> {
    return this.transport.run(request);
  }

  dispose(): void {
    this.transport.dispose();
  }
}
