import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  HAVOC_GAME_BATCH_LIMIT,
  HAVOC_GAME_BATCH_TARGET_MIN,
  HAVOC_WORKER_WIRE_SCHEMA_VERSION,
  havocLockedInputDigest,
  havocNextGameBatchSize,
  type HavocWorkerGameBatchMessage,
  type HavocWorkerMessage,
} from '@hoop-rush/data-contracts';
import { buildHavocLockedInputs } from '@hoop-rush/test-fixtures';

const originalSelf = (globalThis as { self?: unknown }).self;
const fakeSelf = {
  postMessage: (() => {}) as (message: HavocWorkerMessage) => void,
  onmessage: null as ((event: { data: unknown }) => void) | null,
};

beforeAll(async () => {
  (globalThis as { self?: unknown }).self = fakeSelf;
  await import('./havoc-worker.ts');
});

afterAll(() => {
  if (originalSelf === undefined) {
    delete (globalThis as { self?: unknown }).self;
  } else {
    (globalThis as { self?: unknown }).self = originalSelf;
  }
});

function simulateRequest(requestId: string, count: number) {
  const locked = buildHavocLockedInputs();
  return {
    schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
    type: 'havoc-simulate' as const,
    requestId,
    runId: locked.runId,
    revision: 1,
    inputDigest: havocLockedInputDigest(locked),
    variant: 'havoc' as const,
    cursor: 0,
    count,
    locked,
  };
}

function runWorker(
  request: ReturnType<typeof simulateRequest>,
  onPosted?: (message: HavocWorkerMessage) => void,
): Promise<HavocWorkerMessage[]> {
  const posted: HavocWorkerMessage[] = [];
  let settle: (() => void) | null = null;
  const completed = new Promise<void>((resolve) => {
    settle = resolve;
  });
  fakeSelf.postMessage = (message) => {
    posted.push(message);
    onPosted?.(message);
    if (message.type === 'havoc-complete' || message.type === 'havoc-error') settle?.();
  };
  fakeSelf.onmessage?.({ data: request });
  return completed.then(() => posted);
}

describe('Havoc worker game batches', () => {
  it('keeps every full-season group inside the 4-8 game target', () => {
    let remaining = 82;
    const sizes: number[] = [];
    while (remaining > 0) {
      const size = havocNextGameBatchSize(remaining);
      sizes.push(size);
      remaining -= size;
    }
    expect(sizes.reduce((total, size) => total + size, 0)).toBe(82);
    expect(sizes.every((size) => size >= HAVOC_GAME_BATCH_TARGET_MIN)).toBe(true);
    expect(sizes.every((size) => size <= HAVOC_GAME_BATCH_LIMIT)).toBe(true);
    expect(sizes).toEqual([8, 8, 8, 8, 8, 8, 8, 8, 8, 6, 4]);
  });

  it('delivers small ordered game groups instead of one message per game', async () => {
    const posted = await runWorker(simulateRequest('worker-batch-shape', 10));
    expect(posted.find((message) => message.type === 'havoc-error')).toBeUndefined();
    expect(posted.filter((message) => message.type === 'havoc-game')).toHaveLength(0);
    const batches = posted.filter(
      (message): message is HavocWorkerGameBatchMessage => message.type === 'havoc-game-batch',
    );
    expect(batches.map((batch) => batch.games.length)).toEqual([6, 4]);
    expect(batches.flatMap((batch) => batch.games.map((game) => game.cursor))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    for (const batch of batches) {
      for (const game of batch.games) {
        expect(game.inputDigest).toBe(game.result.inputDigest);
        expect(game.summary.gameNumber).toBe(game.cursor);
      }
    }
    expect(posted.at(-1)).toMatchObject({
      type: 'havoc-complete',
      cancelled: false,
      gamesDelivered: 10,
      lastCursor: 10,
    });
  }, 60_000);

  it('discards a partial batch when cancelled and resumes from the last full batch', async () => {
    const posted = await runWorker(simulateRequest('worker-batch-cancel', 10), (message) => {
      if (message.type === 'havoc-game-batch') {
        fakeSelf.onmessage?.({
          data: {
            schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
            type: 'havoc-cancel',
            requestId: 'worker-batch-cancel',
          },
        });
      }
    });
    const batches = posted.filter(
      (message): message is HavocWorkerGameBatchMessage => message.type === 'havoc-game-batch',
    );
    expect(batches.map((batch) => batch.games.length)).toEqual([6]);
    expect(posted.at(-1)).toMatchObject({
      type: 'havoc-complete',
      cancelled: true,
      gamesDelivered: 6,
      lastCursor: 6,
    });
  }, 60_000);

  it('rejects locked inputs that do not match the request digest', async () => {
    const request = simulateRequest('worker-batch-digest', 4);
    request.inputDigest = '0'.repeat(32);
    const posted = await runWorker(request);
    expect(posted).toHaveLength(1);
    const error = posted[0];
    if (error?.type !== 'havoc-error') throw new Error('expected a worker error');
    expect(error.code).toBe('invariant-failure');
    expect(error.gameNumber).toBeNull();
  }, 60_000);
});
