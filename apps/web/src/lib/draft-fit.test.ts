import { describe, expect, it } from 'vitest';
import {
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
  playerIdSchema,
  type PeakPlayerSeason,
} from '@hoop-rush/data-contracts';
import { DEFAULT_ERA_SIM_PROFILE, buildPlayerSeason } from '@hoop-rush/test-fixtures';
import { buildProjectionModel } from '@hoop-rush/engine/test-helpers/projection';
import {
  FIT_NEED_META,
  FIT_TIER_META,
  formatNetDelta,
  heuristicDraftPoolReport,
  nextPageWindow,
  poolRowKey,
  scoreDraftPoolMemo,
  type DraftFitContext,
} from './draft-fit';

function peak(
  id: string,
  threePoint: number,
  playable: PeakPlayerSeason['positions']['playable'],
): PeakPlayerSeason {
  return buildPlayerSeason({
    playerId: playerIdSchema.parse(id),
    displayName: `Draftee ${id}`,
    positions: {
      primary: playable[0] ?? 'SG',
      secondary: [],
      playable: [...playable],
      sourceLabels: [...playable],
      normalizationVersion: 'position-v3',
    },
    detailedRatings: { ...SIMULATION_RATINGS, threePoint },
    tendencies: { ...SIMULATION_TENDENCIES, usageRate: 16, threePointRate: 30 },
    summaryRatings: {
      overallRating: Math.round(60 + threePoint / 5),
      offenseRating: 65,
      defenseRating: 65,
    },
  });
}

function context(): DraftFitContext {
  return { eraProfile: DEFAULT_ERA_SIM_PROFILE, model: buildProjectionModel() };
}

describe('draft-fit presentation', () => {
  it('covers every tier and need with a label', () => {
    expect(Object.keys(FIT_TIER_META)).toEqual(['best', 'strong', 'solid', 'situational', 'poor']);
    expect(Object.keys(FIT_NEED_META)).toEqual([
      'spacing',
      'creation',
      'defense',
      'rebounding',
      'balance',
    ]);
    for (const meta of [...Object.values(FIT_TIER_META), ...Object.values(FIT_NEED_META)]) {
      expect(meta.label.length).toBeGreaterThan(0);
    }
  });

  it('formats net deltas for display', () => {
    expect(formatNetDelta(null)).toBe('Heuristic');
    expect(formatNetDelta(2.34)).toBe('+2.3 NET');
    expect(formatNetDelta(-1)).toBe('-1 NET');
    expect(formatNetDelta(0)).toBe('0 NET');
  });
});

describe('page-window helpers', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    franchiseId: 'lakers',
    eraId: '1990s',
    playerId: `p-page-${String(i)}`,
  }));
  it('keys rows by franchise, era, and player', () => {
    expect(poolRowKey({ franchiseId: 'lakers', eraId: '1990s', playerId: 'p-page-0' })).toBe(
      'lakers/1990s/p-page-0',
    );
  });
  it('returns the slice after the visible window', () => {
    const visible = rows.slice(0, 48);
    const upcoming = nextPageWindow(rows, visible);
    expect(upcoming).toHaveLength(48);
    expect(upcoming[0]?.playerId).toBe('p-page-48');
  });
  it('returns a short tail at the end of the list', () => {
    const visible = rows.slice(48, 96);
    const upcoming = nextPageWindow(rows, visible);
    expect(upcoming).toHaveLength(4);
  });
  it('returns nothing for an empty or unknown window', () => {
    expect(nextPageWindow(rows, [])).toEqual([]);
    expect(nextPageWindow(rows, [{ franchiseId: 'x', eraId: 'y', playerId: 'p-zzz' }])).toEqual([]);
  });
});

describe('heuristicDraftPoolReport', () => {
  it('ranks the pool deterministically and drops locked players', () => {
    const locked = [peak('p-lock-1', 40, ['PG']), peak('p-lock-2', 42, ['C'])];
    const pool = [
      peak('p-lock-1', 40, ['PG']),
      peak('p-cand-1', 38, ['SG']),
      peak('p-cand-2', 88, ['SG']),
      peak('p-cand-3', 70, ['SF']),
    ];
    const first = heuristicDraftPoolReport({ pool, locked });
    const second = heuristicDraftPoolReport({ pool, locked });
    expect(first.digest).toBe(second.digest);
    expect(first.scores.map((entry) => entry.playerId)).not.toContain('p-lock-1');
    expect(first.scores).toHaveLength(3);
    expect(first.top.length).toBeLessThanOrEqual(5);
    expect(first.refinedCount).toBe(0);
  });
});

describe('scoreDraftPoolMemo', () => {
  it('memoizes repeat evaluations and refines with projection', () => {
    const locked = [peak('p-memo-lock-1', 40, ['PG']), peak('p-memo-lock-2', 42, ['C'])];
    const pool = [
      peak('p-memo-cand-1', 38, ['SG']),
      peak('p-memo-cand-2', 88, ['SG']),
      peak('p-memo-cand-3', 70, ['SF']),
    ];
    const first = scoreDraftPoolMemo({ pool, locked, context: context() });
    const second = scoreDraftPoolMemo({ pool, locked, context: context() });
    expect(second).toBe(first);
    expect(first.scores[0]?.playerId).toBe('p-memo-cand-2');
    const firstSlots = scoreDraftPoolMemo({
      pool,
      locked,
      lockedSlots: ['G1', 'C'],
      context: context(),
    });
    const secondSlots = scoreDraftPoolMemo({
      pool,
      locked,
      lockedSlots: ['G2', 'C'],
      context: context(),
    });
    expect(secondSlots).not.toBe(firstSlots);
    const reordered = scoreDraftPoolMemo({
      pool,
      locked: [locked[1]!, locked[0]!],
      lockedSlots: ['G1', 'C'],
      context: context(),
    });
    expect(reordered).not.toBe(firstSlots);
  });
});
