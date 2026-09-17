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

  it('refines every legal candidate by default instead of hiding behind the screen', () => {
    const locked = [nonShooter(50, ['PG']), nonShooter(52, ['C'])];
    const candidates = [shooter(53, 88), shooter(54, 72, ['SF']), nonShooter(55, ['PF'])];
    const report = scoreDraftPool({
      candidates,
      locked,
      lockedSlots: ['G1', 'C'],
      projection: {
        eraProfile: DEFAULT_ERA_SIM_PROFILE,
        model: buildProjectionModel(),
      },
    });
    expect(report.refinedCount).toBe(report.scores.length);
    expect(report.scores.every((entry) => entry.refined)).toBe(true);
  });

  it('does not put heuristic fallbacks in the projected recommendation list', () => {
    const report = scoreDraftPool({
      candidates: [shooter(65, 88), shooter(66, 72), nonShooter(67, ['PF'])],
      locked: [nonShooter(68, ['PG']), nonShooter(69, ['C'])],
      lockedSlots: ['G1', 'C'],
      projection: {
        eraProfile: DEFAULT_ERA_SIM_PROFILE,
        model: buildProjectionModel(),
        refineTopN: 1,
      },
    });
    expect(report.refinedCount).toBe(1);
    expect(report.top).toHaveLength(1);
    expect(report.top[0]?.refined).toBe(true);
  });

  it('removes candidates that cannot complete the current slot layout', () => {
    const locked = [nonShooter(56, ['PG']), nonShooter(57, ['SG'])];
    const blocked = rolePlayer(58, {}, {}, ['PG']);
    const legal = rolePlayer(59, {}, {}, ['C']);
    const report = scoreDraftPool({
      candidates: [blocked, legal],
      locked,
      lockedSlots: ['G1', 'G2'],
    });
    expect(report.scores.map((entry) => entry.playerId)).toEqual(['p-fit-59']);
  });

  it('does not replace the recorded slot assignment with a first-fit fallback', () => {
    const report = scoreDraftPool({
      candidates: [rolePlayer(64, {}, {}, ['PG'])],
      locked: [rolePlayer(63, {}, {}, ['C'])],
      lockedSlots: ['G1'],
    });
    expect(report.scores).toEqual([]);
  });

  it('honors draft modes that do not allow displacing locked players', () => {
    const locked = [
      rolePlayer(70, {}, {}, ['PG', 'C']),
      rolePlayer(71, {}, {}, ['SG']),
      rolePlayer(72, {}, {}, ['SF']),
      rolePlayer(73, {}, {}, ['PF']),
    ];
    const candidate = rolePlayer(74, {}, {}, ['PG']);
    const blocked = scoreDraftPool({
      candidates: [candidate],
      locked,
      lockedSlots: ['G1', 'G2', 'F1', 'F2'],
      allowDisplacement: false,
    });
    const allowed = scoreDraftPool({
      candidates: [candidate],
      locked,
      lockedSlots: ['G1', 'G2', 'F1', 'F2'],
      allowDisplacement: true,
    });
    expect(blocked.scores).toEqual([]);
    expect(allowed.scores).toHaveLength(1);
  });

  it('keeps a positive fit explanation ahead of a role warning', () => {
    const locked = [
      rolePlayer(60, {}, { usageRate: 23 }, ['PG']),
      rolePlayer(61, {}, { usageRate: 23 }, ['SG']),
    ];
    const candidate = rolePlayer(
      62,
      { perimeterDefense: 90, interiorDefense: 82, defensiveIq: 86 },
      { usageRate: 26 },
      ['SF'],
    );
    const report = scoreDraftPool({ candidates: [candidate], locked });
    expect(report.scores[0]?.reasonLabel).not.toBe('Competes for on-ball possessions');
    expect(report.scores[0]?.warningLabel).toBe('Competes for on-ball possessions');
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
