import {
  DRAFT_DUEL_WORKER_WIRE_VERSION,
  draftDuelWorkerRequestSchema,
  draftDuelWorkerResponseSchema,
  type DraftDuelGameOutput,
  type DraftDuelWorkerRequest,
  type GameSimulationInput,
} from '@hoop-rush/data-contracts';
import { newRequestId } from '$lib/ids';
export interface DraftDuelRunnerInput {
  roomId: string;
  input: GameSimulationInput;
}
export interface DraftDuelRunnerOptions {
  timeoutMs?: number;
}
const DEFAULT_TIMEOUT_MS = 60_000;
interface PendingRun {
  requestId: string;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}
export class DraftDuelRunner {
  private worker: Worker | null = null;
  private pending: PendingRun | null = null;
  constructor(private readonly options: DraftDuelRunnerOptions = {}) {}
  runDraftDuelGame(request: DraftDuelRunnerInput): Promise<DraftDuelGameOutput> {
    this.cancelPending('the draft duel run was superseded');
    this.teardownWorker();
    const requestId = newRequestId();
    const message: DraftDuelWorkerRequest = draftDuelWorkerRequestSchema.parse({
      schemaVersion: DRAFT_DUEL_WORKER_WIRE_VERSION,
      kind: 'draft-duel-game',
      requestId,
      roomId: request.roomId,
      input: request.input,
    });
    const worker = new Worker(new URL('../workers/draft-duel-game-worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker = worker;
    return new Promise<DraftDuelGameOutput>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.fail(requestId, new Error('the draft duel game worker timed out'));
      }, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      this.pending = { requestId, reject, timeout };
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const parsed = draftDuelWorkerResponseSchema.safeParse(event.data);
        if (!parsed.success) {
          this.fail(requestId, new Error('the draft duel game worker returned an invalid message'));
          return;
        }
        if (parsed.data.requestId !== requestId) return;
        if (this.pending?.requestId !== requestId) return;
        if (parsed.data.kind === 'draft-duel-error') {
          this.settle(requestId);
          reject(new Error(parsed.data.message));
          return;
        }
        this.settle(requestId);
        resolve(parsed.data.output);
      };
      worker.onerror = () => {
        this.fail(requestId, new Error('the draft duel game worker crashed'));
      };
      worker.postMessage(message);
    });
  }
  dispose(): void {
    this.cancelPending('the draft duel runner was disposed');
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
