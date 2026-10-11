import { describe, expect, it } from 'vitest';
import {
  HAVOC_WORKER_WIRE_SCHEMA_VERSION,
  havocWorkerSimulateRequestSchema,
  havocWorkerTapeRequestSchema,
  type HavocWorkerGameMessage,
  type HavocWorkerMessage,
  type HavocWorkerSimulateRequest,
  type HavocWorkerTapeMessage,
} from '@hoop-rush/data-contracts';
import {
  buildHavocGameInput,
  createEngineContext,
  havocGameResultDigest,
  havocGameSummaryOf,
  havocGameTapeDigest,
  simulateHavocGame,
} from '@hoop-rush/engine';
import { buildHavocGameResult, buildHavocLockedInputs } from '@hoop-rush/test-fixtures';
import { HavocRunner, type HavocBatchHandlers } from './havoc-runner';

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: unknown[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: unknown): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }

  asWorker(): Worker {
    return this as unknown as Worker;
  }
}

function buildRequest(overrides: Record<string, unknown> = {}): HavocWorkerSimulateRequest {
  return havocWorkerSimulateRequestSchema.parse({
    schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
    type: 'havoc-simulate',
    requestId: 'req-batch',
    runId: 'havoc-run-1',
    revision: 0,
    inputDigest: 'a'.repeat(32),
    variant: 'havoc',
    cursor: 0,
    count: 2,
    locked: buildHavocLockedInputs(),
    ...overrides,
  });
}

function buildGameMessage(cursor: number, requestId = 'req-batch'): HavocWorkerGameMessage {
  const result = buildHavocGameResult({ gameNumber: cursor });
  const resultDigest = havocGameResultDigest(result);
  return {
    schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
    type: 'havoc-game',
    requestId,
    variant: 'havoc',
    cursor,
    inputDigest: result.inputDigest,
    resultDigest,
    summary: havocGameSummaryOf(result, resultDigest),
    result,
  };
}

describe('HavocRunner', () => {
  it('serializes game handlers and resolves after the queue drains', async () => {
    const fake = new FakeWorker();
    const runner = new HavocRunner({ createWorker: () => fake.asWorker() });
    const order: number[] = [];
    const handlers: HavocBatchHandlers = {
      onGame: async (message) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(message.cursor);
      },
    };
    const pending = runner.startBatch(buildRequest(), handlers);
    fake.emit(buildGameMessage(1));
    fake.emit(buildGameMessage(2));
    fake.emit({
      schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
      type: 'havoc-complete',
      requestId: 'req-batch',
      variant: 'havoc',
      gamesDelivered: 2,
      cancelled: false,
      lastCursor: 2,
    } satisfies HavocWorkerMessage);
    const message = await pending;
    expect(message.gamesDelivered).toBe(2);
    expect(order).toEqual([1, 2]);
    expect(fake.terminated).toBe(true);
  });

  it('ignores stale request ids and non-batch messages', async () => {
    const fake = new FakeWorker();
    const runner = new HavocRunner({ createWorker: () => fake.asWorker() });
    const seen: number[] = [];
    const pending = runner.startBatch(buildRequest(), {
      onGame: (message) => {
        seen.push(message.cursor);
      },
    });
    fake.emit(buildGameMessage(1, 'other-request'));
    fake.emit({ schemaVersion: 1, type: 'not-a-message' });
    fake.emit(buildGameMessage(2));
    fake.emit({
      schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
      type: 'havoc-complete',
      requestId: 'req-batch',
      variant: 'havoc',
      gamesDelivered: 1,
      cancelled: false,
      lastCursor: 2,
    });
    await pending;
    expect(seen).toEqual([2]);
  });

  it('sends a cancel message and rejects when a handler fails', async () => {
    const fake = new FakeWorker();
    const runner = new HavocRunner({ createWorker: () => fake.asWorker() });
    const pending = runner.startBatch(buildRequest(), {
      onGame: () => {
        throw new Error('acceptance failed');
      },
    });
    fake.emit(buildGameMessage(1));
    fake.emit({
      schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
      type: 'havoc-complete',
      requestId: 'req-batch',
      variant: 'havoc',
      gamesDelivered: 1,
      cancelled: true,
      lastCursor: 1,
    });
    await expect(pending).rejects.toThrow('acceptance failed');
    expect(
      fake.posted.some(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          (message as { type?: string }).type === 'havoc-cancel',
      ),
    ).toBe(true);
  });

  it('resolves tape requests through the worker', async () => {
    const fake = new FakeWorker();
    const runner = new HavocRunner({ createWorker: () => fake.asWorker() });
    const request = havocWorkerTapeRequestSchema.parse({
      schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
      type: 'havoc-tape',
      requestId: 'req-tape',
      runId: 'havoc-run-1',
      revision: 0,
      inputDigest: 'a'.repeat(32),
      variant: 'havoc',
      gameNumber: 1,
      locked: buildHavocLockedInputs(),
    });
    const pending = runner.runTape(request);
    const input = buildHavocGameInput({
      locked: request.locked,
      gameNumber: 1,
      variant: 'havoc',
    });
    const { result, tape } = simulateHavocGame(input, createEngineContext());
    const resultDigest = havocGameResultDigest(result);
    const message: HavocWorkerTapeMessage = {
      schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
      type: 'havoc-tape',
      requestId: 'req-tape',
      variant: 'havoc',
      gameNumber: 1,
      inputDigest: result.inputDigest,
      resultDigest,
      tapeDigest: havocGameTapeDigest(tape),
      summary: havocGameSummaryOf(result, resultDigest),
      tape,
    };
    fake.emit(message);
    const resolved = await pending;
    expect(resolved.gameNumber).toBe(1);
    expect(fake.terminated).toBe(true);
  });

  it('rejects pending work when disposed', async () => {
    const fake = new FakeWorker();
    const runner = new HavocRunner({ createWorker: () => fake.asWorker() });
    const pending = runner.startBatch(buildRequest(), {});
    runner.dispose();
    await expect(pending).rejects.toThrow('disposed');
  });

  it('rejects superseded batches', async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const workers = [first, second];
    const runner = new HavocRunner({ createWorker: () => (workers.shift() ?? second).asWorker() });
    const pending = runner.startBatch(buildRequest(), {});
    const replacement = runner.startBatch(buildRequest({ requestId: 'req-second' }), {});
    await expect(pending).rejects.toThrow('superseded');
    second.emit({
      schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
      type: 'havoc-complete',
      requestId: 'req-second',
      variant: 'havoc',
      gamesDelivered: 0,
      cancelled: false,
      lastCursor: 0,
    });
    await expect(replacement).resolves.toMatchObject({ requestId: 'req-second' });
  });
});
