import {
  HAVOC_WORKER_WIRE_SCHEMA_VERSION,
  havocWorkerMessageSchema,
  type HavocWorkerMessage,
  type HavocWorkerCompleteMessage,
  type HavocWorkerSimulateRequest,
  type HavocWorkerTapeMessage,
  type HavocWorkerTapeRequest,
} from '@hoop-rush/data-contracts';
import { StreamingWorkerRunner } from '#lib/workers/streaming-worker.js';
import type { HavocBatchHandlers } from '@hoop-rush/application/havoc';

export type { HavocBatchHandlers } from '@hoop-rush/application/havoc';

export interface HavocRunnerOptions {
  createWorker?: () => Worker;
  tapeTimeoutMs?: number;
}

const DEFAULT_TAPE_TIMEOUT_MS = 60_000;

export class HavocRunner {
  private readonly transport: StreamingWorkerRunner<HavocWorkerMessage>;
  private tapeActive = false;

  constructor(private readonly options: HavocRunnerOptions = {}) {
    this.transport = new StreamingWorkerRunner({
      createWorker:
        options.createWorker ??
        (() =>
          new Worker(new URL('../../../workers/havoc-worker.ts', import.meta.url), {
            type: 'module',
          })),
      responseSchema: havocWorkerMessageSchema,
      invalidMessage: null,
      crashed: 'the havoc worker crashed',
    });
  }

  startBatch(
    request: HavocWorkerSimulateRequest,
    handlers: HavocBatchHandlers,
  ): Promise<HavocWorkerCompleteMessage> {
    const message = this.tapeActive
      ? 'the havoc tape run was superseded'
      : 'the havoc batch was superseded';
    this.tapeActive = false;
    return this.transport.run({
      request,
      requestId: request.requestId,
      concurrent: { kind: 'supersede', message },
      completeOf: (message) => (message.type === 'havoc-complete' ? message : null),
      errorOf: (message) => {
        if (message.type !== 'havoc-error') return null;
        handlers.onError?.(message);
        return new Error(message.message);
      },
      drainOnError: false,
      cancelRequest: {
        schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
        type: 'havoc-cancel',
        requestId: request.requestId,
      },
      handle: (message, enqueue) => {
        if (message.type === 'havoc-game') enqueue(() => handlers.onGame?.(message));
        else if (message.type === 'havoc-progress') handlers.onProgress?.(message);
      },
    });
  }

  runTape(request: HavocWorkerTapeRequest): Promise<HavocWorkerTapeMessage> {
    const message = this.tapeActive
      ? 'the havoc tape run was superseded'
      : 'the havoc batch was superseded';
    this.tapeActive = true;
    return this.transport.run({
      request,
      requestId: request.requestId,
      concurrent: { kind: 'supersede', message },
      completeOf: (message) => (message.type === 'havoc-tape' ? message : null),
      errorOf: (message) => (message.type === 'havoc-error' ? new Error(message.message) : null),
      drainOnError: false,
      timeout: {
        ms: this.options.tapeTimeoutMs ?? DEFAULT_TAPE_TIMEOUT_MS,
        message: 'the havoc tape worker timed out',
      },
      handle: () => {},
    });
  }

  cancel(): void {
    if (!this.tapeActive) this.transport.cancel();
  }

  dispose(): void {
    this.transport.dispose('the havoc runner was disposed');
  }
}
