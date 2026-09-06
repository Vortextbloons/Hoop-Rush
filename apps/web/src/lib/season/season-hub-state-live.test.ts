import { describe, expect, it, vi } from 'vitest';
import {
  franchiseIdSchema,
  seasonGameIdSchema,
  type SeasonScoreline,
} from '@hoop-rush/data-contracts';
import { SeasonHubState } from './season-hub-state';
import type { SeasonBlockRunner, SeasonRunnerEvent } from './season-block-runner';

class ControllableRunner implements SeasonBlockRunner {
  private listeners = new Set<(e: SeasonRunnerEvent) => void>();
  startBlock = vi.fn(() => 'req-1');
  resumeBlock = vi.fn(() => 'resume-1');
  cancel = vi.fn();
  terminate = vi.fn();
  prewarm = vi.fn();
  subscribe(listener: (e: SeasonRunnerEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(event: SeasonRunnerEvent) {
    for (const l of [...this.listeners]) l(event);
  }
}

function repo() {
  return {
    loadActiveRun: vi.fn(() => Promise.resolve(null)),
    loadActiveRunIndex: vi.fn(() => Promise.resolve(null)),
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
    upsertSeasonRunPlayerSlice: vi.fn(() => Promise.resolve(undefined)),
    commitPostseasonAdvancement: vi.fn(() => Promise.resolve()),
    loadPostseasonSummaries: vi.fn(() => Promise.resolve([])),
    loadPostseasonSummary: vi.fn(() => Promise.resolve(null)),
  };
}

function line(gameId: string): SeasonScoreline {
  return {
    gameId: seasonGameIdSchema.parse(gameId),
    homeFranchiseId: franchiseIdSchema.parse('lakers'),
    homeScore: 112,
    awayScore: 108,
    awayFranchiseId: franchiseIdSchema.parse('celtics'),
  };
}

function withGameId(base: SeasonScoreline, gameId: string): SeasonScoreline {
  return { ...base, gameId: seasonGameIdSchema.parse(gameId) };
}

function progressEvent(
  overrides: Partial<Extract<SeasonRunnerEvent, { type: 'progress' }>> = {},
): Extract<SeasonRunnerEvent, { type: 'progress' }> {
  const l = line('s000001');
  return {
    type: 'progress',
    requestId: 'req-1',
    blockIndex: 0,
    gamesCompleted: 1,
    gamesTotal: 150,
    latestGameId: seasonGameIdSchema.parse('s000001'),
    latestResult: { ...l },
    isHumanGame: false,
    humanRecordInBlock: { wins: 0, losses: 0 },
    humanResults: [],
    leaguePulse: { closest: { ...l }, blowout: { ...l }, highestScoring: { ...l } },
    ...overrides,
  };
}

describe('season hub live v10', () => {
  it('copies cumulative human results even when notification is throttled', () => {
    let now = 1000;
    const runner = new ControllableRunner();
    const hub = new SeasonHubState(repo() as never, runner, undefined, { now: () => now });
    hub.block = {
      requestId: 'req-1',
      blockIndex: 0,
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
    let emits = 0;
    hub.subscribe(() => {
      emits += 1;
    });
    runner.emit(progressEvent({ gamesCompleted: 1 }));
    expect(emits).toBe(1);
    now += 100;
    const humanLine = line('s000002');
    runner.emit(
      progressEvent({
        gamesCompleted: 2,
        latestGameId: seasonGameIdSchema.parse('s000002'),
        latestResult: withGameId(humanLine, 's000002'),
        isHumanGame: false,
        humanRecordInBlock: { wins: 1, losses: 0 },
        humanResults: [withGameId(humanLine, 's000002')],
        leaguePulse: {
          closest: withGameId(humanLine, 's000002'),
          blowout: withGameId(humanLine, 's000002'),
          highestScoring: withGameId(humanLine, 's000002'),
        },
      }),
    );
    expect(hub.block.humanResults).toHaveLength(1);
    expect(hub.block.humanRecordInBlock).toEqual({ wins: 1, losses: 0 });
    expect(emits).toBe(1);
    hub.destroy();
  });

  it('human games and finals bypass throttling', () => {
    let now = 5000;
    const runner = new ControllableRunner();
    const hub = new SeasonHubState(repo() as never, runner, undefined, { now: () => now });
    hub.block = {
      requestId: 'req-1',
      blockIndex: 0,
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
    let emits = 0;
    hub.subscribe(() => {
      emits += 1;
    });
    runner.emit(progressEvent({ gamesCompleted: 1 }));
    expect(emits).toBe(1);
    now += 50;
    const humanLine = line('s000010');
    runner.emit(
      progressEvent({
        gamesCompleted: 2,
        latestGameId: seasonGameIdSchema.parse('s000010'),
        latestResult: withGameId(humanLine, 's000010'),
        isHumanGame: true,
        humanRecordInBlock: { wins: 1, losses: 0 },
        humanResults: [withGameId(humanLine, 's000010')],
      }),
    );
    expect(emits).toBe(2);
    now += 50;
    runner.emit(progressEvent({ gamesCompleted: 150, gamesTotal: 150, isHumanGame: false }));
    expect(emits).toBe(3);
    hub.destroy();
  });

  it('drops stale blockIndex and handles cancelled/failed', () => {
    const runner = new ControllableRunner();
    const hub = new SeasonHubState(repo() as never, runner);
    hub.block = {
      requestId: 'req-1',
      blockIndex: 0,
      phase: 'running',
      gamesCompleted: 5,
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
    runner.emit(progressEvent({ blockIndex: 1, gamesCompleted: 99 }));
    expect(hub.block.gamesCompleted).toBe(5);
    runner.emit({ type: 'cancelled', requestId: 'req-1', blockIndex: 0 });
    expect(hub.block.phase).toBe('cancelled');
    hub.block.phase = 'running';
    runner.emit({
      type: 'error',
      requestId: 'req-1',
      blockIndex: 0,
      code: 'internal',
      message: 'boom',
      seed: null,
      gameId: null,
    });
    expect(hub.block.phase).toBe('failed');
    expect(hub.block.error?.message).toBe('boom');
    hub.destroy();
  });
});
