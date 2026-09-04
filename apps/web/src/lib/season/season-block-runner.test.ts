import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CommitSeasonBlockInput,
  SeasonRunRepository,
  SeasonRunSnapshot,
} from '@hoop-rush/persistence';
import {
  SEASON_NEUTRAL_HOME_COURT,
  SEASON_FREE_AGENCY_VERSION,
  seasonCandidateCheckpointSchema,
  seasonWorkerCancelRequestSchema,
  seasonWorkerContinueRequestSchema,
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
import { franchiseIdSchema, idSchema, playerIdSchema, commandIdSchema, seedSchema, seasonGameIdSchema } from '@hoop-rush/data-contracts';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import { createSeasonBlockRunner, type SeasonBlockStartInput } from './season-block-runner';
const LEAGUE = buildSeasonLeague({}, { humanFranchiseId: franchiseIdSchema.parse('lakers') });
import {
  generateSeasonSchedule,
  seasonCheckpointDigest,
  seasonFranchiseLegalFiveFacts,
  seasonRotationSetDigest,
} from '@hoop-rush/engine';
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
        0: { objectiveId: 'win-six' as const, selectedByCommandId: commandIdSchema.parse('cmd-select-0'), success: null },
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
type MockRepositoryFns = {
  commitSeasonBlock: ReturnType<typeof vi.fn>;
  savePendingBlock: ReturnType<typeof vi.fn>;
  loadPendingBlock: ReturnType<typeof vi.fn>;
};
type MockRepository = SeasonRunRepository & MockRepositoryFns;
function repositoryMocks(repository: MockRepository): MockRepositoryFns {
  return repository;
}
function makeRepository(run: SeasonRun): MockRepository {
  const snapshot = {
    run,
    summaries: [],
    retainedDetails: [],
    acceptedBlocks: [],
    effects: buildZeroEffects(run),
  };
  const repository: MockRepository = {
    loadActiveRunIndex: vi.fn(() => Promise.resolve(null)),
    loadActiveRun: vi.fn(() => Promise.resolve(snapshot)),
    loadBlockSummaries: vi.fn(() => Promise.resolve([])),
    loadRetainedDetails: vi.fn(() => Promise.resolve([])),
    loadBlockHistory: vi.fn(() => Promise.resolve([])),
    commitSeasonBlock: vi.fn(() => Promise.resolve(undefined)),
    promoteSeasonDraftToRun: vi.fn(() => Promise.resolve(undefined)),
    clearSeasonRun: vi.fn(() => Promise.resolve(undefined)),
    forceClearActiveSeasonRun: vi.fn(() => Promise.resolve(undefined)),
    savePendingBlock: vi.fn(() => Promise.resolve(undefined)),
    loadPendingBlock: vi.fn(() => Promise.resolve(null)),
    discardPendingBlock: vi.fn(() => Promise.resolve(undefined)),
    applySeasonRunCommand: vi.fn(() => Promise.resolve(undefined)),
    loadSeasonRunPlayerSlice: vi.fn(() => Promise.resolve(null)),
    upsertSeasonRunPlayerSlice: vi.fn(() => Promise.resolve(undefined)),
  };
  return repository;
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
    summaryVersion: 'season-game-summary-v3',
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
    recapVersion: 'season-recap-v5',
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
    checkpointVersion: 'season-checkpoint-v5',
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
function makePending(run: SeasonRun, nextGameId = seasonGameIdSchema.parse('s000016')): SeasonPendingBlockCandidate {
  return {
    schemaVersion: 1,
    blockVersion: 'season-block-v5',
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
describe('season block runner (M2.5 wire)', () => {
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
    const repository = makeRepository(run);
    const runner = createSeasonBlockRunner({
      repository,
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
    expect(start.schemaVersion).toBe(7);
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
  it('prewarms the worker with the packaged asset URLs (performance pass)', async () => {
    const run = makeRun();
    const runner = createSeasonBlockRunner({
      repository: makeRepository(run),
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
      repository: makeRepository(run),
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
    const repository = makeRepository(run);
    const pending = makePending(run);
    repository.loadPendingBlock.mockResolvedValue(pending);
    const runner = createSeasonBlockRunner({
      repository,
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    runner.resumeBlock({
      runId: run.runId,
      blockIndex: 0,
      expectedRevision: 0,
      rotationDigest: rotationDigest(run),
      commandId: commandIdSchema.parse('cmd-1'),
      rotations: run.rotations,
      humanFranchiseId: franchiseIdSchema.parse('lakers'),
      homeCourt: SEASON_NEUTRAL_HOME_COURT,
      catalogUrl: 'u',
      catalogHash: '0'.repeat(64),
      profileUrl: 'p',
      profileHash: '0'.repeat(64),
    });
    await flush();
    expect(FakeWorker.instances).toHaveLength(1);
    const start = seasonWorkerStartRequestSchema.parse(FakeWorker.instances[0]?.posted[0]);
    expect(start.schemaVersion).toBe(7);
    expect(start.startGameId).toBe('s000016');
    expect(start.objectiveId).toBe('win-six');
    expect(start.priorHealth).toEqual(pending.health);
  });
  it('sends a schema-4 cancel request (cancel-schema fix)', async () => {
    const run = makeRun();
    const runner = createSeasonBlockRunner({
      repository: makeRepository(run),
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
    expect(cancel.schemaVersion).toBe(7);
    expect(cancel.requestId).toBe(requestId);
  });
  it('cancels while artifacts are loading before creating a worker', async () => {
    const run = makeRun();
    let resolveArtifacts!: (value: Awaited<ReturnType<typeof artifacts>>) => void;
    const pendingArtifacts = new Promise<Awaited<ReturnType<typeof artifacts>>>((resolve) => {
      resolveArtifacts = resolve;
    });
    const runner = createSeasonBlockRunner({
      repository: makeRepository(run),
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
  it('drops messages that fail the frozen wire schema', async () => {
    const run = makeRun();
    const runner = createSeasonBlockRunner({
      repository: makeRepository(run),
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    const events: string[] = [];
    runner.subscribe((event) => events.push(event.type));
    runner.startBlock(startInput(run));
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    worker?.emit({
      schemaVersion: 3,
      type: 'season-block-complete',
      requestId: 'sb-1',
      checkpoint: {},
    });
    await flush();
    expect(events).toEqual(['started']);
  });
  it('rejects a stale cursor before any worker start', async () => {
    const run = makeRun();
    const runner = createSeasonBlockRunner({
      repository: makeRepository(run),
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    const events: string[] = [];
    runner.subscribe((event) => events.push(event.type));
    runner.startBlock(startInput(run, { expectedRevision: 3 }));
    await flush();
    expect(FakeWorker.instances).toHaveLength(0);
    expect(events.some((event) => event === 'error')).toBe(true);
  });
  it('reconciles an in-memory cursor with persistence before starting the worker', async () => {
    const run = makeRun();
    const repository = makeRepository(run);
    const runner = createSeasonBlockRunner({
      repository,
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
    worker?.emit({
      schemaVersion: 7,
      type: 'season-block-complete',
      requestId,
      result: { status: 'committed', checkpoint: makeCandidate(run) },
    });
    await flush();
    expect(events.some((event) => event.type === 'complete')).toBe(true);
    runner.startBlock(startInput(run, { commandId: commandIdSchema.parse('cmd-2') }));
    await flush();
    expect(events.filter((event) => event.type === 'started')).toHaveLength(2);
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(FakeWorker.instances[0]?.posted).toHaveLength(2);
  });
  it('commits an accepted candidate through completeSeasonBlockCommit with the M2.5 input', async () => {
    const run = makeRun();
    const repository = makeRepository(run);
    const runner = createSeasonBlockRunner({
      repository,
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
      schemaVersion: 7,
      type: 'season-block-complete',
      requestId,
      result: { status: 'committed', checkpoint: candidate },
    });
    await flush();
    expect(events.some((event) => event.type === 'complete')).toBe(true);
    expect(repositoryMocks(repository).commitSeasonBlock).toHaveBeenCalledTimes(1);
    const input = repository.commitSeasonBlock.mock.calls[0]?.[0] as CommitSeasonBlockInput;
    expect(input).toMatchObject({
      runId: run.runId,
      revision: 1,
      commandId: commandIdSchema.parse('cmd-1'),
      rotationDigest: rotationDigest(run),
      expectedStateRevision: run.stateRevision,
      expectedStateDigest: run.stateDigest,
      stateRevision: run.stateRevision + 1,
      window: null,
    });
    expect(input.stateDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(input.health).toEqual(candidate.health);
    expect(input.transactions).toEqual([]);
    expect(input.objectives).toBeDefined();
    expect(input.checkpointState).toMatchObject({ runId: run.runId, blockIndex: 0 });
    expect(input.freeAgency).toEqual(run.freeAgency);
  });
  it('carries the authoritative pre-block free-agency state through the commit', async () => {
    const run = {
      ...makeRun(),
      freeAgency: {
        schemaVersion: 1 as const,
        freeAgencyVersion: 'season-free-agency-v1' as const,
        windows: [],
        canonicalCandidates: {
          'p-magic': {
            playerId: playerIdSchema.parse('p-magic'),
            playerVersionId: 'pv-11111111111111111111111111111111',
            band: 'featured' as const,
            admittedWindowIndex: 0,
            seedPath: ['0', 'canonical', 'p-magic'],
          },
        },
        signingCounts: Object.fromEntries(LEAGUE.teams.map((team) => [team.franchiseId, 0])),
        seasonSpend: Object.fromEntries(LEAGUE.teams.map((team) => [team.franchiseId, 0])),
      },
    };
    const repository = makeRepository(run);
    const runner = createSeasonBlockRunner({
      repository,
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    const events: Array<{
      type: string;
      requestId?: string;
      snapshot?: SeasonRunSnapshot;
    }> = [];
    runner.subscribe((event) => events.push(event));
    runner.startBlock(startInput(run));
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    const started = events.find((event) => event.type === 'started');
    const requestId = started?.requestId ?? 'sb-1';
    const candidate = makeCandidate(run, {
      freeAgency: {
        schemaVersion: 1,
        freeAgencyVersion: 'season-free-agency-v1' as const,
        windows: [],
        canonicalCandidates: {},
        signingCounts: Object.fromEntries(LEAGUE.teams.map((team) => [team.franchiseId, 0])),
        seasonSpend: Object.fromEntries(LEAGUE.teams.map((team) => [team.franchiseId, 0])),
      },
    });
    worker?.emit({
      schemaVersion: 7,
      type: 'season-block-complete',
      requestId,
      result: { status: 'committed', checkpoint: candidate },
    });
    await flush();
    expect(events.some((event) => event.type === 'complete')).toBe(true);
    const commit = repository.commitSeasonBlock.mock.calls[0]?.[0] as CommitSeasonBlockInput;
    expect(commit.freeAgency.canonicalCandidates).toEqual(run.freeAgency.canonicalCandidates);
    const complete = events.find((event) => event.type === 'complete') as
      | {
          type: 'complete';
          snapshot: SeasonRunSnapshot;
        }
      | undefined;
    if (complete === undefined) throw new Error('expected a complete event');
    expect(complete.snapshot.run.freeAgency.canonicalCandidates).toEqual(
      run.freeAgency.canonicalCandidates,
    );
  });
  it('digests the LOCKED rotation set at commit, not the pre-submission run', async () => {
    const run = makeRun();
    const repository = makeRepository(run);
    const runner = createSeasonBlockRunner({
      repository,
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    const events: Array<{
      type: string;
      requestId?: string;
    }> = [];
    runner.subscribe((event) => events.push(event));
    const human = run.rotations.find((rotation) => rotation.franchiseId === 'lakers');
    if (human === undefined) throw new Error('fixture run has no human rotation');
    const pending: SeasonRun['rotations'][number] = {
      ...human,
      targetMinutes: human.targetMinutes.map((row, index) => ({
        ...row,
        minutes: index < 5 ? 38 : 10,
      })),
    };
    const locked = run.rotations.map((rotation) =>
      rotation.franchiseId === 'lakers' ? pending : rotation,
    );
    runner.startBlock(
      startInput(run, { rotations: locked, rotationDigest: seasonRotationSetDigest(locked) }),
    );
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    const started = events.find((event) => event.type === 'started');
    const requestId = started?.requestId ?? 'sb-1';
    worker?.emit({
      schemaVersion: 7,
      type: 'season-block-complete',
      requestId,
      result: {
        status: 'committed',
        checkpoint: makeCandidate(run, { rotationDigest: seasonRotationSetDigest(locked) }),
      },
    });
    await flush();
    const repositoryInput = repository.commitSeasonBlock.mock.calls[0]?.[0] as
      CommitSeasonBlockInput | undefined;
    expect(repositoryInput?.rotations).toEqual(locked);
    const storedHuman = repositoryInput?.rotations.find(
      (rotation) => rotation.franchiseId === 'lakers',
    );
    expect(storedHuman?.targetMinutes).not.toEqual(human.targetMinutes);
  });
  it('sends a wire-v5 continuation when the worker already holds the run context', async () => {
    const run = makeRun();
    const repository = makeRepository(run);
    const runner = createSeasonBlockRunner({
      repository,
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
      schemaVersion: 7,
      type: 'season-block-complete',
      requestId,
      result: { status: 'committed', checkpoint: candidate },
    });
    await flush();
    expect(events.some((event) => event.type === 'complete')).toBe(true);
    runner.startBlock(startInput(run, { blockIndex: 1, expectedRevision: 1, commandId: commandIdSchema.parse('cmd-2') }));
    await flush();
    const continuation = seasonWorkerContinueRequestSchema.parse(worker?.posted[1]);
    expect(continuation.type).toBe('season-block-continue');
    expect(continuation.runId).toBe(run.runId);
    expect(continuation.blockIndex).toBe(1);
    expect(continuation.commandId).toBe('cmd-2');
    expect(continuation.newSummaries).toEqual([]);
    expect(continuation.rotations).toHaveLength(run.rotations.length);
    expect(continuation.humanFranchiseId).toBe('lakers');
    expect('schedule' in continuation).toBe(false);
    expect('run' in continuation).toBe(false);
  });
  it('sends authoritative effects and health on a full reset after roster context changes', async () => {
    const run = makeRun();
    const repository = makeRepository(run);
    const runner = createSeasonBlockRunner({
      repository,
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
    const requestId = events.find((event) => event.type === 'started')?.requestId ?? 'sb-1';
    worker?.emit({
      schemaVersion: 7,
      type: 'season-block-complete',
      requestId,
      result: { status: 'committed', checkpoint: makeCandidate(run) },
    });
    await flush();
    const changedRun: SeasonRun = {
      ...run,
      rosters: [...run.rosters].reverse(),
      cursor: { schemaVersion: 1, completedRounds: 10 },
    };
    const changedEffects = buildZeroEffects(changedRun);
    const firstPair = changedEffects.pairStates[0];
    if (firstPair === undefined) throw new Error('fixture has no chemistry pair');
    changedEffects.pairStates[0] = { ...firstPair, sharedPossessions: 77 };
    runner.startBlock(
      startInput(changedRun, {
        effects: changedEffects,
        blockIndex: 1,
        expectedRevision: 1,
        commandId: commandIdSchema.parse('cmd-2'),
      }),
    );
    await flush();
    const reset = seasonWorkerStartRequestSchema.parse(worker?.posted[1]);
    expect(reset.type).toBe('season-block-start');
    expect(reset.priorEffects).toEqual(changedEffects);
    expect(reset.priorHealth).toEqual(changedRun.health);
    expect(reset.priorSummaries).toBeDefined();
  });
  it('rejects a candidate whose expected state facts do not match the run', async () => {
    const run = makeRun();
    const repository = makeRepository(run);
    const runner = createSeasonBlockRunner({
      repository,
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
    const candidate = makeCandidate(run, { expectedStateRevision: 5 });
    worker?.emit({
      schemaVersion: 7,
      type: 'season-block-complete',
      requestId,
      result: { status: 'committed', checkpoint: candidate },
    });
    await flush();
    expect(repositoryMocks(repository).commitSeasonBlock).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'error')).toBe(true);
  });
  it('persists an invalid-roster interruption and emits the typed event', async () => {
    const run = makeRun();
    const repository = makeRepository(run);
    const runner = createSeasonBlockRunner({
      repository,
      schedule,
      workerUrl: 'fake-worker.ts',
      artifacts,
    });
    const events: Array<{
      type: string;
      requestId?: string;
      blockIndex?: number;
      snapshot?: SeasonRunSnapshot;
    }> = [];
    runner.subscribe((event) => events.push(event));
    runner.startBlock(startInput(run));
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    const started = events.find((event) => event.type === 'started');
    const requestId = started?.requestId ?? 'sb-1';
    const pending = makePending(run);
    worker?.emit({
      schemaVersion: 7,
      type: 'season-block-complete',
      requestId,
      result: { status: 'interrupted', pending },
    });
    await flush();
    expect(repositoryMocks(repository).savePendingBlock).toHaveBeenCalledTimes(1);
    const call = repository.savePendingBlock.mock.calls[0] ?? [];
    const savedPending = call[0] as {
      nextGameId: string;
    };
    const interruption = call[1] as {
      code: string;
      runId: string;
      blockIndex: number;
      nextGameId: string;
      humanFranchiseId: string;
      unavailablePlayerVersionIds: string[];
    };
    expect(savedPending.nextGameId).toBe('s000016');
    expect(interruption).toMatchObject({
      code: 'invalid-roster',
      runId: run.runId,
      blockIndex: 0,
      nextGameId: seasonGameIdSchema.parse('s000016'),
      humanFranchiseId: franchiseIdSchema.parse('lakers'),
    });
    const expectedAvailability = seasonFranchiseLegalFiveFacts(
      run,
      franchiseIdSchema.parse('lakers'),
      pending.health,
    );
    expect(interruption.unavailablePlayerVersionIds).toEqual(
      expectedAvailability.unavailablePlayerVersionIds,
    );
    const interrupted = events.find((event) => event.type === 'interrupted');
    expect(interrupted).toBeDefined();
    expect(interrupted?.blockIndex).toBe(0);
    expect(events.some((event) => event.type === 'complete')).toBe(false);
  });
});
