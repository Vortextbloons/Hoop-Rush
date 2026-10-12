import { describe, expect, it } from 'vitest';
import { seedSchema, type ChallengeRun, type GameResult } from '@hoop-rush/data-contracts';
import {
  acceptGameResult,
  createEngineContext,
  createGameInput,
  simulateGame,
} from '@hoop-rush/engine';
import type { ActiveGameAppend, CompletedRunIndex, StoredRunRecord } from '@hoop-rush/persistence';
import {
  buildChallengeRun,
  buildEraSimulationProfile,
  buildGameSimulationInput,
} from '@hoop-rush/test-fixtures';
import { ChallengeSession } from './session.ts';
import type {
  ChallengeAssetPort,
  ChallengeClockPort,
  ChallengeJobAttemptInput,
  ChallengeJobEvents,
  ChallengeJobPort,
  ChallengeJobSimulationInput,
  ChallengeRunRepositoryPort,
} from './ports.ts';

const PROFILE = buildGameSimulationInput().profile;
const ENGINE_VERSION = createEngineContext().engineVersion;

function fixtureRun(overrides: Partial<ChallengeRun> = {}): ChallengeRun {
  const base = buildChallengeRun(overrides);
  return { ...base, versions: { ...base.versions, engineVersion: ENGINE_VERSION } };
}

function resultSequence(base: ChallengeRun, count: number): GameResult[] {
  const context = createEngineContext();
  const results: GameResult[] = [];
  let run = base;
  for (let gameNumber = 1; gameNumber <= count; gameNumber += 1) {
    const result = simulateGame(createGameInput(run, PROFILE, gameNumber), context);
    results.push(result);
    run = acceptGameResult(run, result);
  }
  return results;
}

function resultsUntilFinished(base: ChallengeRun): GameResult[] {
  const context = createEngineContext();
  const results: GameResult[] = [];
  let run = base;
  for (let gameNumber = 1; gameNumber <= 82; gameNumber += 1) {
    const result = simulateGame(createGameInput(run, PROFILE, gameNumber), context);
    results.push(result);
    run = acceptGameResult(run, result);
    if (run.status === 'finished') break;
  }
  return results;
}

function storedRecord(run: ChallengeRun): StoredRunRecord {
  return {
    recordId: 'active',
    saveSchemaVersion: 2,
    run,
    updatedAtIso: '2026-01-01T00:00:00.000Z',
  };
}

function pick<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`missing fixture item at ${String(index)}`);
  return item;
}

class MemoryChallengeRepository implements ChallengeRunRepositoryPort {
  record: StoredRunRecord | null = null;
  appends: ActiveGameAppend[] = [];
  promotion: { completed: StoredRunRecord; index: CompletedRunIndex } | null = null;
  failPromotion = false;

  loadActiveRun(): Promise<StoredRunRecord | null> {
    return Promise.resolve(this.record);
  }
  saveActiveRun(record: StoredRunRecord): Promise<void> {
    this.record = record;
    return Promise.resolve();
  }
  appendActiveGame(input: ActiveGameAppend): Promise<void> {
    this.appends.push(input);
    return Promise.resolve();
  }
  promoteActiveToCompleted(completed: StoredRunRecord, index: CompletedRunIndex): Promise<void> {
    if (this.failPromotion) return Promise.reject(new Error('promotion store offline'));
    this.promotion = { completed, index };
    return Promise.resolve();
  }
}

class FakeChallengeJob implements ChallengeJobPort {
  events: ChallengeJobEvents | null = null;
  attempts: ChallengeJobAttemptInput[] = [];
  simulations: ChallengeJobSimulationInput[] = [];
  cancels = 0;
  disposals = 0;

  startAttempt(input: ChallengeJobAttemptInput, events: ChallengeJobEvents): void {
    this.attempts.push(input);
    this.events = events;
  }
  startSimulation(input: ChallengeJobSimulationInput, events: ChallengeJobEvents): void {
    this.simulations.push(input);
    this.events = events;
  }
  cancel(): void {
    this.cancels += 1;
  }
  dispose(): void {
    this.disposals += 1;
  }
  chooseSeed(chosenRunSeed: string): void {
    this.events?.onStartResult(chosenRunSeed);
  }
  deliver(results: GameResult[]): void {
    this.events?.onResults(results);
  }
  fail(message: string): void {
    this.events?.onError(message);
  }
}

class FakeChallengeClock implements ChallengeClockPort {
  now(): number {
    return 0;
  }
  nowIso(): string {
    return '2026-01-01T00:00:00.000Z';
  }
  sleep(): Promise<void> {
    return Promise.resolve();
  }
}

function assets(): ChallengeAssetPort {
  return {
    loadEraSimulationProfile: () => Promise.resolve(buildEraSimulationProfile()),
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(run: ChallengeRun | null, options: { failPromotion?: boolean } = {}) {
  const repository = new MemoryChallengeRepository();
  if (run !== null) repository.record = storedRecord(run);
  repository.failPromotion = options.failPromotion ?? false;
  const job = new FakeChallengeJob();
  const session = new ChallengeSession({
    repository,
    job,
    assets: assets(),
    clock: new FakeChallengeClock(),
  });
  const snapshots: Array<ReturnType<ChallengeSession['getSnapshot']>> = [];
  session.subscribe(() => snapshots.push(session.getSnapshot()));
  return { repository, job, session, snapshots };
}

describe('ChallengeSession', () => {
  it('loads an active run and its era profile', async () => {
    const run = fixtureRun({ runId: 'run-load' });
    const { session } = setup(run);
    await session.load();
    expect(session.getSnapshot()).toMatchObject({
      run: { runId: 'run-load' },
      phase: 'idle',
      loadError: null,
    });
  });

  it('reports a missing active run', async () => {
    const { session } = setup(null);
    await session.load();
    expect(session.getSnapshot().loadError).toBe('No active challenge. Start one from the draft.');
    expect(session.getSnapshot().run).toBeNull();
  });

  it('reports a profile failure without leaking the run', async () => {
    const run = fixtureRun();
    const { session } = setup(run);
    const failingRepo = new MemoryChallengeRepository();
    failingRepo.record = storedRecord(run);
    const failing = new ChallengeSession({
      repository: failingRepo,
      job: new FakeChallengeJob(),
      assets: {
        loadEraSimulationProfile: () => Promise.reject(new Error('offline')),
      },
      clock: new FakeChallengeClock(),
    });
    await session.load();
    await failing.load();
    expect(session.getSnapshot().loadError).toBeNull();
    expect(failing.getSnapshot().run).toBeNull();
    expect(failing.getSnapshot().loadError).toBe('The decade simulation profile is unavailable.');
  });

  it('treats a finished run as finished instead of starting it', async () => {
    const base = fixtureRun({ runId: 'run-finished' });
    const results = resultsUntilFinished(base);
    const finished = results.reduce((run, result) => acceptGameResult(run, result), base);
    const { session, job } = setup(finished);
    await session.load();
    expect(session.getSnapshot().phase).toBe('finished');
    session.start({ reducedMotion: true });
    expect(job.attempts).toHaveLength(0);
    expect(job.simulations).toHaveLength(0);
  });

  it('chooses an attempt seed, persists it, and reveals games in order', async () => {
    const run = fixtureRun({ runId: 'run-reveal' });
    const chosenSeed = 'ffffffffffffffffffffffffffffffff';
    const chosenRun = fixtureRun({ runId: 'run-reveal', runSeed: seedSchema.parse(chosenSeed) });
    const results = resultsUntilFinished(chosenRun);
    const { repository, job, session } = setup(run);
    await session.load();
    session.start({ reducedMotion: true });
    expect(session.getSnapshot().phase).toBe('starting');
    expect(job.attempts).toHaveLength(1);
    job.chooseSeed(chosenSeed);
    await flush();
    expect(session.getSnapshot().phase).toBe('running');
    expect(repository.record?.run.runSeed).toBe(chosenSeed);
    expect(job.simulations[0]).toMatchObject({ startGameNumber: 1 });
    expect(job.simulations[0]?.run.runSeed).toBe(chosenSeed);
    job.deliver(results.slice(0, 2));
    await flush();
    expect(repository.appends.map((append) => append.gameNumber)).toEqual([1, 2]);
    expect(session.getSnapshot().run?.games).toHaveLength(2);
    job.deliver(results.slice(2));
    await flush();
    expect(repository.appends.map((append) => append.gameNumber)).toEqual(
      results.map((result) => result.gameNumber),
    );
    expect(session.getSnapshot().phase).toBe('finished');
    expect(repository.promotion?.index.runId).toBe('run-reveal');
    expect(repository.promotion?.index.outcome).toBe(session.getSnapshot().run?.outcome);
  });

  it('resumes an existing run without replaying the attempt seed', async () => {
    const base = fixtureRun({ runId: 'run-resume' });
    const first = pick(resultSequence(base, 1), 0);
    const withGame = acceptGameResult(base, first);
    const { job, session } = setup(withGame);
    await session.load();
    session.start({ reducedMotion: true });
    expect(job.attempts).toHaveLength(0);
    expect(job.simulations).toHaveLength(1);
    expect(job.simulations[0]?.startGameNumber).toBe(2);
  });

  it('cancels into paused and drops late results', async () => {
    const run = fixtureRun({ runId: 'run-cancel' });
    const results = resultSequence(run, 3);
    const { repository, job, session } = setup(run);
    await session.load();
    session.start({ reducedMotion: true });
    job.chooseSeed(run.runSeed);
    await flush();
    job.deliver([pick(results, 0)]);
    await flush();
    expect(repository.appends).toHaveLength(1);
    session.cancel();
    expect(session.getSnapshot().phase).toBe('paused');
    job.deliver(results.slice(1));
    await flush();
    expect(repository.appends).toHaveLength(1);
    session.start({ reducedMotion: true });
    expect(job.simulations).toHaveLength(2);
    expect(job.simulations[1]?.startGameNumber).toBe(2);
  });

  it('surfaces job errors and restarts on resume', async () => {
    const run = fixtureRun({ runId: 'run-error' });
    const results = resultSequence(run, 2);
    const { job, session } = setup(run);
    await session.load();
    session.start({ reducedMotion: true });
    job.chooseSeed(run.runSeed);
    await flush();
    job.deliver([pick(results, 0)]);
    await flush();
    job.fail('worker exploded');
    expect(session.getSnapshot()).toMatchObject({ phase: 'error', error: 'worker exploded' });
    expect(job.disposals).toBeGreaterThan(0);
    session.start({ reducedMotion: true });
    expect(session.getSnapshot().phase).toBe('running');
    expect(session.getSnapshot().error).toBeNull();
    expect(job.simulations).toHaveLength(2);
  });

  it('fails on out-of-order results', async () => {
    const run = fixtureRun({ runId: 'run-order' });
    const results = resultSequence(run, 3);
    const { session, job } = setup(run);
    await session.load();
    session.start({ reducedMotion: true });
    job.chooseSeed(run.runSeed);
    await flush();
    job.deliver([pick(results, 1)]);
    await flush();
    expect(session.getSnapshot().phase).toBe('error');
    expect(session.getSnapshot().error).toContain('out-of-order result');
  });

  it('retries promotion after a failed completion commit', async () => {
    const base = fixtureRun({ runId: 'run-promote' });
    const results = resultsUntilFinished(base);
    const { repository, job, session } = setup(base, { failPromotion: true });
    await session.load();
    session.start({ reducedMotion: true });
    job.chooseSeed(base.runSeed);
    await flush();
    job.deliver(results);
    await flush();
    expect(session.getSnapshot().phase).toBe('error');
    expect(session.getSnapshot().error).toContain('could not save the completed run');
    repository.failPromotion = false;
    session.start({ reducedMotion: true });
    await flush();
    expect(session.getSnapshot().phase).toBe('finished');
    expect(repository.promotion?.index.runId).toBe('run-promote');
  });

  it('disposes the job and ignores late events after dispose', async () => {
    const run = fixtureRun({ runId: 'run-dispose' });
    const results = resultSequence(run, 2);
    const { repository, job, session } = setup(run);
    await session.load();
    session.start({ reducedMotion: true });
    job.chooseSeed(run.runSeed);
    await flush();
    session.dispose();
    expect(job.disposals).toBeGreaterThan(0);
    job.deliver(results);
    await flush();
    expect(repository.appends).toHaveLength(0);
  });
});
