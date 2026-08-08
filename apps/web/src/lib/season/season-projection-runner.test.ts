import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectionRunner } from './season-projection-runner';
import { seasonArtifactUrls } from './season-assets';
import { buildMinimalRotation } from '@hoop-rush/engine';
import type { HumanRosterBuildResult, MinutePlanOptimizationResult } from '@hoop-rush/engine';
import type { SeasonRotation } from '@hoop-rush/data-contracts';

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

const FAKE_PLAN_RESULT = {
  plans: [],
  recommended: 'balanced',
} as unknown as MinutePlanOptimizationResult;

/** Ten-members fixture rotation for the optimize-rotation request. */
function fixtureRotation(): SeasonRotation {
  const players = [
    { playerVersionId: 'pv-1', playable: ['PG'] as const },
    { playerVersionId: 'pv-2', playable: ['SG'] as const },
    { playerVersionId: 'pv-3', playable: ['SF'] as const },
    { playerVersionId: 'pv-4', playable: ['PF'] as const },
    { playerVersionId: 'pv-5', playable: ['C'] as const },
    { playerVersionId: 'pv-6', playable: ['PG'] as const },
    { playerVersionId: 'pv-7', playable: ['SG'] as const },
    { playerVersionId: 'pv-8', playable: ['SF'] as const },
    { playerVersionId: 'pv-9', playable: ['PF'] as const },
    { playerVersionId: 'pv-10', playable: ['C'] as const },
  ];
  return buildMinimalRotation({
    franchiseId: 'lakers',
    members: players.map((player) => ({
      playerVersionId: player.playerVersionId,
      playable: [...player.playable],
    })),
  });
}

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

  it('optimizes a rotation through the worker and resolves the plan result', async () => {
    const runner = createProjectionRunner({ workerUrl: 'fake-worker.ts' });
    const rotation = fixtureRotation();
    const load = [
      {
        playerVersionId: 'pv-1',
        staminaRating: 80,
        durability: 75,
        fatigueBasisPoints: 1200,
        recentLoadBasisPoints: 800,
      },
    ];
    const promise = runner.optimizeRotation({
      roster: ['pv-1'],
      structure: rotation,
      load,
      horizon: 10,
      seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const worker = FakeWorker.instances.at(-1);
    if (worker === undefined) throw new Error('no worker was created');
    const request = worker.posted[0] as Record<string, unknown>;
    expect(request.type).toBe('optimize-rotation');
    expect(request.catalogUrl).toBe('/data/season/draft-catalog.json');
    expect(request.catalogHash).toBe('c'.repeat(64));
    expect(request.modelUrl).toBe('/data/projection/projection-model.json');
    expect(request.modelHash).toBe('m'.repeat(64));
    expect(request.eraProfileUrl).toBe('/data/era-sim/2010s.json');
    expect(request.roster).toEqual(['pv-1']);
    expect(request.structure).toEqual(rotation);
    expect(request.load).toEqual(load);
    expect(request.horizon).toBe(10);
    expect(request.seed).toBe('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
    worker.respond({
      type: 'complete',
      requestId: request.requestId,
      result: FAKE_PLAN_RESULT,
    });
    await expect(promise).resolves.toBe(FAKE_PLAN_RESULT);
  });

  it('rejects optimize-rotation with the worker error message', async () => {
    const runner = createProjectionRunner({ workerUrl: 'fake-worker.ts' });
    const promise = runner.optimizeRotation({
      roster: ['pv-1'],
      structure: fixtureRotation(),
      load: [],
      horizon: 10,
      seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const worker = FakeWorker.instances.at(-1);
    if (worker === undefined) throw new Error('no worker was created');
    const request = worker.posted[0] as { requestId: string } | undefined;
    worker.respond({ type: 'error', requestId: request?.requestId, message: 'boom' });
    await expect(promise).rejects.toThrow('boom');
  });

  it('rejects optimize-rotation with the typed message when the model artifact is missing', async () => {
    mockedUrls.mockResolvedValue({
      catalogUrl: '/data/season/draft-catalog.json',
      catalogHash: 'c'.repeat(64),
      profileUrl: '/data/era-sim/2010s.json',
      profileHash: 'p'.repeat(64),
    });
    const runner = createProjectionRunner({ workerUrl: 'fake-worker.ts' });
    await expect(
      runner.optimizeRotation({
        roster: ['pv-1'],
        structure: fixtureRotation(),
        load: [],
        horizon: 10,
        seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
      }),
    ).rejects.toThrow(/projection model artifact is unavailable/);
  });
});
