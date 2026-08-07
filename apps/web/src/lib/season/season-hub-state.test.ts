import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeasonEffectsState } from '@hoop-rush/data-contracts';
import type { SeasonRunSnapshot } from '@hoop-rush/persistence';
import { generateSeasonSchedule, seasonObjectiveChoicesForBlock } from '@hoop-rush/engine';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import { SeasonHubState, type BlockRunState } from './season-hub-state';
import { clearCachedSeasonSnapshot, setCachedSeasonSnapshot } from './season-state-cache';
import type {
  SeasonBlockResumeInput,
  SeasonBlockRunner,
  SeasonBlockStartInput,
  SeasonRunnerEvent,
} from './season-block-runner';

/**
 * SeasonHubState.quitRun unit tests: quitting stops an in-flight block
 * before the atomic clear, reloads the empty repository state afterwards,
 * and refuses to run when there is nothing to quit. The runner and the
 * repository are fakes; the hub contract itself is under test.
 */

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
    savePendingBlock: vi.fn(() => Promise.resolve()),
    loadPendingBlock: vi.fn(() => Promise.resolve(null)),
    discardPendingBlock: vi.fn(() => Promise.resolve()),
    applySeasonRunCommand: vi.fn(() => Promise.resolve()),
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

describe('SeasonHubState between-block commands', () => {
  afterEach(() => {
    clearCachedSeasonSnapshot();
  });

  it('reloads the persisted state after an accepted objective selection (stale snapshot cache regression)', async () => {
    // A real engine-valid run: after the accepted command the hub must
    // re-read the persisted run instead of serving the session snapshot
    // cache (keyed by runId + accepted-block count, neither of which
    // changes for between-block commands).
    const seed = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
    const league = buildSeasonLeague({}, { humanFranchiseId: 'lakers' });
    const schedule = generateSeasonSchedule({ league, seed });
    const effects: SeasonEffectsState = { schemaVersion: 1, playerStates: [], pairStates: [] };
    const run = {
      ...buildSeasonRunFixture({ schedule, league, seed, humanFranchiseId: 'lakers' }),
      effects,
    } as SeasonRunSnapshot['run'];
    const initial: SeasonRunSnapshot = {
      run,
      summaries: [],
      retainedDetails: [],
      acceptedBlocks: [],
      effects,
    };

    // The session cache holds the pre-command snapshot, exactly as it does
    // right after a block commit.
    setCachedSeasonSnapshot(initial);

    let active: SeasonRunSnapshot | null = initial;
    const repo = {
      loadActiveRun: vi.fn(() => Promise.resolve(active)),
      loadActiveRunIndex: vi.fn(() =>
        Promise.resolve({
          runId: run.runId,
          rootSeed: seed,
          humanFranchiseId: 'lakers',
          completedRounds: 0,
          revision: 0,
          humanWins: 0,
          humanLosses: 0,
          updatedAtIso: '2026-01-01T00:00:00.000Z',
        }),
      ),
      loadActiveRunIncompatible: vi.fn(() => Promise.resolve(null)),
      loadBlockSummaries: vi.fn(),
      loadRetainedDetails: vi.fn(),
      loadBlockHistory: vi.fn(),
      commitSeasonBlock: vi.fn(),
      promoteSeasonDraftToRun: vi.fn(),
      clearSeasonRun: vi.fn(() => Promise.resolve()),
      savePendingBlock: vi.fn(() => Promise.resolve()),
      loadPendingBlock: vi.fn(() => Promise.resolve(null)),
      discardPendingBlock: vi.fn(() => Promise.resolve()),
      applySeasonRunCommand: vi.fn((input: { run: SeasonRunSnapshot['run'] }) => {
        active = { ...initial, run: input.run };
        return Promise.resolve();
      }),
    };

    const runner = new FakeRunner();
    const hub = new SeasonHubState(repo, runner);
    await hub.refresh();
    expect(hub.snapshot).toBe(initial);

    const offered = seasonObjectiveChoicesForBlock(run.rootSeed, 0);
    await hub.selectBlockObjective({ blockIndex: 0, objectiveId: offered[0] ?? 'win-six' });

    expect(hub.commandError).toBeNull();
    expect(hub.snapshot?.run.objectives.selections[0]?.objectiveId).toBe(offered[0]);
    expect(repo.loadActiveRun).toHaveBeenCalledTimes(1);
    hub.destroy();
  });
});
