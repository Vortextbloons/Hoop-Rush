import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeasonRunSnapshot } from '@hoop-rush/persistence';
import type {
  SeasonBlockRunner,
  SeasonBlockStartInput,
  SeasonRunnerEvent,
} from './season-block-runner';
import { SeasonHubState, type BlockRunState } from './season-hub-state';

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
  private readonly listeners = new Set<(event: SeasonRunnerEvent) => void>();
  private lastBlockIndex = 0;

  startBlock(input: SeasonBlockStartInput): string {
    this.startCalls.push(input);
    this.lastBlockIndex = input.blockIndex;
    const requestId = `fake-${String(this.startCalls.length)}`;
    this.emit({ type: 'started', requestId, blockIndex: input.blockIndex });
    return requestId;
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
    loadBlockSummaries: vi.fn(),
    loadRetainedDetails: vi.fn(),
    loadBlockHistory: vi.fn(),
    commitSeasonBlock: vi.fn(),
    promoteSeasonDraftToRun: vi.fn(),
    clearSeasonRun: vi.fn((runId: string) => {
      if (runId === active?.run.runId) active = null;
      return Promise.resolve();
    }),
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
