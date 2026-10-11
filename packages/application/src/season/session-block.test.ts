import { describe, expect, it, vi } from 'vitest';
import {
  SEASON_BLOCK_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_NEUTRAL_HOME_COURT,
  commandIdSchema,
  franchiseIdSchema,
  idSchema,
  seasonGameIdSchema,
  seasonPendingBlockCandidateSchema,
  seedSchema,
  type SeasonBlockRecap,
  type SeasonCandidateCheckpoint,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonInvalidRosterInterruption,
  type SeasonPendingBlockCandidate,
  type SeasonRun,
  type SeasonSchedule,
  type SeasonStandings,
  type SeasonSubmitBlockCommand,
} from '@hoop-rush/data-contracts';
import type { CommitSeasonBlockInput, SeasonRunSnapshot } from '@hoop-rush/persistence';
import { generateSeasonSchedule, seasonCheckpointDigest } from '@hoop-rush/engine';
import { seasonRotationSetDigest } from '@hoop-rush/engine';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import { SeasonSession } from './session.ts';
import type {
  SeasonBlockResumeInput,
  SeasonBlockRunner,
  SeasonBlockStartInput,
  SeasonRunnerEvent,
} from './block-wire.ts';
import type { SeasonAssetPort, SeasonRunAnnouncement, SeasonRunRepositoryPort } from './ports.ts';

const LEAGUE = buildSeasonLeague({}, { humanFranchiseId: franchiseIdSchema.parse('lakers') });
const HUMAN = franchiseIdSchema.parse('lakers');
let schedule: SeasonSchedule;
let run: SeasonRun;

function buildZeroEffects(target: SeasonRun): SeasonEffectsState {
  const playerStates = target.rosters.flatMap((roster) =>
    roster.players.map((player) => ({
      playerVersionId: player.playerVersionId,
      fatigueBasisPoints: 0,
      recentLoadBasisPoints: 0,
      lastCompletedRound: 0,
    })),
  );
  const pairStates: SeasonEffectsState['pairStates'] = [];
  for (const roster of target.rosters) {
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

function snapshotOf(
  target: SeasonRun,
  effects: SeasonEffectsState,
  acceptedBlocks: SeasonRunSnapshot['acceptedBlocks'] = [],
  summaries: SeasonGameSummary[] = [],
): SeasonRunSnapshot {
  return {
    run: target,
    summaries,
    retainedDetails: [],
    acceptedBlocks,
    effects,
  };
}

function makeCandidate(
  target: SeasonRun,
  partial: Partial<SeasonCandidateCheckpoint> = {},
): SeasonCandidateCheckpoint {
  const home = target.rosters[0];
  const away = target.rosters[1];
  if (home === undefined || away === undefined) throw new Error('fixture rosters missing');
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
    rows: target.league.teams.map((team) => ({
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
      headToHead: target.league.teams
        .filter((other) => other.franchiseId !== team.franchiseId)
        .map((other) => ({ franchiseId: other.franchiseId, wins: 0, losses: 0 })),
    })),
  };
  const teamAggregates = target.league.teams.map((team) => ({
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
  const playerAggregates = target.rosters.flatMap((roster) =>
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
    runId: target.runId,
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
    runId: target.runId,
    rootSeed: target.rootSeed,
    versions: target.versions,
    blockIndex: 0,
    completedRounds: 10,
    revision: 0,
    rotationDigest: seasonRotationSetDigest(target.rotations),
    standings,
    teamAggregates,
    playerAggregates,
    gameSummaries: [gameSummary],
    retainedDetails: [],
    recap,
    effects: buildZeroEffects(target),
    health: { schemaVersion: 1, healthVersion: 'season-health-v2', injuries: [] },
    influence: target.influence,
    freeAgency: target.freeAgency,
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
    expectedStateRevision: target.stateRevision,
    expectedStateDigest: target.stateDigest,
    stateRevision: target.stateRevision + 1,
    stateDigest: 'c'.repeat(32),
    digest: '0'.repeat(32),
    ...partial,
  };
  const digest = seasonCheckpointDigest(base);
  return { ...base, digest };
}

function makePending(target: SeasonRun): SeasonPendingBlockCandidate {
  return seasonPendingBlockCandidateSchema.parse({
    schemaVersion: 1,
    blockVersion: 'season-block-v7',
    runId: target.runId,
    commandId: commandIdSchema.parse('cmd-1'),
    blockIndex: 0,
    expectedRevision: 0,
    expectedStateRevision: target.stateRevision,
    expectedStateDigest: target.stateDigest,
    objectiveId: null,
    nextGameId: seasonGameIdSchema.parse('s000016'),
    summaries: [],
    retainedDetails: [],
    effects: buildZeroEffects(target),
    health: { schemaVersion: 1, healthVersion: 'season-health-v2', injuries: [] },
    standings: target.standings,
    teamAggregates: [],
    playerAggregates: [],
    rotationDigest: seasonRotationSetDigest(target.rotations),
  });
}

function startInput(partial: Partial<SeasonBlockStartInput> = {}): SeasonBlockStartInput {
  return {
    run,
    effects: buildZeroEffects(run),
    rotations: run.rotations,
    blockIndex: 0,
    expectedRevision: 0,
    rotationDigest: seasonRotationSetDigest(run.rotations),
    commandId: commandIdSchema.parse('cmd-1'),
    humanFranchiseId: HUMAN,
    objectiveId: null,
    homeCourt: SEASON_NEUTRAL_HOME_COURT,
    catalogUrl: 'https://example.test/season/draft-catalog.json',
    catalogHash: '0'.repeat(64),
    profileUrl: 'https://example.test/season/era-sim.json',
    profileHash: '0'.repeat(64),
    ...partial,
  };
}

function submitCommand(start: SeasonBlockStartInput): SeasonSubmitBlockCommand {
  return {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    blockVersion: SEASON_BLOCK_VERSION,
    command: 'submit-season-block',
    commandId: start.commandId,
    runId: idSchema.parse(run.runId),
    expectedRevision: start.expectedRevision,
    blockIndex: start.blockIndex,
    rotationDigest: start.rotationDigest,
    objectiveId: null,
    expectedStateRevision: start.run.stateRevision,
    expectedStateDigest: start.run.stateDigest,
  };
}

class FakeRunner implements SeasonBlockRunner {
  startCalls: SeasonBlockStartInput[] = [];
  resumeCalls: SeasonBlockResumeInput[] = [];
  cancelCalls: string[] = [];
  terminateCalls = 0;
  private readonly listeners = new Set<(event: SeasonRunnerEvent) => void>();
  private lastBlockIndex = 0;
  startBlock(input: SeasonBlockStartInput): string {
    this.startCalls.push(input);
    this.lastBlockIndex = input.blockIndex;
    const requestId = `fake-${String(this.startCalls.length)}`;
    this.emit({ type: 'started', requestId, blockIndex: input.blockIndex });
    return requestId;
  }
  resumeBlock(input: SeasonBlockResumeInput): string {
    this.resumeCalls.push(input);
    this.lastBlockIndex = input.blockIndex;
    const requestId = `resume-${String(this.resumeCalls.length)}`;
    this.emit({ type: 'started', requestId, blockIndex: input.blockIndex });
    return requestId;
  }
  cancel(requestId: string): void {
    this.cancelCalls.push(requestId);
  }
  terminate(): void {
    this.terminateCalls += 1;
  }
  prewarm(): void {}
  subscribe(listener: (event: SeasonRunnerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(event: SeasonRunnerEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

type MockRepository = ReturnType<typeof makeRepository>;

function makeRepository(initial: SeasonRunSnapshot | null) {
  let active = initial;
  const loadActiveRun = vi.fn<() => Promise<SeasonRunSnapshot | null>>(() =>
    Promise.resolve(active),
  );
  const commitSeasonBlock = vi.fn<(input: CommitSeasonBlockInput) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const savePendingBlock = vi.fn<
    (
      pending: SeasonPendingBlockCandidate,
      interruption: SeasonInvalidRosterInterruption,
    ) => Promise<void>
  >(() => Promise.resolve());
  const loadPendingBlock = vi.fn<(runId: string) => Promise<SeasonPendingBlockCandidate | null>>(
    () => Promise.resolve(null),
  );
  const repository = {
    loadActiveRunIndex: vi.fn(() => Promise.resolve(null)),
    loadActiveRun,
    loadBlockSummaries: vi.fn(() => Promise.resolve([])),
    loadRetainedDetails: vi.fn(() => Promise.resolve([])),
    loadBlockHistory: vi.fn(() => Promise.resolve([])),
    commitSeasonBlock,
    promoteSeasonDraftToRun: vi.fn(() => Promise.resolve(undefined)),
    clearSeasonRun: vi.fn((runId: string) => {
      if (runId === active?.run.runId) active = null;
      return Promise.resolve(undefined);
    }),
    forceClearActiveSeasonRun: vi.fn(() => {
      active = null;
      return Promise.resolve(undefined);
    }),
    savePendingBlock,
    loadPendingBlock,
    loadPendingInterruption: vi.fn(() => Promise.resolve(null)),
    discardPendingBlock: vi.fn(() => Promise.resolve(undefined)),
    applySeasonRunCommand: vi.fn(() => Promise.resolve(undefined)),
    loadSeasonRunPlayerSlice: vi.fn(() => Promise.resolve(null)),
    upsertSeasonRunPlayerSlice: vi.fn(() => Promise.resolve(undefined)),
    commitPostseasonAdvancement: vi.fn(() => Promise.resolve(undefined)),
    loadPostseasonSummaries: vi.fn(() => Promise.resolve([])),
    loadPostseasonSummary: vi.fn(() => Promise.resolve(null)),
    loadPostseasonDetails: vi.fn(() => Promise.resolve([])),
    loadCommandLog: vi.fn(() => Promise.resolve(null)),
    promoteChampionToCompleted: vi.fn(() => Promise.resolve(undefined)),
    loadCompletedSeason: vi.fn(() => Promise.resolve(null)),
    listCompletedSeasonRuns: vi.fn(() => Promise.resolve([])),
    deleteCompletedSeason: vi.fn(() => Promise.resolve(undefined)),
    buildReplayExport: vi.fn(() => Promise.resolve(null)),
  } satisfies SeasonRunRepositoryPort;
  return { ...repository, commitSeasonBlock, savePendingBlock, loadPendingBlock, loadActiveRun };
}

function zeroSchedule(): Promise<SeasonSchedule> {
  return Promise.resolve(schedule);
}

function createSession(
  repository: MockRepository,
  runner: FakeRunner,
  announcements: SeasonRunAnnouncement[] = [],
): SeasonSession {
  const assets: SeasonAssetPort = {
    loadEraProfile: () => Promise.reject(new Error('the era profile is unavailable')),
    loadDraftCatalog: () => Promise.reject(new Error('the draft catalog is unavailable')),
    loadFreeAgencyIndex: () => Promise.reject(new Error('the free-agency index is unavailable')),
    loadFreeAgencyTargets: () =>
      Promise.reject(new Error('the free-agency targets are unavailable')),
    loadHomeCourtProfile: () => Promise.resolve({ ...SEASON_NEUTRAL_HOME_COURT }),
    loadArtifactUrls: () =>
      Promise.resolve({
        catalogUrl: 'https://example.test/season/draft-catalog.json',
        catalogHash: '0'.repeat(64),
        profileUrl: 'https://example.test/season/era-sim.json',
        profileHash: '0'.repeat(64),
      }),
    loadSchedule: () => zeroSchedule(),
  };
  return new SeasonSession({
    repository,
    blockRunner: runner,
    assets,
    notifier: {
      announce: (mutation) => {
        announcements.push(mutation);
      },
      onMutation: () => () => {},
      close: () => {},
    },
    clock: { now: () => 0, sleep: () => Promise.resolve() },
    ids: { id: (prefix) => `${prefix}-test-1` },
    draftCleaner: { clearDraftSave: () => Promise.resolve() },
  });
}

async function withSession(
  setup: (fixture: {
    session: SeasonSession;
    runner: FakeRunner;
    repository: MockRepository;
    announcements: SeasonRunAnnouncement[];
  }) => Promise<void>,
  initial?: SeasonRunSnapshot | null,
): Promise<void> {
  schedule = generateSeasonSchedule({ league: LEAGUE, seed: seedSchema.parse('a'.repeat(32)) });
  run = buildSeasonRunFixture({ schedule, stateDigest: 'a'.repeat(32) });
  const repository = makeRepository(
    initial === undefined ? snapshotOf(run, buildZeroEffects(run)) : initial,
  );
  const runner = new FakeRunner();
  const announcements: SeasonRunAnnouncement[] = [];
  const session = createSession(repository, runner, announcements);
  try {
    if (initial === undefined) await session.refresh();
    await setup({ session, runner, repository, announcements });
  } finally {
    session.destroy();
  }
}

describe('SeasonSession block candidate acceptance', () => {
  it('commits an accepted candidate atomically then publishes the snapshot', async () => {
    await withSession(async ({ session, runner, repository, announcements }) => {
      session.startBlock({ command: submitCommand(startInput()), start: startInput() });
      await vi.waitFor(() => {
        expect(runner.startCalls).toHaveLength(1);
      });
      expect(runner.startCalls[0]?.knownSummaries).toEqual([]);
      const candidate = makeCandidate(run);
      runner.emit({ type: 'candidate', requestId: 'fake-1', blockIndex: 0, checkpoint: candidate });
      await vi.waitFor(() => {
        expect(repository.commitSeasonBlock).toHaveBeenCalledTimes(1);
      });
      await vi.waitFor(() => {
        expect(session.block.phase).toBe('idle');
      });

      const commit = repository.commitSeasonBlock.mock.calls[0]?.[0] as CommitSeasonBlockInput;
      expect(commit).toMatchObject({
        runId: run.runId,
        revision: 1,
        commandId: 'cmd-1',
        rotationDigest: startInput().rotationDigest,
        expectedStateRevision: run.stateRevision,
        expectedStateDigest: run.stateDigest,
        window: null,
      });
      expect(commit.summaries).toEqual(candidate.gameSummaries);
      expect(commit.stateDigest).toMatch(/^[0-9a-f]{32}$/);
      expect(commit.checkpointState).toMatchObject({ runId: run.runId, blockIndex: 0 });
      expect(session.snapshot?.acceptedBlocks).toHaveLength(1);
      expect(session.snapshot?.summaries).toEqual(candidate.gameSummaries);
      expect(session.snapshot?.run.cursor.completedRounds).toBe(10);
      expect(session.pending).toBeNull();
      expect(session.interruption).toBeNull();
      expect(announcements).toContainEqual({
        kind: 'commit',
        runId: run.runId,
        revision: 1,
        committedAt: 0,
      });
      expect(session.nextBlockIndex()).toBe(1);
    });
  });

  it('feeds the committed summaries into the next start request', async () => {
    await withSession(async ({ session, runner, repository }) => {
      session.startBlock({ command: submitCommand(startInput()), start: startInput() });
      await vi.waitFor(() => {
        expect(runner.startCalls).toHaveLength(1);
      });
      const candidate = makeCandidate(run);
      runner.emit({ type: 'candidate', requestId: 'fake-1', blockIndex: 0, checkpoint: candidate });
      await vi.waitFor(() => {
        expect(repository.commitSeasonBlock).toHaveBeenCalledTimes(1);
      });
      await vi.waitFor(() => {
        expect(session.block.phase).toBe('idle');
      });

      const next = startInput({
        blockIndex: 1,
        expectedRevision: 1,
        commandId: commandIdSchema.parse('cmd-2'),
      });
      session.startBlock({ command: submitCommand(next), start: next });
      await vi.waitFor(() => {
        expect(runner.startCalls).toHaveLength(2);
      });
      expect(runner.startCalls[1]?.knownSummaries).toEqual(candidate.gameSummaries);
    });
  });

  it('rejects a digest mismatch with invariant-failure without committing', async () => {
    await withSession(async ({ session, runner, repository }) => {
      session.startBlock({ command: submitCommand(startInput()), start: startInput() });
      await vi.waitFor(() => {
        expect(runner.startCalls).toHaveLength(1);
      });
      runner.emit({
        type: 'candidate',
        requestId: 'fake-1',
        blockIndex: 0,
        checkpoint: { ...makeCandidate(run), digest: 'f'.repeat(32) },
      });
      await vi.waitFor(() => {
        expect(session.block.phase).toBe('failed');
      });
      expect(session.block.error?.code).toBe('invariant-failure');
      expect(session.block.error?.message).toContain('candidate digest does not verify');
      expect(repository.commitSeasonBlock).not.toHaveBeenCalled();
      expect(session.snapshot?.acceptedBlocks).toHaveLength(0);
    });
  });

  it('rejects a candidate whose expected state facts do not match the run', async () => {
    await withSession(async ({ session, runner, repository }) => {
      session.startBlock({ command: submitCommand(startInput()), start: startInput() });
      await vi.waitFor(() => {
        expect(runner.startCalls).toHaveLength(1);
      });
      runner.emit({
        type: 'candidate',
        requestId: 'fake-1',
        blockIndex: 0,
        checkpoint: makeCandidate(run, { expectedStateRevision: 5 }),
      });
      await vi.waitFor(() => {
        expect(session.block.phase).toBe('failed');
      });
      expect(session.block.error?.code).toBe('invariant-failure');
      expect(repository.commitSeasonBlock).not.toHaveBeenCalled();
    });
  });

  it('surfaces a commit rejection as internal without publishing', async () => {
    await withSession(async ({ session, runner, repository }) => {
      repository.commitSeasonBlock.mockRejectedValueOnce(new Error('atomic write failed'));
      session.startBlock({ command: submitCommand(startInput()), start: startInput() });
      await vi.waitFor(() => {
        expect(runner.startCalls).toHaveLength(1);
      });
      runner.emit({
        type: 'candidate',
        requestId: 'fake-1',
        blockIndex: 0,
        checkpoint: makeCandidate(run),
      });
      await vi.waitFor(() => {
        expect(session.block.phase).toBe('failed');
      });
      expect(session.block.error).toMatchObject({
        code: 'internal',
        message: 'checkpoint commit failed: atomic write failed',
        seed: run.rootSeed,
      });
      expect(session.snapshot?.acceptedBlocks).toHaveLength(0);
      expect(session.snapshot?.summaries).toEqual([]);
    });
  });

  it('drops a late candidate after cancel without committing', async () => {
    await withSession(async ({ session, runner, repository }) => {
      session.startBlock({ command: submitCommand(startInput()), start: startInput() });
      await vi.waitFor(() => {
        expect(runner.startCalls).toHaveLength(1);
      });
      session.cancel();
      expect(runner.cancelCalls).toEqual(['fake-1']);
      runner.emit({
        type: 'candidate',
        requestId: 'fake-1',
        blockIndex: 0,
        checkpoint: makeCandidate(run),
      });
      await vi.waitFor(() => {
        expect(session.block.phase).toBe('cancelled');
      });
      expect(repository.commitSeasonBlock).not.toHaveBeenCalled();
      expect(session.snapshot?.acceptedBlocks).toHaveLength(0);
    });
  });

  it('drops an in-flight acceptance when cancel lands before the commit resolves', async () => {
    await withSession(async ({ session, runner, repository }) => {
      let resolveCommit: () => void = () => {};
      const deferred = new Promise<void>((resolve) => {
        resolveCommit = resolve;
      });
      repository.commitSeasonBlock.mockImplementationOnce(() => deferred);
      session.startBlock({ command: submitCommand(startInput()), start: startInput() });
      await vi.waitFor(() => {
        expect(runner.startCalls).toHaveLength(1);
      });
      runner.emit({
        type: 'candidate',
        requestId: 'fake-1',
        blockIndex: 0,
        checkpoint: makeCandidate(run),
      });
      await vi.waitFor(() => {
        expect(repository.commitSeasonBlock).toHaveBeenCalledTimes(1);
      });
      session.cancel();
      resolveCommit();
      await vi.waitFor(() => {
        expect(session.block.phase).toBe('cancelled');
      });
      expect(session.snapshot?.acceptedBlocks).toHaveLength(0);
    });
  });
});

describe('SeasonSession block start reconciliation', () => {
  it('rejects a stale cursor before starting the worker', async () => {
    await withSession(async ({ session, runner }) => {
      const stale = startInput({ expectedRevision: 3 });
      session.startBlock({ command: submitCommand(stale), start: stale });
      await vi.waitFor(() => {
        expect(session.block.phase).toBe('failed');
      });
      expect(session.block.error?.message).toBe(
        'stale cursor: the run is at revision 0, command expects 3',
      );
      expect(runner.startCalls).toHaveLength(0);
    });
  });

  it('rejects a duplicate command before starting the worker', async () => {
    await withSession(async ({ session, runner }) => {
      const first = startInput();
      session.startBlock({ command: submitCommand(first), start: first });
      await vi.waitFor(() => {
        expect(runner.startCalls).toHaveLength(1);
      });
      const candidate = makeCandidate(run);
      runner.emit({ type: 'candidate', requestId: 'fake-1', blockIndex: 0, checkpoint: candidate });
      await vi.waitFor(() => {
        expect(session.block.phase).toBe('idle');
      });
      const duplicate = startInput({
        blockIndex: 1,
        expectedRevision: 1,
        commandId: first.commandId,
      });
      session.startBlock({ command: submitCommand(duplicate), start: duplicate });
      await vi.waitFor(() => {
        expect(session.block.phase).toBe('failed');
      });
      expect(session.block.error?.message).toBe('duplicate command cmd-1');
      expect(runner.startCalls).toHaveLength(1);
    });
  });

  it('rejects a non-boundary block before starting the worker', async () => {
    await withSession(async ({ session, runner }) => {
      const nonBoundary = startInput({
        blockIndex: 1,
        expectedRevision: 0,
        commandId: commandIdSchema.parse('cmd-2'),
      });
      session.startBlock({ command: submitCommand(nonBoundary), start: nonBoundary });
      await vi.waitFor(() => {
        expect(session.block.phase).toBe('failed');
      });
      expect(session.block.error?.message).toBe(
        'non-boundary block: the run expects 0, command submits 1',
      );
      expect(runner.startCalls).toHaveLength(0);
    });
  });

  it('rejects a rotation digest that does not match the submitted rotations', async () => {
    await withSession(async ({ session, runner }) => {
      const mismatch = startInput({ rotationDigest: 'f'.repeat(32) });
      session.startBlock({ command: submitCommand(mismatch), start: mismatch });
      await vi.waitFor(() => {
        expect(session.block.phase).toBe('failed');
      });
      expect(session.block.error?.message).toBe(
        'rotation digest does not match the submitted rotations',
      );
      expect(runner.startCalls).toHaveLength(0);
    });
  });

  it('fails a start when no active run is persisted', async () => {
    await withSession(async ({ session, runner }) => {
      session.startBlock({ command: submitCommand(startInput()), start: startInput() });
      await vi.waitFor(() => {
        expect(session.block.phase).toBe('failed');
      });
      expect(session.block.error?.message).toBe('no active season run to advance');
      expect(runner.startCalls).toHaveLength(0);
    }, null);
  });
});

describe('SeasonSession block interruption persistence', () => {
  it('persists the merged pending candidate and sets the interrupted state', async () => {
    await withSession(async ({ session, runner, repository }) => {
      session.startBlock({ command: submitCommand(startInput()), start: startInput() });
      await vi.waitFor(() => {
        expect(runner.startCalls).toHaveLength(1);
      });
      const pending = makePending(run);
      runner.emit({
        type: 'interrupted',
        requestId: 'fake-1',
        runId: run.runId,
        blockIndex: 0,
        pending,
      });
      await vi.waitFor(() => {
        expect(session.block.phase).toBe('interrupted');
      });
      expect(repository.savePendingBlock).toHaveBeenCalledTimes(1);
      const call = repository.savePendingBlock.mock.calls[0] ?? [];
      expect(call[0]).toEqual(pending);
      expect(call[1]).toMatchObject({
        code: 'invalid-roster',
        runId: run.runId,
        blockIndex: 0,
        nextGameId: 's000016',
        humanFranchiseId: HUMAN,
      });
      expect(session.pending).toEqual(pending);
      expect(session.interruption?.code).toBe('invalid-roster');
      expect(session.commandError).toBeNull();
      expect(repository.commitSeasonBlock).not.toHaveBeenCalled();
    });
  });

  it('surfaces an interruption persistence failure as internal', async () => {
    await withSession(async ({ session, runner, repository }) => {
      repository.savePendingBlock.mockRejectedValueOnce(new Error('pending write failed'));
      session.startBlock({ command: submitCommand(startInput()), start: startInput() });
      await vi.waitFor(() => {
        expect(runner.startCalls).toHaveLength(1);
      });
      runner.emit({
        type: 'interrupted',
        requestId: 'fake-1',
        runId: run.runId,
        blockIndex: 0,
        pending: makePending(run),
      });
      await vi.waitFor(() => {
        expect(session.block.phase).toBe('failed');
      });
      expect(session.block.error).toMatchObject({
        code: 'internal',
        message: 'interruption persistence failed: pending write failed',
        seed: run.rootSeed,
      });
      expect(session.pending).toBeNull();
      expect(session.interruption).toBeNull();
    });
  });

  it('resumes from the stored pending candidate facts', async () => {
    await withSession(async ({ session, runner, repository }) => {
      const pending = makePending(run);
      repository.loadPendingBlock.mockResolvedValueOnce(pending);
      session.pending = pending;
      await session.resumeBlock();
      await vi.waitFor(() => {
        expect(runner.resumeCalls).toHaveLength(1);
      });
      const input = runner.resumeCalls[0];
      expect(input?.run).toEqual(run);
      expect(input?.effects).toEqual(buildZeroEffects(run));
      expect(input?.pending).toEqual(pending);
      expect(input?.knownSummaries).toEqual([]);
      expect(input?.rotationDigest).toBe(seasonRotationSetDigest(run.rotations));
      expect(session.block.phase).toBe('running');
    });
  });

  it('fails a resume when no pending block is stored', async () => {
    await withSession(async ({ session, runner, repository }) => {
      const pending = makePending(run);
      repository.loadPendingBlock.mockResolvedValueOnce(null);
      session.pending = pending;
      await session.resumeBlock();
      await vi.waitFor(() => {
        expect(session.block.phase).toBe('failed');
      });
      expect(session.block.error?.message).toBe(`no pending block for run ${run.runId}`);
      expect(runner.resumeCalls).toHaveLength(0);
    });
  });
});
