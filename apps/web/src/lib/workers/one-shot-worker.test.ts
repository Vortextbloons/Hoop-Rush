import { describe, expect, it, vi } from 'vitest';
import {
  OneShotWorkerRunner,
  type OneShotWorkerErrorMessages,
  type OneShotWorkerResult,
  type OneShotWorkerSpec,
} from './one-shot-worker.js';

const ERRORS: OneShotWorkerErrorMessages = {
  superseded: 'superseded by a newer run',
  disposed: 'the runner was disposed',
  timeout: 'the stub worker timed out',
  crashed: 'the stub worker crashed',
  invalidMessage: 'the stub worker returned an invalid message',
};

interface StubPayload {
  value: number;
}

interface StubResponse {
  requestId: string;
  ok: boolean;
  output?: string;
  message?: string;
}

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }

  crash(): void {
    this.onerror?.(new Event('error') as ErrorEvent);
  }
}

interface StubHarness {
  spec: OneShotWorkerSpec<StubPayload, StubResponse, string>;
  workers: FakeWorker[];
  createdWorkerUrls: URL[];
}

function stubSpec(
  overrides: Partial<OneShotWorkerSpec<StubPayload, StubResponse, string>> = {},
): StubHarness {
  const workers: FakeWorker[] = [];
  const createdWorkerUrls: URL[] = [];
  const spec: OneShotWorkerSpec<StubPayload, StubResponse, string> = {
    workerUrl: new URL('stub://worker'),
    buildRequest: (payload, requestId) => ({ payload, requestId }),
    responseSchema: {
      safeParse(value: unknown) {
        if (typeof value === 'object' && value !== null && 'requestId' in value) {
          return { success: true, data: value as StubResponse };
        }
        return { success: false, error: null };
      },
    },
    requestIdOf: (response) => response.requestId,
    resultOf: (response): OneShotWorkerResult<string> =>
      response.ok
        ? { kind: 'output', output: response.output ?? '' }
        : { kind: 'error', message: response.message ?? '' },
    errorMessages: ERRORS,
    createWorker: (url) => {
      createdWorkerUrls.push(url);
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    },
    ...overrides,
  };
  return { spec, workers, createdWorkerUrls };
}

function workerAt(workers: FakeWorker[], index: number): FakeWorker {
  const worker = workers[index];
  if (worker === undefined) throw new Error(`missing fake worker ${String(index)}`);
  return worker;
}

function requestIdOf(worker: FakeWorker): string {
  return (worker.posted[0] as { requestId: string }).requestId;
}

describe('OneShotWorkerRunner', () => {
  it('posts the built request under a fresh correlation id and resolves the mapped output', async () => {
    const { spec, workers } = stubSpec();
    const runner = new OneShotWorkerRunner(spec);
    const pending = runner.run({ value: 7 });
    const worker = workerAt(workers, 0);
    expect(worker.terminated).toBe(false);
    expect(worker.posted).toEqual([{ payload: { value: 7 }, requestId: requestIdOf(worker) }]);
    worker.emit({ requestId: requestIdOf(worker), ok: true, output: 'done' });
    await expect(pending).resolves.toBe('done');
  });

  it('passes the spec worker url to createWorker', () => {
    const { spec, workers, createdWorkerUrls } = stubSpec();
    const runner = new OneShotWorkerRunner(spec);
    void runner.run({ value: 1 });
    expect(workers.length).toBe(1);
    expect(createdWorkerUrls[0]).toBe(spec.workerUrl);
  });

  it('ignores responses for other requests and still settles on the matching one', async () => {
    const { spec, workers } = stubSpec();
    const runner = new OneShotWorkerRunner(spec);
    const pending = runner.run({ value: 1 });
    const worker = workerAt(workers, 0);
    worker.emit({ requestId: 'foreign-request', ok: true, output: 'foreign' });
    expect(worker.terminated).toBe(false);
    worker.emit({ requestId: requestIdOf(worker), ok: true, output: 'done' });
    await expect(pending).resolves.toBe('done');
  });

  it('ignores late messages after the request settled', async () => {
    const { spec, workers } = stubSpec();
    const runner = new OneShotWorkerRunner(spec);
    const pending = runner.run({ value: 1 });
    const worker = workerAt(workers, 0);
    const requestId = requestIdOf(worker);
    worker.emit({ requestId, ok: true, output: 'first' });
    await expect(pending).resolves.toBe('first');
    worker.emit({ requestId, ok: false, message: 'late error' });
    expect(worker.terminated).toBe(false);
  });

  it('rejects malformed messages with the invalid-message error and terminates the worker', async () => {
    const { spec, workers } = stubSpec();
    const runner = new OneShotWorkerRunner(spec);
    const pending = runner.run({ value: 1 });
    workerAt(workers, 0).emit('not-an-object');
    await expect(pending).rejects.toThrow(ERRORS.invalidMessage);
    expect(workerAt(workers, 0).terminated).toBe(true);
  });

  it('rejects mapped errors with the mapped message', async () => {
    const { spec, workers } = stubSpec();
    const runner = new OneShotWorkerRunner(spec);
    const pending = runner.run({ value: 1 });
    const worker = workerAt(workers, 0);
    worker.emit({ requestId: requestIdOf(worker), ok: false, message: 'boom' });
    const error = await pending.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('boom');
  });

  it('rejects the pending run as superseded when a newer run starts', async () => {
    const { spec, workers } = stubSpec();
    const runner = new OneShotWorkerRunner(spec);
    const first = runner.run({ value: 1 });
    const second = runner.run({ value: 2 });
    await expect(first).rejects.toThrow(ERRORS.superseded);
    expect(workerAt(workers, 0).terminated).toBe(true);
    expect(workers.length).toBe(2);
    const secondWorker = workerAt(workers, 1);
    secondWorker.emit({ requestId: requestIdOf(secondWorker), ok: true, output: 'second' });
    await expect(second).resolves.toBe('second');
  });

  it('rejects with the timeout error and terminates the worker', async () => {
    vi.useFakeTimers();
    try {
      const { spec, workers } = stubSpec({ timeoutMs: 1_000 });
      const runner = new OneShotWorkerRunner(spec);
      const pending = runner.run({ value: 1 });
      const timedOut = expect(pending).rejects.toThrow(ERRORS.timeout);
      await vi.advanceTimersByTimeAsync(1_000);
      await timedOut;
      expect(workerAt(workers, 0).terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects with the crash error and terminates the worker', async () => {
    const { spec, workers } = stubSpec();
    const runner = new OneShotWorkerRunner(spec);
    const pending = runner.run({ value: 1 });
    workerAt(workers, 0).crash();
    await expect(pending).rejects.toThrow(ERRORS.crashed);
    expect(workerAt(workers, 0).terminated).toBe(true);
  });

  it('dispose rejects the pending run and ignores later messages', async () => {
    const { spec, workers } = stubSpec();
    const runner = new OneShotWorkerRunner(spec);
    const pending = runner.run({ value: 1 });
    const worker = workerAt(workers, 0);
    runner.dispose();
    await expect(pending).rejects.toThrow(ERRORS.disposed);
    expect(worker.terminated).toBe(true);
    worker.emit({ requestId: requestIdOf(worker), ok: true, output: 'late' });
  });

  it('dispose terminates the current worker even when the caller ignores the rejection', () => {
    const { spec, workers } = stubSpec();
    const runner = new OneShotWorkerRunner(spec);
    runner.run({ value: 1 }).catch(() => {});
    runner.dispose();
    expect(workerAt(workers, 0).terminated).toBe(true);
  });
});
