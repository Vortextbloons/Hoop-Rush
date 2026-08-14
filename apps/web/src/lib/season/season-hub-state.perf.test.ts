import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeasonRunSnapshot } from '@hoop-rush/persistence';
import type { SeasonEffectsState, SeasonRun } from '@hoop-rush/data-contracts';
import {
  SEASON_BLOCK_VERSION,
  SEASON_NEUTRAL_HOME_COURT,
  SEASON_RUN_SCHEMA_VERSION,
  type SeasonSubmitBlockCommand,
} from '@hoop-rush/data-contracts';
import { SeasonHubState } from './season-hub-state';
import { clearCachedSeasonSnapshot, getCachedSeasonSnapshot } from './season-state-cache';
import type {
  SeasonBlockRunner,
  SeasonBlockStartInput,
  SeasonRunnerEvent,
} from './season-block-runner';
import { createSeasonRunChannel } from './season-cross-tab';

/**
 * Season Hub performance pass tests: an accepted block updates the in-memory
 * snapshot from the runner's authoritative `complete` event WITHOUT a full
 * `loadActiveRun()` reload; a cold refresh still executes the full validated
 * load; and an external tab's commit/clear invalidates the cache, reloads,
 * and cancels stale local simulation.
 */

const RUN_ID = 'run-hub-perf';

function minimalSnapshot(overrides: Partial<SeasonRunSnapshot> = {}): SeasonRunSnapshot {
  return {
    run: {
      runId: RUN_ID,
      rootSeed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
      league: {
        schemaVersion: 1,
        leagueVersion: 'league-v1',
        teams: [
          {
            franchiseId: 'lakers',
            control: 'human',
            conference: 'east',
            division: 'atlantic',
          },
          {
            franchiseId: 'celtics',
            control: 'ai',
            conference: 'west',
            division: 'pacific',
          },
        ],
      },
      standings: {
        schemaVersion: 1,
        standingsVersion: 'standings-v1',
        rows: [
          {
            franchiseId: 'lakers',
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
            headToHead: [],
          },
        ],
      },
      cursor: { schemaVersion: 1, completedRounds: 0 },
      stateRevision: 0,
      stateDigest: '0'.repeat(32),
    } as unknown as SeasonRunSnapshot['run'],
    summaries: [],
    retainedDetails: [],
    acceptedBlocks: [],
    effects: {
      schemaVersion: 1,
      playerStates: [],
      pairStates: [],
    },
    ...overrides,
  };
}

class EmittingRunner implements SeasonBlockRunner {
  private readonly listeners = new Set<(event: SeasonRunnerEvent) => void>();
  cancelCalls: string[] = [];
  terminateCalls = 0;
  prewarmCalls = 0;
  /** The event the next startBlock emits after 'started'. */
  completion: SeasonRunnerEvent | null = null;

  startBlock(): string {
    const requestId = 'req-1';
    this.emit({ type: 'started', requestId, blockIndex: 0 });
    const completion = this.completion;
    if (completion !== null) {
      queueMicrotask(() => {
        this.emit(completion);
      });
    }
    return requestId;
  }

  resumeBlock(): string {
    return 'req-resume';
  }

  cancel(requestId: string): void {
    this.cancelCalls.push(requestId);
    this.emit({ type: 'cancelled', requestId, blockIndex: 0 });
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

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

function startEnvelope(run: SeasonRun, effects: SeasonEffectsState) {
  const command: SeasonSubmitBlockCommand = {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    blockVersion: SEASON_BLOCK_VERSION,
    command: 'submit-season-block',
    commandId: 'cmd-1',
    runId: RUN_ID,
    expectedRevision: 0,
    blockIndex: 0,
    rotationDigest: '0'.repeat(32),
    objectiveId: null,
    expectedStateRevision: 0,
    expectedStateDigest: '0'.repeat(32),
  };
  const start: SeasonBlockStartInput = {
    run,
    effects,
    rotations: [],
    blockIndex: 0,
    expectedRevision: 0,
    rotationDigest: '0'.repeat(32),
    commandId: 'cmd-1',
    humanFranchiseId: 'lakers',
    objectiveId: null,
    homeCourt: SEASON_NEUTRAL_HOME_COURT,
    catalogUrl: '',
    catalogHash: '0'.repeat(64),
    profileUrl: '',
    profileHash: '0'.repeat(64),
  };
  // The fixture run is a runtime cast (minimalSnapshot); eslint's type info
  // resolves it as an error-typed value, but the hub never validates the
  // start input shape.
  return { command, start };
}

function repoWith(initial: SeasonRunSnapshot | null, indexRevision: number) {
  let active = initial;
  let revision = indexRevision;
  return {
    loadActiveRun: vi.fn(() => Promise.resolve(active)),
    loadActiveRunIndex: vi.fn(() =>
      Promise.resolve(
        active === null
          ? null
          : {
              runId: RUN_ID,
              rootSeed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
              humanFranchiseId: 'lakers',
              completedRounds: 0,
              revision,
              humanWins: 0,
              humanLosses: 0,
              updatedAtIso: '2026-01-01T00:00:00.000Z',
            },
      ),
    ),
    loadActiveRunIncompatible: vi.fn(() => Promise.resolve(null)),
    loadBlockSummaries: vi.fn(() => Promise.resolve([])),
    loadRetainedDetails: vi.fn(() => Promise.resolve([])),
    loadBlockHistory: vi.fn(() => Promise.resolve([])),
    commitSeasonBlock: vi.fn(() => Promise.resolve()),
    promoteSeasonDraftToRun: vi.fn(() => Promise.resolve()),
    clearSeasonRun: vi.fn((runId: string) => {
      if (runId === RUN_ID) active = null;
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
    // M2.6 postseason repository surface (unused by these tests).
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
    /** Test hook: advances the persisted index revision (external commit). */
    setRevision(next: number): void {
      revision = next;
    },
  };
}

describe('SeasonHubState performance pass', () => {
  beforeEach(() => {
    clearCachedSeasonSnapshot();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies the runner complete snapshot directly without a full reload', async () => {
    const initial = minimalSnapshot();
    const repo = repoWith(initial, 0);
    const runner = new EmittingRunner();
    const hub = new SeasonHubState(repo, runner);
    await hub.refresh();
    expect(repo.loadActiveRun).toHaveBeenCalledTimes(1);

    const committed = minimalSnapshot({
      acceptedBlocks: [
        {
          runId: RUN_ID,
          blockIndex: 0,
          completedRounds: 10,
          revision: 1,
          commandId: 'cmd-1',
          rotationDigest: '0'.repeat(32),
          checkpointDigest: '0'.repeat(32),
          summaryCount: 150,
          stateRevision: 1,
          stateDigest: '0'.repeat(32),
        },
      ],
    });
    runner.completion = {
      type: 'complete',
      requestId: 'req-1',
      checkpoint: {
        blockIndex: 0,
        revision: 0,
        digest: '0'.repeat(32),
        runId: RUN_ID,
      } as unknown as import('@hoop-rush/data-contracts').SeasonCandidateCheckpoint,
      snapshot: committed,
    };

    hub.startBlock(startEnvelope(initial.run, initial.effects));
    await new Promise((resolve) => setTimeout(resolve, 10));

    // The hub holds the committed snapshot verbatim, the index advanced, the
    // session cache is primed, and NO full validated reload happened.
    expect(hub.snapshot).toBe(committed);
    expect(hub.index?.revision).toBe(1);
    expect(getCachedSeasonSnapshot()).toBe(committed);
    expect(repo.loadActiveRun).toHaveBeenCalledTimes(1);
    expect(hub.block.phase).toBe('idle');
    hub.destroy();
  });

  it('a cold refresh still executes the full validated load', async () => {
    const initial = minimalSnapshot();
    const repo = repoWith(initial, 0);
    const runner = new EmittingRunner();
    const hub = new SeasonHubState(repo, runner);
    await hub.refresh();
    // Nothing cached/in-memory at cold start: full validated load runs.
    expect(repo.loadActiveRun).toHaveBeenCalledTimes(1);
    expect(hub.snapshot).toBe(initial);
    // A second refresh with a matching in-memory snapshot skips the reload.
    await hub.refresh();
    expect(repo.loadActiveRun).toHaveBeenCalledTimes(1);
    hub.destroy();
  });

  it('an external commit invalidates the cache and reloads the snapshot', async () => {
    const initial = minimalSnapshot();
    const repo = repoWith(initial, 0);
    const runner = new EmittingRunner();
    const hub = new SeasonHubState(repo, runner);
    await hub.refresh();
    expect(hub.snapshot).toBe(initial);

    // Another tab announces a commit; the hub's own channel is a different
    // instance on the same BroadcastChannel name.
    const external = createSeasonRunChannel();
    repo.setRevision(3);
    external.announce({ kind: 'commit', runId: RUN_ID, revision: 3, committedAt: Date.now() });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(hub.externalChange).not.toBeNull();
    expect(hub.externalChange?.kind).toBe('commit');
    // The cache was invalidated and the repository reloaded.
    expect(getCachedSeasonSnapshot()).toBeNull();
    expect(repo.loadActiveRun).toHaveBeenCalledTimes(2);
    hub.acknowledgeExternalChange();
    expect(hub.externalChange).toBeNull();
    hub.destroy();
    external.close();
  });

  it('an external clear cancels stale local simulation safely', async () => {
    const initial = minimalSnapshot();
    const repo = repoWith(initial, 0);
    const runner = new EmittingRunner();
    const hub = new SeasonHubState(repo, runner);
    await hub.refresh();
    hub.startBlock(startEnvelope(initial.run, initial.effects));
    expect(hub.block.phase).toBe('running');

    const external = createSeasonRunChannel();
    // The other tab already cleared the run before announcing.
    await repo.clearSeasonRun(RUN_ID);
    external.announce({ kind: 'clear', runId: null, committedAt: Date.now() });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(runner.cancelCalls).toContain('req-1');
    // The local run is gone: the hub reloaded the empty repository state.
    expect(hub.snapshot).toBeNull();
    expect(hub.externalChange?.kind).toBe('clear');
    hub.destroy();
    external.close();
  });
});
