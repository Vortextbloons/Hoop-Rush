import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SEASON_NEUTRAL_HOME_COURT,
  SEASON_WORKER_WIRE_SCHEMA_VERSION,
  seasonCandidateCheckpointSchema,
  seasonWorkerCancelRequestSchema,
  seasonWorkerStartRequestSchema,
  seasonWorkerWarmRequestSchema,
  type SeasonBlockRecap,
  type SeasonCandidateCheckpoint,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonPendingBlockCandidate,
  type SeasonRun,
  type SeasonSchedule,
  type SeasonStandings,
} from '@hoop-rush/data-contracts';
import {
  franchiseIdSchema,
  idSchema,
  commandIdSchema,
  seedSchema,
  seasonGameIdSchema,
} from '@hoop-rush/data-contracts';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import {
  acceptWorkerResult,
  buildWorkerRequest,
  createSeasonBlockRunner,
  type SeasonBlockResumeInput,
  type SeasonBlockStartInput,
} from './season-block-runner';
const LEAGUE = buildSeasonLeague({}, { humanFranchiseId: franchiseIdSchema.parse('lakers') });
import { generateSeasonSchedule } from '@hoop-rush/engine';
import { seasonCheckpointDigest } from '@hoop-rush/engine';
import { seasonRotationSetDigest } from '@hoop-rush/engine';
class FakeWorker {
  static instances: FakeWorker[] = [];
  static clonePostedMessages = false;
  posted: unknown[] = [];
  private listeners: Array<(event: MessageEvent<unknown>) => void> = [];
  constructor(
    public url: string,
    public options?: {
      type?: string;
    },
  ) {
    FakeWorker.instances.push(this);
  }
  postMessage(data: unknown): void {
    if (FakeWorker.clonePostedMessages) structuredClone(data);
    this.posted.push(data);
  }
  addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void {
    if (type === 'message') this.listeners.push(listener);
  }
  removeEventListener(): void {}
  emit(data: unknown): void {
    for (const listener of [...this.listeners]) listener({ data } as MessageEvent<unknown>);
  }
  terminate(): void {}
}
function rotationDigest(run: SeasonRun): string {
  return seasonRotationSetDigest(run.rotations);
}
function makeRun(): SeasonRun {
  const base = buildSeasonRunFixture({ schedule, stateDigest: 'a'.repeat(32) });
  return {
    ...base,
    objectives: {
      ...base.objectives,
      selections: {
        0: {
          objectiveId: 'win-six' as const,
          selectedByCommandId: commandIdSchema.parse('cmd-select-0'),
          success: null,
        },
      },
    },
  };
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
  const pairStates: Array<{
    a: string;
    b: string;
    sharedPossessions: number;
  }> = [];
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
let schedule: SeasonSchedule;
beforeEach(() => {
  FakeWorker.clonePostedMessages = false;
});
function startInput(
  run: SeasonRun,
  partial: Partial<SeasonBlockStartInput> = {},
): SeasonBlockStartInput {
  return {
    run,
    effects: buildZeroEffects(run),
    rotations: run.rotations,
    blockIndex: 0,
    expectedRevision: 0,
    rotationDigest: rotationDigest(run),
    commandId: commandIdSchema.parse('cmd-1'),
    humanFranchiseId: franchiseIdSchema.parse('lakers'),
    objectiveId: 'win-six',
    knownSummaries: [],
    homeCourt: SEASON_NEUTRAL_HOME_COURT,
    catalogUrl: 'https://example.test/season/draft-catalog.json',
    catalogHash: '0'.repeat(64),
    profileUrl: 'https://example.test/season/era-sim.json',
    profileHash: '0'.repeat(64),
    ...partial,
  };
}
function makeCandidate(
  run: SeasonRun,
  partial: Partial<SeasonCandidateCheckpoint> = {},
): SeasonCandidateCheckpoint {
  const line = (playerVersionId: string) => ({
    playerVersionId,
    seconds: 1440,
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
  });
  const boxOf = (franchiseId: string) => ({
    franchiseId: franchiseIdSchema.parse(franchiseId),
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    possessions: 0,
  });
  const home = run.rosters[0];
  const away = run.rosters[1];
  if (home === undefined || away === undefined) throw new Error('fixture rosters missing');
  const gameSummary: SeasonGameSummary = {
    schemaVersion: 1,
    summaryVersion: 'season-game-summary-v4',
    gameId: seasonGameIdSchema.parse('s000001'),
    round: 1,
    homeFranchiseId: home.franchiseId,
    awayFranchiseId: away.franchiseId,
    status: 'final',
    overtimePeriods: 0,
    homeScore: 100,
    awayScore: 90,
    forfeitLoserFranchiseId: null,
    homeBox: boxOf(home.franchiseId),
    awayBox: boxOf(away.franchiseId),
    homePlayers: home.players.map((player) => line(player.playerVersionId)),
    awayPlayers: away.players.map((player) => line(player.playerVersionId)),
    injuryEvents: [],
  };
  const standings: SeasonStandings = {
    schemaVersion: 1,
    standingsVersion: 'standings-v1',
    rows: run.league.teams.map((team) => ({
      franchiseId: team.franchiseId,
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
      homeWins: 0,
      homeLosses: 0,
      awayWins: 0,
      awayLosses: 0,
      conferenceWins: 0,
      conferenceLosses: 0,
      divisionWins: 0,
      divisionLosses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      headToHead: run.league.teams
        .filter((other) => other.franchiseId !== team.franchiseId)
        .map((other) => ({ franchiseId: other.franchiseId, wins: 0, losses: 0 })),
    })),
  };
  const teamAggregates = run.league.teams.map((team) => ({
    franchiseId: team.franchiseId,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    possessions: 0,
  }));
  const playerAggregates = run.rosters.flatMap((roster) =>
    roster.players.map((player) => ({
      playerVersionId: player.playerVersionId,
      franchiseId: roster.franchiseId,
      gamesPlayed: 0,
      appearances: 0,
      started: 0,
      seconds: 0,
      points: 0,
      fieldGoalsMade: 0,
      fieldGoalsAttempted: 0,
      threePointersMade: 0,
      threePointersAttempted: 0,
      freeThrowsMade: 0,
      freeThrowsAttempted: 0,
      offensiveRebounds: 0,
      defensiveRebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      fouls: 0,
    })),
  );
  const recap: SeasonBlockRecap = {
    schemaVersion: 1,
    recapVersion: 'season-recap-v6',
    runId: run.runId,
    blockIndex: 0,
    completedRounds: 10,
    humanRecord: null,
    standingsMovement: [],
    notablePerformances: [],
    streaks: [],
    versionSpotlights: [],
    upcomingHumanGames: [],
    injuryEvidence: {
      injuries: 0,
      bySeverity: { minor: 0, moderate: 0, major: 0, 'season-ending': 0 },
      sameGameReturns: 0,
      seasonEnding: 0,
      returnedThisBlock: 0,
      activeAtBlockEnd: 0,
      humanTeamInjuries: [],
    },
    objectiveEvidence: null,
    tradeEvidence: { tradesAccepted: 0, influenceDelta: 0 },
    freeAgencyEvidence: {
      windowIndex: null,
      signings: [],
      influenceDelta: 0,
      seasonSignings: 0,
      seasonSpend: 0,
    },
    influenceBalance: { humanBalance: 2 },
  };
  const base: SeasonCandidateCheckpoint = {
    schemaVersion: 1,
    checkpointVersion: 'season-checkpoint-v7',
    runId: run.runId,
    rootSeed: run.rootSeed,
    versions: run.versions,
    blockIndex: 0,
    completedRounds: 10,
    revision: 0,
    rotationDigest: rotationDigest(run),
    standings,
    teamAggregates,
    playerAggregates,
    gameSummaries: [gameSummary],
    retainedDetails: [],
    recap,
    effects: buildZeroEffects(run),
    health: { schemaVersion: 1, healthVersion: 'season-health-v2', injuries: [] },
    influence: run.influence,
    freeAgency: run.freeAgency,
    transactions: [],
    objective: {
      objectiveId: null,
      success: null,
      evaluation: {
        objectiveId: 'win-six',
        blockIndex: 0,
        success: false,
        facts: {
          games: 0,
          wins: 0,
          pointsAllowed: 0,
          reboundMargin: 0,
          tipsWithAtLeastEightAvailable: 0,
          tipsTotal: 0,
          benchMinutes: 0,
          turnovers: 0,
        },
        tipCountedGames: 0,
      },
    },
    expectedStateRevision: run.stateRevision,
    expectedStateDigest: run.stateDigest,
    stateRevision: run.stateRevision + 1,
    stateDigest: 'c'.repeat(32),
    digest: '0'.repeat(32),
    ...partial,
  };
  const parsed = seasonCandidateCheckpointSchema.parse(base);
  return { ...parsed, digest: seasonCheckpointDigest(parsed) };
}
function makePending(
  run: SeasonRun,
  nextGameId = seasonGameIdSchema.parse('s000016'),
): SeasonPendingBlockCandidate {
  return {
    schemaVersion: 1,
    blockVersion: 'season-block-v7',
    runId: run.runId,
    commandId: commandIdSchema.parse('cmd-1'),
    blockIndex: 0,
    expectedRevision: 0,
    expectedStateRevision: 0,
    expectedStateDigest: 'a'.repeat(32),
    objectiveId: 'win-six',
    nextGameId,
    summaries: [],
    retainedDetails: [],
    effects: buildZeroEffects(run),
    health: { schemaVersion: 1, healthVersion: 'season-health-v2', injuries: [] },
    standings: run.standings,
    teamAggregates: [],
    playerAggregates: [],
    rotationDigest: rotationDigest(run),
  };
}
function resumeInput(
  run: SeasonRun,
  pending: SeasonPendingBlockCandidate,
  partial: Partial<SeasonBlockResumeInput> = {},
): SeasonBlockResumeInput {
  return {
    run,
    effects: pending.effects,
    pending,
    knownSummaries: [],
    runId: run.runId,
    blockIndex: pending.blockIndex,
    expectedRevision: pending.expectedRevision,
    rotationDigest: pending.rotationDigest,
    commandId: pending.commandId,
    rotations: run.rotations,
    humanFranchiseId: franchiseIdSchema.parse('lakers'),
    homeCourt: SEASON_NEUTRAL_HOME_COURT,
    catalogUrl: 'u',
    catalogHash: '0'.repeat(64),
    profileUrl: 'p',
    profileHash: '0'.repeat(64),
    ...partial,
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await tick();
  }
}
function artifacts(): Promise<{
  catalogUrl: string;
  catalogHash: string;
  profileUrl: string;
  profileHash: string;
}> {
  return Promise.resolve({
    catalogUrl: 'u',
    catalogHash: '0'.repeat(64),
    profileUrl: 'p',
    profileHash: '0'.repeat(64),
  });
}
describe('season block runner (transport)', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('fetch', () => Promise.reject(new Error('fetch stubbed for runner tests')));
    schedule = generateSeasonSchedule({ league: LEAGUE, seed: seedSchema.parse('a'.repeat(32)) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  it('sends a schema-4 start request with the M2.5 fields (wire round-trip)', async () => {
    const run = makeRun();
    const runner = createSeasonBlockRunner({
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    const events: string[] = [];
    runner.subscribe((event) => events.push(event.type));
    runner.startBlock(startInput(run));
    await flush();
    expect(FakeWorker.instances).toHaveLength(1);
    const raw = FakeWorker.instances[0]?.posted[0];
    expect(raw).toBeDefined();
    const start = seasonWorkerStartRequestSchema.parse(raw);
    expect(start.schemaVersion).toBe(SEASON_WORKER_WIRE_SCHEMA_VERSION);
    expect(start.runId).toBe(run.runId);
    expect(start.objectiveId).toBe('win-six');
    expect(start.startGameId).toBeNull();
    expect(start.priorHealth).toEqual({
      schemaVersion: 1,
      healthVersion: 'season-health-v2',
      injuries: [],
    });
    expect(start.commandId).toBe('cmd-1');
    expect(events.some((event) => event === 'started')).toBe(true);
  });
  it('sends known committed summaries as priorSummaries on the start request', async () => {
    const run = makeRun();
    const summaries = makeCandidate(run).gameSummaries;
    const runner = createSeasonBlockRunner({
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    runner.startBlock(startInput(run, { knownSummaries: summaries }));
    await flush();
    const start = seasonWorkerStartRequestSchema.parse(FakeWorker.instances[0]?.posted[0]);
    expect(start.priorSummaries).toEqual(summaries);
  });
  it('prewarms the worker with the packaged asset URLs (performance pass)', async () => {
    const runner = createSeasonBlockRunner({
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    runner.prewarm();
    await flush();
    expect(FakeWorker.instances).toHaveLength(1);
    const raw = FakeWorker.instances[0]?.posted[0];
    expect(raw).toBeDefined();
    const warm = seasonWorkerWarmRequestSchema.parse(raw);
    expect(warm.type).toBe('season-block-warm');
    expect(warm.catalogUrl).toBe('u');
    expect(warm.profileUrl).toBe('p');
    runner.prewarm();
    await flush();
    expect(FakeWorker.instances[0]?.posted).toHaveLength(1);
    runner.terminate();
    runner.prewarm();
    await flush();
    expect(FakeWorker.instances).toHaveLength(2);
  });
  it('removes reactive proxies from the request before posting to the worker', async () => {
    const base = makeRun();
    const run: SeasonRun = {
      ...base,
      transactions: [
        {
          transactionId: idSchema.parse('txn-initial-proxy'),
          commandId: null,
          franchiseId: franchiseIdSchema.parse('lakers'),
          type: 'initial-grant',
          blockIndex: null,
          appliedAtStateRevision: 0,
          payload: new Proxy({ balance: 5 }, {}),
          explanation: 'Initial Influence grant',
        },
      ],
    };
    const runner = createSeasonBlockRunner({
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    const events: string[] = [];
    runner.subscribe((event) => events.push(event.type));
    FakeWorker.clonePostedMessages = true;
    runner.startBlock(startInput(run));
    await flush();
    expect(FakeWorker.instances[0]?.posted).toHaveLength(1);
    expect(events).toContain('started');
    expect(events).not.toContain('error');
  });
  it('sends the pending candidate facts on a resume start request', async () => {
    const run = makeRun();
    const pending = makePending(run);
    const summaries = makeCandidate(run).gameSummaries;
    const runner = createSeasonBlockRunner({
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    runner.resumeBlock(resumeInput(run, pending, { knownSummaries: summaries }));
    await flush();
    expect(FakeWorker.instances).toHaveLength(1);
    const start = seasonWorkerStartRequestSchema.parse(FakeWorker.instances[0]?.posted[0]);
    expect(start.schemaVersion).toBe(SEASON_WORKER_WIRE_SCHEMA_VERSION);
    expect(start.startGameId).toBe('s000016');
    expect(start.objectiveId).toBe('win-six');
    expect(start.priorHealth).toEqual(pending.health);
    expect(start.priorSummaries).toEqual(summaries);
  });
  it('sends a schema-4 cancel request (cancel-schema fix)', async () => {
    const run = makeRun();
    const runner = createSeasonBlockRunner({
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    const requestId = runner.startBlock(startInput(run));
    await flush();
    runner.cancel(requestId);
    await flush();
    const cancelRaw = FakeWorker.instances[0]?.posted[1];
    expect(cancelRaw).toBeDefined();
    const cancel = seasonWorkerCancelRequestSchema.parse(cancelRaw);
    expect(cancel.schemaVersion).toBe(SEASON_WORKER_WIRE_SCHEMA_VERSION);
    expect(cancel.requestId).toBe(requestId);
  });
  it('cancels while artifacts are loading before creating a worker', async () => {
    const run = makeRun();
    let resolveArtifacts!: (value: Awaited<ReturnType<typeof artifacts>>) => void;
    const pendingArtifacts = new Promise<Awaited<ReturnType<typeof artifacts>>>((resolve) => {
      resolveArtifacts = resolve;
    });
    const runner = createSeasonBlockRunner({
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts: () => pendingArtifacts,
    });
    const events: string[] = [];
    runner.subscribe((event) => events.push(event.type));
    const requestId = runner.startBlock(startInput(run));
    runner.cancel(requestId);
    expect(FakeWorker.instances).toHaveLength(0);
    resolveArtifacts(await artifacts());
    await flush();
    expect(FakeWorker.instances).toHaveLength(0);
    expect(events).toEqual(['cancelled']);
  });
  it('cancels a block during asset loading even when a warm worker already exists', async () => {
    const run = makeRun();
    let artifactsCalls = 0;
    let resolveArtifacts!: (value: Awaited<ReturnType<typeof artifacts>>) => void;
    const deferredArtifacts = new Promise<Awaited<ReturnType<typeof artifacts>>>((resolve) => {
      resolveArtifacts = resolve;
    });
    const artifactsFn = (): Promise<Awaited<ReturnType<typeof artifacts>>> => {
      artifactsCalls += 1;
      return artifactsCalls === 1 ? artifacts() : deferredArtifacts;
    };
    const runner = createSeasonBlockRunner({
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts: artifactsFn,
    });
    const events: string[] = [];
    runner.subscribe((event) => events.push(event.type));
    runner.prewarm();
    await flush();
    expect(FakeWorker.instances).toHaveLength(1);
    const requestId = runner.startBlock(startInput(run));
    await flush();
    expect(FakeWorker.instances[0]?.posted).toHaveLength(1);
    runner.cancel(requestId);
    resolveArtifacts(await artifacts());
    await flush();
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]?.posted).toHaveLength(1);
    expect(events).toEqual(['cancelled']);
  });
  it('drops a late candidate result after cancel and emits no candidate', async () => {
    const run = makeRun();
    const runner = createSeasonBlockRunner({
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    const events: Array<{ type: string; requestId?: string }> = [];
    runner.subscribe((event) => events.push(event));
    runner.startBlock(startInput(run));
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    const requestId = events.find((event) => event.type === 'started')?.requestId ?? 'sb-1';
    runner.cancel(requestId);
    await flush();
    worker?.emit({
      schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-block-complete',
      requestId,
      result: { status: 'committed', checkpoint: makeCandidate(run) },
    });
    await flush();
    expect(events.some((event) => event.type === 'candidate')).toBe(false);
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(events.filter((event) => event.type === 'cancelled')).toHaveLength(1);
  });
  it('drops a late interrupted result after cancel and emits no interrupted', async () => {
    const run = makeRun();
    const runner = createSeasonBlockRunner({
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    const events: Array<{ type: string; requestId?: string }> = [];
    runner.subscribe((event) => events.push(event));
    runner.startBlock(startInput(run));
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    const requestId = events.find((event) => event.type === 'started')?.requestId ?? 'sb-1';
    runner.cancel(requestId);
    await flush();
    worker?.emit({
      schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-block-complete',
      requestId,
      result: { status: 'interrupted', pending: makePending(run) },
    });
    await flush();
    expect(events.some((event) => event.type === 'interrupted')).toBe(false);
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(events.filter((event) => event.type === 'cancelled')).toHaveLength(1);
  });
  it('rejects a second block start while one is already running', () => {
    const run = makeRun();
    const runner = createSeasonBlockRunner({
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    runner.startBlock(startInput(run));
    expect(() =>
      runner.startBlock(startInput(run, { commandId: commandIdSchema.parse('cmd-2') })),
    ).toThrow(/already running/);
  });
  it('emits the raw candidate checkpoint without running the commit pipeline', async () => {
    const run = makeRun();
    const runner = createSeasonBlockRunner({
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    const events: Array<{
      type: string;
      requestId?: string;
      checkpoint?: SeasonCandidateCheckpoint;
    }> = [];
    runner.subscribe((event) => events.push(event));
    runner.startBlock(startInput(run));
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    const requestId = events.find((event) => event.type === 'started')?.requestId ?? 'sb-1';
    const candidate = makeCandidate(run);
    worker?.emit({
      schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-block-complete',
      requestId,
      result: { status: 'committed', checkpoint: candidate },
    });
    await flush();
    const emitted = events.find((event) => event.type === 'candidate');
    expect(emitted).toBeDefined();
    expect(emitted?.requestId).toBe(requestId);
    expect(emitted?.checkpoint).toEqual(candidate);
    expect(events.some((event) => event.type === 'error')).toBe(false);
  });
  it('emits the raw interrupted pending without persisting it', async () => {
    const run = makeRun();
    const runner = createSeasonBlockRunner({
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    const events: Array<{
      type: string;
      requestId?: string;
      runId?: string;
      blockIndex?: number;
      pending?: SeasonPendingBlockCandidate;
    }> = [];
    runner.subscribe((event) => events.push(event));
    runner.startBlock(startInput(run));
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    const requestId = events.find((event) => event.type === 'started')?.requestId ?? 'sb-1';
    const pending = makePending(run);
    worker?.emit({
      schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-block-complete',
      requestId,
      result: { status: 'interrupted', pending },
    });
    await flush();
    const interrupted = events.find((event) => event.type === 'interrupted');
    expect(interrupted).toBeDefined();
    expect(interrupted?.requestId).toBe(requestId);
    expect(interrupted?.runId).toBe(run.runId);
    expect(interrupted?.blockIndex).toBe(0);
    expect(interrupted?.pending).toEqual(pending);
    expect(events.some((event) => event.type === 'candidate')).toBe(false);
  });
  it('emits invariant-failure for messages that fail the frozen wire schema', async () => {
    const run = makeRun();
    const runner = createSeasonBlockRunner({
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    const events: Array<{ type: string; code?: string; requestId?: string }> = [];
    runner.subscribe((event) => events.push(event));
    runner.startBlock(startInput(run));
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    const started = events.find((event) => event.type === 'started');
    const requestId = started?.requestId ?? 'sb-1';
    worker?.emit({
      schemaVersion: 3,
      type: 'season-block-complete',
      requestId: 'sb-1',
      checkpoint: {},
    });
    await flush();
    const error = events.find((event) => event.type === 'error');
    expect(error).toMatchObject({ code: 'invariant-failure', requestId });
    worker?.emit({
      schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-block-complete',
      requestId,
      result: { status: 'committed', checkpoint: makeCandidate(run) },
    });
    await flush();
    expect(events.some((event) => event.type === 'candidate')).toBe(false);
    runner.terminate();
  });
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['number', 42],
    ['string', 'wire-noise'],
    ['array', []],
    ['empty-object', {}],
    ['bare-type', { type: 'season-block-progress' }],
    ['unknown-schema', { schemaVersion: 999, type: 'nope', requestId: 'sb-fuzz' }],
    ['truncated-progress', { schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION }],
    [
      'truncated-complete',
      {
        schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
        type: 'season-block-complete',
        requestId: 'sb-fuzz',
      },
    ],
    [
      'wrong-request-id-type',
      {
        schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
        type: 'season-block-error',
        requestId: 42,
        code: 'internal',
        message: 'boom',
        seed: null,
        gameId: null,
      },
    ],
  ])(
    'fuzz: unparsable envelope %s emits invariant-failure, never hangs',
    async (_label, payload) => {
      const run = makeRun();
      const runner = createSeasonBlockRunner({
        schedule,
        workerUrl: 'fake-worker.ts',
        artifacts,
      });
      const events: Array<{ type: string; code?: string }> = [];
      runner.subscribe((event) => events.push(event));
      runner.startBlock(startInput(run));
      await flush();
      const worker = FakeWorker.instances[0];
      expect(worker).toBeDefined();
      worker?.emit(payload);
      await flush();
      const error = events.find((event) => event.type === 'error');
      expect(error).toMatchObject({ code: 'invariant-failure' });
      expect(events.some((event) => event.type === 'candidate')).toBe(false);
      runner.terminate();
    },
  );
  it('sends a stateless start request on every block with full prior state', async () => {
    const run = makeRun();
    const runner = createSeasonBlockRunner({
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    const events: Array<{
      type: string;
      requestId?: string;
    }> = [];
    runner.subscribe((event) => events.push(event));
    runner.startBlock(startInput(run));
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    const started = events.find((event) => event.type === 'started');
    const requestId = started?.requestId ?? 'sb-1';
    const candidate = makeCandidate(run);
    worker?.emit({
      schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-block-complete',
      requestId,
      result: { status: 'committed', checkpoint: candidate },
    });
    await flush();
    expect(events.some((event) => event.type === 'candidate')).toBe(true);
    runner.startBlock(
      startInput(run, {
        blockIndex: 1,
        expectedRevision: 1,
        commandId: commandIdSchema.parse('cmd-2'),
        knownSummaries: candidate.gameSummaries,
      }),
    );
    await flush();
    const second = seasonWorkerStartRequestSchema.parse(worker?.posted[1]);
    expect(second.type).toBe('season-block-start');
    expect(second.runId).toBe(run.runId);
    expect(second.blockIndex).toBe(1);
    expect(second.commandId).toBe('cmd-2');
    expect(second.priorSummaries).toEqual(candidate.gameSummaries);
    expect(second.priorEffects).toBeDefined();
    expect(second.priorHealth).toBeDefined();
    expect(second.run.rotations).toHaveLength(run.rotations.length);
    expect(second.humanFranchiseId).toBe('lakers');
    expect(second.schedule).toBeDefined();
  });
  it('starts when prior summaries exist without reading aggregates from checkpoint metadata', async () => {
    const run = makeRun();
    const runner = createSeasonBlockRunner({
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    const events: Array<{ type: string }> = [];
    runner.subscribe((event) => events.push(event));

    runner.startBlock(startInput(run, { knownSummaries: makeCandidate(run).gameSummaries }));
    await flush();

    expect(events.some((event) => event.type === 'started')).toBe(true);
    expect(FakeWorker.instances[0]?.posted[0]).toBeDefined();
  });
  it('buildWorkerRequest and acceptWorkerResult are pure and worker-independent', () => {
    const run = makeRun();
    const input = startInput(run);
    const pending = makePending(run);
    const request = buildWorkerRequest(
      'req-pure',
      {
        blockIndex: 0,
        expectedRevision: 0,
        rotationDigest: rotationDigest(run),
        commandId: input.commandId,
        rotations: input.rotations,
        input,
        resumePending: pending,
      },
      {
        knownSummaries: [],
        schedule,
        artifacts: {
          catalogUrl: 'u',
          catalogHash: '0'.repeat(64),
          profileUrl: 'p',
          profileHash: '0'.repeat(64),
        },
      },
    );
    expect(request.type).toBe('season-block-start');
    expect(request.startGameId).toBe(pending.nextGameId);
    expect(request.priorEffects).toEqual(pending.effects);
    const candidate = makeCandidate(run);
    expect(
      acceptWorkerResult(candidate, {
        runId: run.runId,
        blockIndex: 0,
        revision: 0,
        rotationDigest: rotationDigest(run),
        expectedStateRevision: run.stateRevision,
        expectedStateDigest: run.stateDigest,
      }),
    ).toEqual([]);
    expect(
      acceptWorkerResult(candidate, {
        runId: run.runId,
        blockIndex: 1,
        revision: 0,
        rotationDigest: rotationDigest(run),
        expectedStateRevision: run.stateRevision,
        expectedStateDigest: run.stateDigest,
      }).length,
    ).toBeGreaterThan(0);
  });
  it('sends authoritative effects and health on a full reset after roster context changes', async () => {
    const run = makeRun();
    const runner = createSeasonBlockRunner({
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    const changedRun: SeasonRun = {
      ...run,
      rosters: [...run.rosters].reverse(),
      cursor: { schemaVersion: 1, completedRounds: 10 },
    };
    const changedEffects = buildZeroEffects(changedRun);
    const firstPair = changedEffects.pairStates[0];
    if (firstPair === undefined) throw new Error('fixture has no chemistry pair');
    changedEffects.pairStates[0] = { ...firstPair, sharedPossessions: 77 };
    const summaries = makeCandidate(run).gameSummaries;
    runner.startBlock(
      startInput(changedRun, {
        effects: changedEffects,
        blockIndex: 1,
        expectedRevision: 1,
        commandId: commandIdSchema.parse('cmd-2'),
        knownSummaries: summaries,
      }),
    );
    await flush();
    const reset = seasonWorkerStartRequestSchema.parse(FakeWorker.instances[0]?.posted[0]);
    expect(reset.type).toBe('season-block-start');
    expect(reset.priorEffects).toEqual(changedEffects);
    expect(reset.priorHealth).toEqual(changedRun.health);
    expect(reset.priorSummaries).toEqual(summaries);
  });
});
