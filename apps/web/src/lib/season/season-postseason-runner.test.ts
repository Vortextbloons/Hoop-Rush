import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION,
  commandIdSchema,
  franchiseIdSchema,
  postseasonGameIdSchema,
  seasonPostseasonWorkerStartRequestSchema,
  seedSchema,
  type SeasonEffectsState,
  type SeasonRun,
  type SeasonPostseasonWorkerProgressMessage,
  type SeasonPostseasonWorkerStartRequest,
} from '@hoop-rush/data-contracts';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import { generateSeasonSchedule } from '@hoop-rush/engine';
import {
  createSeasonPostseasonJob,
  type SeasonPostseasonSimulatorFn,
} from './season-postseason-runner';
const LEAGUE = buildSeasonLeague({}, { humanFranchiseId: franchiseIdSchema.parse('lakers') });
const ARTIFACTS = {
  catalogUrl: 'u',
  catalogHash: '0'.repeat(64),
  profileUrl: 'p',
  profileHash: '0'.repeat(64),
};
function artifacts(): Promise<typeof ARTIFACTS> {
  return Promise.resolve({ ...ARTIFACTS });
}
class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: unknown[] = [];
  private messageListeners: Array<(event: MessageEvent<unknown>) => void> = [];
  private errorListeners: Array<(event: { message: string }) => void> = [];
  constructor(
    public url: string,
    public options?: { type?: string },
  ) {
    FakeWorker.instances.push(this);
  }
  postMessage(data: unknown): void {
    this.posted.push(data);
  }
  addEventListener(type: string, listener: (event: never) => void): void {
    if (type === 'message') this.messageListeners.push(listener as never);
    if (type === 'error') this.errorListeners.push(listener as never);
  }
  removeEventListener(): void {}
  emitMessage(data: unknown): void {
    for (const listener of [...this.messageListeners]) listener({ data } as MessageEvent<unknown>);
  }
  emitError(message: string): void {
    for (const listener of [...this.errorListeners]) listener({ message });
  }
  terminate(): void {}
}
function buildZeroEffects(run: SeasonRun): SeasonEffectsState {
  const playerStates = run.rosters.flatMap((roster) =>
    roster.players.map((player) => ({
      playerVersionId: player.playerVersionId,
      fatigueBasisPoints: 0,
      recentLoadBasisPoints: 0,
      lastCompletedRound: 0,
    })),
  );
  const pairStates: SeasonEffectsState['pairStates'] = [];
  for (const roster of run.rosters) {
    const ids = roster.players.map((player) => player.playerVersionId).sort();
    for (let i = 0; i < ids.length; i += 1) {
      const a = ids[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < ids.length; j += 1) {
        const b = ids[j];
        if (b === undefined) continue;
        pairStates.push({ a, b, sharedPossessions: 0 });
      }
    }
  }
  return {
    schemaVersion: 2,
    playerStates,
    inactivePlayerStates: [],
    pairStates,
    archivedPairs: [],
  };
}
interface Fixture {
  run: SeasonRun;
  request: SeasonPostseasonWorkerStartRequest;
}
function fixture(): Fixture {
  const schedule = generateSeasonSchedule({
    league: LEAGUE,
    seed: seedSchema.parse('a'.repeat(32)),
  });
  const run = buildSeasonRunFixture({ schedule, stateDigest: 'a'.repeat(32) });
  const request: SeasonPostseasonWorkerStartRequest =
    seasonPostseasonWorkerStartRequestSchema.parse({
      schemaVersion: SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-postseason-start',
      requestId: 'sp-wire-0',
      runId: run.runId,
      rootSeed: run.rootSeed,
      commandId: commandIdSchema.parse('cmd-postseason-1'),
      expectedStateRevision: run.stateRevision,
      expectedStateDigest: run.stateDigest,
      humanFranchiseId: null,
      targetGameId: postseasonGameIdSchema.parse('pi-east-seven-eight'),
      catalogUrl: ARTIFACTS.catalogUrl,
      catalogHash: ARTIFACTS.catalogHash,
      profileUrl: ARTIFACTS.profileUrl,
      profileHash: ARTIFACTS.profileHash,
      run,
      effects: buildZeroEffects(run),
      regularSeasonSummaries: [],
    });
  return { run, request };
}
function completeMessage(
  request: SeasonPostseasonWorkerStartRequest,
  run: SeasonRun,
): {
  schemaVersion: typeof SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION;
  type: 'season-postseason-complete';
  requestId: string;
  result: {
    status: 'accepted';
    stage: SeasonRun['stage'];
    advancedGameIds: string[];
    summaries: [];
    run: SeasonRun;
    nextDecision: 'rotation';
    nextGameId: string;
    aiNextGameId: null;
  };
} {
  return {
    schemaVersion: SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION,
    type: 'season-postseason-complete',
    requestId: request.requestId,
    result: {
      status: 'accepted',
      stage: run.stage,
      advancedGameIds: [request.targetGameId],
      summaries: [],
      run,
      nextDecision: 'rotation',
      nextGameId: request.targetGameId,
      aiNextGameId: null,
    },
  };
}
describe('season postseason job transport', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });
  it('posts the wire request and maps an accepted complete message', async () => {
    const { run, request } = fixture();
    const job = createSeasonPostseasonJob({ workerUrl: 'fake-postseason-worker.ts' });
    const outcomePromise = job.simulate(request);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]?.posted[0]).toEqual(request);
    FakeWorker.instances[0]?.emitMessage(completeMessage(request, run));
    const outcome = await outcomePromise;
    expect(outcome).toEqual({
      kind: 'accepted',
      result: {
        status: 'accepted',
        stage: run.stage,
        advancedGameIds: [request.targetGameId],
        summaries: [],
        run,
        nextDecision: 'rotation',
        nextGameId: request.targetGameId,
        aiNextGameId: null,
      },
    });
    job.terminate();
  });
  it('maps a rejected complete message', async () => {
    const { request } = fixture();
    const job = createSeasonPostseasonJob({ workerUrl: 'fake-postseason-worker.ts' });
    const outcomePromise = job.simulate(request);
    FakeWorker.instances[0]?.emitMessage({
      schemaVersion: SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-postseason-complete',
      requestId: request.requestId,
      result: {
        status: 'rejected',
        commandId: request.commandId,
        rejection: { code: 'integrity-failure', reason: 'box score drift' },
      },
    });
    await expect(outcomePromise).resolves.toEqual({
      kind: 'rejected',
      commandId: request.commandId,
      rejection: { code: 'integrity-failure', reason: 'box score drift' },
    });
    job.terminate();
  });
  it('maps a worker error message', async () => {
    const { request } = fixture();
    const job = createSeasonPostseasonJob({ workerUrl: 'fake-postseason-worker.ts' });
    const outcomePromise = job.simulate(request);
    FakeWorker.instances[0]?.emitMessage({
      schemaVersion: SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-postseason-error',
      requestId: request.requestId,
      code: 'invariant-failure',
      message: 'the box score does not reconcile',
      seed: null,
      gameId: null,
    });
    await expect(outcomePromise).resolves.toEqual({
      kind: 'error',
      code: 'invariant-failure',
      message: 'the box score does not reconcile',
      seed: null,
      gameId: null,
    });
    job.terminate();
  });
  it('forwards worker progress to the simulate callback', () => {
    const { request } = fixture();
    const job = createSeasonPostseasonJob({ workerUrl: 'fake-postseason-worker.ts' });
    const progress: SeasonPostseasonWorkerProgressMessage[] = [];
    void job.simulate(request, (message) => progress.push(message));
    FakeWorker.instances[0]?.emitMessage({
      schemaVersion: SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-postseason-progress',
      requestId: request.requestId,
      gamesCompleted: 2,
      gamesTotal: 12,
      latestGameId: request.targetGameId,
      latestResult: null,
    });
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({ gamesCompleted: 2, gamesTotal: 12 });
    job.terminate();
  });
  it('ignores complete messages for unknown requests', async () => {
    const { run, request } = fixture();
    const job = createSeasonPostseasonJob({ workerUrl: 'fake-postseason-worker.ts' });
    const outcomePromise = job.simulate(request);
    const message = completeMessage(request, run);
    FakeWorker.instances[0]?.emitMessage({ ...message, requestId: 'sp-other' });
    let settled = false;
    void outcomePromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    job.terminate();
    await expect(outcomePromise).resolves.toMatchObject({ kind: 'error', code: 'cancelled' });
  });
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['number', 42],
    ['string', 'wire-noise'],
    ['array', []],
    ['empty-object', {}],
    ['bare-type', { type: 'season-postseason-progress' }],
    ['unknown-schema', { schemaVersion: 999, type: 'nope', requestId: 'sp-fuzz' }],
    ['truncated-progress', { schemaVersion: 1 }],
    [
      'truncated-complete',
      { schemaVersion: 1, type: 'season-postseason-complete', requestId: 'sp-fuzz' },
    ],
    [
      'wrong-request-id-type',
      {
        schemaVersion: 1,
        type: 'season-postseason-error',
        requestId: 42,
        code: 'internal',
        message: 'boom',
        seed: null,
        gameId: null,
      },
    ],
  ])(
    'fuzz: unparsable envelope %s surfaces invariant-failure instead of hanging',
    async (_label, payload) => {
      const { request } = fixture();
      const job = createSeasonPostseasonJob({ workerUrl: 'fake-postseason-worker.ts' });
      const outcomePromise = job.simulate(request);
      FakeWorker.instances[0]?.emitMessage(payload);
      await expect(outcomePromise).resolves.toMatchObject({
        kind: 'error',
        code: 'invariant-failure',
        message: 'the postseason worker sent a message outside the wire schema',
      });
      job.terminate();
    },
  );
  it('posts the wire cancel for the active request only', () => {
    const { request } = fixture();
    const job = createSeasonPostseasonJob({ workerUrl: 'fake-postseason-worker.ts' });
    void job.simulate(request);
    job.cancel('sp-other');
    expect(FakeWorker.instances[0]?.posted).toHaveLength(1);
    job.cancel(request.requestId);
    expect(FakeWorker.instances[0]?.posted[1]).toEqual({
      schemaVersion: SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-postseason-cancel',
      requestId: request.requestId,
    });
    job.terminate();
  });
  it('terminate resolves in-flight simulations with cancelled', async () => {
    const { request } = fixture();
    const job = createSeasonPostseasonJob({ workerUrl: 'fake-postseason-worker.ts' });
    const outcomePromise = job.simulate(request);
    job.terminate();
    await expect(outcomePromise).resolves.toEqual({
      kind: 'error',
      code: 'cancelled',
      message: 'postseason worker terminated',
      seed: null,
      gameId: null,
    });
  });
  it('surfaces a worker error event as an internal outcome', async () => {
    const { request } = fixture();
    const job = createSeasonPostseasonJob({ workerUrl: 'fake-postseason-worker.ts' });
    const outcomePromise = job.simulate(request);
    FakeWorker.instances[0]?.emitError('worker exploded');
    await expect(outcomePromise).resolves.toMatchObject({
      kind: 'error',
      code: 'internal',
      message: 'worker exploded',
    });
    job.terminate();
  });
  it('prewarms the worker with the packaged asset URLs', async () => {
    const job = createSeasonPostseasonJob({ workerUrl: 'fake-postseason-worker.ts', artifacts });
    job.prewarm();
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]?.posted[0]).toMatchObject({
      type: 'season-postseason-warm',
      catalogUrl: 'u',
      profileUrl: 'p',
    });
    job.prewarm();
    expect(FakeWorker.instances[0]?.posted).toHaveLength(1);
    job.terminate();
  });
  it('maps the injected simulator seam and forwards its progress', async () => {
    const { run, request } = fixture();
    const progress: SeasonPostseasonWorkerProgressMessage[] = [];
    const simulate: SeasonPostseasonSimulatorFn = (incoming, onProgress) => {
      expect(incoming).toEqual(request);
      onProgress({
        schemaVersion: SEASON_POSTSEASON_WORKER_WIRE_SCHEMA_VERSION,
        type: 'season-postseason-progress',
        requestId: incoming.requestId,
        gamesCompleted: 1,
        gamesTotal: 5,
        latestGameId: incoming.targetGameId,
        latestResult: null,
      });
      return Promise.resolve(completeMessage(incoming, run));
    };
    const job = createSeasonPostseasonJob({ simulate, artifacts });
    const outcome = await job.simulate(request, (message) => progress.push(message));
    expect(outcome.kind).toBe('accepted');
    expect(progress).toHaveLength(1);
    expect(progress[0]?.gamesCompleted).toBe(1);
    expect(FakeWorker.instances).toHaveLength(0);
    job.terminate();
  });
});
