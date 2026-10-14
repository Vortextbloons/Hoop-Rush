import {
  HAVOC_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
  havocMultiplayerWorkerRequestSchema,
  havocMultiplayerWorkerResponseSchema,
  type HavocBattleInput,
  type HavocMultiplayerWorkerGameOutput,
  type HavocMultiplayerWorkerRequest,
} from '@hoop-rush/data-contracts';
import { newRequestId } from '$lib/ids';

export interface HavocMultiplayerRunnerInput {
  roomId: string;
  gameNumber: number;
  input: HavocBattleInput;
}

export interface HavocMultiplayerRunnerOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

interface PendingRun {
  requestId: string;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class HavocMultiplayerRunner {
  private worker: Worker | null = null;
  private pending: PendingRun | null = null;

  constructor(private readonly options: HavocMultiplayerRunnerOptions = {}) {}

  runGame(request: HavocMultiplayerRunnerInput): Promise<HavocMultiplayerWorkerGameOutput> {
    this.cancelPending('the havoc multiplayer run was superseded');
    this.teardownWorker();
    const requestId = newRequestId();
    const message: HavocMultiplayerWorkerRequest = havocMultiplayerWorkerRequestSchema.parse({
      schemaVersion: HAVOC_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
      kind: 'havoc-multiplayer-game',
      requestId,
      roomId: request.roomId,
      gameNumber: request.gameNumber,
      input: request.input,
    });
    const worker = new Worker(
      new URL('../../../workers/havoc-multiplayer-worker.ts', import.meta.url),
      {
        type: 'module',
      },
    );
    this.worker = worker;
    return new Promise<HavocMultiplayerWorkerGameOutput>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.fail(requestId, new Error('the havoc multiplayer game worker timed out'));
      }, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      this.pending = { requestId, reject, timeout };
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const parsed = havocMultiplayerWorkerResponseSchema.safeParse(event.data);
        if (!parsed.success) {
          this.fail(
            requestId,
            new Error('the havoc multiplayer game worker returned an invalid message'),
          );
          return;
        }
        if (parsed.data.requestId !== requestId) return;
        if (this.pending?.requestId !== requestId) return;
        if (parsed.data.kind === 'havoc-multiplayer-error') {
          this.settle(requestId);
          reject(new Error(parsed.data.message));
          return;
        }
        this.settle(requestId);
        resolve(parsed.data.output);
      };
      worker.onerror = () => {
        this.fail(requestId, new Error('the havoc multiplayer game worker crashed'));
      };
      worker.postMessage(message);
    });
  }

  dispose(): void {
    this.cancelPending('the havoc multiplayer runner was disposed');
    this.teardownWorker();
  }

  private settle(requestId: string): void {
    if (this.pending?.requestId !== requestId) return;
    clearTimeout(this.pending.timeout);
    this.pending = null;
  }

  private fail(requestId: string, error: Error): void {
    if (this.pending?.requestId !== requestId) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timeout);
    this.teardownWorker();
    pending.reject(error);
  }

  private cancelPending(reason: string): void {
    if (this.pending === null) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timeout);
    pending.reject(new Error(reason));
  }

  private teardownWorker(): void {
    if (this.worker !== null) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
