import { describe, expect, it } from 'bun:test';
import type { ChallengeRun, GameResult } from '@hoop-rush/data-contracts';
import {
  acceptGameResult,
  createEngineContext,
  createGameInput,
  simulateGame,
} from '@hoop-rush/engine';
import type {
  ActiveGameAppend,
  CompletedRunIndex,
  StoredRunRecord,
} from '@hoop-rush/data-contracts';
import {
  buildChallengeRun,
  buildEraSimulationProfile,
  buildGameSimulationInput,
} from '@hoop-rush/test-fixtures';
import { ChallengeSession } from './session.ts';
import type {
  ChallengeAssetPort,
  ChallengeClockPort,
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
  batches: ActiveGameAppend[][] = [];
  promotion: { completed: StoredRunRecord; index: CompletedRunIndex } | null = null;
  failPromotion = false;

  loadActiveRun(): Promise<StoredRunRecord | null> {
    return Promise.resolve(this.record);
  }
  appendActiveGames(inputs: readonly ActiveGameAppend[]): Promise<void> {
    this.batches.push([...inputs]);
    this.appends.push(...inputs);
    return Promise.resolve(undefined);
  }
  promoteActiveToCompleted(completed: StoredRunRecord, index: CompletedRunIndex): Promise<void> {
    if (this.failPromotion) return Promise.reject(new Error('promotion store offline'));
    this.promotion = { completed, index };
    return Promise.resolve(undefined);
  }
}

class FakeChallengeJob implements ChallengeJobPort {
  events: ChallengeJobEvents | null = null;
  simulations: ChallengeJobSimulationInput[] = [];
  cancels = 0;
  disposals = 0;

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
  sleeps: number[] = [];
  sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    return Promise.resolve(undefined);
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
  const clock = new FakeChallengeClock();
  const session = new ChallengeSession({
    repository,
    job,
    assets: assets(),
    clock,
  });
  const snapshots: Array<ReturnType<ChallengeSession['getSnapshot']>> = [];
  session.subscribe(() => snapshots.push(session.getSnapshot()));
  return { repository, job, session, snapshots, clock };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function batchSizes(repository: MemoryChallengeRepository): number[] {
  return repository.batches.map((batch) => batch.length);
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
    await failing.load();
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
    expect(job.simulations).toHaveLength(0);
  });

  it('simulates a fresh run once from its persisted seed and reveals games in order', async () => {
    const run = fixtureRun({ runId: 'run-reveal' });
    const results = resultsUntilFinished(run);
    const { repository, job, session } = setup(run);
    await session.load();
    session.start({ reducedMotion: true });
    expect(session.getSnapshot().phase).toBe('running');
    expect(job.simulations).toHaveLength(1);
    expect(job.simulations[0]).toMatchObject({ startGameNumber: 1 });
    expect(job.simulations[0]?.run.runSeed).toBe(run.runSeed);
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

  it('resumes an existing run from the next unplayed game', async () => {
    const base = fixtureRun({ runId: 'run-resume' });
    const first = pick(resultSequence(base, 1), 0);
    const withGame = acceptGameResult(base, first);
    const { job, session } = setup(withGame);
    await session.load();
    session.start({ reducedMotion: true });
    expect(job.simulations).toHaveLength(1);
    expect(job.simulations[0]?.startGameNumber).toBe(2);
  });

  it('paces reveals only when motion is not reduced', async () => {
    const run = fixtureRun({ runId: 'run-pacing' });
    const results = resultSequence(run, 3);
    const timed = setup(run);
    await timed.session.load();
    timed.session.start({ reducedMotion: false });
    timed.job.deliver(results);
    await flush();
    expect(timed.clock.sleeps).toHaveLength(3);
    expect(timed.clock.sleeps.every((ms) => ms > 0)).toBe(true);
    expect(batchSizes(timed.repository)).toEqual([1, 1, 1]);

    const reduced = setup(run);
    await reduced.session.load();
    reduced.session.start({ reducedMotion: true });
    reduced.job.deliver(results);
    await flush();
    expect(reduced.clock.sleeps).toEqual([]);
    expect(batchSizes(reduced.repository)).toEqual([3]);
    expect(reduced.repository.appends.map((append) => append.gameNumber)).toEqual([1, 2, 3]);
  });

  it('batches fast-sim results into one durable append', async () => {
    const run = fixtureRun({ runId: 'run-fast-batch' });
    const results = resultSequence(run, 6);
    const { repository, job, session } = setup(run);
    await session.load();
    session.start({ reducedMotion: false, fastSim: true });
    job.deliver(results);
    await flush();
    expect(batchSizes(repository)).toEqual([6]);
    expect(repository.batches[0]?.map((append) => append.gameNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(repository.batches[0]?.at(-1)?.aggregates).toEqual(
      session.getSnapshot().run?.aggregates,
    );
  });

  it('switches a running reveal to fast batching', async () => {
    const run = fixtureRun({ runId: 'run-fast-toggle' });
    const results = resultSequence(run, 3);
    const { repository, job, session, clock } = setup(run);
    const gate = deferred<undefined>();
    clock.sleep = () => gate.promise;
    await session.load();
    session.start({ reducedMotion: false });
    job.deliver(results);
    session.setFast(true);
    gate.resolve(undefined);
    await flush();
    expect(batchSizes(repository)).toEqual([1, 2]);
    expect(repository.appends.map((append) => append.gameNumber)).toEqual([1, 2, 3]);
  });

  it('keeps reduced motion fast when the toggle is off', async () => {
    const run = fixtureRun({ runId: 'run-reduced-toggle' });
    const results = resultSequence(run, 2);
    const { repository, job, session } = setup(run);
    await session.load();
    session.start({ reducedMotion: true });
    session.setFast(false);
    job.deliver(results);
    await flush();
    expect(batchSizes(repository)).toEqual([2]);
  });

  it('cancels into paused and drops late results', async () => {
    const run = fixtureRun({ runId: 'run-cancel' });
    const results = resultSequence(run, 3);
    const { repository, job, session } = setup(run);
    await session.load();
    session.start({ reducedMotion: true });
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
    session.dispose();
    expect(job.disposals).toBeGreaterThan(0);
    job.deliver(results);
    await flush();
    expect(repository.appends).toHaveLength(0);
  });
  it('keeps the newest load when an earlier repository load resolves late', async () => {
    const older = deferred<StoredRunRecord | null>();
    const run = fixtureRun({ runId: 'newest-load' });
    const { session, repository } = setup(run);
    let calls = 0;
    repository.loadActiveRun = () =>
      ++calls === 1 ? older.promise : Promise.resolve(storedRecord(run));
    const first = session.load();
    await session.load();
    older.resolve(null);
    await first;
    expect(session.getSnapshot()).toMatchObject({ run: { runId: run.runId }, loadError: null });
  });

  it('does not let a stale profile failure clear a newer load', async () => {
    const profile = deferred<ReturnType<typeof buildEraSimulationProfile>>();
    const run = fixtureRun();
    const repository = new MemoryChallengeRepository();
    repository.record = storedRecord(run);
    let calls = 0;
    const session = new ChallengeSession({
      repository,
      job: new FakeChallengeJob(),
      clock: new FakeChallengeClock(),
      assets: {
        loadEraSimulationProfile: () =>
          ++calls === 1 ? profile.promise : Promise.resolve(PROFILE),
      },
    });
    const first = session.load();
    await flush();
    await session.load();
    profile.reject(new Error('old load failed'));
    await first;
    expect(session.getSnapshot()).toMatchObject({ run: { runId: run.runId }, loadError: null });
  });

  it('drains a resumed queue while the cancelled execution is still sleeping', async () => {
    const run = fixtureRun();
    const results = resultSequence(run, 2);
    const { session, job, clock, repository } = setup(run);
    const sleep = deferred<undefined>();
    clock.sleep = () => sleep.promise;
    await session.load();
    session.start({ reducedMotion: false });
    job.deliver([pick(results, 0)]);
    session.cancel();
    session.start({ reducedMotion: true });
    job.deliver(results);
    await flush();
    expect(repository.appends.map((row) => row.gameNumber)).toEqual([1, 2]);
    sleep.resolve(undefined);
    await flush();
    expect(session.getSnapshot().run?.games).toHaveLength(2);
  });

  it('waits for a cancelled append and resumes after the committed game', async () => {
    const run = fixtureRun();
    const { session, job, repository } = setup(run);
    const append = deferred<undefined>();
    repository.appendActiveGames = () => append.promise;
    await session.load();
    session.start({ reducedMotion: true });
    job.deliver(resultSequence(run, 1));
    session.cancel();
    session.start({ reducedMotion: true });
    expect(job.simulations).toHaveLength(1);
    append.resolve(undefined);
    await flush();
    expect(job.simulations[1]?.startGameNumber).toBe(2);
    expect(session.getSnapshot().run?.games).toHaveLength(1);
  });

  it('ignores a rejected cancelled append when a restart is waiting', async () => {
    const run = fixtureRun();
    const { session, job, repository } = setup(run);
    const append = deferred<undefined>();
    repository.appendActiveGames = () => append.promise;
    await session.load();
    session.start({ reducedMotion: true });
    job.deliver(resultSequence(run, 1));
    session.cancel();
    session.start({ reducedMotion: true });
    append.reject(new Error('old append failed'));
    await flush();
    expect(session.getSnapshot()).toMatchObject({ phase: 'running', error: null });
    expect(job.simulations).toHaveLength(2);
  });

  it('keeps completion pending and prevents duplicate promotions', async () => {
    const run = fixtureRun();
    const { session, job, repository } = setup(run);
    const promotion = deferred<undefined>();
    let calls = 0;
    repository.promoteActiveToCompleted = () => {
      calls += 1;
      return promotion.promise;
    };
    await session.load();
    session.start({ reducedMotion: true });
    job.deliver(resultsUntilFinished(run));
    await flush();
    expect(session.getSnapshot().phase).toBe('completing');
    session.start({ reducedMotion: true });
    expect(calls).toBe(1);
    session.dispose();
    promotion.reject(new Error('late failure'));
    await flush();
    expect(session.getSnapshot().phase).toBe('completing');
  });
  it('promotes a finished active checkpoint on reload before reporting finished', async () => {
    const base = fixtureRun();
    const finished = resultsUntilFinished(base).reduce(
      (run, result) => acceptGameResult(run, result),
      base,
    );
    const { session, repository } = setup(finished, { failPromotion: true });
    await session.load();
    expect(session.getSnapshot().phase).toBe('error');
    repository.failPromotion = false;
    session.start({ reducedMotion: true });
    await flush();
    expect(session.getSnapshot().phase).toBe('finished');
    expect(repository.promotion?.completed.run.runId).toBe(base.runId);
  });
});
