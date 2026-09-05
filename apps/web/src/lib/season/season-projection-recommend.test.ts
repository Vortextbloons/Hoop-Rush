import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectionRunner } from './season-projection-runner';
import { seasonArtifactUrls } from './season-assets';
import { buildMinimalRotation } from '@hoop-rush/engine';
import type { RecommendSeasonRotationResult } from '@hoop-rush/engine';
import type { SeasonRotation } from '@hoop-rush/data-contracts';

vi.mock('./season-assets', () => ({
  seasonArtifactUrls: vi.fn(),
}));

const mockedUrls = vi.mocked(seasonArtifactUrls);

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: unknown[] = [];
  terminated = false;
  private listeners = new Map<string, Array<(event: MessageEvent<unknown>) => void>>();

  constructor(url: string | URL) {
    void url;
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((candidate) => candidate !== listener),
    );
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: unknown): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data: response } as MessageEvent<unknown>);
    }
  }
}

const FAKE_RECOMMEND = {
  status: 'recommended',
  candidate: null,
  alternatives: [],
  changes: [],
  metrics: null,
  degraded: true,
  facts: null,
} as unknown as RecommendSeasonRotationResult;

function fixtureRotation(franchiseId = 'lakers'): SeasonRotation {
  const versionId = (n: number) => `pv-${String(n).padStart(32, '0')}`;
  const players = [
    { playerVersionId: versionId(1), playable: ['PG'] as const },
    { playerVersionId: versionId(2), playable: ['SG'] as const },
    { playerVersionId: versionId(3), playable: ['SF'] as const },
    { playerVersionId: versionId(4), playable: ['PF'] as const },
    { playerVersionId: versionId(5), playable: ['C'] as const },
    { playerVersionId: versionId(6), playable: ['PG'] as const },
    { playerVersionId: versionId(7), playable: ['SG'] as const },
    { playerVersionId: versionId(8), playable: ['SF'] as const },
    { playerVersionId: versionId(9), playable: ['PF'] as const },
    { playerVersionId: versionId(10), playable: ['C'] as const },
  ];
  return buildMinimalRotation({
    franchiseId,
    members: players.map((player) => ({
      playerVersionId: player.playerVersionId,
      playable: [...player.playable],
    })),
  });
}

function fullUrls() {
  return {
    catalogUrl: '/data/season/draft-catalog.json',
    catalogHash: 'c'.repeat(64),
    profileUrl: '/data/era-sim/2010s.json',
    profileHash: 'p'.repeat(64),
    modelUrl: '/data/projection/projection-model.json',
    modelHash: 'm'.repeat(64),
  };
}

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  mockedUrls.mockResolvedValue(fullUrls());
});

describe('recommendRotation via projection worker', () => {
  it('sends recommend-rotation with scope mapping and resolves the engine result', async () => {
    const runner = createProjectionRunner({ workerUrl: 'fake-worker.ts' });
    const current = fixtureRotation();
    const promise = runner.recommendRotation({
      roster: [...current.starters, ...current.benchOrder],
      unavailable: [],
      current,
      load: [],
      overall: [],
      horizon: 10,
      seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
      scope: 'full',
      keepActive10: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const worker = FakeWorker.instances[0];
    if (worker === undefined) throw new Error('no worker was created');
    const request = worker.posted[0] as Record<string, unknown>;
    expect(request.type).toBe('recommend-rotation');
    expect(request.scope).toBe('full');
    expect(request.keepActive10).toBe(false);
    expect(request.roster).toEqual([...current.starters, ...current.benchOrder]);
    expect(request.current).toEqual(current);
    expect(request.horizon).toBe(10);
    worker.respond({ type: 'complete', requestId: request.requestId, result: FAKE_RECOMMEND });
    await expect(promise).resolves.toBe(FAKE_RECOMMEND);
  });

  it('falls back to OVR without throwing when the model artifact is absent', async () => {
    mockedUrls.mockResolvedValue({
      catalogUrl: '/data/season/draft-catalog.json',
      catalogHash: 'c'.repeat(64),
      profileUrl: '/data/era-sim/2010s.json',
      profileHash: 'p'.repeat(64),
    });
    const runner = createProjectionRunner({ workerUrl: 'fake-worker.ts' });
    const current = fixtureRotation();
    const promise = runner.recommendRotation({
      roster: [...current.starters, ...current.benchOrder],
      unavailable: [],
      current,
      load: [],
      overall: [],
      horizon: 10,
      seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
      scope: 'full',
      keepActive10: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const worker = FakeWorker.instances[0];
    if (worker === undefined) throw new Error('no worker was created');
    const request = worker.posted[0] as Record<string, unknown>;
    expect(request.type).toBe('recommend-rotation');
    expect(request.modelUrl).toBeUndefined();
    worker.respond({ type: 'complete', requestId: request.requestId, result: FAKE_RECOMMEND });
    await expect(promise).resolves.toBe(FAKE_RECOMMEND);
  });

  it('rejects with the worker boundary error on corrupt model failure', async () => {
    const runner = createProjectionRunner({ workerUrl: 'fake-worker.ts' });
    const current = fixtureRotation();
    const promise = runner.recommendRotation({
      roster: [...current.starters, ...current.benchOrder],
      unavailable: [],
      current,
      load: [],
      overall: [],
      horizon: 10,
      seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
      scope: 'full',
      keepActive10: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const worker = FakeWorker.instances[0];
    if (worker === undefined) throw new Error('no worker was created');
    const request = worker.posted[0] as { requestId: string } | undefined;
    worker.respond({
      type: 'error',
      requestId: request?.requestId,
      message: 'auto-rotation: invalid projection model artifact',
    });
    await expect(promise).rejects.toThrow(/invalid projection model artifact/);
  });

  it('aborts in-flight work by terminating and recreates on restart', async () => {
    const runner = createProjectionRunner({ workerUrl: 'fake-worker.ts' });
    const current = fixtureRotation();
    const controller = new AbortController();
    const promise = runner.recommendRotation(
      {
        roster: [...current.starters, ...current.benchOrder],
        unavailable: [],
        current,
        load: [],
        overall: [],
        horizon: 10,
        seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
        scope: 'full',
        keepActive10: false,
      },
      { signal: controller.signal },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const first = FakeWorker.instances[0];
    if (first === undefined) throw new Error('no worker was created');
    controller.abort();
    await expect(promise).rejects.toThrow(/cancelled/);
    expect(first.terminated).toBe(true);
    const retry = runner.recommendRotation({
      roster: [...current.starters, ...current.benchOrder],
      unavailable: [],
      current,
      load: [],
      overall: [],
      horizon: 10,
      seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
      scope: 'minutes-only',
      keepActive10: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = FakeWorker.instances[1];
    if (second === undefined) throw new Error('worker was not recreated after cancel');
    expect(second).not.toBe(first);
    const request = second.posted[0] as Record<string, unknown>;
    expect(request.scope).toBe('minutes-only');
    second.respond({ type: 'complete', requestId: request.requestId, result: FAKE_RECOMMEND });
    await expect(retry).resolves.toBe(FAKE_RECOMMEND);
  });

  it('reuses a single worker across requests and terminates on destroy', async () => {
    const runner = createProjectionRunner({ workerUrl: 'fake-worker.ts' });
    const current = fixtureRotation();
    const firstPromise = runner.recommendRotation({
      roster: [...current.starters, ...current.benchOrder],
      unavailable: [],
      current,
      load: [],
      overall: [],
      horizon: 10,
      seed: 'seed-1',
      scope: 'full',
      keepActive10: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const worker = FakeWorker.instances[0];
    if (worker === undefined) throw new Error('no worker was created');
    const firstRequest = worker.posted[0] as Record<string, unknown>;
    worker.respond({ type: 'complete', requestId: firstRequest.requestId, result: FAKE_RECOMMEND });
    await expect(firstPromise).resolves.toBe(FAKE_RECOMMEND);
    const secondPromise = runner.recommendRotation({
      roster: [...current.starters, ...current.benchOrder],
      unavailable: [],
      current,
      load: [],
      overall: [],
      horizon: 10,
      seed: 'seed-2',
      scope: 'full',
      keepActive10: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(FakeWorker.instances).toHaveLength(1);
    const secondRequest = worker.posted[1] as Record<string, unknown>;
    worker.respond({
      type: 'complete',
      requestId: secondRequest.requestId,
      result: FAKE_RECOMMEND,
    });
    await expect(secondPromise).resolves.toBe(FAKE_RECOMMEND);
    runner.destroy();
    expect(worker.terminated).toBe(true);
  });
});
