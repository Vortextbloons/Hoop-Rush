import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SEASON_BLOCK_VERSION,
  SEASON_DRAFT_CATALOG_VERSION,
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
  type SeasonHomeCourtProfile,
  type SeasonPostseasonRotationPayload,
  type SeasonPostseasonWorkerStartRequest,
  type SeasonRun,
  type SeasonRunCommand,
  type SeasonStandings,
  type SeasonSubmitBlockCommand,
} from '@hoop-rush/data-contracts';
import {
  franchiseIdSchema,
  eraIdSchema,
  seedSchema,
  commandIdSchema,
  idSchema,
  SeasonRunCommandStaleStateError,
  SeasonRunLoadError,
} from '@hoop-rush/data-contracts';
import type { CommitPostseasonAdvancementInput, SeasonRunSnapshot } from '@hoop-rush/persistence';
import { SEASON_HOME_COURT_PROFILE } from '@hoop-rush/engine';
import { generateSeasonSchedule } from '@hoop-rush/engine';
import { handleSeasonRunCommand } from '@hoop-rush/engine';
import { seasonPostseasonNextGame } from '@hoop-rush/engine';
import { seasonRotationSetDigest } from '@hoop-rush/engine';
import { seasonRunStateDigest } from '@hoop-rush/engine';
import {
  buildEraSimulationProfile,
  buildSeasonLeague,
  buildSeasonRunFixture,
} from '@hoop-rush/test-fixtures';
import { SeasonSession, describeCommandRejection, type BlockRunState } from './session.ts';
import { SeasonSnapshotCache } from './state-cache.ts';
import type {
  SeasonBlockResumeInput,
  SeasonBlockRunner,
  SeasonBlockStartInput,
  SeasonRunnerEvent,
} from './block-wire.ts';
import type { SeasonPostseasonJob, SeasonPostseasonJobOutcome } from './postseason-wire.ts';
import type { SeasonAssetPort, SeasonRunRepositoryPort } from './ports.ts';
let nextTestCommandId = 0;
function createSession(
  repository: SeasonRunRepositoryPort,
  blockRunner: SeasonBlockRunner,
  postseasonJob?: SeasonPostseasonJob,
): SeasonSession {
  const assets: SeasonAssetPort = {
    loadEraProfile: () => Promise.resolve(buildEraSimulationProfile()),
    loadDraftCatalog: () => Promise.reject(new Error('the season draft catalog is unavailable')),
    loadFreeAgencyIndex: () => Promise.reject(new Error('the free-agency index is unavailable')),
    loadFreeAgencyTargets: () =>
      Promise.reject(new Error('the free-agency targets are unavailable')),
    loadHomeCourtProfile: () => Promise.resolve({ ...SEASON_HOME_COURT_PROFILE }),
    loadArtifactUrls: () =>
      Promise.resolve({
        catalogUrl: 'https://example.test/season/draft-catalog.json',
        catalogHash: '0'.repeat(64),
        profileUrl: 'https://example.test/season/era-sim.json',
        profileHash: '0'.repeat(64),
      }),
    loadSchedule: () => Promise.reject(new Error('the season schedule is unavailable')),
  };
  return new SeasonSession({
    repository,
    blockRunner,
    ...(postseasonJob !== undefined ? { postseasonJob } : {}),
    assets,
    notifier: {
      announce: () => {},
      onMutation: () => () => {},
      close: () => {},
    },
    clock: {
      now: () => 0,
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
    ids: {
      id: (prefix: string): string => {
        nextTestCommandId += 1;
        return `${prefix}-test-${String(nextTestCommandId)}`;
      },
    },
    draftCleaner: { clearDraftSave: () => Promise.resolve() },
  });
}

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
  emit(event: SeasonRunnerEvent): void {
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
    loadPendingInterruption: vi.fn(() => Promise.resolve(null)),
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
    isHumanGame: false,
    humanRecordInBlock: { wins: 0, losses: 0 },
    humanResults: [],
    leaguePulse: { closest: null, blowout: null, highestScoring: null },
    error: null,
    command: null,
    startInput: null,
  };
}
describe('SeasonSession season-load diagnostics', () => {
  it('preserves a typed load diagnostic for the recovery screen', async () => {
    const repo = repoWith(null);
    repo.loadActiveRun.mockRejectedValueOnce(
      new SeasonRunLoadError(
        ['corrupt accepted-block row 3: revision does not match block index'],
        'Season Run reload validation failed',
        'SEASON_RUN_STATE_VALIDATION_FAILED',
      ),
    );
    const hub = createSession(repo, new FakeRunner());

    await hub.refresh();

    expect(hub.error).toEqual({
      code: 'SEASON_RUN_STATE_VALIDATION_FAILED',
      message: 'Season Run reload validation failed',
      failures: ['corrupt accepted-block row 3: revision does not match block index'],
    });
    hub.destroy();
  });

  it('reports a missing checkpoint when the active-run index survives alone', async () => {
    const repo = repoWith(null);
    repo.loadActiveRunIndex.mockResolvedValueOnce({
      runId: RUN_ID,
      rootSeed: 'a'.repeat(32),
      humanFranchiseId: 'lakers',
      revision: 4,
      stateRevision: 4,
      lastCheckpointDigest: 'b'.repeat(32),
      updatedAtIso: '2026-01-01T00:00:00.000Z',
      humanWins: 0,
      humanLosses: 0,
    } as never);
    const hub = createSession(repo, new FakeRunner());

    await hub.refresh();

    expect(hub.error).toMatchObject({
      code: 'SEASON_RUN_CHECKPOINT_MISSING',
      failures: [`run ${RUN_ID} is indexed at revision 4 but has no checkpoint record`],
    });
    hub.destroy();
  });
});
describe('SeasonSession.quitRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('clears the active run and reloads the empty state', async () => {
    const repo = repoWith(snapshot());
    const runner = new FakeRunner();
    const hub = createSession(repo, runner);
    await hub.refresh();
    expect(hub.snapshot?.run.runId).toBe(RUN_ID);
    const result = await hub.quitRun();
    expect(result.ok).toBe(true);
    expect(repo.clearSeasonRun).toHaveBeenCalledWith(RUN_ID);
    expect(repo.loadActiveRun).toHaveBeenCalledTimes(2);
    expect(hub.snapshot).toBeNull();
    hub.destroy();
  });
  it('terminates a runner that never acknowledges cancellation', async () => {
    const repo = repoWith(snapshot());
    const runner = new FakeRunner();
    runner.ackCancel = false;
    const hub = createSession(repo, runner);
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
    const hub = createSession(repo, runner);
    await hub.refresh();
    const result = await hub.quitRun();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no active season run');
    expect(repo.clearSeasonRun).not.toHaveBeenCalled();
    hub.destroy();
  });
});
describe('SeasonSession.retry', () => {
  it('re-derives the home-court profile instead of resubmitting the stored copy', async () => {
    const run = {
      runId: RUN_ID,
      rosters: [],
      cursor: { schemaVersion: 1, completedRounds: 0 },
      stateRevision: 0,
      stateDigest: '0'.repeat(32),
    } as unknown as SeasonRun;
    const repo = repoWith({ ...snapshot(), run });
    const runner = new FakeRunner();
    const hub = createSession(repo, runner);
    await hub.refresh();
    const staleHomeCourt: SeasonHomeCourtProfile = {
      ...SEASON_HOME_COURT_PROFILE,
      homeDefensiveCommunication: 0.1,
    };
    const rotations: SeasonRun['rotations'] = [];
    const digest = seasonRotationSetDigest(rotations);
    const command: SeasonSubmitBlockCommand = {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      blockVersion: SEASON_BLOCK_VERSION,
      command: 'submit-season-block',
      commandId: commandIdSchema.parse('cmd-retry-1'),
      runId: idSchema.parse(RUN_ID),
      expectedRevision: 0,
      blockIndex: 0,
      rotationDigest: digest,
      objectiveId: null,
      expectedStateRevision: 0,
      expectedStateDigest: '0'.repeat(32),
    };
    const startInput: SeasonBlockStartInput = {
      run,
      effects: hubZeroEffects(run),
      rotations,
      blockIndex: 0,
      expectedRevision: 0,
      rotationDigest: digest,
      commandId: command.commandId,
      humanFranchiseId: null,
      objectiveId: null,
      homeCourt: staleHomeCourt,
      catalogUrl: 'https://example.test/season/draft-catalog.json',
      catalogHash: '0'.repeat(64),
      profileUrl: 'https://example.test/season/era-sim.json',
      profileHash: '0'.repeat(64),
    };
    hub.block = { ...runningBlock('fake-1', 0), phase: 'failed', command, startInput };
    await hub.retry();
    await vi.waitFor(() => {
      expect(runner.startCalls).toHaveLength(1);
    });
    expect(runner.startCalls[0]?.homeCourt).toEqual(SEASON_HOME_COURT_PROFILE);
    expect(runner.startCalls[0]?.homeCourt).not.toBe(staleHomeCourt);
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
    catalogVersion: SEASON_DRAFT_CATALOG_VERSION,
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
class FakePostseasonJob implements SeasonPostseasonJob {
  simulateCalls: SeasonPostseasonWorkerStartRequest[] = [];
  cancelCalls: string[] = [];
  terminateCalls = 0;
  prewarmCalls = 0;
  private readonly pending: Array<{
    resolve: (outcome: SeasonPostseasonJobOutcome) => void;
  }> = [];
  private readonly queued: SeasonPostseasonJobOutcome[] = [];
  enqueue(outcome: SeasonPostseasonJobOutcome): void {
    const next = this.pending.shift();
    if (next === undefined) {
      this.queued.push(outcome);
      return;
    }
    next.resolve(outcome);
  }
  simulate(request: SeasonPostseasonWorkerStartRequest): Promise<SeasonPostseasonJobOutcome> {
    this.simulateCalls.push(request);
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
    const cancelled: SeasonPostseasonJobOutcome = {
      kind: 'error',
      code: 'cancelled',
      message: 'postseason worker terminated',
      seed: null,
      gameId: null,
    };
    for (const entry of [...this.pending]) entry.resolve(cancelled);
    this.pending.length = 0;
  }
  prewarm(): void {
    this.prewarmCalls += 1;
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
    loadPendingInterruption: vi.fn(() => Promise.resolve(null)),
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
describe('SeasonSession postseason commands (M2.6)', () => {
  afterEach(() => {
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
    const hub = createSession(repo, new FakeRunner(), new FakePostseasonJob());
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
  it('surfaces a stale command commit as an explicit retry prompt', async () => {
    const run = hubBoundaryRun();
    const repo = hubPostseasonRepo({
      run,
      summaries: [],
      retainedDetails: [],
      acceptedBlocks: [],
      effects: hubZeroEffects(run),
    });
    repo.commitPostseasonAdvancement.mockRejectedValueOnce(
      new SeasonRunCommandStaleStateError('cmd-stale', 0, 1),
    );
    const hub = createSession(repo, new FakeRunner(), new FakePostseasonJob());
    hub.catalog = hubCatalogOf(run);
    await hub.refresh();
    await hub.startPostseason();
    expect(hub.commandError?.command).toBe('start-postseason');
    expect(hub.commandError?.rejection).toBeNull();
    expect(hub.commandError?.message).toBe(
      'The season changed before this action was saved. Refresh and try again.',
    );
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
    const hub = createSession(repo, new FakeRunner(), new FakePostseasonJob());
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
    const hub = createSession(repo, new FakeRunner(), new FakePostseasonJob());
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
  it('advancePostseason drives the job for the next postseason game', async () => {
    const run = hubBoundaryRun();
    const repo = hubPostseasonRepo({
      run,
      summaries: [],
      retainedDetails: [],
      acceptedBlocks: [],
      effects: hubZeroEffects(run),
    });
    const job = new FakePostseasonJob();
    const hub = createSession(repo, new FakeRunner(), job);
    hub.catalog = hubCatalogOf(run);
    await hub.refresh();
    await hub.startPostseason();
    await hub.advancePostseason();
    await vi.waitFor(() => {
      expect(job.simulateCalls).toHaveLength(1);
    });
    expect(hub.postseason.phase).toBe('running');
    expect(hub.postseason.error).toBeNull();
    const request = job.simulateCalls[0];
    expect(request?.type).toBe('season-postseason-start');
    expect(request?.runId).toBe(run.runId);
    expect(request?.commandId).toMatch(/^adv-test-/);
    hub.destroy();
  });
  it('spectatePostseasonGame drives the job and cancelPostseason cancels the wire request', async () => {
    const run = hubBoundaryRun();
    const repo = hubPostseasonRepo({
      run,
      summaries: [],
      retainedDetails: [],
      acceptedBlocks: [],
      effects: hubZeroEffects(run),
    });
    const job = new FakePostseasonJob();
    const hub = createSession(repo, new FakeRunner(), job);
    hub.catalog = hubCatalogOf(run);
    await hub.refresh();
    await hub.startPostseason();
    await hub.spectatePostseasonGame({ targetGameId: 'pi-east-seven-eight' });
    await vi.waitFor(() => {
      expect(job.simulateCalls).toHaveLength(1);
    });
    expect(job.simulateCalls[0]?.targetGameId).toBe('pi-east-seven-eight');
    expect(job.simulateCalls[0]?.commandId).toMatch(/^spc-test-/);
    expect(hub.postseason.phase).toBe('running');
    hub.cancelPostseason();
    expect(job.cancelCalls).toEqual([job.simulateCalls[0]?.requestId]);
    expect(hub.postseason.phase).toBe('cancelled');
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
    const job = new FakePostseasonJob();
    const hub = createSession(repo, new FakeRunner(), job);
    await hub.refresh();
    await hub.advancePostseason();
    expect(job.simulateCalls).toHaveLength(0);
    expect(hub.commandError?.command).toBe('advance-postseason');
    expect(hub.commandError?.rejection?.code).toBe('invalid-stage');
    expect(hub.commandError?.message).toContain('regular-season');
    await hub.fastForwardPostseason();
    expect(job.simulateCalls).toHaveLength(0);
    expect(hub.commandError?.rejection?.code).toBe('invalid-stage');
    hub.destroy();
  });
});
describe('SeasonSession trade guards', () => {
  it('blocks trade commands while a block is pending or running', async () => {
    const repo = repoWith(snapshot());
    const runner = new FakeRunner();
    const hub = createSession(repo, runner);
    await hub.refresh();
    hub.pending = { runId: RUN_ID, blockIndex: 3 } as unknown as SeasonSession['pending'];
    await hub.openTradeInquiry({ windowIndex: 0, toFranchiseId: 'celtics' });
    expect(hub.commandError?.command).toBe('open-trade-inquiry');
    expect(hub.commandError?.rejection).toMatchObject({ code: 'pending-block', blockIndex: 3 });
    expect(hub.commandError?.message).toContain('pending');
    expect(repo.applySeasonRunCommand).not.toHaveBeenCalled();
    expect(hub.pending).not.toBeNull();
    hub.block = runningBlock('fake-1', 2);
    hub.pending = null;
    await hub.purchaseTradeInquiry({ windowIndex: 0 });
    expect(hub.commandError?.command).toBe('purchase-trade-inquiry');
    expect(hub.commandError?.rejection).toMatchObject({ code: 'pending-block' });
    expect(repo.applySeasonRunCommand).not.toHaveBeenCalled();
    hub.destroy();
  });
  it('maps postseason, sponsor, and trade rejection codes in describeCommandRejection', () => {
    expect(
      describeCommandRejection('advance-postseason', {
        code: 'invalid-stage',
        requiredStage: 'play-in',
        currentStage: 'regular-season',
      } as never).length,
    ).toBeGreaterThan(10);
    expect(
      describeCommandRejection('advance-postseason', {
        code: 'invalid-rotation',
        franchiseId: franchiseIdSchema.parse('lakers'),
        reasons: ['test reason'],
      } as never),
    ).toContain('rotation is not legal');
    expect(describeCommandRejection('advance-postseason', { code: 'unknown' } as never)).toContain(
      'rejected',
    );
    expect(
      describeCommandRejection('buy-sponsor', {
        code: 'sponsor-not-offered',
        instanceId: 'sponsor-0-0',
        blockIndex: 0,
      } as never),
    ).toContain('not offered');
    expect(
      describeCommandRejection('buy-sponsor', {
        code: 'sponsor-slot-mismatch',
        instanceId: 'sponsor-0-0',
        expectedSlot: 'shoe',
        slot: 'fuel',
      } as never),
    ).toContain('shoe');
    expect(
      describeCommandRejection('buy-sponsor', {
        code: 'sponsor-brand-duplicate',
        playerVersionId: 'pv-1',
        brandFamily: 'nike',
      } as never),
    ).toContain('nike');
    expect(
      describeCommandRejection('respond-to-trade-counter', {
        code: 'pending-block',
        blockIndex: 3,
      } as never),
    ).toContain('pending');
    expect(
      describeCommandRejection('respond-to-trade-counter', {
        code: 'trade-negotiation-illegal',
        windowIndex: 0,
        inquiryId: 'inq-1',
        reasons: ['lakers: too few centers'],
      } as never),
    ).toContain('illegal roster');
  });
});
describe('SeasonSession runner teardown', () => {
  function setPostseasonRequestId(hub: SeasonSession, requestId: string | null): void {
    (hub as unknown as { postseasonRequestId: string | null }).postseasonRequestId = requestId;
  }
  function setPostseasonWireRequestId(hub: SeasonSession, requestId: string | null): void {
    (hub as unknown as { postseasonWireRequestId: string | null }).postseasonWireRequestId =
      requestId;
  }
  it('destroy cancels and terminates both runners', async () => {
    const repo = repoWith(snapshot());
    const runner = new FakeRunner();
    const job = new FakePostseasonJob();
    const hub = createSession(repo, runner, job);
    await hub.refresh();
    hub.block = runningBlock('fake-1', 0);
    hub.postseason = { ...hub.postseason, phase: 'running' };
    setPostseasonRequestId(hub, 'sp-1');
    setPostseasonWireRequestId(hub, 'sp-1-0');
    hub.destroy();
    expect(runner.cancelCalls).toEqual(['fake-1']);
    expect(job.cancelCalls).toEqual(['sp-1-0']);
    expect(runner.terminateCalls).toBe(1);
    expect(job.terminateCalls).toBe(1);
  });
  it('quitRun cancels both runners and a late postseason result cannot resurrect state', async () => {
    const repo = repoWith(snapshot());
    const runner = new FakeRunner();
    const job = new FakePostseasonJob();
    const hub = createSession(repo, runner, job);
    await hub.refresh();
    hub.postseason = { ...hub.postseason, phase: 'running' };
    setPostseasonRequestId(hub, 'sp-1');
    setPostseasonWireRequestId(hub, 'sp-1-0');
    const result = await hub.quitRun();
    expect(result.ok).toBe(true);
    expect(job.cancelCalls).toEqual(['sp-1-0']);
    expect(job.terminateCalls).toBe(1);
    expect(hub.snapshot).toBeNull();
    job.enqueue({
      kind: 'accepted',
      result: {
        status: 'accepted',
        stage: 'play-in',
        advancedGameIds: [],
        summaries: [],
        run: snapshot().run,
        nextDecision: 'none',
        nextGameId: null,
        aiNextGameId: null,
      },
    });
    await vi.waitFor(() => {
      expect(hub.postseason.phase).toBe('idle');
    });
    expect(hub.snapshot).toBeNull();
    expect(hub.index).toBeNull();
    hub.destroy();
  });
  it('drops late block events that no longer match the active request or run', async () => {
    const repo = repoWith(snapshot());
    const runner = new FakeRunner();
    const hub = createSession(repo, runner);
    await hub.refresh();
    hub.block = runningBlock('fake-1', 0);
    runner.emit({
      type: 'candidate',
      requestId: 'stale-request',
      blockIndex: 0,
      checkpoint: { blockIndex: 0 } as never,
    });
    expect(hub.snapshot?.run.runId).toBe(RUN_ID);
    expect(hub.block.requestId).toBe('fake-1');
    hub.destroy();
  });
});
function cacheSnapshot(
  runId: string,
  acceptedCount: number,
  stateRevision: number,
): SeasonRunSnapshot {
  return {
    run: { runId, stateRevision, rosters: [] },
    summaries: [],
    retainedDetails: [],
    acceptedBlocks: Array.from({ length: acceptedCount }, () => ({}) as never),
  } as unknown as SeasonRunSnapshot;
}
describe('SeasonSnapshotCache', () => {
  it('caches snapshots by run, accepted count, and state revision', () => {
    const cache = new SeasonSnapshotCache();
    const stored = cacheSnapshot('run-cache', 1, 2);
    cache.set(stored);
    expect(cache.get()).toBe(stored);
    expect(cache.getFor('run-cache', 1, 2)).toBe(stored);
    expect(cache.matches('run-cache', 1, 2)).toBe(true);
    expect(cache.matches('run-cache', 2, 2)).toBe(false);
    expect(cache.rosterKeyFor('run-cache', 1, 2)).toBe('');
    cache.clear();
    expect(cache.get()).toBeNull();
    expect(cache.matches('run-cache', 1, 2)).toBe(false);
  });
  it('keeps cache state isolated per instance and evicts beyond the limit', () => {
    const first = new SeasonSnapshotCache();
    const second = new SeasonSnapshotCache();
    first.set(cacheSnapshot('run-isolated', 0, 0));
    expect(first.get()).not.toBeNull();
    expect(second.get()).toBeNull();
    for (let index = 0; index < 5; index += 1) {
      first.set(cacheSnapshot(`run-${String(index)}`, 0, index));
    }
    expect(first.matches('run-0', 0, 0)).toBe(false);
    expect(first.matches('run-4', 0, 4)).toBe(true);
  });
});
describe('SeasonSession disposed guard', () => {
  it('ignores a late postseason job attach after destroy', async () => {
    const repo = repoWith(snapshot());
    const runner = new FakeRunner();
    const job = new FakePostseasonJob();
    const lateFactory = Promise.withResolvers<SeasonPostseasonJob>();
    const session = new SeasonSession({
      repository: repo,
      blockRunner: runner,
      postseasonJobFactory: () => lateFactory.promise,
      assets: {
        loadEraProfile: () => Promise.resolve(buildEraSimulationProfile()),
        loadDraftCatalog: () =>
          Promise.reject(new Error('the season draft catalog is unavailable')),
        loadFreeAgencyIndex: () =>
          Promise.reject(new Error('the free-agency index is unavailable')),
        loadFreeAgencyTargets: () =>
          Promise.reject(new Error('the free-agency targets are unavailable')),
        loadHomeCourtProfile: () => Promise.resolve({ ...SEASON_HOME_COURT_PROFILE }),
        loadArtifactUrls: () =>
          Promise.reject(new Error('the season artifact urls are unavailable')),
        loadSchedule: () => Promise.reject(new Error('the season schedule is unavailable')),
      },
      notifier: {
        announce: () => {},
        onMutation: () => () => {},
        close: () => {},
      },
      clock: {
        now: () => 0,
        sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      },
      ids: { id: (prefix: string): string => `${prefix}-late` },
      draftCleaner: { clearDraftSave: () => Promise.resolve() },
    });
    await session.refresh();
    session.destroy();
    lateFactory.resolve(job);
    await lateFactory.promise;
    await Promise.resolve();
    expect(session.postseason.phase).toBe('idle');
    expect(session.commandError).toBeNull();
    expect((session as unknown as { postseasonJob: unknown }).postseasonJob).toBeNull();
    expect(job.terminateCalls).toBe(0);
  });
  it('ignores late refresh continuations after destroy', async () => {
    const repo = repoWith(null);
    const lateLoad = Promise.withResolvers<SeasonRunSnapshot | null>();
    repo.loadActiveRun.mockImplementationOnce(() => lateLoad.promise);
    const session = createSession(repo, new FakeRunner());
    const pending = session.refresh();
    session.destroy();
    lateLoad.resolve(snapshot());
    await pending;
    expect(session.snapshot).toBeNull();
    expect(session.error).toBeNull();
  });
});
describe('SeasonSession getSnapshot', () => {
  it('composes the session view from the live session state', async () => {
    const repo = repoWith(snapshot());
    const hub = createSession(repo, new FakeRunner());
    await hub.refresh();
    const view = hub.getSnapshot();
    expect(view.snapshot).toBe(hub.snapshot);
    expect(view.index).toBe(hub.index);
    expect(view.block).toBe(hub.block);
    expect(view.postseason).toBe(hub.postseason);
    expect(view.pending).toBe(hub.pending);
    expect(view.interruption).toBe(hub.interruption);
    expect(view.commandError).toBeNull();
    expect(view.commandReceipt).toBeNull();
    expect(view.externalChange).toBeNull();
    expect(view.error).toBeNull();
    hub.destroy();
  });
});
