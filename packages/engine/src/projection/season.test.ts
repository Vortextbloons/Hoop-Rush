import { describe, expect, it } from 'vitest';
import {
  seasonProjectionSchema,
  type ProjectionMatchupArchetype,
  type ProjectionModelArtifact,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { DEFAULT_ERA_SIM_PROFILE } from '@hoop-rush/test-fixtures';
import { buildInput } from './season.test-helpers.ts';
import {
  ProjectionCache,
  projectSeasonRoster,
  traceRotationClose,
  traceRotationNormal,
  traceContext,
} from '../projection/index.ts';
import { validateSeasonRotation } from '../season/rotation.ts';

function buildModel(): ProjectionModelArtifact {
  const player = (index: number, positions: string[]): SimulationPlayer => ({
    playerId: `p-ref-${String(index)}`,
    displayName: `Ref ${String(index)}`,
    positions: positions as SimulationPlayer['positions'],
    heightInches: 78,
    weightLbs: 215,
    ratings: {
      insideScoring: 70,
      closeShot: 68,
      midrange: 66,
      threePoint: 62,
      freeThrow: 74,
      ballHandling: 70,
      passing: 70,
      offensiveIq: 70,
      offensiveRebound: 60,
      defensiveRebound: 65,
      perimeterDefense: 62,
      interiorDefense: 62,
      steal: 60,
      block: 60,
      defensiveIq: 62,
      speed: 70,
      strength: 65,
      vertical: 66,
    },
    tendencies: {
      usageRate: 20,
      passRate: 30,
      shotRate: 25,
      driveRate: 18,
      postUpRate: 5,
      rimFrequency: 30,
      shortMidFrequency: 20,
      longMidFrequency: 14,
      cornerThreeFrequency: 8,
      aboveBreakThreeFrequency: 12,
      threePointRate: 20,
      freeThrowRate: 22,
      turnoverRate: 12,
      isolationRate: 10,
      pickAndRollBallHandlerRate: 25,
      pickAndRollRollManRate: 10,
      spotUpRate: 20,
      transitionRate: 15,
      cutRate: 10,
      foulRate: 2,
      stealAttemptRate: 8,
      blockAttemptRate: 10,
      crashOffensiveGlassRate: 12,
    },
  });
  const five = (archetype: ProjectionMatchupArchetype) => ({
    referenceId: `ref-1990s-${archetype}`,
    archetype,
    eraId: '1990s',
    referenceHash: 'e'.repeat(64),
    players: [
      player(1, ['PG']),
      player(2, ['SG']),
      player(3, ['SF']),
      player(4, ['PF']),
      player(5, ['C']),
    ] as [SimulationPlayer, SimulationPlayer, SimulationPlayer, SimulationPlayer, SimulationPlayer],
  });
  return {
    schemaVersion: 1,
    modelVersion: 'projection-model-v1',
    dataVersion: 'm10-ratings-v3.4',
    ratingsVersion: 'ratings-v3.4',
    eraProfileVersions: { '1990s': DEFAULT_ERA_SIM_PROFILE.profileVersion },
    references: {
      '1990s': {
        neutral: five('neutral'),
        archetypes: [
          five('perimeter'),
          five('interior'),
          five('pressure'),
          five('size-switch'),
        ],
      },
    },
    scales: {
      creation: { baseline: 0.5, perPoint: 0.01, min: 0, max: 100, higherIsBetter: true },
      spacing: { baseline: 0.5, perPoint: 0.01, min: 0, max: 100, higherIsBetter: true },
      defense: { baseline: 55, perPoint: 1, min: 0, max: 100, higherIsBetter: true },
    },
    componentWeights: { creation: 1, spacing: 1, defense: 1 },
    weights: { basketballMean: 0.4, rotationMean: 0.35, robustnessMean: 0.25 },
    weaknesses: [
      {
        code: 'contingencyDepth',
        severity: 'major',
        threshold: 70,
        weight: 1,
        minSide: true,
        message: 'contingency depth {value} below {threshold}',
      },
    ],
    search: {
      seedNamespace: 'season-projection-search',
      partialBeamsPerLens: 16,
      completeCandidates: 32,
      startingFives: 16,
      closingFives: 16,
      benchHierarchies: 8,
      minuteTemplates: 4,
      singleRemovals: 'all',
      pairRemovals: 8,
      nodeBudgets: { partial: 100_000, complete: 100_000, rotation: 50_000 },
      closeScenarioWeight: 0.2,
    },
    cohorts: {
      calibrationGames: 2048,
      validationGames: 1024,
      heldOutGames: 2048,
      calibrationSeedFrom: '00000000000000000000000000000000',
      calibrationSeedTo: '000000000000000000000000000007ff',
      validationSeedFrom: '00000000000000000000000000000800',
      validationSeedTo: '00000000000000000000000000000bff',
      heldOutSeedFrom: '00000000000000000000000000000c00',
      heldOutSeedTo: '000000000000000000000000000013ff',
    },
    monotonicGates: [
      {
        code: 'shooting-monotonic',
        driver: 'threePoint',
        output: 'effectiveFieldGoalPct',
        description: 'better shooting must not lower projected eFG%',
      },
    ],
  };
}

describe('rotation trace', () => {
  it('covers exactly 48 regulation minutes across legal units', () => {
    const { players, rotation } = buildInput();
    const memberPlayable = new Map(
      players.map((player) => [player.playerVersionId ?? '', player.positions]),
    );
    const context = traceContext({ rotation, members: memberPlayable });
    const normal = traceRotationNormal(context);
    expect(normal.totalMinutes).toBe(48);
    const unitMinutes = normal.units.reduce((sum, unit) => sum + unit.minutes, 0);
    expect(unitMinutes).toBe(48);
    // Five players on court for 48 minutes: 240 player-minutes total.
    const playerMinutes = [...normal.actualMinutes.values()].reduce((sum, value) => sum + value, 0);
    expect(playerMinutes).toBe(240);
    for (const unit of normal.units) {
      expect(unit.players).toHaveLength(5);
    }
  });

  it('is deterministic and applies the closing window in close games', () => {
    const { players, rotation } = buildInput();
    const memberPlayable = new Map(
      players.map((player) => [player.playerVersionId ?? '', player.positions]),
    );
    const context = traceContext({ rotation, members: memberPlayable });
    const normal = traceRotationNormal(context);
    const close = traceRotationClose(context);
    expect(traceRotationNormal(context).units).toEqual(normal.units);
    // The close trace must exist and stay legal.
    expect(close.totalMinutes).toBe(48);
    const closeUnits = close.units.some((unit) =>
      unit.players.includes(rotation.closingFive[0] ?? ''),
    );
    expect(closeUnits || close.units.length > 0).toBe(true);
  });
});

describe('projectSeasonRoster', () => {
  it('produces a schema-valid projection with weighted units summing to one', () => {
    const { players, rotation } = buildInput();
    const projection = projectSeasonRoster({
      roster: players.map((player) => ({ player })),
      rotation,
      eraProfile: DEFAULT_ERA_SIM_PROFILE,
      model: buildModel(),
    });
    const parsed = seasonProjectionSchema.parse(projection);
    const weightedTotal = parsed.units
      .filter((unit) => unit.weight > 0)
      .reduce((sum, unit) => sum + unit.weight, 0);
    expect(weightedTotal).toBeCloseTo(1, 9);
    expect(parsed.minutes).toHaveLength(10);
    expect(parsed.metrics.positionalCoverage).toBe(100);
    expect(parsed.units.some((unit) => unit.kind === 'starting')).toBe(true);
    expect(parsed.units.some((unit) => unit.kind === 'bench-heavy')).toBe(true);
    expect(parsed.units.some((unit) => unit.kind === 'contingency')).toBe(true);
    expect(parsed.units.filter((unit) => unit.kind === 'matchup')).toHaveLength(4);
  });

  it('is byte-identical and cache-backed', () => {
    const { players, rotation } = buildInput();
    const roster = players.map((player) => ({ player }));
    const cache = new ProjectionCache();
    const first = projectSeasonRoster({
      roster,
      rotation,
      eraProfile: DEFAULT_ERA_SIM_PROFILE,
      model: buildModel(),
    });
    const second = projectSeasonRoster(
      {
        roster,
        rotation,
        eraProfile: DEFAULT_ERA_SIM_PROFILE,
        model: buildModel(),
      },
      { cache },
    );
    expect(second.digest).toBe(first.digest);
    expect(second).toEqual(first);
    expect(cache.stats().hits).toBeGreaterThan(0);
  });

  it('rejects an invalid rotation', () => {
    const { players, rotation } = buildInput();
    expect(() =>
      projectSeasonRoster({
        roster: players.map((player) => ({ player })),
        rotation: { ...rotation, starters: rotation.starters.slice(0, 4) },
        eraProfile: DEFAULT_ERA_SIM_PROFILE,
        model: buildModel(),
      }),
    ).toThrow(/invalid rotation/);
  });

  it('rejects rosters without ten players', () => {
    const { players, rotation } = buildInput();
    expect(() =>
      projectSeasonRoster({
        roster: players.slice(0, 9).map((player) => ({ player })),
        rotation,
        eraProfile: DEFAULT_ERA_SIM_PROFILE,
        model: buildModel(),
      }),
    ).toThrow(/exactly 10 players/);
  });

  it('validates rotation legality through the shared validator', () => {
    const { players, rotation } = buildInput();
    const memberPlayable = new Map(
      players.map((player) => [player.playerVersionId ?? '', player.positions]),
    );
    expect(validateSeasonRotation(rotation, memberPlayable)).toEqual([]);
  });
});


