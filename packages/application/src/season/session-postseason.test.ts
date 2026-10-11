import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SEASON_NEUTRAL_HOME_COURT,
  SeasonRunCommandDuplicateError,
  commandIdSchema,
  franchiseIdSchema,
  postseasonGameIdSchema,
  seedSchema,
  type SeasonEffectsState,
  type SeasonRun,
  type SeasonPostseasonWorkerProgressMessage,
  type SeasonPostseasonWorkerStartRequest,
} from '@hoop-rush/data-contracts';
import {
  seasonPostseasonCommitResultDigest,
  type SeasonPostseasonJob,
  type SeasonPostseasonJobOutcome,
} from './postseason-wire.ts';
import type {
  CommitPostseasonAdvancementInput,
  PromoteChampionInput,
  SeasonRunSnapshot,
} from '@hoop-rush/persistence';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import { generateSeasonSchedule } from '@hoop-rush/engine';
import { SeasonSession, type SeasonSessionOptions } from './session.ts';
import type { SeasonAssetPort, SeasonRunRepositoryPort } from './ports.ts';

const postseasonFns = vi.hoisted(() => ({
  nextGame: vi.fn(),
  upcomingGames: vi.fn(() => [] as string[]),
  humanEliminated: vi.fn(() => false),
}));
vi.mock('@hoop-rush/engine', async (importOriginal) => {
  const original = await importOriginal<typeof import('@hoop-rush/engine')>();
  return {
    ...original,
    seasonPostseasonNextGame: postseasonFns.nextGame,
    seasonPostseasonUpcomingGames: postseasonFns.upcomingGames,
    seasonPostseasonHumanEliminated: postseasonFns.humanEliminated,
  };
});

const LEAGUE = buildSeasonLeague({}, { humanFranchiseId: franchiseIdSchema.parse('lakers') });
const HUMAN = franchiseIdSchema.parse('lakers');
const GAME_IDS = [
  'pi-east-seven-eight',
  'pi-east-nine-ten',
  'pi-west-seven-eight',
  'pi-west-nine-ten',
  'po-east-r1-g1',
  'po-east-r1-g2',
  'po-east-r1-g3',
  'po-east-r1-g4',
  'po-east-r1-g5',
  'po-east-r1-g6',
  'po-east-r1-g7',
] as const;

function gameId(id: string) {
  return postseasonGameIdSchema.parse(id);
}

class ProgrammableJob implements SeasonPostseasonJob {
  simulateCalls: SeasonPostseasonWorkerStartRequest[] = [];
  cancelCalls: string[] = [];
  terminateCalls = 0;
  prewarmCalls = 0;
  private readonly queued: SeasonPostseasonJobOutcome[] = [];
  private readonly pending: Array<{
    resolve: (outcome: SeasonPostseasonJobOutcome) => void;
  }> = [];
  private progress: ((progress: SeasonPostseasonWorkerProgressMessage) => void) | null = null;
  enqueue(outcome: SeasonPostseasonJobOutcome): void {
    const next = this.pending.shift();
    if (next === undefined) {
      this.queued.push(outcome);
      return;
    }
    next.resolve(outcome);
  }
  emitProgress(progress: SeasonPostseasonWorkerProgressMessage): void {
    this.progress?.(progress);
  }
  simulate(
    request: SeasonPostseasonWorkerStartRequest,
    onProgress?: (progress: SeasonPostseasonWorkerProgressMessage) => void,
  ): Promise<SeasonPostseasonJobOutcome> {
    this.simulateCalls.push(request);
    this.progress = onProgress ?? null;
    const queued = this.queued.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.pending.push({ resolve });
    });
  }
  cancel(requestId: string): void {
    this.cancelCalls.push(requestId);
  }
  terminate(): void {
    this.terminateCalls += 1;
  }
  prewarm(): void {
    this.prewarmCalls += 1;
  }
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

function snapshotOf(run: SeasonRun, effects: SeasonEffectsState): SeasonRunSnapshot {
  return {
    run,
    summaries: [],
    retainedDetails: [],
    acceptedBlocks: [],
    effects,
  };
}

function acceptedOutcome(
  run: SeasonRun,
  advancedGameIds: readonly string[],
  partial: {
    stage?: SeasonRun['stage'];
    nextDecision?: 'rotation' | 'none';
    nextGameId?: string | null;
    aiNextGameId?: string | null;
  } = {},
): SeasonPostseasonJobOutcome {
  const ids = advancedGameIds.map((id) => gameId(id));
  return {
    kind: 'accepted',
    result: {
      status: 'accepted',
      stage: partial.stage ?? run.stage,
      advancedGameIds: ids,
      summaries: [],
      run,
      nextDecision: partial.nextDecision ?? 'rotation',
      nextGameId:
        partial.nextGameId === undefined
          ? (ids[0] ?? null)
          : partial.nextGameId === null
            ? null
            : gameId(partial.nextGameId),
      aiNextGameId:
        partial.aiNextGameId === undefined
          ? null
          : partial.aiNextGameId === null
            ? null
            : gameId(partial.aiNextGameId),
    },
  };
}

function completedRun(base: SeasonRun): SeasonRun {
  const champion = franchiseIdSchema.parse(base.league.teams[0]?.franchiseId ?? 'lakers');
  return {
    ...base,
    stage: 'completed',
    postseason: { ...base.postseason, championFranchiseId: champion },
    completion: {
      championFranchiseId: champion,
      almanacDigest: 'a'.repeat(32),
      finalizedAtStateRevision: base.stateRevision,
    },
  };
}

function makeRepository(initial: SeasonRunSnapshot | null) {
  let active = initial;
  const commitCalls: CommitPostseasonAdvancementInput[] = [];
  const promoteCalls: unknown[] = [];
  const repository = {
    loadActiveRunIndex: vi.fn(() => Promise.resolve(null)),
    loadActiveRun: vi.fn(() => Promise.resolve(active)),
    loadBlockSummaries: vi.fn(() => Promise.resolve([])),
    loadRetainedDetails: vi.fn(() => Promise.resolve([])),
    loadBlockHistory: vi.fn(() => Promise.resolve([])),
    commitSeasonBlock: vi.fn(() => Promise.resolve(undefined)),
    promoteSeasonDraftToRun: vi.fn(() => Promise.resolve(undefined)),
    clearSeasonRun: vi.fn(() => Promise.resolve(undefined)),
    forceClearActiveSeasonRun: vi.fn(() => Promise.resolve(undefined)),
    savePendingBlock: vi.fn(() => Promise.resolve(undefined)),
    loadPendingBlock: vi.fn(() => Promise.resolve(null)),
    loadPendingInterruption: vi.fn(() => Promise.resolve(null)),
    discardPendingBlock: vi.fn(() => Promise.resolve(undefined)),
    applySeasonRunCommand: vi.fn(() => Promise.resolve(undefined)),
    loadSeasonRunPlayerSlice: vi.fn(() => Promise.resolve(null)),
    upsertSeasonRunPlayerSlice: vi.fn(() => Promise.resolve(undefined)),
    commitPostseasonAdvancement: vi.fn((input: CommitPostseasonAdvancementInput) => {
      commitCalls.push(input);
      if (active !== null) {
        active = { ...active, run: input.run };
      }
      return Promise.resolve();
    }),
    loadPostseasonSummaries: vi.fn(() => Promise.resolve([])),
    loadPostseasonSummary: vi.fn(() => Promise.resolve(null)),
    loadPostseasonDetails: vi.fn(() => Promise.resolve([])),
    loadCommandLog: vi.fn((runId: string) =>
      Promise.resolve({
        schemaVersion: 1 as const,
        commandLogVersion: 'command-log-v3' as const,
        runId,
        entries: [],
      }),
    ),
    promoteChampionToCompleted: vi.fn((input: PromoteChampionInput): Promise<void> => {
      promoteCalls.push(input);
      active = null;
      return Promise.resolve();
    }),
    loadCompletedSeason: vi.fn(() => Promise.resolve(null)),
    listCompletedSeasonRuns: vi.fn(() => Promise.resolve([])),
    deleteCompletedSeason: vi.fn(() => Promise.resolve(undefined)),
    buildReplayExport: vi.fn(() => Promise.resolve(null)),
  } satisfies SeasonRunRepositoryPort;
  return {
    repository,
    commitCalls,
    promoteCalls,
    active: () => active,
  };
}

interface Harness {
  session: SeasonSession;
  job: ProgrammableJob;
  commitCalls: CommitPostseasonAdvancementInput[];
  promoteCalls: unknown[];
  announcements: Array<{ kind: string; runId: string | null }>;
}

function createHarness(
  job: ProgrammableJob,
  repository: ReturnType<typeof makeRepository>,
  assetsOverrides: Partial<SeasonAssetPort> = {},
): Harness {
  const announcements: Array<{ kind: string; runId: string | null }> = [];
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
    loadSchedule: () => Promise.reject(new Error('the season schedule is unavailable')),
    ...assetsOverrides,
  };
  const options: SeasonSessionOptions = {
    repository: repository.repository,
    blockRunner: {
      startBlock: () => 'block-1',
      resumeBlock: () => 'block-resume-1',
      cancel: () => {},
      terminate: () => {},
      prewarm: () => {},
      subscribe: () => () => {},
    },
    postseasonJob: job,
    assets,
    notifier: {
      announce: (mutation) => {
        announcements.push(mutation);
      },
      onMutation: () => () => {},
      close: () => {},
    },
    clock: { now: () => 0, sleep: () => Promise.resolve() },
    ids: { id: (prefix: string): string => `${prefix}-test-${String(nextTestId())}` },
    draftCleaner: { clearDraftSave: () => Promise.resolve() },
  };
  return {
    session: new SeasonSession(options),
    job,
    commitCalls: repository.commitCalls,
    promoteCalls: repository.promoteCalls,
    announcements,
  };
}

let testIdCounter = 0;
function nextTestId(): number {
  testIdCounter += 1;
  return testIdCounter;
}

function playInRun(): SeasonRun {
  const schedule = generateSeasonSchedule({
    league: LEAGUE,
    seed: seedSchema.parse('a'.repeat(32)),
  });
  const base = buildSeasonRunFixture({ schedule, stateDigest: 'a'.repeat(32) });
  return { ...base, stage: 'play-in' };
}

beforeEach(() => {
  testIdCounter = 0;
  postseasonFns.nextGame.mockReset();
  postseasonFns.upcomingGames.mockReset().mockReturnValue([]);
  postseasonFns.humanEliminated.mockReset().mockReturnValue(false);
});

describe('SeasonSession postseason orchestration', () => {
  it('commits an accepted simulation atomically then publishes the reloaded snapshot', async () => {
    const run = playInRun();
    const effects = buildZeroEffects(run);
    const repository = makeRepository(snapshotOf(run, effects));
    const job = new ProgrammableJob();
    const harness = createHarness(job, repository);
    const session = harness.session;
    await session.refresh();
    postseasonFns.upcomingGames.mockReturnValue([...GAME_IDS.slice(0, 4)]);
    postseasonFns.nextGame.mockReturnValue({ kind: 'game', gameId: GAME_IDS[0] });
    job.enqueue(acceptedOutcome(run, [GAME_IDS[0]]));
    await session.advancePostseason();
    await vi.waitFor(() => {
      expect(session.postseason.phase).toBe('complete');
    });

    expect(job.simulateCalls).toHaveLength(1);
    const wire = job.simulateCalls[0];
    expect(wire).toMatchObject({
      type: 'season-postseason-start',
      runId: run.runId,
      rootSeed: run.rootSeed,
      expectedStateRevision: run.stateRevision,
      expectedStateDigest: run.stateDigest,
      humanFranchiseId: HUMAN,
      targetGameId: GAME_IDS[0],
      catalogUrl: 'https://example.test/season/draft-catalog.json',
    });
    expect(wire?.regularSeasonSummaries).toEqual([]);
    expect(wire?.commandId).toMatch(/^adv-test-/);

    expect(harness.commitCalls).toHaveLength(1);
    const commit = harness.commitCalls[0];
    expect(commit).toMatchObject({
      runId: run.runId,
      preStateRevision: run.stateRevision,
      preStateDigest: run.stateDigest,
      relatedGameIds: [GAME_IDS[0]],
      transactionIds: [],
    });
    expect(commit?.command.command).toBe('advance-postseason');
    if (commit?.command.command !== 'advance-postseason') throw new Error('unexpected command');
    expect(commit.command.targetGameId).toBe(GAME_IDS[0]);
    expect(commit.effects).toEqual(effects);
    expect(commit.resultDigest).toBe(
      seasonPostseasonCommitResultDigest(wire?.commandId ?? '', [GAME_IDS[0]], []),
    );
    expect(session.snapshot?.run.runId).toBe(run.runId);
    expect(session.postseason.gamesCompleted).toBe(1);
    expect(session.postseason.gamesTotal).toBe(4);
    expect(
      harness.announcements.some((entry) => entry.kind === 'replace' && entry.runId === run.runId),
    ).toBe(true);
    session.destroy();
  });

  it('forwards job progress into the postseason counters', async () => {
    const run = playInRun();
    const repository = makeRepository(snapshotOf(run, buildZeroEffects(run)));
    const job = new ProgrammableJob();
    const harness = createHarness(job, repository);
    const session = harness.session;
    await session.refresh();
    postseasonFns.nextGame.mockReturnValue({ kind: 'game', gameId: GAME_IDS[0] });
    await session.advancePostseason();
    await vi.waitFor(() => {
      expect(job.simulateCalls).toHaveLength(1);
    });
    job.emitProgress({
      schemaVersion: 1,
      type: 'season-postseason-progress',
      requestId: job.simulateCalls[0]?.requestId ?? '',
      gamesCompleted: 3,
      gamesTotal: 109,
      latestGameId: gameId(GAME_IDS[0]),
      latestResult: null,
    });
    expect(session.postseason.gamesTotal).toBe(109);
    expect(session.postseason.latestGameId).toBe(GAME_IDS[0]);
    job.enqueue(acceptedOutcome(run, [GAME_IDS[0]]));
    await vi.waitFor(() => {
      expect(session.postseason.phase).toBe('complete');
    });
    session.destroy();
  });

  it('retries a duplicate commit with a fresh command id', async () => {
    const run = playInRun();
    const repository = makeRepository(snapshotOf(run, buildZeroEffects(run)));
    repository.repository.commitPostseasonAdvancement.mockRejectedValueOnce(
      new SeasonRunCommandDuplicateError('adv-test-1'),
    );
    const job = new ProgrammableJob();
    const harness = createHarness(job, repository);
    const session = harness.session;
    await session.refresh();
    postseasonFns.nextGame.mockReturnValue({ kind: 'game', gameId: GAME_IDS[0] });
    job.enqueue(acceptedOutcome(run, [GAME_IDS[0]]));
    job.enqueue(acceptedOutcome(run, [GAME_IDS[0]]));
    await session.advancePostseason();
    await vi.waitFor(() => {
      expect(session.postseason.phase).toBe('complete');
    });

    expect(job.simulateCalls).toHaveLength(2);
    const firstId = job.simulateCalls[0]?.commandId;
    const secondId = job.simulateCalls[1]?.commandId;
    expect(firstId).toMatch(/^adv-test-/);
    expect(secondId).toMatch(/^adv-test-/);
    expect(secondId).not.toBe(firstId);
    expect(harness.commitCalls).toHaveLength(1);
    session.destroy();
  });

  it('surfaces a rejected simulation through commandError and the failed phase', async () => {
    const run = playInRun();
    const repository = makeRepository(snapshotOf(run, buildZeroEffects(run)));
    const job = new ProgrammableJob();
    const harness = createHarness(job, repository);
    const session = harness.session;
    await session.refresh();
    postseasonFns.nextGame.mockReturnValue({ kind: 'game', gameId: GAME_IDS[0] });
    job.enqueue({
      kind: 'rejected',
      commandId: commandIdSchema.parse('adv-test-1'),
      rejection: { code: 'integrity-failure', reason: 'box score drift' },
    });
    await session.advancePostseason();
    await vi.waitFor(() => {
      expect(session.postseason.phase).toBe('failed');
    });
    expect(session.commandError).toMatchObject({ command: 'advance-postseason' });
    expect(session.commandError?.message).toBe(
      'The postseason integrity check failed: box score drift.',
    );
    expect(session.postseason.error).toEqual({
      code: 'integrity-failure',
      message: 'The postseason integrity check failed: box score drift.',
    });
    expect(harness.commitCalls).toHaveLength(0);
    session.destroy();
  });

  it('surfaces a worker error as the failed postseason state', async () => {
    const run = playInRun();
    const repository = makeRepository(snapshotOf(run, buildZeroEffects(run)));
    const job = new ProgrammableJob();
    const harness = createHarness(job, repository);
    const session = harness.session;
    await session.refresh();
    postseasonFns.nextGame.mockReturnValue({ kind: 'game', gameId: GAME_IDS[0] });
    job.enqueue({
      kind: 'error',
      code: 'internal',
      message: 'postseason simulation blew up',
      seed: null,
      gameId: null,
    });
    await session.advancePostseason();
    await vi.waitFor(() => {
      expect(session.postseason.phase).toBe('failed');
    });
    expect(session.postseason.error).toEqual({
      code: 'internal',
      message: 'postseason simulation blew up',
    });
    expect(session.commandError).toBeNull();
    session.destroy();
  });

  it('drops the commit when cancel lands during the simulation', async () => {
    const run = playInRun();
    const repository = makeRepository(snapshotOf(run, buildZeroEffects(run)));
    const job = new ProgrammableJob();
    const harness = createHarness(job, repository);
    const session = harness.session;
    await session.refresh();
    postseasonFns.nextGame.mockReturnValue({ kind: 'game', gameId: GAME_IDS[0] });
    await session.advancePostseason();
    await vi.waitFor(() => {
      expect(job.simulateCalls).toHaveLength(1);
    });
    session.cancelPostseason();
    expect(job.cancelCalls).toEqual([job.simulateCalls[0]?.requestId]);
    job.enqueue(acceptedOutcome(run, [GAME_IDS[0]]));
    await vi.waitFor(() => {
      expect(session.postseason.phase).toBe('cancelled');
    });
    expect(harness.commitCalls).toHaveLength(0);
    expect(harness.announcements).toHaveLength(0);
    session.destroy();
  });

  it('drops the publication when cancel lands during the commit', async () => {
    const run = playInRun();
    const repository = makeRepository(snapshotOf(run, buildZeroEffects(run)));
    let releaseCommit: () => void = () => {};
    const deferred = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    repository.repository.commitPostseasonAdvancement.mockImplementationOnce(
      (input: CommitPostseasonAdvancementInput) => {
        repository.commitCalls.push(input);
        return deferred;
      },
    );
    const job = new ProgrammableJob();
    const harness = createHarness(job, repository);
    const session = harness.session;
    await session.refresh();
    postseasonFns.nextGame.mockReturnValue({ kind: 'game', gameId: GAME_IDS[0] });
    job.enqueue(acceptedOutcome(run, [GAME_IDS[0]]));
    await session.advancePostseason();
    await vi.waitFor(() => {
      expect(repository.commitCalls).toHaveLength(1);
    });
    session.cancelPostseason();
    releaseCommit();
    await vi.waitFor(() => {
      expect(session.postseason.phase).toBe('cancelled');
    });
    expect(session.snapshot?.acceptedBlocks).toHaveLength(0);
    expect(harness.announcements).toHaveLength(0);
    session.destroy();
  });

  it('promotes the champion, publishes clear and completes', async () => {
    const base = playInRun();
    const run = completedRun(base);
    const repository = makeRepository(snapshotOf(base, buildZeroEffects(base)));
    const job = new ProgrammableJob();
    const harness = createHarness(job, repository);
    const session = harness.session;
    await session.refresh();
    postseasonFns.nextGame.mockReturnValue({ kind: 'game', gameId: GAME_IDS[0] });
    job.enqueue(acceptedOutcome(run, [GAME_IDS[0]], { stage: 'completed', nextDecision: 'none' }));
    await session.advancePostseason();
    await vi.waitFor(() => {
      expect(session.postseason.phase).toBe('complete');
    });

    expect(job.simulateCalls).toHaveLength(1);
    expect(harness.promoteCalls).toHaveLength(1);
    const promote = harness.promoteCalls[0] as {
      runId: string;
      almanac: { digest: string };
      run: SeasonRun;
      expectedStateRevision: number;
      expectedStateDigest: string;
      expectedRevision: number;
      postseasonSummaries: unknown[];
    };
    expect(promote.runId).toBe(run.runId);
    expect(promote.expectedStateRevision).toBe(run.stateRevision);
    expect(promote.expectedStateDigest).toBe(run.stateDigest);
    expect(promote.expectedRevision).toBe(0);
    expect(promote.almanac.digest).toMatch(/^[0-9a-f]{32}$/);
    expect(promote.run.completion?.almanacDigest).toBe(promote.almanac.digest);
    expect(session.snapshot).toBeNull();
    expect(session.index).toBeNull();
    expect(
      harness.announcements.some((entry) => entry.kind === 'clear' && entry.runId === run.runId),
    ).toBe(true);
    session.destroy();
  });

  it('guards a promotion that resolves after cancel', async () => {
    const base = playInRun();
    const run = completedRun(base);
    const repository = makeRepository(snapshotOf(base, buildZeroEffects(base)));
    let releasePromotion: () => void = () => {};
    const deferred = new Promise<void>((resolve) => {
      releasePromotion = resolve;
    });
    repository.repository.promoteChampionToCompleted.mockImplementationOnce(
      (input: PromoteChampionInput) => {
        repository.promoteCalls.push(input);
        return deferred;
      },
    );
    const job = new ProgrammableJob();
    const harness = createHarness(job, repository);
    const session = harness.session;
    await session.refresh();
    postseasonFns.nextGame.mockReturnValue({ kind: 'game', gameId: GAME_IDS[0] });
    job.enqueue(acceptedOutcome(run, [GAME_IDS[0]], { stage: 'completed', nextDecision: 'none' }));
    await session.advancePostseason();
    await vi.waitFor(() => {
      expect(repository.promoteCalls).toHaveLength(1);
    });
    session.cancelPostseason();
    releasePromotion();
    await vi.waitFor(() => {
      expect(session.postseason.phase).toBe('cancelled');
    });
    expect(session.snapshot).not.toBeNull();
    expect(harness.announcements.some((entry) => entry.kind === 'clear')).toBe(false);
    session.destroy();
  });

  it('caps a fast-forward chunk at the eight-game bound', async () => {
    const run = playInRun();
    const repository = makeRepository(snapshotOf(run, buildZeroEffects(run)));
    const job = new ProgrammableJob();
    const harness = createHarness(job, repository);
    const session = harness.session;
    await session.refresh();
    postseasonFns.humanEliminated.mockReturnValue(true);
    postseasonFns.upcomingGames.mockReturnValue([...GAME_IDS]);
    postseasonFns.nextGame.mockReturnValue({ kind: 'game', gameId: GAME_IDS[0] });
    await session.fastForwardPostseason();
    await vi.waitFor(() => {
      expect(job.simulateCalls).toHaveLength(1);
    });
    expect(job.simulateCalls[0]?.targetGameId).toBe(GAME_IDS[7]);
    expect(job.simulateCalls[0]?.commandId).toMatch(/^ff-test-/);
    session.destroy();
  });

  it('rejects a fast-forward target beyond the chunk bound', async () => {
    const run = playInRun();
    const repository = makeRepository(snapshotOf(run, buildZeroEffects(run)));
    const job = new ProgrammableJob();
    const harness = createHarness(job, repository);
    const session = harness.session;
    await session.refresh();
    postseasonFns.humanEliminated.mockReturnValue(true);
    postseasonFns.upcomingGames.mockReturnValue([...GAME_IDS]);
    postseasonFns.nextGame.mockReturnValue({ kind: 'game', gameId: GAME_IDS[0] });
    await session.fastForwardPostseason({ targetGameId: GAME_IDS[9] });
    await vi.waitFor(() => {
      expect(session.postseason.phase).toBe('failed');
    });
    expect(session.postseason.error?.message).toBe(
      'the fast-forward target is beyond the 8-game chunk bound',
    );
    expect(job.simulateCalls).toHaveLength(0);
    session.destroy();
  });

  it('requires the human franchise to be eliminated for fast-forward', async () => {
    const run = playInRun();
    const repository = makeRepository(snapshotOf(run, buildZeroEffects(run)));
    const job = new ProgrammableJob();
    const harness = createHarness(job, repository);
    const session = harness.session;
    await session.refresh();
    postseasonFns.humanEliminated.mockReturnValue(false);
    postseasonFns.nextGame.mockReturnValue({ kind: 'game', gameId: GAME_IDS[0] });
    await session.fastForwardPostseason();
    await vi.waitFor(() => {
      expect(session.postseason.phase).toBe('failed');
    });
    expect(session.postseason.error?.message).toBe(
      `the human franchise ${HUMAN} still has postseason decisions; fast-forward requires elimination`,
    );
    expect(job.simulateCalls).toHaveLength(0);
    session.destroy();
  });

  it('completes spectate after a single commit even when more games remain', async () => {
    const run = playInRun();
    const repository = makeRepository(snapshotOf(run, buildZeroEffects(run)));
    const job = new ProgrammableJob();
    const harness = createHarness(job, repository);
    const session = harness.session;
    await session.refresh();
    postseasonFns.nextGame.mockReturnValue({ kind: 'game', gameId: GAME_IDS[2] });
    job.enqueue(
      acceptedOutcome(run, [GAME_IDS[3]], {
        nextDecision: 'rotation',
        aiNextGameId: GAME_IDS[4],
      }),
    );
    await session.spectatePostseasonGame({ targetGameId: GAME_IDS[3] });
    await vi.waitFor(() => {
      expect(session.postseason.phase).toBe('complete');
    });
    expect(job.simulateCalls).toHaveLength(1);
    expect(job.simulateCalls[0]?.targetGameId).toBe(GAME_IDS[3]);
    expect(job.simulateCalls[0]?.commandId).toMatch(/^spc-test-/);
    expect(harness.commitCalls).toHaveLength(1);
    session.destroy();
  });

  it('stops the advance loop when the terminal target game lands', async () => {
    const run = playInRun();
    const repository = makeRepository(snapshotOf(run, buildZeroEffects(run)));
    const job = new ProgrammableJob();
    const harness = createHarness(job, repository);
    const session = harness.session;
    await session.refresh();
    postseasonFns.upcomingGames.mockReturnValue([...GAME_IDS.slice(0, 4)]);
    postseasonFns.nextGame.mockReturnValue({ kind: 'game', gameId: GAME_IDS[0] });
    job.enqueue(
      acceptedOutcome(run, [GAME_IDS[0]], {
        nextDecision: 'none',
        aiNextGameId: GAME_IDS[1],
      }),
    );
    await session.advancePostseason({ targetGameId: GAME_IDS[0] });
    await vi.waitFor(() => {
      expect(session.postseason.phase).toBe('complete');
    });
    expect(job.simulateCalls).toHaveLength(1);
    expect(job.simulateCalls[0]?.targetGameId).toBe(GAME_IDS[0]);
    session.destroy();
  });
});
