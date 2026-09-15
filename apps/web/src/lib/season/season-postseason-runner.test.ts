import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commandIdSchema,
  franchiseIdSchema,
  seedSchema,
  type SeasonEffectsState,
  type SeasonPostseasonSummary,
  type SeasonRun,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import type {
  SeasonPostseasonRepository,
  SeasonRunRepository,
  SeasonRunSnapshot,
} from '@hoop-rush/persistence';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import { generateSeasonSchedule } from '@hoop-rush/engine/src/season/schedule.ts';
import {
  createSeasonPostseasonRunner,
  type SeasonPostseasonSimulatorFn,
} from './season-postseason-runner';
const postseasonFns = vi.hoisted(() => ({
  nextGame: vi.fn(),
  upcomingGames: vi.fn(() => [] as string[]),
  humanEliminated: vi.fn(() => false),
}));
vi.mock('@hoop-rush/engine/src/season/postseason.ts', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@hoop-rush/engine/src/season/postseason.ts')>();
  return {
    ...original,
    seasonPostseasonNextGame: postseasonFns.nextGame,
    seasonPostseasonUpcomingGames: postseasonFns.upcomingGames,
    seasonPostseasonHumanEliminated: postseasonFns.humanEliminated,
  };
});
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
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await tick();
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
type PostseasonRepositoryMock = {
  loadActiveRun: ReturnType<typeof vi.fn>;
  commitPostseasonAdvancement: ReturnType<typeof vi.fn>;
  loadCommandLog: ReturnType<typeof vi.fn>;
  loadPostseasonSummaries: ReturnType<typeof vi.fn>;
  promoteChampionToCompleted: ReturnType<typeof vi.fn>;
};
function makeRepository(run: SeasonRun): {
  repository: SeasonRunRepository & SeasonPostseasonRepository;
  mock: PostseasonRepositoryMock;
} {
  const snapshot: SeasonRunSnapshot = {
    run,
    summaries: [],
    retainedDetails: [],
    acceptedBlocks: [],
    effects: buildZeroEffects(run),
  };
  const mock: PostseasonRepositoryMock = {
    loadActiveRun: vi.fn(() => Promise.resolve(snapshot)),
    commitPostseasonAdvancement: vi.fn(() => Promise.resolve()),
    loadCommandLog: vi.fn(() =>
      Promise.resolve({
        schemaVersion: 1,
        commandLogVersion: 'command-log-v3',
        runId: run.runId,
        entries: [],
      }),
    ),
    loadPostseasonSummaries: vi.fn(() => Promise.resolve([] as SeasonPostseasonSummary[])),
    promoteChampionToCompleted: vi.fn(() => Promise.resolve()),
  };
  return {
    repository: mock as unknown as SeasonRunRepository & SeasonPostseasonRepository,
    mock,
  };
}
function acceptedSimulator(run: SeasonRun): SeasonPostseasonSimulatorFn {
  return (request) =>
    Promise.resolve({
      schemaVersion: 1,
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
    });
}
describe('season postseason runner cancellation', () => {
  let schedule: SeasonSchedule;
  beforeEach(() => {
    schedule = generateSeasonSchedule({
      league: LEAGUE,
      seed: seedSchema.parse('a'.repeat(32)),
    });
    postseasonFns.nextGame.mockReset();
    postseasonFns.upcomingGames.mockReset().mockReturnValue([]);
    postseasonFns.humanEliminated.mockReset().mockReturnValue(false);
  });
  it('drops a commit that resolves after cancel without emitting late events', async () => {
    const run = buildSeasonRunFixture({ schedule, stateDigest: 'a'.repeat(32) });
    const { repository, mock } = makeRepository(run);
    let resolveCommit!: () => void;
    const deferredCommit = new Promise<void>((resolve) => {
      resolveCommit = resolve;
    });
    mock.commitPostseasonAdvancement.mockImplementationOnce(() => deferredCommit);
    postseasonFns.nextGame.mockReturnValue({ kind: 'game', gameId: 'pi-east-seven-eight' });
    const runner = createSeasonPostseasonRunner({
      repository,
      schedule,
      artifacts,
      simulate: acceptedSimulator(run),
    });
    const events: Array<{ type: string; requestId?: string }> = [];
    runner.subscribe((event) => events.push(event));
    const requestId = runner.advancePostseason({
      runId: run.runId,
      commandId: commandIdSchema.parse('cmd-cancel-1'),
      humanFranchiseId: null,
    });
    await flush();
    expect(events.some((event) => event.type === 'started')).toBe(true);
    expect(mock.commitPostseasonAdvancement).toHaveBeenCalledTimes(1);
    runner.cancel(requestId);
    expect(events.some((event) => event.type === 'cancelled')).toBe(true);
    const loadsBeforeResolve = mock.loadActiveRun.mock.calls.length;
    resolveCommit();
    await flush();
    expect(events.some((event) => event.type === 'committed')).toBe(false);
    expect(events.some((event) => event.type === 'complete')).toBe(false);
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(mock.loadActiveRun.mock.calls.length).toBe(loadsBeforeResolve);
    runner.terminate();
  });
  it('drops a champion promotion that resolves after cancel without emitting complete', async () => {
    const base = buildSeasonRunFixture({ schedule, stateDigest: 'a'.repeat(32) });
    const champion = franchiseIdSchema.parse(base.league.teams[0]?.franchiseId ?? 'lakers');
    const run: SeasonRun = {
      ...base,
      stage: 'completed',
      postseason: { ...base.postseason, championFranchiseId: champion },
      completion: {
        championFranchiseId: champion,
        almanacDigest: 'a'.repeat(32),
        finalizedAtStateRevision: base.stateRevision,
      },
    };
    const { repository, mock } = makeRepository(run);
    let resolvePromotion!: () => void;
    const deferredPromotion = new Promise<void>((resolve) => {
      resolvePromotion = resolve;
    });
    mock.promoteChampionToCompleted.mockImplementationOnce(() => deferredPromotion);
    postseasonFns.nextGame.mockReturnValue({ kind: 'complete' });
    const runner = createSeasonPostseasonRunner({
      repository,
      schedule,
      artifacts,
      simulate: acceptedSimulator(run),
    });
    const events: Array<{ type: string; requestId?: string }> = [];
    runner.subscribe((event) => events.push(event));
    const requestId = runner.advancePostseason({
      runId: run.runId,
      commandId: commandIdSchema.parse('cmd-cancel-2'),
      humanFranchiseId: null,
    });
    await flush();
    expect(mock.promoteChampionToCompleted).toHaveBeenCalledTimes(1);
    runner.cancel(requestId);
    resolvePromotion();
    await flush();
    expect(events.some((event) => event.type === 'complete')).toBe(false);
    expect(events.some((event) => event.type === 'error')).toBe(false);
    runner.terminate();
  });
  it('rejects a stale promotion input through the persisted state facts', async () => {
    const base = buildSeasonRunFixture({ schedule, stateDigest: 'a'.repeat(32) });
    const champion = franchiseIdSchema.parse(base.league.teams[0]?.franchiseId ?? 'lakers');
    const run: SeasonRun = {
      ...base,
      stage: 'completed',
      postseason: { ...base.postseason, championFranchiseId: champion },
      completion: {
        championFranchiseId: champion,
        almanacDigest: 'a'.repeat(32),
        finalizedAtStateRevision: base.stateRevision,
      },
    };
    const { repository, mock } = makeRepository(run);
    mock.promoteChampionToCompleted.mockImplementationOnce(
      (input: { expectedStateRevision: number; expectedStateDigest: string }) => {
        expect(input.expectedStateRevision).toBe(run.stateRevision);
        expect(input.expectedStateDigest).toBe(run.stateDigest);
        return Promise.resolve();
      },
    );
    postseasonFns.nextGame.mockReturnValue({ kind: 'complete' });
    const runner = createSeasonPostseasonRunner({
      repository,
      schedule,
      artifacts,
      simulate: acceptedSimulator(run),
    });
    runner.advancePostseason({
      runId: run.runId,
      commandId: commandIdSchema.parse('cmd-cancel-3'),
      humanFranchiseId: null,
    });
    await flush();
    expect(mock.promoteChampionToCompleted).toHaveBeenCalledTimes(1);
    const call = mock.promoteChampionToCompleted.mock.calls[0]?.[0] as
      | {
          expectedStateRevision: number;
          expectedRevision: number;
        }
      | undefined;
    expect(call?.expectedRevision).toBe(0);
    runner.terminate();
  });
  it('does not commit when the session is cancelled during simulate', async () => {
    const run = buildSeasonRunFixture({ schedule, stateDigest: 'a'.repeat(32) });
    const { repository, mock } = makeRepository(run);
    let resolveSimulate!: (value: Awaited<ReturnType<SeasonPostseasonSimulatorFn>>) => void;
    const deferredSimulate = new Promise<Awaited<ReturnType<SeasonPostseasonSimulatorFn>>>(
      (resolve) => {
        resolveSimulate = resolve;
      },
    );
    const simulate: SeasonPostseasonSimulatorFn = () => deferredSimulate;
    postseasonFns.nextGame.mockReturnValue({ kind: 'game', gameId: 'pi-east-seven-eight' });
    const runner = createSeasonPostseasonRunner({
      repository,
      schedule,
      artifacts,
      simulate,
    });
    const events: Array<{ type: string }> = [];
    runner.subscribe((event) => events.push(event));
    const requestId = runner.advancePostseason({
      runId: run.runId,
      commandId: commandIdSchema.parse('cmd-cancel-4'),
      humanFranchiseId: null,
    });
    await flush();
    runner.cancel(requestId);
    resolveSimulate({
      schemaVersion: 1,
      type: 'season-postseason-complete',
      requestId: 'sp-wire-0',
      result: {
        status: 'accepted',
        stage: run.stage,
        advancedGameIds: ['pi-east-seven-eight'],
        summaries: [],
        run,
        nextDecision: 'rotation',
        nextGameId: 'pi-east-seven-eight',
        aiNextGameId: null,
      },
    });
    await flush();
    expect(mock.commitPostseasonAdvancement).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === 'committed')).toBe(false);
    expect(events.some((event) => event.type === 'complete')).toBe(false);
    expect(events.some((event) => event.type === 'error')).toBe(false);
    runner.terminate();
  });
});
