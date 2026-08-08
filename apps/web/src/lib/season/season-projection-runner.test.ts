import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectionRunner } from './season-projection-runner';
import { seasonArtifactUrls } from './season-assets';
import type { HumanRosterBuildResult } from '@hoop-rush/engine';

vi.mock('./season-assets', () => ({
  seasonArtifactUrls: vi.fn(),
}));

const mockedUrls = vi.mocked(seasonArtifactUrls);

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: unknown[] = [];
  private listeners: Array<(event: MessageEvent<unknown>) => void> = [];

  constructor(url: string | URL, options?: { type?: string }) {
    void url;
    void options;
    FakeWorker.instances.push(this);
  }

  addEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.push(listener);
  }

  removeEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners = this.listeners.filter((candidate) => candidate !== listener);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {}

  respond(response: unknown): void {
    for (const listener of this.listeners) {
      listener({ data: response } as MessageEvent<unknown>);
    }
  }
}

const FAKE_RESULT = {
  ok: true,
  roster: ['pv-1', 'pv-2'],
  rotation: null,
  projection: null,
  ranked: [],
  audit: {
    seed: 'seed',
    seedNamespace: 'season-projection-search',
    lens: 'balance',
    nodeCount: 1,
    nodeBudget: 10,
    cacheHits: 0,
    cacheMisses: 1,
    partialBeams: 0,
    completeRosters: 0,
    rotationsEvaluated: 0,
    rejected: [],
    paretoSurvivors: 0,
    selectedCandidateId: null,
  },
  feasibilityFailure: null,
} as unknown as HumanRosterBuildResult;

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  mockedUrls.mockResolvedValue({
    catalogUrl: '/data/season/draft-catalog.json',
    catalogHash: 'c'.repeat(64),
    profileUrl: '/data/era-sim/2010s.json',
    profileHash: 'p'.repeat(64),
    modelUrl: '/data/projection/projection-model.json',
    modelHash: 'm'.repeat(64),
  });
});

describe('createProjectionRunner', () => {
  it('builds a roster through the worker and resolves the engine result', async () => {
    const runner = createProjectionRunner({ workerUrl: 'fake-worker.ts' });
    const promise = runner.buildRoster({
      locked: ['pv-1'],
      available: ['pv-2', 'pv-3'],
      seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
      lens: 'creation',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const worker = FakeWorker.instances[0];
    if (worker === undefined) throw new Error('no worker was created');
    const request = worker.posted[0] as Record<string, unknown>;
    expect(request.type).toBe('build-roster');
    expect(request.catalogUrl).toBe('/data/season/draft-catalog.json');
    expect(request.catalogHash).toBe('c'.repeat(64));
    expect(request.modelUrl).toBe('/data/projection/projection-model.json');
    expect(request.modelHash).toBe('m'.repeat(64));
    expect(request.locked).toEqual(['pv-1']);
    expect(request.available).toEqual(['pv-2', 'pv-3']);
    expect(request.lens).toBe('creation');
    worker.respond({ type: 'complete', requestId: request.requestId, result: FAKE_RESULT });
    await expect(promise).resolves.toBe(FAKE_RESULT);
  });

  it('rejects with the worker error message', async () => {
    const runner = createProjectionRunner({ workerUrl: 'fake-worker.ts' });
    const promise = runner.buildRoster({
      locked: [],
      available: ['pv-1'],
      seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const worker = FakeWorker.instances[0];
    if (worker === undefined) throw new Error('no worker was created');
    const request = worker.posted[0] as { requestId: string } | undefined;
    worker.respond({ type: 'error', requestId: request?.requestId, message: 'boom' });
    await expect(promise).rejects.toThrow('boom');
  });

  it('rejects with the typed message when the model artifact is missing', async () => {
    mockedUrls.mockResolvedValue({
      catalogUrl: '/data/season/draft-catalog.json',
      catalogHash: 'c'.repeat(64),
      profileUrl: '/data/era-sim/2010s.json',
      profileHash: 'p'.repeat(64),
    });
    const runner = createProjectionRunner({ workerUrl: 'fake-worker.ts' });
    await expect(
      runner.buildRoster({
        locked: [],
        available: ['pv-1'],
        seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
      }),
    ).rejects.toThrow(/projection model artifact is unavailable/);
  });
});
