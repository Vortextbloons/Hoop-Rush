import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommitSeasonBlockInput, SeasonRunRepository } from '@hoop-rush/persistence';
import {
  SEASON_NEUTRAL_HOME_COURT,
  seasonWorkerCancelRequestSchema,
  seasonWorkerStartRequestSchema,
  type SeasonBlockRecap,
  type SeasonCandidateCheckpoint,
  type SeasonGameSummary,
  type SeasonPendingBlockCandidate,
  type SeasonRun,
  type SeasonSchedule,
  type SeasonStandings,
} from '@hoop-rush/data-contracts';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import { createSeasonBlockRunner, type SeasonBlockStartInput } from './season-block-runner';

/**
 * Season block runner unit tests (M2.5): the wire round-trip through the
 * frozen envelopes (start requests parse as schema 4 with the M2.5 fields,
 * complete messages accept committed and interrupted results), the cancel
 * schema-version fix, and the acceptance/commit orchestration (expected
 * state facts validated against the run, `completeSeasonBlockCommit` fold,
 * atomic commit input, interruption persistence). The engine module is
 * mocked because the health/economy workstreams have not landed their
 * exports yet; the mock returns the documented engine semantics so the
 * runner's orchestration is exercised end to end.
 */

const LEAGUE = buildSeasonLeague({}, { humanFranchiseId: 'lakers' });

vi.mock('@hoop-rush/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@hoop-rush/engine')>()),
  completeSeasonBlockCommit: vi.fn(
    (input: {
      run: SeasonRun;
      candidate: SeasonCandidateCheckpoint;
      commandId: string;
      rotationDigest: string;
      humanFranchiseId: string | null;
    }) => ({
      checkpointState: {
        runId: input.run.runId,
        blockIndex: input.candidate.blockIndex,
        completedRounds: input.candidate.completedRounds,
        revision: input.candidate.revision,
        commandId: input.commandId,
        rotationDigest: input.rotationDigest,
        checkpointDigest: input.candidate.digest,
      },
      stateRevision: input.run.stateRevision + 1,
      stateDigest: 'c'.repeat(32),
      window: null,
    }),
  ),
  seasonFranchiseLegalFiveFacts: vi.fn(() => ({
    legal: false,
    unavailablePlayerVersionIds: ['pv-' + '1'.repeat(32)],
  })),
  seasonCheckpointDigest: vi.fn((candidate: SeasonCandidateCheckpoint) => candidate.digest),
}));

import {
  generateSeasonSchedule,
  seasonCheckpointDigest,
  seasonRotationSetDigest,
} from '@hoop-rush/engine';

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: unknown[] = [];
  private listeners: Array<(event: MessageEvent<unknown>) => void> = [];

  constructor(
    public url: string,
    public options?: { type?: string },
  ) {
    FakeWorker.instances.push(this);
  }

  postMessage(data: unknown): void {
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
        0: { objectiveId: 'win-six' as const, selectedByCommandId: 'cmd-select-0', success: null },
      },
    },
  };
}

/** Schema-valid zero effects state (300 loads, 1,350 pairs). */
function buildZeroEffects(run: SeasonRun): {
  schemaVersion: 1;
  playerStates: Array<{
    playerVersionId: string;
    fatigueBasisPoints: number;
    recentLoadBasisPoints: number;
    lastCompletedRound: number;
  }>;
  pairStates: Array<{ a: string; b: string; sharedPossessions: number }>;
} {
  const playerStates = run.rosters.flatMap((roster) =>
    roster.players.map((player) => ({
      playerVersionId: player.playerVersionId,
      fatigueBasisPoints: 0,
      recentLoadBasisPoints: 0,
      lastCompletedRound: 0,
    })),
  );
  const pairStates: Array<{ a: string; b: string; sharedPossessions: number }> = [];
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
  return { schemaVersion: 1, playerStates, pairStates };
}

type MockRepository = SeasonRunRepository & {
  commitSeasonBlock: ReturnType<typeof vi.fn>;
  savePendingBlock: ReturnType<typeof vi.fn>;
  loadPendingBlock: ReturnType<typeof vi.fn>;
};

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
    savePendingBlock: vi.fn(() => Promise.resolve(undefined)),
    loadPendingBlock: vi.fn(() => Promise.resolve(null)),
    discardPendingBlock: vi.fn(() => Promise.resolve(undefined)),
    applySeasonRunCommand: vi.fn(() => Promise.resolve(undefined)),
  };
  return repository;
}

let schedule: SeasonSchedule;

function startInput(
  run: SeasonRun,
  partial: Partial<SeasonBlockStartInput> = {},
): SeasonBlockStartInput {
  return {
    run,
    rotations: run.rotations,
    blockIndex: 0,
    expectedRevision: 0,
    rotationDigest: rotationDigest(run),
    commandId: 'cmd-1',
    humanFranchiseId: 'lakers',
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
    franchiseId,
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
    gameId: 's000001',
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
    recapVersion: 'season-recap-v3',
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
    influenceBalance: { humanBalance: 2 },
  };
  const base: SeasonCandidateCheckpoint = {
    schemaVersion: 1,
    checkpointVersion: 'season-checkpoint-v3',
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
    health: { schemaVersion: 1, healthVersion: 'season-health-v1', injuries: [] },
    influence: run.influence,
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
  return { ...base, digest: seasonCheckpointDigest(base) };
}

function makePending(run: SeasonRun, nextGameId = 's000016'): SeasonPendingBlockCandidate {
  return {
    schemaVersion: 1,
    blockVersion: 'season-block-v3',
    runId: run.runId,
    commandId: 'cmd-1',
    blockIndex: 0,
    expectedRevision: 0,
    expectedStateRevision: 0,
    expectedStateDigest: 'a'.repeat(32),
    objectiveId: 'win-six',
    nextGameId,
    summaries: [],
    retainedDetails: [],
    effects: buildZeroEffects(run),
    health: { schemaVersion: 1, healthVersion: 'season-health-v1', injuries: [] },
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
    schedule = generateSeasonSchedule({ league: LEAGUE, seed: 'a'.repeat(32) });
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
    // The frozen wire envelope parses the posted payload (schema 4).
    const start = seasonWorkerStartRequestSchema.parse(raw);
    expect(start.schemaVersion).toBe(4);
    expect(start.runId).toBe(run.runId);
    expect(start.objectiveId).toBe('win-six');
    expect(start.startGameId).toBeNull();
    expect(start.priorHealth).toEqual({
      schemaVersion: 1,
      healthVersion: 'season-health-v1',
      injuries: [],
    });
    expect(start.commandId).toBe('cmd-1');
    expect(events.some((event) => event === 'started')).toBe(true);
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
      commandId: 'cmd-1',
      rotations: run.rotations,
      humanFranchiseId: 'lakers',
      homeCourt: SEASON_NEUTRAL_HOME_COURT,
      catalogUrl: 'u',
      catalogHash: '0'.repeat(64),
      profileUrl: 'p',
      profileHash: '0'.repeat(64),
    });
    await flush();

    expect(FakeWorker.instances).toHaveLength(1);
    const start = seasonWorkerStartRequestSchema.parse(FakeWorker.instances[0]?.posted[0]);
    expect(start.schemaVersion).toBe(4);
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
    expect(cancel.schemaVersion).toBe(4);
    expect(cancel.requestId).toBe(requestId);
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
    // A schema-3 complete message must be dropped (stale wire family).
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

  it('commits an accepted candidate through completeSeasonBlockCommit with the M2.5 input', async () => {
    const run = makeRun();
    const repository = makeRepository(run);
    const runner = createSeasonBlockRunner({
      repository,
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
    const started = events.find((event) => event.type === 'started');
    const requestId = started?.requestId ?? 'sb-1';
    const candidate = makeCandidate(run);
    worker?.emit({
      schemaVersion: 4,
      type: 'season-block-complete',
      requestId,
      result: { status: 'committed', checkpoint: candidate },
    });
    await flush();

    expect(events.some((event) => event.type === 'complete')).toBe(true);
    // The repository stub's methods carry an implicit 	his (interface method); the mock reference is fine here.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(repository.commitSeasonBlock).toHaveBeenCalledTimes(1);
    const input = repository.commitSeasonBlock.mock.calls[0]?.[0] as CommitSeasonBlockInput;
    expect(input).toMatchObject({
      runId: run.runId,
      revision: 1,
      commandId: 'cmd-1',
      rotationDigest: rotationDigest(run),
      expectedStateRevision: run.stateRevision,
      expectedStateDigest: run.stateDigest,
      stateRevision: run.stateRevision + 1,
      stateDigest: 'c'.repeat(32),
      window: null,
    });
    expect(input.health).toEqual(candidate.health);
    expect(input.transactions).toEqual([]);
    expect(input.objectives).toBeDefined();
    expect(input.checkpointState).toMatchObject({ runId: run.runId, blockIndex: 0 });
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
    const events: Array<{ type: string; requestId?: string }> = [];
    runner.subscribe((event) => events.push(event));
    runner.startBlock(startInput(run));
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    const started = events.find((event) => event.type === 'started');
    const requestId = started?.requestId ?? 'sb-1';
    const candidate = makeCandidate(run, { expectedStateRevision: 5 });
    worker?.emit({
      schemaVersion: 4,
      type: 'season-block-complete',
      requestId,
      result: { status: 'committed', checkpoint: candidate },
    });
    await flush();

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(repository.commitSeasonBlock).not.toHaveBeenCalled();
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
    const events: Array<{ type: string; blockIndex?: number; requestId?: string }> = [];
    runner.subscribe((event) => events.push(event));
    runner.startBlock(startInput(run));
    await flush();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    const started = events.find((event) => event.type === 'started');
    const requestId = started?.requestId ?? 'sb-1';
    const pending = makePending(run);
    worker?.emit({
      schemaVersion: 4,
      type: 'season-block-complete',
      requestId,
      result: { status: 'interrupted', pending },
    });
    await flush();

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(repository.savePendingBlock).toHaveBeenCalledTimes(1);
    const call = repository.savePendingBlock.mock.calls[0] ?? [];
    const savedPending = call[0] as { nextGameId: string };
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
      nextGameId: 's000016',
      humanFranchiseId: 'lakers',
    });
    expect(interruption.unavailablePlayerVersionIds).toEqual(['pv-' + '1'.repeat(32)]);
    const interrupted = events.find((event) => event.type === 'interrupted');
    expect(interrupted).toBeDefined();
    expect(interrupted?.blockIndex).toBe(0);
    // 'complete' is emitted only for committed blocks.
    expect(events.some((event) => event.type === 'complete')).toBe(false);
  });
});
