import { describe, expect, it } from 'vitest';
import type { SeasonGame, SeasonRotation } from '@hoop-rush/data-contracts';
import { buildSeasonDraftCatalog, buildSeasonRotation } from '@hoop-rush/test-fixtures';
import {
  buildLockPreview,
  gamesToLockForBlock,
  humanUpcomingGames,
  pendingRotationSetDigest,
} from './season-lock-preview';

/**
 * M2.3 "What changed?" lock preview unit tests (spec/2.0/11 block lock
 * preview): games that will lock, upcoming human games, the set-digest
 * comparison, and the granular per-player diff.
 */

const CATALOG = buildSeasonDraftCatalog({
  franchiseIds: ['lakers'],
  eras: ['1990s'],
  playersPerPool: 10,
});
const POOL = CATALOG.pools[0];
if (POOL === undefined) {
  throw new Error('fixture catalog has no pool');
}
const IDS = POOL.playerVersionIds;

function rotation(playerVersionIds: string[] = IDS, minutes: number[] = []): SeasonRotation {
  const built = buildSeasonRotation('lakers', playerVersionIds);
  if (minutes.length === 0) return built;
  return {
    ...built,
    targetMinutes: built.targetMinutes.map((entry, index) => ({
      ...entry,
      minutes: minutes[index] ?? entry.minutes,
    })),
  };
}

const NAMES = new Map<string, string>(
  CATALOG.candidates.map((c) => [c.playerVersionId, c.displayName]),
);

function games(): SeasonGame[] {
  const make = (gameId: string, round: number, home: string, away: string): SeasonGame => ({
    gameId,
    round,
    homeFranchiseId: home,
    awayFranchiseId: away,
    status: 'scheduled',
    homeScore: null,
    awayScore: null,
    forfeitLoserFranchiseId: null,
  });
  return [
    make('s000001', 1, 'lakers', 'celtics'),
    make('s000002', 1, 'bulls', 'lakers'),
    make('s000003', 2, 'lakers', 'knicks'),
    make('s000004', 2, 'spurs', 'lakers'),
    make('s000005', 11, 'lakers', 'heat'),
    make('s000006', 81, 'celtics', 'lakers'),
    make('s000007', 82, 'lakers', 'celtics'),
  ];
}

describe('gamesToLockForBlock', () => {
  it('locks ten games for blocks 0-7 and two for the final block', () => {
    for (let block = 0; block < 8; block += 1) {
      expect(gamesToLockForBlock(block)).toBe(10);
    }
    expect(gamesToLockForBlock(8)).toBe(2);
  });
});

describe('humanUpcomingGames', () => {
  it('lists only the human team games inside the block round range', () => {
    const upcoming = humanUpcomingGames(games(), 'lakers', 0);
    expect(upcoming).toHaveLength(4);
    const first = upcoming[0];
    const last = upcoming[3];
    if (first === undefined) {
      throw new Error('expected upcoming games');
    }
    if (last === undefined) {
      throw new Error('expected upcoming games');
    }
    expect(first.round).toBe(1);
    expect(first.humanIsHome).toBe(true);
    expect(first.opponentFranchiseId).toBe('celtics');
    expect(last.humanIsHome).toBe(false);
    expect(last.opponentFranchiseId).toBe('spurs');
  });

  it('returns the final two games for block 8', () => {
    const upcoming = humanUpcomingGames(games(), 'lakers', 8);
    expect(upcoming.map((game) => game.round)).toEqual([81, 82]);
  });
});

describe('buildLockPreview', () => {
  const base = {
    pendingSetDigest: 'a'.repeat(32),
    lastLockedDigest: null,
    blockIndex: 0,
    names: NAMES,
    games: games(),
    humanFranchiseId: 'lakers',
  };

  it('shows no changes and ten locked games on a fresh block', () => {
    const preview = buildLockPreview({
      ...base,
      pendingHumanRotation: rotation(),
      baselineHumanRotation: rotation(),
    });
    expect(preview.gamesToLock).toBe(10);
    expect(preview.roundRange).toEqual({ fromRound: 1, toRound: 10 });
    expect(preview.changes).toEqual([]);
    expect(preview.unchangedSinceLastLock).toBe(false);
    expect(preview.upcomingGames).toHaveLength(4);
  });

  it('reports unchanged since the last lock when the set digest matches', () => {
    const pending = rotation();
    const preview = buildLockPreview({
      ...base,
      pendingHumanRotation: pending,
      baselineHumanRotation: rotation(),
      pendingSetDigest: 'b'.repeat(32),
      lastLockedDigest: 'b'.repeat(32),
    });
    expect(preview.unchangedSinceLastLock).toBe(true);
  });

  it('diffs minute changes per player', () => {
    const baseline = rotation();
    const pending = rotation(IDS, [36, 32, 32, 32, 32, 18, 18, 16, 12, 12]);
    const preview = buildLockPreview({
      ...base,
      pendingHumanRotation: pending,
      baselineHumanRotation: baseline,
    });
    const starter0 = IDS[0];
    if (starter0 === undefined) {
      throw new Error('fixture pool has no candidate ids');
    }
    const change = preview.changes.find((c) => c.playerVersionId === starter0);
    if (change === undefined) {
      throw new Error(`expected a change for ${starter0}`);
    }
    expect(change.minutesBefore).toBe(32);
    expect(change.minutesAfter).toBe(36);
  });

  it('diffs role changes when a bench player becomes a starter', () => {
    const pending = rotation();
    const benchPlayer = pending.benchOrder[0];
    if (benchPlayer === undefined) {
      throw new Error('fixture rotation has no bench order');
    }
    const incumbent = pending.starters[0];
    if (incumbent === undefined) {
      throw new Error('fixture rotation has no starters');
    }
    const starters = [...pending.starters];
    const bench = [...pending.benchOrder];
    starters[0] = benchPlayer;
    bench[bench.indexOf(benchPlayer)] = incumbent;
    const baseline = rotation();
    const preview = buildLockPreview({
      ...base,
      pendingHumanRotation: { ...pending, starters, benchOrder: bench },
      baselineHumanRotation: baseline,
    });
    const change = preview.changes.find((c) => c.playerVersionId === benchPlayer);
    if (change === undefined) {
      throw new Error(`expected a change for ${benchPlayer}`);
    }
    expect(change.roleBefore).toBe('Bench 1');
    expect(change.roleAfter).toBe('Starter PG');
  });
});

describe('pendingRotationSetDigest', () => {
  it('computes the merged set digest with the human rotation swapped', () => {
    const otherIds = Array.from({ length: 10 }, (_, i) => `pv-${'b'.repeat(31)}${String(i)}`);
    const runRotations = [
      rotation(otherIds),
      rotation(IDS, [36, 32, 32, 32, 32, 18, 18, 16, 12, 12]),
    ];
    const pending = rotation(IDS, [36, 32, 32, 32, 32, 18, 18, 16, 12, 12]);
    const digest = pendingRotationSetDigest(runRotations, pending);
    expect(digest).toMatch(/^[0-9a-f]{32}$/);
  });
});
