import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  franchiseIdSchema,
  seedSchema,
  type HoopRushManifest,
  type PlayersIndexEntry,
  type SeasonDraftCatalog,
  type SeasonRun,
  type SeasonTradeState,
} from '@hoop-rush/data-contracts';
import type { SeasonRunPlayerSliceEntry, SeasonRunSnapshot } from '@hoop-rush/persistence';
import {
  SeasonSession,
  type BlockRunState,
  type SeasonBlockResumeInput,
  type SeasonBlockRunner,
  type SeasonBlockStartInput,
  type SeasonRunRepositoryPort,
  type SeasonRunnerEvent,
  type SeasonSessionOptions,
} from '@hoop-rush/application/season';
import { generateSeasonSchedule } from '@hoop-rush/engine';
import {
  buildSeasonDraftCatalog,
  buildSeasonLeague,
  buildSeasonRunFixture,
} from '@hoop-rush/test-fixtures';
import { SeasonRunShell, type SeasonRunShellDeps } from './season-shell-state.svelte.ts';
const SEED = seedSchema.parse('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
const HUMAN = franchiseIdSchema.parse('lakers');
const LEAGUE = buildSeasonLeague({}, { humanFranchiseId: HUMAN });
const SCHEDULE = generateSeasonSchedule({ league: LEAGUE, seed: SEED });
const BASE_RUN = buildSeasonRunFixture({
  schedule: SCHEDULE,
  league: LEAGUE,
  seed: SEED,
  humanFranchiseId: HUMAN,
});
const FIRST_PLAYER_VERSION_ID =
  BASE_RUN.rosters.find((roster) => roster.franchiseId === HUMAN)?.players[0]?.playerVersionId ??
  '';
afterEach(() => {
  vi.restoreAllMocks();
});
function manifestFixture(): HoopRushManifest {
  return {
    modernFranchiseSlots: [
      { franchiseId: HUMAN, displayName: 'Los Angeles Lakers', teamExternalId: '13' },
    ],
  } as unknown as HoopRushManifest;
}
function snapshotOf(run: SeasonRun, acceptedBlocks = 0): SeasonRunSnapshot {
  return {
    run,
    summaries: [],
    retainedDetails: [],
    acceptedBlocks: Array.from({ length: acceptedBlocks }, () => ({})),
    effects: {},
  } as unknown as SeasonRunSnapshot;
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
function progressEvent(
  requestId: string,
  blockIndex: number,
  gamesCompleted: number,
): SeasonRunnerEvent {
  return {
    type: 'progress',
    requestId,
    blockIndex,
    gamesCompleted,
    gamesTotal: 150,
    latestGameId: null,
    latestResult: null,
    isHumanGame: true,
    humanRecordInBlock: { wins: 0, losses: 0 },
    humanResults: [],
    leaguePulse: { closest: null, blowout: null, highestScoring: null },
  };
}
function tradeFixture(): SeasonTradeState {
  return {
    windows: [{ offers: [], negotiations: [], boardProfiles: [], valueTrends: [] }],
  } as unknown as SeasonTradeState;
}
function catalogFor(run: SeasonRun): SeasonDraftCatalog {
  const template = buildSeasonDraftCatalog({
    franchiseIds: [HUMAN],
    eras: ['1990s'],
    playersPerPool: 10,
  });
  const candidate = template.candidates[0];
  const roster = run.rosters.find((entry) => entry.franchiseId === HUMAN);
  if (candidate === undefined || roster === undefined) {
    throw new Error('fixture data is incomplete');
  }
  return {
    ...template,
    candidates: roster.players.map((player) => ({
      ...candidate,
      playerVersionId: player.playerVersionId,
      playerId: player.playerId,
      franchiseId: player.franchiseId,
      eraId: player.eraId,
      seasonKey: player.seasonKey,
      displayName: player.displayName,
    })),
  };
}
class FakeRunner implements SeasonBlockRunner {
  terminateCalls = 0;
  private readonly listeners = new Set<(event: SeasonRunnerEvent) => void>();
  startBlock(input: SeasonBlockStartInput): string {
    return `start-${String(input.blockIndex)}`;
  }
  resumeBlock(input: SeasonBlockResumeInput): string {
    return `resume-${String(input.blockIndex)}`;
  }
  cancel(): void {}
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
function createFakeRepo(initial: SeasonRunSnapshot | null) {
  let active = initial;
  const upsertCalls: Array<{ runId: string; entries: SeasonRunPlayerSliceEntry[] }> = [];
  const repo: SeasonRunRepositoryPort = {
    loadActiveRunIndex: () => Promise.resolve(null),
    loadActiveRun: () => Promise.resolve(active),
    loadBlockSummaries: () => Promise.resolve([]),
    loadRetainedDetails: () => Promise.resolve([]),
    loadBlockHistory: () => Promise.resolve([]),
    commitSeasonBlock: () => Promise.resolve(),
    promoteSeasonDraftToRun: () => Promise.resolve(),
    clearSeasonRun: () => Promise.resolve(),
    forceClearActiveSeasonRun: () => Promise.resolve(),
    savePendingBlock: () => Promise.resolve(),
    loadPendingBlock: () => Promise.resolve(null),
    loadPendingInterruption: () => Promise.resolve(null),
    discardPendingBlock: () => Promise.resolve(),
    applySeasonRunCommand: () => Promise.resolve(),
    loadSeasonRunPlayerSlice: () => Promise.resolve(null),
    upsertSeasonRunPlayerSlice: (runId, entries) => {
      upsertCalls.push({ runId, entries });
      return Promise.resolve();
    },
    commitPostseasonAdvancement: () => Promise.resolve(),
    loadPostseasonSummaries: () => Promise.resolve([]),
    loadPostseasonSummary: () => Promise.resolve(null),
    loadPostseasonDetails: () => Promise.resolve([]),
    loadCommandLog: () => Promise.resolve(null),
    promoteChampionToCompleted: () => Promise.resolve(),
    loadCompletedSeason: () => Promise.resolve(null),
    listCompletedSeasonRuns: () => Promise.resolve([]),
    deleteCompletedSeason: () => Promise.resolve(),
    buildReplayExport: () => Promise.resolve(null),
  };
  return {
    repo,
    upsertCalls,
    setActive(snapshot: SeasonRunSnapshot | null): void {
      active = snapshot;
    },
  };
}
function sessionOptions(
  repository: SeasonRunRepositoryPort,
  blockRunner: SeasonBlockRunner,
): SeasonSessionOptions {
  return {
    repository,
    blockRunner,
    assets: {
      loadEraProfile: () => Promise.reject(new Error('era profile unavailable in tests')),
      loadDraftCatalog: () => Promise.reject(new Error('draft catalog unavailable in tests')),
      loadFreeAgencyIndex: () =>
        Promise.reject(new Error('free agency index unavailable in tests')),
      loadFreeAgencyTargets: () =>
        Promise.reject(new Error('free agency targets unavailable in tests')),
      loadHomeCourtProfile: () => Promise.reject(new Error('home court unavailable in tests')),
      loadArtifactUrls: () => Promise.reject(new Error('artifact urls unavailable in tests')),
      loadSchedule: () => Promise.resolve(SCHEDULE),
    },
    notifier: {
      announce: () => {},
      onMutation: () => () => {},
      close: () => {},
    },
    clock: {
      now: () => 0,
      sleep: () => Promise.resolve(),
    },
    ids: {
      id: (prefix) => `${prefix}-test`,
    },
    draftCleaner: {
      clearDraftSave: () => Promise.resolve(),
    },
  };
}
interface HarnessOptions {
  loadCatalog?: () => Promise<SeasonDraftCatalog>;
  loadPlayersIndex?: () => Promise<readonly PlayersIndexEntry[]>;
  portsGate?: Promise<void>;
  onPortsCalled?: () => void;
}
function createHarness(active: SeasonRunSnapshot | null, options: HarnessOptions = {}) {
  const fakeRepo = createFakeRepo(active);
  const runner = new FakeRunner();
  const shell = new SeasonRunShell({
    createPorts: async () => {
      options.onPortsCalled?.();
      if (options.portsGate !== undefined) await options.portsGate;
      return sessionOptions(fakeRepo.repo, runner);
    },
    loadManifest: () => Promise.resolve(manifestFixture()),
    loadLeague: () => Promise.resolve(LEAGUE),
    loadSchedule: () => Promise.resolve(SCHEDULE),
    loadPlayersIndex: options.loadPlayersIndex ?? (() => Promise.resolve([])),
    loadCatalog:
      options.loadCatalog ?? (() => Promise.reject(new Error('catalog unavailable in tests'))),
    scheduleLazyWork: () => {},
  } satisfies Partial<SeasonRunShellDeps>);
  return {
    shell,
    runner,
    upsertCalls: fakeRepo.upsertCalls,
    setActive: (snapshot: SeasonRunSnapshot | null) => {
      fakeRepo.setActive(snapshot);
    },
  };
}
describe('SeasonRunShell committed snapshot adoption', () => {
  it('adopts committed snapshots and refreshes derived views', async () => {
    const run = BASE_RUN;
    const harness = createHarness(snapshotOf(run, 2));
    const shell = harness.shell;
    await shell.init();
    expect(shell.ready).toBe(true);
    expect(shell.run).toBe(run);
    expect(shell.humanFranchiseId).toBe(HUMAN);
    expect(shell.humanTeam?.franchiseId).toBe(HUMAN);
    expect(shell.nextBlockIndex).toBe(2);
    expect(shell.seasonComplete).toBe(false);
    expect(shell.health).toBe(run.health);
    expect(shell.influence).toBe(run.influence);
    expect(shell.freeAgency).toBe(run.freeAgency);
    expect(shell.objectives).toBe(run.objectives);
    expect(shell.challenges).toBe(run.challenges);
    expect(shell.franchiseName(HUMAN)).toBe('Los Angeles Lakers');
    expect(shell.franchiseName('celtics')).toBe('celtics');
    expect(shell.playerName(FIRST_PLAYER_VERSION_ID)).toBe('Fixture lakers 1');
    const committedRun: SeasonRun = { ...run, health: { ...run.health } };
    harness.setActive(snapshotOf(committedRun, 9));
    await shell.refresh();
    expect(shell.run).toBe(committedRun);
    expect(shell.nextBlockIndex).toBe(9);
    expect(shell.seasonComplete).toBe(true);
    expect(shell.health).toBe(committedRun.health);
    shell.dispose();
  });
});
describe('SeasonRunShell heavy state', () => {
  it('keeps local editor edits and the trade clone across progress emits', async () => {
    const trade = tradeFixture();
    const run: SeasonRun = { ...BASE_RUN, trade };
    const harness = createHarness(snapshotOf(run));
    const shell = harness.shell;
    await shell.init();
    const editor = shell.editor;
    if (editor === null) throw new Error('expected a rotation editor');
    const tradeClone = shell.trade;
    expect(tradeClone).not.toBeNull();
    expect(tradeClone).not.toBe(trade);
    editor.setMinutes(FIRST_PLAYER_VERSION_ID, 20);
    const editedRotation = editor.rotation;
    const session = shell.hub;
    if (session === null) throw new Error('expected a session');
    session.block = runningBlock('req-progress', 0);
    harness.runner.emit(progressEvent('req-progress', 0, 1));
    expect(shell.block.phase).toBe('running');
    expect(shell.block.gamesCompleted).toBe(1);
    expect(shell.editor).toBe(editor);
    expect(shell.editor?.rotation).toBe(editedRotation);
    expect(shell.editor?.minutesFor(FIRST_PLAYER_VERSION_ID)).toBe(20);
    expect(shell.trade).toBe(tradeClone);
    harness.runner.emit(progressEvent('req-progress', 0, 2));
    expect(shell.block.gamesCompleted).toBe(2);
    expect(shell.editor).toBe(editor);
    expect(shell.editor?.rotation).toBe(editedRotation);
    expect(shell.trade).toBe(tradeClone);
    shell.dispose();
  });
  it('keeps local editor edits and the trade clone across a commit with unchanged rotations', async () => {
    const trade = tradeFixture();
    const run: SeasonRun = { ...BASE_RUN, trade };
    const harness = createHarness(snapshotOf(run));
    const shell = harness.shell;
    await shell.init();
    const editor = shell.editor;
    if (editor === null) throw new Error('expected a rotation editor');
    const tradeClone = shell.trade;
    editor.setMinutes(FIRST_PLAYER_VERSION_ID, 20);
    const committedRun: SeasonRun = { ...run, health: { ...run.health } };
    harness.setActive(snapshotOf(committedRun));
    await shell.refresh();
    expect(shell.run).toBe(committedRun);
    expect(shell.health).toBe(committedRun.health);
    expect(shell.editor).toBe(editor);
    expect(shell.editor?.minutesFor(FIRST_PLAYER_VERSION_ID)).toBe(20);
    expect(shell.trade).toBe(tradeClone);
    shell.dispose();
  });
  it('delegates commands to the session and tops up the slice after respondToTradeCounter', async () => {
    const run = BASE_RUN;
    const harness = createHarness(snapshotOf(run));
    const shell = harness.shell;
    await shell.init();
    const session = shell.hub;
    if (session === null) throw new Error('expected a session');
    const respond = vi.spyOn(session, 'respondToTradeCounter').mockResolvedValue();
    shell.catalog = catalogFor(run);
    const input = { windowIndex: 0, inquiryId: 'inq-1', accept: true };
    await shell.respondToTradeCounter(input);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(input);
    expect(harness.upsertCalls).toHaveLength(1);
    expect(harness.upsertCalls[0]?.runId).toBe(run.runId);
    expect(harness.upsertCalls[0]?.entries).toHaveLength(10);
    expect(shell.playerSlice.size).toBe(10);
    expect(
      shell.playerSlice.get(FIRST_PLAYER_VERSION_ID)?.positionsPlayable.length,
    ).toBeGreaterThan(0);
    shell.dispose();
  });
  it('acknowledgeExternalChange clears the banner locally', async () => {
    const harness = createHarness(snapshotOf(BASE_RUN));
    const shell = harness.shell;
    await shell.init();
    const session = shell.hub;
    if (session === null) throw new Error('expected a session');
    session.block = runningBlock('req-ack', 0);
    session.externalChange = {
      kind: 'commit',
      message: 'The season advanced to block 2 in another tab.',
    };
    harness.runner.emit(progressEvent('req-ack', 0, 1));
    expect(shell.externalChange).not.toBeNull();
    shell.acknowledgeExternalChange();
    expect(shell.externalChange).toBeNull();
    expect(session.externalChange).toBeNull();
    shell.dispose();
  });
});
describe('SeasonRunShell lifecycle', () => {
  it('dispose destroys the session and later emits cannot mutate the shell', async () => {
    const harness = createHarness(snapshotOf(BASE_RUN));
    const shell = harness.shell;
    await shell.init();
    const snapshotBefore = shell.snapshot;
    const session = shell.hub;
    if (session === null) throw new Error('expected a session');
    session.block = runningBlock('req-late', 0);
    shell.dispose();
    expect(harness.runner.terminateCalls).toBe(1);
    expect(shell.hub).toBeNull();
    harness.runner.emit(progressEvent('req-late', 0, 5));
    expect(shell.block.phase).toBe('idle');
    expect(shell.block.gamesCompleted).toBe(0);
    expect(shell.snapshot).toBe(snapshotBefore);
    expect(shell.ready).toBe(true);
  });
  it('never attaches a session when disposed while init awaits the ports', async () => {
    const portsCalled = Promise.withResolvers<undefined>();
    const portsGate = Promise.withResolvers<undefined>();
    const harness = createHarness(snapshotOf(BASE_RUN), {
      portsGate: portsGate.promise,
      onPortsCalled: () => {
        portsCalled.resolve(undefined);
      },
    });
    const subscribeSpy = vi.spyOn(SeasonSession.prototype, 'subscribe');
    const destroySpy = vi.spyOn(SeasonSession.prototype, 'destroy');
    const init = harness.shell.init();
    await portsCalled.promise;
    harness.shell.dispose();
    portsGate.resolve(undefined);
    await init;
    expect(harness.shell.hub).toBeNull();
    expect(harness.shell.ready).toBe(false);
    expect(subscribeSpy).not.toHaveBeenCalled();
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });
});
