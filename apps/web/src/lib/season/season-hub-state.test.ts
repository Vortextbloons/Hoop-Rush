import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SEASON_DRAFT_CATALOG_V3,
  SEASON_DURABILITY_VERSION,
  SEASON_ROUND_COUNT,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_STAMINA_VERSION,
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
  PLAYER_VERSION_ID_VERSION,
  canonicalJson,
  seasonDigestHex,
  type Position,
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonPostseasonRotationPayload,
  type SeasonRun,
  type SeasonRunCommand,
  type SeasonStandings,
} from '@hoop-rush/data-contracts';
import {
  franchiseIdSchema,
  eraIdSchema,
  seedSchema,
  commandIdSchema,
} from '@hoop-rush/data-contracts';
import type { SeasonRunSnapshot } from '@hoop-rush/persistence';
import {
  generateSeasonSchedule,
  handleSeasonRunCommand,
  seasonPostseasonNextGame,
  seasonRunStateDigest,
} from '@hoop-rush/engine';
import {
  buildEraSimulationProfile,
  buildSeasonLeague,
  buildSeasonRunFixture,
} from '@hoop-rush/test-fixtures';
import { SeasonHubState, type BlockRunState, describeCommandRejection } from './season-hub-state';
import { clearCachedSeasonSnapshot } from './season-state-cache';
import type {
  SeasonBlockResumeInput,
  SeasonBlockRunner,
  SeasonBlockStartInput,
  SeasonRunnerEvent,
} from './season-block-runner';
import type {
  SeasonPostseasonEvent,
  SeasonPostseasonRunner,
  SeasonPostseasonRunInput,
} from './season-postseason-runner';
import type { CommitPostseasonAdvancementInput } from '@hoop-rush/persistence';
vi.mock('$lib/season/season-assets', async (importOriginal) => {
  const original = await importOriginal<typeof import('$lib/season/season-assets')>();
  return {
    ...original,
    loadSeasonEraProfile: () => Promise.resolve(buildEraSimulationProfile()),
  };
});
class FakeRunner implements SeasonBlockRunner {
  ackCancel = true;
  terminateCalls = 0;
  cancelCalls: string[] = [];
  startCalls: SeasonBlockStartInput[] = [];
  resumeCalls: SeasonBlockResumeInput[] = [];
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
    return 'resume-1';
  }
  cancel(requestId: string): void {
    this.cancelCalls.push(requestId);
    if (this.ackCancel) {
      this.emit({ type: 'cancelled', requestId, blockIndex: this.lastBlockIndex });
    }
  }
  terminate(): void {
    this.terminateCalls += 1;
  }
  prewarmCalls = 0;
  prewarm(): void {
    this.prewarmCalls += 1;
  }
  subscribe(listener: (event: SeasonRunnerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(event: SeasonRunnerEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
const RUN_ID = 'run-quit-fixture';
function snapshot(): SeasonRunSnapshot {
  return {
    run: { runId: RUN_ID },
    summaries: [],
    retainedDetails: [],
    acceptedBlocks: [],
  } as unknown as SeasonRunSnapshot;
}
function repoWith(initial: SeasonRunSnapshot | null) {
  let active = initial;
  return {
    loadActiveRun: vi.fn(() => Promise.resolve(active)),
    loadActiveRunIndex: vi.fn(() => Promise.resolve(null)),
    loadActiveRunIncompatible: vi.fn(() => Promise.resolve(null)),
    loadBlockSummaries: vi.fn(),
    loadRetainedDetails: vi.fn(),
    loadBlockHistory: vi.fn(),
    commitSeasonBlock: vi.fn(),
    promoteSeasonDraftToRun: vi.fn(),
    clearSeasonRun: vi.fn((runId: string) => {
      if (runId === active?.run.runId) active = null;
      return Promise.resolve();
    }),
    forceClearActiveSeasonRun: vi.fn(() => {
      active = null;
      return Promise.resolve();
    }),
    savePendingBlock: vi.fn(() => Promise.resolve()),
    loadPendingBlock: vi.fn(() => Promise.resolve(null)),
    discardPendingBlock: vi.fn(() => Promise.resolve()),
    applySeasonRunCommand: vi.fn(() => Promise.resolve()),
    loadSeasonRunPlayerSlice: vi.fn(() => Promise.resolve(null)),
    upsertSeasonRunPlayerSlice: vi.fn(() => Promise.resolve()),
    commitPostseasonAdvancement: vi.fn(() => Promise.resolve()),
    loadPostseasonSummaries: vi.fn(() => Promise.resolve([])),
    loadPostseasonSummary: vi.fn(() => Promise.resolve(null)),
    loadPostseasonDetails: vi.fn(() => Promise.resolve([])),
    loadCommandLog: vi.fn(() => Promise.resolve(null)),
    promoteChampionToCompleted: vi.fn(() => Promise.resolve()),
    loadCompletedSeason: vi.fn(() => Promise.resolve(null)),
    listCompletedSeasonRuns: vi.fn(() => Promise.resolve([])),
    deleteCompletedSeason: vi.fn(() => Promise.resolve()),
    buildReplayExport: vi.fn(() => Promise.resolve(null)),
  };
}
function runningBlock(requestId: string, blockIndex: number): BlockRunState {
  return {
    requestId,
    blockIndex,
    phase: 'running',
    gamesCompleted: 0,
    gamesTotal: 150,
    latestGameId: null,
    latestResult: null,
    error: null,
    command: null,
    startInput: null,
  };
}
describe('SeasonHubState.quitRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('clears the active run and reloads the empty state', async () => {
    const repo = repoWith(snapshot());
    const runner = new FakeRunner();
    const hub = new SeasonHubState(repo, runner);
    await hub.refresh();
    expect(hub.snapshot?.run.runId).toBe(RUN_ID);
    const result = await hub.quitRun();
    expect(result.ok).toBe(true);
    expect(repo.clearSeasonRun).toHaveBeenCalledWith(RUN_ID);
    expect(repo.loadActiveRun).toHaveBeenCalledTimes(2);
    expect(hub.snapshot).toBeNull();
    hub.destroy();
  });
  it('cancels an in-flight block before clearing', async () => {
    const repo = repoWith(snapshot());
    const runner = new FakeRunner();
    const hub = new SeasonHubState(repo, runner);
    await hub.refresh();
    hub.block = runningBlock('fake-1', 0);
    const result = await hub.quitRun();
    expect(result.ok).toBe(true);
    expect(runner.cancelCalls).toEqual(['fake-1']);
    expect(runner.terminateCalls).toBe(0);
    expect(repo.clearSeasonRun).toHaveBeenCalledWith(RUN_ID);
    hub.destroy();
  });
  it('terminates a runner that never acknowledges cancellation', async () => {
    const repo = repoWith(snapshot());
    const runner = new FakeRunner();
    runner.ackCancel = false;
    const hub = new SeasonHubState(repo, runner);
    await hub.refresh();
    hub.block = runningBlock('fake-1', 0);
    const pending = hub.quitRun();
    await vi.advanceTimersByTimeAsync(6000);
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(runner.cancelCalls).toEqual(['fake-1']);
    expect(runner.terminateCalls).toBe(1);
    expect(hub.block.phase).toBe('idle');
    expect(repo.clearSeasonRun).toHaveBeenCalledWith(RUN_ID);
    hub.destroy();
  });
  it('refuses to quit when no run is active', async () => {
    const repo = repoWith(null);
    const runner = new FakeRunner();
    const hub = new SeasonHubState(repo, runner);
    await hub.refresh();
    const result = await hub.quitRun();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no active season run');
    expect(repo.clearSeasonRun).not.toHaveBeenCalled();
    hub.destroy();
  });
  it('reports a clear failure without destroying the shell', async () => {
    const repo = repoWith(snapshot());
    repo.clearSeasonRun.mockRejectedValueOnce(new Error('boom'));
    const runner = new FakeRunner();
    const hub = new SeasonHubState(repo, runner);
    await hub.refresh();
    const result = await hub.quitRun();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('boom');
    expect(hub.snapshot?.run.runId).toBe(RUN_ID);
    hub.destroy();
  });
});
const POSTSEASON_SEED = seedSchema.parse('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
const POSTSEASON_HUMAN = franchiseIdSchema.parse('lakers');
const HUB_SLOT_POSITIONS: ReadonlyArray<readonly Position[]> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF', 'C'],
  ['C'],
];
function hubCatalogOf(run: SeasonRun): SeasonDraftCatalog {
  const candidates: SeasonDraftCandidate[] = run.rosters.flatMap((roster) =>
    roster.players.map((player, slot) => {
      const playable = HUB_SLOT_POSITIONS[slot];
      if (playable === undefined) throw new Error(`no position pattern for slot ${String(slot)}`);
      const primary = playable[0];
      if (primary === undefined) throw new Error(`no primary position for slot ${String(slot)}`);
      return {
        playerVersionId: player.playerVersionId,
        playerId: player.playerId,
        franchiseId: roster.franchiseId,
        eraId: player.eraId,
        seasonKey: player.seasonKey,
        displayName: player.displayName,
        playerExternalId: '101',
        positions: {
          primary,
          secondary: playable.slice(1),
          playable: [...playable],
          normalizationVersion: 'position-v3',
        },
        heightInches: 79,
        weightLbs: 215,
        summaryRatings: { overallRating: 90, offenseRating: 92, defenseRating: 84 },
        detailedRatings: { ...SIMULATION_RATINGS },
        tendencies: { ...SIMULATION_TENDENCIES },
        stamina: { rating: 70, historicalMpg: 30, derivationVersion: SEASON_STAMINA_VERSION },
        durability: { rating: 70, derivationVersion: SEASON_DURABILITY_VERSION },
      };
    }),
  );
  const pools = run.rosters.map((roster) => ({
    franchiseId: roster.franchiseId,
    eraId: eraIdSchema.parse('1990s'),
    playerVersionIds: roster.players.map((player) => player.playerVersionId),
  }));
  return {
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_CATALOG_V3,
    dataVersion: 'data-v1',
    ratingsVersion: 'ratings-v1',
    positionNormalizationVersion: 'position-v3',
    playerVersionIdVersion: PLAYER_VERSION_ID_VERSION,
    staminaVersion: SEASON_STAMINA_VERSION,
    durabilityVersion: SEASON_DURABILITY_VERSION,
    pools,
    candidates,
  };
}
function hubZeroEffects(run: SeasonRun): SeasonEffectsState {
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
function hubStandings(run: SeasonRun): SeasonStandings {
  const teamIds = run.league.teams.map((team) => team.franchiseId);
  const spec: Record<
    string,
    {
      w: number;
      l: number;
      h2h?: Record<string, number>;
    }
  > = {};
  const east = run.league.teams.filter((team) => team.conference === 'east');
  east.forEach((team, index) => {
    const w = 62 - index;
    spec[team.franchiseId] = { w, l: 82 - w };
  });
  const west = run.league.teams.filter((team) => team.conference === 'west');
  let above = 0;
  let below = 0;
  west.forEach((team) => {
    if (team.franchiseId === POSTSEASON_HUMAN || team.franchiseId === 'clippers') {
      spec[team.franchiseId] = { w: 40, l: 42 };
    } else if (above < 6) {
      const w = 52 + above;
      spec[team.franchiseId] = { w, l: 82 - w };
      above += 1;
    } else {
      const w = 30 - below;
      spec[team.franchiseId] = { w, l: 82 - w };
      below += 1;
    }
  });
  spec[POSTSEASON_HUMAN] = { w: 40, l: 42, h2h: { clippers: 1 } };
  spec.clippers = { w: 40, l: 42, h2h: { [POSTSEASON_HUMAN]: 3 } };
  return {
    schemaVersion: 1,
    standingsVersion: 'standings-v1',
    rows: teamIds.map((franchiseId) => {
      const teamSpec = spec[franchiseId] ?? { w: 0, l: 0 };
      return {
        franchiseId,
        wins: teamSpec.w,
        losses: teamSpec.l,
        gamesPlayed: teamSpec.w + teamSpec.l,
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
        headToHead: teamIds
          .filter((other) => other !== franchiseId)
          .map((other) => ({
            franchiseId: other,
            wins: teamSpec.h2h?.[other] ?? 0,
            losses: spec[other]?.h2h?.[franchiseId] ?? 0,
          })),
      };
    }),
  };
}
function hubBoundaryRun(): SeasonRun {
  const league = buildSeasonLeague({}, { humanFranchiseId: POSTSEASON_HUMAN });
  const schedule = generateSeasonSchedule({ league, seed: POSTSEASON_SEED });
  const base = buildSeasonRunFixture({
    schedule,
    league,
    seed: POSTSEASON_SEED,
    humanFranchiseId: POSTSEASON_HUMAN,
  });
  const effects = hubZeroEffects(base);
  const run: SeasonRun = {
    ...base,
    cursor: { ...base.cursor, completedRounds: SEASON_ROUND_COUNT },
    standings: hubStandings(base),
    stateRevision: 0,
    stateDigest: seasonRunStateDigest({
      stateRevision: 0,
      stage: 'regular-season',
      postseason: base.postseason,
      awards: null,
      completion: null,
      checkpointState: null,
      health: base.health,
      influence: base.influence,
      transactions: [],
      trade: null,
      objectives: base.objectives,
      rosters: base.rosters,
      ownership: base.ownership,
      rotations: base.rotations,
      effects,
      freeAgency: base.freeAgency,
    }),
  };
  return run;
}
async function advanceHubRunToHumanGame(
  repo: ReturnType<typeof hubPostseasonRepo>,
  run: SeasonRun,
  effects: SeasonEffectsState,
  catalog: SeasonDraftCatalog,
): Promise<{
  run: SeasonRun;
  nextGameId: string;
}> {
  const profile = buildEraSimulationProfile();
  let current = run;
  let guard = 0;
  for (;;) {
    guard += 1;
    if (guard > 30) throw new Error('the run never reached a human rotation decision');
    const decision = seasonPostseasonNextGame(current.postseason);
    if (decision.kind !== 'game') {
      throw new Error(`the run ended before a human rotation decision: ${decision.kind}`);
    }
    const command: SeasonRunCommand = {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      commandId: commandIdSchema.parse(`hub-adv-${String(guard)}`),
      runId: current.runId,
      expectedStateRevision: current.stateRevision,
      expectedStateDigest: current.stateDigest,
      command: 'advance-postseason',
      targetGameId: decision.gameId,
    };
    const output = handleSeasonRunCommand(command, {
      run: current,
      pending: null,
      humanFranchiseId: POSTSEASON_HUMAN,
      effects,
      catalog,
      profile,
    });
    const envelope = output.result;
    if (envelope.command !== 'advance-postseason' || envelope.result.status !== 'accepted') {
      throw new Error(`hub advance rejected: ${JSON.stringify(envelope)}`);
    }
    const summaries = output.postseasonSummaries ?? [];
    await repo.commitPostseasonAdvancement({
      runId: current.runId,
      run: output.run,
      summaries,
      command,
      preStateRevision: command.expectedStateRevision,
      preStateDigest: command.expectedStateDigest,
      resultDigest: seasonDigestHex(
        canonicalJson({
          commandId: command.commandId,
          gameIds: [...envelope.result.advancedGameIds].sort(),
          summaryDigests: summaries.map((summary) => summary.resultDigest).sort(),
        }),
      ),
      relatedGameIds: [...envelope.result.advancedGameIds],
      transactionIds: [],
    });
    current = output.run;
    if (envelope.result.nextDecision === 'rotation' && envelope.result.nextGameId !== null) {
      return { run: current, nextGameId: envelope.result.nextGameId };
    }
  }
}
class FakePostseasonRunner implements SeasonPostseasonRunner {
  advanceCalls: SeasonPostseasonRunInput[] = [];
  spectateCalls: SeasonPostseasonRunInput[] = [];
  fastForwardCalls: SeasonPostseasonRunInput[] = [];
  cancelCalls: string[] = [];
  terminateCalls = 0;
  private readonly listeners = new Set<(event: SeasonPostseasonEvent) => void>();
  advancePostseason(input: SeasonPostseasonRunInput): string {
    this.advanceCalls.push(input);
    this.emit({
      type: 'started',
      requestId: 'sp-1',
      mode: 'advance',
      targetGameId: null,
      gamesTotal: 0,
    });
    return 'sp-1';
  }
  spectatePostseasonGame(
    input: SeasonPostseasonRunInput & {
      targetGameId: string;
    },
  ): string {
    this.spectateCalls.push(input);
    this.emit({
      type: 'started',
      requestId: 'sp-2',
      mode: 'spectate',
      targetGameId: input.targetGameId,
      gamesTotal: 0,
    });
    return 'sp-2';
  }
  fastForwardPostseason(input: SeasonPostseasonRunInput): string {
    this.fastForwardCalls.push(input);
    this.emit({
      type: 'started',
      requestId: 'sp-3',
      mode: 'fast-forward',
      targetGameId: null,
      gamesTotal: 0,
    });
    return 'sp-3';
  }
  cancel(requestId: string): void {
    this.cancelCalls.push(requestId);
  }
  terminate(): void {
    this.terminateCalls += 1;
  }
  prewarm(): void {}
  subscribe(listener: (event: SeasonPostseasonEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(event: SeasonPostseasonEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
function hubPostseasonRepo(initial: SeasonRunSnapshot | null) {
  let active = initial;
  const commits: CommitPostseasonAdvancementInput[] = [];
  return {
    active,
    commits,
    loadActiveRun: vi.fn(() => Promise.resolve(active)),
    loadActiveRunIndex: vi.fn(() => Promise.resolve(null)),
    loadActiveRunIncompatible: vi.fn(() => Promise.resolve(null)),
    loadBlockSummaries: vi.fn(() => Promise.resolve([])),
    loadRetainedDetails: vi.fn(() => Promise.resolve([])),
    loadBlockHistory: vi.fn(() => Promise.resolve([])),
    commitSeasonBlock: vi.fn(() => Promise.resolve()),
    promoteSeasonDraftToRun: vi.fn(() => Promise.resolve()),
    clearSeasonRun: vi.fn(() => Promise.resolve()),
    forceClearActiveSeasonRun: vi.fn(() => Promise.resolve()),
    savePendingBlock: vi.fn(() => Promise.resolve()),
    loadPendingBlock: vi.fn(() => Promise.resolve(null)),
    discardPendingBlock: vi.fn(() => Promise.resolve()),
    applySeasonRunCommand: vi.fn(() => Promise.resolve()),
    loadSeasonRunPlayerSlice: vi.fn(() => Promise.resolve(null)),
    upsertSeasonRunPlayerSlice: vi.fn(() => Promise.resolve()),
    commitPostseasonAdvancement: vi.fn((input: CommitPostseasonAdvancementInput) => {
      commits.push(input);
      const effects =
        (
          input.run as SeasonRun & {
            effects?: SeasonEffectsState;
          }
        ).effects ??
        active?.effects ??
        hubZeroEffects(input.run);
      active = {
        ...(active ?? { run: input.run, summaries: [], retainedDetails: [], acceptedBlocks: [] }),
        run: input.run,
        effects,
      };
      return Promise.resolve();
    }),
    loadPostseasonSummaries: vi.fn(() => Promise.resolve([])),
    loadPostseasonSummary: vi.fn(() => Promise.resolve(null)),
    loadPostseasonDetails: vi.fn(() => Promise.resolve([])),
    loadCommandLog: vi.fn(() => Promise.resolve(null)),
    promoteChampionToCompleted: vi.fn(() => {
      active = null;
      return Promise.resolve();
    }),
    loadCompletedSeason: vi.fn(() => Promise.resolve(null)),
    listCompletedSeasonRuns: vi.fn(() => Promise.resolve([])),
    deleteCompletedSeason: vi.fn(() => Promise.resolve()),
    buildReplayExport: vi.fn(() => Promise.resolve(null)),
  };
}
describe('SeasonHubState postseason commands (M2.6)', () => {
  afterEach(() => {
    clearCachedSeasonSnapshot();
    vi.restoreAllMocks();
  });
  it('startPostseason dispatches through the engine and commits the advancement', async () => {
    const run = hubBoundaryRun();
    const repo = hubPostseasonRepo({
      run,
      summaries: [],
      retainedDetails: [],
      acceptedBlocks: [],
      effects: hubZeroEffects(run),
    });
    const hub = new SeasonHubState(repo, new FakeRunner(), new FakePostseasonRunner());
    hub.catalog = hubCatalogOf(run);
    await hub.refresh();
    expect(hub.snapshot?.run.stage).toBe('regular-season');
    await hub.startPostseason();
    expect(hub.commandError).toBeNull();
    expect(hub.snapshot?.run.stage).toBe('play-in');
    expect(hub.snapshot?.run.postseason.playIn.west.ranking).not.toBeNull();
    expect(repo.commits).toHaveLength(1);
    const commit = repo.commits[0];
    if (commit === undefined) return;
    expect(commit.command.command).toBe('start-postseason');
    expect(commit.summaries).toEqual([]);
    expect(commit.run.stateRevision).toBe(1);
    hub.destroy();
  });
  it('submitPostseasonRotation accepts a legal rotation for the human team', async () => {
    const run = hubBoundaryRun();
    const repo = hubPostseasonRepo({
      run,
      summaries: [],
      retainedDetails: [],
      acceptedBlocks: [],
      effects: hubZeroEffects(run),
    });
    const hub = new SeasonHubState(repo, new FakeRunner(), new FakePostseasonRunner());
    hub.catalog = hubCatalogOf(run);
    await hub.refresh();
    await hub.startPostseason();
    const started = hub.snapshot?.run;
    if (started === undefined) throw new Error('expected a started run');
    const atHumanGame = await advanceHubRunToHumanGame(
      repo,
      started,
      hubZeroEffects(run),
      hubCatalogOf(run),
    );
    await hub.refresh();
    const humanNext = atHumanGame.nextGameId;
    const humanRotation = atHumanGame.run.rotations.find(
      (rotation) => rotation.franchiseId === POSTSEASON_HUMAN,
    );
    if (humanRotation === undefined) throw new Error('expected a human rotation');
    const payload: SeasonPostseasonRotationPayload = {
      franchiseId: POSTSEASON_HUMAN,
      rotation: humanRotation,
    };
    await hub.submitPostseasonRotation({ targetGameId: humanNext, rotation: payload });
    expect(hub.commandError).toBeNull();
    const commit = repo.commits[repo.commits.length - 1];
    expect(commit).toBeDefined();
    expect(commit?.command.command).toBe('submit-postseason-rotation');
    if (commit?.command.command !== 'submit-postseason-rotation') return;
    expect(commit.command.targetGameId).toBe(humanNext);
    expect(commit.command.rotation.franchiseId).toBe(POSTSEASON_HUMAN);
    expect(hub.snapshot?.run.rotations.find((r) => r.franchiseId === POSTSEASON_HUMAN)).toEqual(
      humanRotation,
    );
    hub.destroy();
  });
  it('rejects submitPostseasonRotation with the typed invalid-rotation mapping', async () => {
    const run = hubBoundaryRun();
    const repo = hubPostseasonRepo({
      run,
      summaries: [],
      retainedDetails: [],
      acceptedBlocks: [],
      effects: hubZeroEffects(run),
    });
    const hub = new SeasonHubState(repo, new FakeRunner(), new FakePostseasonRunner());
    hub.catalog = hubCatalogOf(run);
    await hub.refresh();
    await hub.startPostseason();
    const started = hub.snapshot?.run;
    if (started === undefined) throw new Error('expected a started run');
    const atHumanGame = await advanceHubRunToHumanGame(
      repo,
      started,
      hubZeroEffects(run),
      hubCatalogOf(run),
    );
    await hub.refresh();
    const humanRotation = atHumanGame.run.rotations.find(
      (rotation) => rotation.franchiseId === POSTSEASON_HUMAN,
    );
    if (humanRotation === undefined) throw new Error('expected a human rotation');
    const badPayload: SeasonPostseasonRotationPayload = {
      franchiseId: POSTSEASON_HUMAN,
      rotation: {
        ...humanRotation,
        starters: [
          humanRotation.starters[4] ?? '',
          humanRotation.starters[1] ?? '',
          humanRotation.starters[2] ?? '',
          humanRotation.starters[3] ?? '',
          humanRotation.starters[0] ?? '',
        ],
      },
    };
    await hub.submitPostseasonRotation({
      targetGameId: atHumanGame.nextGameId,
      rotation: badPayload,
    });
    expect(hub.commandError).not.toBeNull();
    expect(hub.commandError?.rejection?.code).toBe('invalid-rotation');
    expect(hub.commandError?.message).toContain('rotation is not legal');
    expect(repo.commits).toHaveLength(4);
    hub.destroy();
  });
  it('advancePostseason routes to the runner and mirrors progress events', async () => {
    const run = hubBoundaryRun();
    const repo = hubPostseasonRepo({
      run,
      summaries: [],
      retainedDetails: [],
      acceptedBlocks: [],
      effects: hubZeroEffects(run),
    });
    const postseasonRunner = new FakePostseasonRunner();
    const hub = new SeasonHubState(repo, new FakeRunner(), postseasonRunner);
    hub.catalog = hubCatalogOf(run);
    await hub.refresh();
    await hub.startPostseason();
    await hub.advancePostseason();
    expect(postseasonRunner.advanceCalls).toHaveLength(1);
    expect(hub.postseason.phase).toBe('running');
    expect(hub.postseason.error).toBeNull();
    const snapshot = hub.snapshot;
    if (snapshot === null) throw new Error('expected a snapshot');
    postseasonRunner.emit({
      type: 'committed',
      requestId: 'sp-1',
      runId: snapshot.run.runId,
      gameIds: ['pi-east-seven-eight'],
      snapshot,
    });
    expect(hub.postseason.gamesCompleted).toBe(1);
    expect(hub.postseason.phase).toBe('running');
    postseasonRunner.emit({
      type: 'progress',
      requestId: 'sp-1',
      gamesCompleted: 1,
      gamesTotal: 109,
      latestGameId: 'pi-east-seven-eight',
      latestResult: null,
    });
    expect(hub.postseason.gamesTotal).toBe(109);
    expect(hub.postseason.latestGameId).toBe('pi-east-seven-eight');
    postseasonRunner.emit({
      type: 'complete',
      requestId: 'sp-1',
      runId: snapshot.run.runId,
      snapshot,
      stage: 'play-in',
      nextDecision: 'rotation',
      nextGameId: 'pi-west-seven-eight',
      aiNextGameId: null,
      promoted: false,
    });
    expect(hub.postseason.phase).toBe('complete');
    expect(hub.snapshot?.run.runId).toBe(snapshot.run.runId);
    hub.destroy();
  });
  it('fastForwardPostseason routes to the runner and promotion clears the run', async () => {
    const run = hubBoundaryRun();
    const repo = hubPostseasonRepo({
      run,
      summaries: [],
      retainedDetails: [],
      acceptedBlocks: [],
      effects: hubZeroEffects(run),
    });
    const postseasonRunner = new FakePostseasonRunner();
    const hub = new SeasonHubState(repo, new FakeRunner(), postseasonRunner);
    hub.catalog = hubCatalogOf(run);
    await hub.refresh();
    await hub.startPostseason();
    await hub.fastForwardPostseason();
    expect(postseasonRunner.fastForwardCalls).toHaveLength(1);
    const snapshot = hub.snapshot;
    if (snapshot === null) throw new Error('expected a snapshot');
    await repo.promoteChampionToCompleted();
    postseasonRunner.emit({
      type: 'complete',
      requestId: 'sp-3',
      runId: snapshot.run.runId,
      snapshot: null,
      stage: 'completed',
      nextDecision: 'none',
      nextGameId: null,
      aiNextGameId: null,
      promoted: true,
    });
    await hub.refresh();
    expect(hub.postseason.phase).toBe('complete');
    expect(hub.snapshot).toBeNull();
    expect(hub.index).toBeNull();
    hub.destroy();
  });
  it('spectatePostseasonGame routes to the runner and cancelPostseason cancels', async () => {
    const run = hubBoundaryRun();
    const repo = hubPostseasonRepo({
      run,
      summaries: [],
      retainedDetails: [],
      acceptedBlocks: [],
      effects: hubZeroEffects(run),
    });
    const postseasonRunner = new FakePostseasonRunner();
    const hub = new SeasonHubState(repo, new FakeRunner(), postseasonRunner);
    hub.catalog = hubCatalogOf(run);
    await hub.refresh();
    await hub.startPostseason();
    await hub.spectatePostseasonGame({ targetGameId: 'pi-east-seven-eight' });
    expect(postseasonRunner.spectateCalls).toHaveLength(1);
    expect(postseasonRunner.spectateCalls[0]?.targetGameId).toBe('pi-east-seven-eight');
    expect(hub.postseason.phase).toBe('running');
    hub.cancelPostseason();
    expect(postseasonRunner.cancelCalls).toEqual(['sp-2']);
    hub.destroy();
  });
  it('rejects runner-routed commands outside the play-in/playoffs stages', async () => {
    const run = hubBoundaryRun();
    const repo = hubPostseasonRepo({
      run,
      summaries: [],
      retainedDetails: [],
      acceptedBlocks: [],
      effects: hubZeroEffects(run),
    });
    const postseasonRunner = new FakePostseasonRunner();
    const hub = new SeasonHubState(repo, new FakeRunner(), postseasonRunner);
    await hub.refresh();
    await hub.advancePostseason();
    expect(postseasonRunner.advanceCalls).toHaveLength(0);
    expect(hub.commandError?.command).toBe('advance-postseason');
    expect(hub.commandError?.rejection?.code).toBe('invalid-stage');
    expect(hub.commandError?.message).toContain('regular-season');
    await hub.fastForwardPostseason();
    expect(postseasonRunner.fastForwardCalls).toHaveLength(0);
    expect(hub.commandError?.rejection?.code).toBe('invalid-stage');
    hub.destroy();
  });
  it('maps every M2.6 postseason rejection code in describeCommandRejection', () => {
    const rejectionOf = (code: string) =>
      describeCommandRejection('advance-postseason', {
        code,
        ...dummyFacts(code),
      } as never);
    const dummyFacts = (code: string): Record<string, unknown> => {
      switch (code) {
        case 'invalid-stage':
          return { requiredStage: 'play-in', currentStage: 'regular-season' };
        case 'wrong-game':
          return { targetGameId: 'pi-east-seven-eight', nextGameId: 'pi-east-nine-ten' };
        case 'invalid-rotation':
          return { franchiseId: franchiseIdSchema.parse('lakers'), reasons: ['test reason'] };
        case 'unavailable-player':
          return { playerVersionId: 'pv-1', reason: 'injured' };
        case 'insufficient-rehab-resources':
          return { franchiseId: franchiseIdSchema.parse('lakers'), balance: 0, required: 2 };
        case 'invalid-series-state':
          return { seriesId: 'east-first-round-1', reason: 'unpaired' };
        case 'integrity-failure':
          return { reason: 'test reason' };
        default:
          return {};
      }
    };
    for (const code of [
      'invalid-stage',
      'wrong-game',
      'invalid-rotation',
      'unavailable-player',
      'insufficient-rehab-resources',
      'invalid-series-state',
      'integrity-failure',
    ]) {
      const message = rejectionOf(code);
      expect(message.length).toBeGreaterThan(10);
    }
    expect(describeCommandRejection('advance-postseason', { code: 'unknown' } as never)).toContain(
      'rejected',
    );
  });
});
