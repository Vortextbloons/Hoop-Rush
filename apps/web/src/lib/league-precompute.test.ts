import { describe, expect, it } from 'vitest';
import {
  buildFixtureBracket,
  buildGameSimulationInput,
  buildLeagueRecord,
} from '@hoop-rush/test-fixtures';
import { seedSchema, type LeagueWorkerComputeRequest } from '@hoop-rush/data-contracts';
import { LeaguePrecompute, type LeaguePrecomputeDeps } from './league-precompute';

const SEED_A = seedSchema.parse('aaaaaaaaaaaaaaaa');
const SEED_B = seedSchema.parse('bbbbbbbbbbbbbbbb');
const SEED_C = seedSchema.parse('cccccccccccccccc');
const SEED_D = seedSchema.parse('dddddddddddddddd');
const SEED_E = seedSchema.parse('eeeeeeeeeeeeeeee');
const SEED_F = seedSchema.parse('ffffffffffffffff');

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

function buildHarness(): { precompute: LeaguePrecompute; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const deps: LeaguePrecomputeDeps = {
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker.asWorker();
    },
    loadPreamble: () =>
      Promise.resolve({
        profile: buildGameSimulationInput().profile,
        bracket: buildFixtureBracket(),
      }),
  };
  return { precompute: new LeaguePrecompute(deps), workers };
}

function requestOf(worker: FakeWorker): LeagueWorkerComputeRequest {
  const posted = worker.posted[0];
  return posted as LeagueWorkerComputeRequest;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('LeaguePrecompute', () => {
  it('resolves a precomputed record and reuses it from the cache', async () => {
    const { precompute, workers } = buildHarness();
    const pending = precompute.ensure(SEED_A);
    await tick();
    const worker = workers[0];
    if (!worker) throw new Error('no worker was created');
    const request = requestOf(worker);
    expect(request.type).toBe('compute');
    expect(request.seed).toBe(SEED_A);
    const record = buildLeagueRecord();
    worker.emit({ schemaVersion: 1, type: 'result', requestId: request.requestId, record });
    await expect(pending).resolves.toEqual(record);
    expect(workers).toHaveLength(1);
    await expect(precompute.ensure(SEED_A)).resolves.toEqual(record);
    expect(workers).toHaveLength(1);
    expect(worker.terminated).toBe(true);
  });

  it('ignores progress and resolves null on worker failure', async () => {
    const { precompute, workers } = buildHarness();
    const pending = precompute.ensure(SEED_B);
    await tick();
    const worker = workers[0];
    if (!worker) throw new Error('no worker was created');
    const request = requestOf(worker);
    worker.emit({
      schemaVersion: 1,
      type: 'progress',
      requestId: request.requestId,
      gamesDone: 96,
      gamesTotal: 1189,
    });
    worker.emit({
      schemaVersion: 1,
      type: 'error',
      requestId: request.requestId,
      message: 'boom',
    });
    await expect(pending).resolves.toBeNull();
  });

  it('cancels an in-flight seed when a new one is requested', async () => {
    const { precompute, workers } = buildHarness();
    const first = precompute.ensure(SEED_C);
    await tick();
    expect(workers).toHaveLength(1);
    const second = precompute.ensure(SEED_D);
    expect(workers[0]?.terminated).toBe(true);
    await expect(first).resolves.toBeNull();
    await tick();
    expect(workers).toHaveLength(2);
    const worker = workers[1];
    if (!worker) throw new Error('no worker was created');
    const request = requestOf(worker);
    const record = buildLeagueRecord({ seed: SEED_D });
    worker.emit({ schemaVersion: 1, type: 'result', requestId: request.requestId, record });
    await expect(second).resolves.toEqual(record);
  });

  it('treats an invalid worker message as a failure', async () => {
    const { precompute, workers } = buildHarness();
    const pending = precompute.ensure(SEED_E);
    await tick();
    workers[0]?.emit({ schemaVersion: 1, type: 'result' });
    await expect(pending).resolves.toBeNull();
  });

  it('shares one in-flight compute across several callers', async () => {
    const { precompute, workers } = buildHarness();
    const first = precompute.ensure(SEED_F);
    await tick();
    const second = precompute.ensure(SEED_F);
    expect(workers).toHaveLength(1);
    const worker = workers[0];
    if (!worker) throw new Error('no worker was created');
    const request = requestOf(worker);
    const record = buildLeagueRecord();
    worker.emit({ schemaVersion: 1, type: 'result', requestId: request.requestId, record });
    await expect(first).resolves.toEqual(record);
    await expect(second).resolves.toEqual(record);
  });
});
