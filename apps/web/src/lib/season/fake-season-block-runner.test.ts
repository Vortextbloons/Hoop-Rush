import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSeasonLeague } from '@hoop-rush/test-fixtures';
import type { SeasonBlockStartInput } from './season-block-runner';
import { FakeSeasonBlockRunner } from './fake-season-block-runner';

/**
 * FakeSeasonBlockRunner unit tests: the deterministic e2e runner streams
 * progress, cancels between games, retries idempotently, and never produces
 * tied finals (the engine rejects ties).
 */

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
const TEAMS = LEAGUE.teams.map((team) => team.franchiseId);

function minimalInput(): SeasonBlockStartInput {
  const rosters = TEAMS.map((franchiseId, teamIndex) => ({
    franchiseId,
    players: Array.from({ length: 10 }, (_, slot) => ({
      playerVersionId: `pv-${(teamIndex * 10 + slot).toString(16).padStart(32, '0')}`,
      playerId: `p-${franchiseId}-${String(slot)}`,
      franchiseId,
      eraId: '1990s',
      seasonKey: '1995-96',
      displayName: `Fixture ${franchiseId} ${String(slot)}`,
    })),
  }));
  const games = [];
  let gameId = 1;
  for (let round = 1; round <= 82; round += 1) {
    for (let i = 0; i < 15; i += 1) {
      const home = TEAMS[(round + i) % 30];
      if (home === undefined) {
        throw new Error(`fixture league has no team at index ${String((round + i) % 30)}`);
      }
      const away = TEAMS[(round + i + 8) % 30];
      if (away === undefined) {
        throw new Error(`fixture league has no team at index ${String((round + i + 8) % 30)}`);
      }
      games.push({
        gameId: `s${String(gameId).padStart(6, '0')}`,
        round,
        homeFranchiseId: home,
        awayFranchiseId: away,
        status: 'scheduled' as const,
        homeScore: null,
        awayScore: null,
        forfeitLoserFranchiseId: null,
      });
      gameId += 1;
    }
  }
  return {
    run: {
      runId: 'run-fake',
      rootSeed: 'a'.repeat(32),
      league: LEAGUE,
      rosters,
      games,
    } as unknown as SeasonBlockStartInput['run'],
    rotations: [],
    blockIndex: 0,
    expectedRevision: 0,
    rotationDigest: 'b'.repeat(32),
    commandId: 'blk-fake-1',
    humanFranchiseId: 'lakers',
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
    // The flag is consumed, so the next startBlock runs to completion.
    const requestId2 = runner.startBlock({ ...minimalInput(), commandId: 'blk-fake-2' });
    expect(requestId2).not.toBe(requestId);
    await vi.advanceTimersByTimeAsync(3000);
    expect(events.filter((e) => e === 'complete').length).toBe(1);
  });
});
