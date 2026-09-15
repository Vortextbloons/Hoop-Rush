import { describe, expect, it } from 'vitest';
import { eraIdSchema, playerIdSchema, type SimulationPlayer } from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildEraSimulationProfile,
  buildSimulationPlayer,
} from '@hoop-rush/test-fixtures';
import { DRAFT_FIT_TOP_COUNT, scoreDraftPool } from './draft-fit-projection.ts';
import { buildProjectionModel } from '../projection/projection.test-helpers.ts';

const POSITIONS: SimulationPlayer['positions'][] = [['PG'], ['SG'], ['SF'], ['PF'], ['C']];

function poolPlayer(
  index: number,
  ratings?: Partial<SimulationPlayer['ratings']>,
  tendencies?: Partial<SimulationPlayer['tendencies']>,
): SimulationPlayer {
  const player = buildSimulationPlayer({
    playerId: playerIdSchema.parse(`p-fit-${String(index)}`),
    displayName: `Fit ${String(index)}`,
    positions: POSITIONS[index % POSITIONS.length] ?? ['PG'],
  });
  if (ratings !== undefined) player.ratings = { ...player.ratings, ...ratings };
  if (tendencies !== undefined) player.tendencies = { ...player.tendencies, ...tendencies };
  return player;
}

function rolePlayer(
  index: number,
  ratings: Partial<SimulationPlayer['ratings']>,
  tendencies: Partial<SimulationPlayer['tendencies']>,
  positions: SimulationPlayer['positions'],
): SimulationPlayer {
  const player = poolPlayer(index, ratings, tendencies);
  return { ...player, positions };
}

const NON_SHOOTER_RATINGS: Partial<SimulationPlayer['ratings']> = {
  threePoint: 35,
  midrange: 45,
  freeThrow: 60,
};
const NON_SHOOTER_TENDENCIES: Partial<SimulationPlayer['tendencies']> = {
  usageRate: 16,
  threePointRate: 6,
  turnoverRate: 10,
};
const SHOOTER_TENDENCIES: Partial<SimulationPlayer['tendencies']> = {
  usageRate: 16,
  threePointRate: 35,
  turnoverRate: 10,
};

function nonShooter(index: number, positions?: SimulationPlayer['positions']): SimulationPlayer {
  return rolePlayer(
    index,
    NON_SHOOTER_RATINGS,
    NON_SHOOTER_TENDENCIES,
    positions ?? POSITIONS[index % POSITIONS.length] ?? ['PG'],
  );
}

function shooter(
  index: number,
  threePoint: number,
  positions: SimulationPlayer['positions'] = ['SG'],
): SimulationPlayer {
  return rolePlayer(
    index,
    { threePoint, midrange: 60, freeThrow: 70 },
    SHOOTER_TENDENCIES,
    positions,
  );
}

describe('scoreDraftPool', () => {
  it('is deterministic across runs', () => {
    const locked = [poolPlayer(1), poolPlayer(2), poolPlayer(3)];
    const candidates = [poolPlayer(4), poolPlayer(5), poolPlayer(6), poolPlayer(7)];
    const first = scoreDraftPool({ candidates, locked });
    const second = scoreDraftPool({ candidates, locked });
    expect(second.digest).toBe(first.digest);
    expect(second.scores.map((entry) => entry.playerId)).toEqual(
      first.scores.map((entry) => entry.playerId),
    );
  });

  it('returns an empty report for an empty pool', () => {
    const report = scoreDraftPool({ candidates: [], locked: [poolPlayer(1)] });
    expect(report.scores).toEqual([]);
    expect(report.top).toEqual([]);
    expect(report.refinedCount).toBe(0);
  });

  it('filters out already-locked candidates', () => {
    const locked = [poolPlayer(1), poolPlayer(2)];
    const candidates = [poolPlayer(1), poolPlayer(3)];
    const report = scoreDraftPool({ candidates, locked });
    expect(report.scores.map((entry) => entry.playerId)).toEqual(['p-fit-3']);
  });

  it('ranks available talent without fit context when nothing is locked', () => {
    const candidates = [poolPlayer(1, { threePoint: 40 }), poolPlayer(2, { threePoint: 80 })];
    const report = scoreDraftPool({ candidates, locked: [] });
    expect(report.refinedCount).toBe(0);
    expect(report.scores[0]?.tier).toBe('strong');
    expect(report.scores[0]?.primaryNeed).toBe('balance');
    expect(report.scores[1]?.tier).toBe('solid');
  });

  it('refines the heuristic screen with marginal projection', () => {
    const locked = [nonShooter(10, ['PG']), nonShooter(12, ['SF']), nonShooter(14, ['C'])];
    const candidates = [
      nonShooter(11, ['SG']),
      shooter(15, 88),
      shooter(16, 72, ['SF']),
      nonShooter(17, ['PF']),
    ];
    const report = scoreDraftPool({
      candidates,
      locked,
      projection: {
        eraProfile: DEFAULT_ERA_SIM_PROFILE,
        model: buildProjectionModel(),
        refineTopN: 4,
      },
    });
    expect(report.refinedCount).toBeGreaterThan(0);
    expect(report.scores[0]?.playerId).toBe('p-fit-15');
    expect(report.scores[0]?.refined).toBe(true);
    expect(report.scores[0]?.netDelta).not.toBeNull();
    expect(report.scores[0]?.primaryNeed).toBe('spacing');
    expect(report.top.length).toBeLessThanOrEqual(DRAFT_FIT_TOP_COUNT);
    const nets = report.scores.filter((entry) => entry.refined).map((entry) => entry.netDelta ?? 0);
    expect([...nets].sort((a, b) => b - a)).toEqual(nets);
  });

  it('prefers an elite spacer over a poor one for a spacing-starved group', () => {
    const locked = [nonShooter(20, ['PG']), nonShooter(24, ['C'])];
    const candidates = [nonShooter(23), shooter(26, 90)];
    const report = scoreDraftPool({
      candidates,
      locked,
      projection: {
        eraProfile: DEFAULT_ERA_SIM_PROFILE,
        model: buildProjectionModel(),
        refineTopN: 2,
      },
    });
    expect(report.scores[0]?.playerId).toBe('p-fit-26');
    expect(report.missingNeeds).toContain('spacing');
  });

  it('falls back to heuristics when the projection era is unavailable', () => {
    const locked = [poolPlayer(31), poolPlayer(32)];
    const candidates = [poolPlayer(33), poolPlayer(34)];
    const report = scoreDraftPool({
      candidates,
      locked,
      projection: {
        eraProfile: buildEraSimulationProfile({ eraId: eraIdSchema.parse('2000s') }),
        model: buildProjectionModel(),
        refineTopN: 2,
      },
    });
    expect(report.refinedCount).toBe(0);
    expect(report.scores).toHaveLength(2);
    expect(report.scores.every((entry) => !entry.refined)).toBe(true);
  });

  it('skips refinement for a full five and still ranks heuristically', () => {
    const locked = [poolPlayer(41), poolPlayer(42), poolPlayer(43), poolPlayer(44), poolPlayer(45)];
    const candidates = [poolPlayer(46), poolPlayer(47)];
    const report = scoreDraftPool({
      candidates,
      locked,
      projection: {
        eraProfile: DEFAULT_ERA_SIM_PROFILE,
        model: buildProjectionModel(),
        refineTopN: 2,
      },
    });
    expect(report.refinedCount).toBe(0);
    expect(report.scores).toHaveLength(2);
  });
});
