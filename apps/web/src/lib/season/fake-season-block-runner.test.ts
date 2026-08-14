import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';
import { generateSeasonSchedule, seasonRotationSetDigest } from '@hoop-rush/engine';
import type { SeasonBlockStartInput } from './season-block-runner';
import { FakeSeasonBlockRunner } from './fake-season-block-runner';

vi.mock('$lib/season/season-repo', () => ({
  getSeasonRunRepository: vi.fn(() =>
    Promise.resolve({
      loadActiveRun: vi.fn(() => null),
      commitSeasonBlock: vi.fn(() => undefined),
    }),
  ),
}));

vi.mock('@hoop-rush/persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@hoop-rush/persistence')>()),
  loadActiveRunWithSchedule: vi.fn(() => null),
}));

const LEAGUE = buildSeasonLeague({}, { humanFranchiseId: 'lakers' });
const SCHEDULE = generateSeasonSchedule({ league: LEAGUE, seed: 'a'.repeat(32) });

function minimalInput(): SeasonBlockStartInput {
  const run = buildSeasonRunFixture({ schedule: SCHEDULE, stateDigest: '0'.repeat(32) });
  return {
    run,
    effects: {
      schemaVersion: 2,
      playerStates: [],
      inactivePlayerStates: [],
      pairStates: [],
      archivedPairs: [],
    },
    rotations: run.rotations,
    blockIndex: 0,
    expectedRevision: 0,
    rotationDigest: seasonRotationSetDigest(run.rotations),
    commandId: 'blk-fake-1',
    humanFranchiseId: 'lakers',
    objectiveId: null,
    homeCourt: {
      schemaVersion: 1,
      profileVersion: 'season-home-court-v1',
      homeDefensiveCommunication: 0,
      awayTurnoverPressure: 0,
      targetHomeWinRate: 0.575,
    },
    catalogUrl: '',
    catalogHash: '0'.repeat(64),
    profileUrl: '',
    profileHash: '0'.repeat(64),
  };
}

function withWindow(shim: Record<string, unknown>): void {
  (globalThis as Record<string, unknown>).window = shim;
}

describe('FakeSeasonBlockRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete (globalThis as Record<string, unknown>).window;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('streams progress to completion with no tied finals', async () => {
    const runner = new FakeSeasonBlockRunner();
    const events: string[] = [];
    runner.subscribe((event) => {
      events.push(`${event.type}:${'gamesCompleted' in event ? String(event.gamesCompleted) : ''}`);
      if (event.type === 'progress' && event.latestResult) {
        expect(event.latestResult.homeScore).not.toBe(event.latestResult.awayScore);
      }
    });
    const requestId = runner.startBlock(minimalInput());
    expect(events[0]).toBe('started:');
    await vi.advanceTimersByTimeAsync(3000);
    expect(events.some((e) => e === 'progress:150')).toBe(true);
    expect(events.some((e) => e.startsWith('complete:'))).toBe(true);
    expect(events.some((e) => e.startsWith('error:'))).toBe(false);
    expect(requestId.length).toBeGreaterThan(0);
  });

  it('stalls on the first startBlock when the e2e flag is set, then cancels', async () => {
    withWindow({ __HOOP_RUSH_E2E_STALL_ONCE__: true });
    const runner = new FakeSeasonBlockRunner();
    const events: string[] = [];
    runner.subscribe((event) => events.push(event.type));
    const requestId = runner.startBlock({ ...minimalInput(), commandId: 'blk-fake-1' });
    expect(events[0]).toBe('started');
    expect(events[1]).toBe('progress');
    runner.cancel(requestId);
    expect(events[2]).toBe('cancelled');

    const requestId2 = runner.startBlock({ ...minimalInput(), commandId: 'blk-fake-2' });
    expect(requestId2).not.toBe(requestId);
    await vi.advanceTimersByTimeAsync(3000);
    expect(events.filter((e) => e === 'complete').length).toBe(1);
  });
});
