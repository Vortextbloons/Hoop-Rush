import { describe, expect, it } from 'vitest';
import {
  baseFiveProjectionSchema,
  RATINGS_VERSION,
  type BaseFiveProjection,
  type ProjectionMatchupArchetype,
  type ProjectionModelArtifact,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { DEFAULT_ERA_SIM_PROFILE, buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import { ProjectionCache, projectBaseFive, projectExpectedLedger } from '../projection/index.ts';
import { prepareTeam } from '../sim/prepare.ts';

const POSITIONS: SimulationPlayer['positions'][] = [['PG'], ['SG'], ['SF'], ['PF'], ['C']];

function lineupPlayer(
  index: number,
  ratings?: Partial<SimulationPlayer['ratings']>,
  tendencies?: Partial<SimulationPlayer['tendencies']>,
): SimulationPlayer {
  const player = buildSimulationPlayer({
    playerId: `p-l${String(index + 1)}`,
    displayName: `L ${String(index + 1)}`,
    positions: POSITIONS[index],
  });
  if (ratings !== undefined) player.ratings = { ...player.ratings, ...ratings };
  if (tendencies !== undefined) player.tendencies = { ...player.tendencies, ...tendencies };
  return player;
}

function buildReferencePlayer(index: number): SimulationPlayer {
  return buildSimulationPlayer({
    playerId: `p-ref-${String(index)}`,
    displayName: `Ref ${String(index)}`,
    positions: index === 4 ? ['C'] : index >= 2 ? ['SF'] : ['PG'],
  });
}

function buildModel(): ProjectionModelArtifact {
  const five = (index: number, archetype: ProjectionMatchupArchetype) => ({
    referenceId: `ref-1990s-${archetype}`,
    archetype,
    eraId: '1990s',
    referenceHash: 'a'.repeat(64),
    players: [
      buildReferencePlayer(1),
      buildReferencePlayer(2),
      buildReferencePlayer(3),
      buildReferencePlayer(4),
      buildReferencePlayer(5),
    ] as [SimulationPlayer, SimulationPlayer, SimulationPlayer, SimulationPlayer, SimulationPlayer],
  });
  return {
    schemaVersion: 1,
    modelVersion: 'projection-model-v1',
    dataVersion: `m10-${RATINGS_VERSION}`,
    ratingsVersion: RATINGS_VERSION,
    eraProfileVersions: { '1990s': DEFAULT_ERA_SIM_PROFILE.profileVersion },
    references: {
      '1990s': {
        neutral: five(0, 'neutral'),
        archetypes: [
          five(1, 'perimeter'),
          five(2, 'interior'),
          five(3, 'pressure'),
          five(4, 'size-switch'),
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
        code: 'creation',
        severity: 'critical',
        threshold: 55,
        weight: 2,
        minSide: true,
        message: 'creation {value} below the critical floor {threshold}',
      },
      {
        code: 'turnoverRate',
        severity: 'major',
        threshold: 22,
        weight: 1,
        minSide: false,
        message: 'turnover rate {value} above {threshold}',
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

function buildProjectionLineup(
  ratings?: Partial<SimulationPlayer['ratings']>,
  tendencies?: Partial<SimulationPlayer['tendencies']>,
): BaseFiveProjection {
  return projectBaseFive({
    lineup: [
      { player: lineupPlayer(0, ratings, tendencies), slot: 'G1' },
      { player: lineupPlayer(1, ratings, tendencies), slot: 'G2' },
      { player: lineupPlayer(2, ratings, tendencies), slot: 'F1' },
      { player: lineupPlayer(3, ratings, tendencies), slot: 'F2' },
      { player: lineupPlayer(4, ratings, tendencies), slot: 'C' },
    ],
    eraProfile: DEFAULT_ERA_SIM_PROFILE,
    model: buildModel(),
  });
}

describe('projectBaseFive', () => {
  it('produces a schema-valid projection with sane ratings', () => {
    const projection = buildProjectionLineup();
    const parsed = baseFiveProjectionSchema.parse(projection);
    expect(parsed.ratings.offensiveRating).toBeGreaterThan(85);
    expect(parsed.ratings.offensiveRating).toBeLessThan(130);
    expect(parsed.ratings.defensiveRatingAllowed).toBeGreaterThan(85);
    expect(parsed.ratings.defensiveRatingAllowed).toBeLessThan(130);
    expect(parsed.ratings.netRating).toBe(
      parsed.ratings.offensiveRating - parsed.ratings.defensiveRatingAllowed,
    );
    expect(parsed.inputDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(parsed.digest).toMatch(/^[0-9a-f]{32}$/);
    expect(parsed.referenceId).toBe('ref-1990s-neutral');
    expect(parsed.referenceHash).toBe('a'.repeat(64));
  });

  it('is byte-identical for identical inputs', () => {
    const first = buildProjectionLineup();
    const second = buildProjectionLineup();
    expect(second).toEqual(first);
    expect(second.digest).toBe(first.digest);
  });

  it('is seedless: overall never changes the projection', () => {
    const base = buildProjectionLineup();
    const withOverall = projectBaseFive({
      lineup: [
        {
          player: buildSimulationPlayer({
            playerId: 'p-l1',
            displayName: 'L 1',
            positions: ['PG'],
            overall: 99,
          }),
          slot: 'G1',
        },
        {
          player: buildSimulationPlayer({
            playerId: 'p-l2',
            displayName: 'L 2',
            positions: ['SG'],
          }),
          slot: 'G2',
        },
        {
          player: buildSimulationPlayer({
            playerId: 'p-l3',
            displayName: 'L 3',
            positions: ['SF'],
          }),
          slot: 'F1',
        },
        {
          player: buildSimulationPlayer({
            playerId: 'p-l4',
            displayName: 'L 4',
            positions: ['PF'],
          }),
          slot: 'F2',
        },
        {
          player: buildSimulationPlayer({ playerId: 'p-l5', displayName: 'L 5', positions: ['C'] }),
          slot: 'C',
        },
      ],
      eraProfile: DEFAULT_ERA_SIM_PROFILE,
      model: buildModel(),
    });
    expect(withOverall.digest).toBe(base.digest);
  });

  it('rejects missing and duplicate slots', () => {
    const players: [
      SimulationPlayer,
      SimulationPlayer,
      SimulationPlayer,
      SimulationPlayer,
      SimulationPlayer,
    ] = [
      buildSimulationPlayer({ playerId: 'p-l1', displayName: 'L 1', positions: ['PG'] }),
      buildSimulationPlayer({ playerId: 'p-l2', displayName: 'L 2', positions: ['SG'] }),
      buildSimulationPlayer({ playerId: 'p-l3', displayName: 'L 3', positions: ['SF'] }),
      buildSimulationPlayer({ playerId: 'p-l4', displayName: 'L 4', positions: ['PF'] }),
      buildSimulationPlayer({ playerId: 'p-l5', displayName: 'L 5', positions: ['C'] }),
    ];
    const input = {
      lineup: [
        { player: players[0], slot: 'G1' },
        { player: players[1], slot: 'G2' },
        { player: players[2], slot: 'F1' },
        { player: players[3], slot: 'F2' },
        { player: players[4], slot: 'C' },
      ] as const,
      eraProfile: DEFAULT_ERA_SIM_PROFILE,
      model: buildModel(),
    };
    expect(() =>
      projectBaseFive({
        ...input,
        lineup: [
          { player: players[0], slot: 'G1' },
          { player: players[1], slot: 'G1' },
          { player: players[2], slot: 'F1' },
          { player: players[3], slot: 'F2' },
          { player: players[4], slot: 'C' },
        ],
      }),
    ).toThrow(/missing slot/);
    expect(() =>
      projectBaseFive({
        ...input,
        lineup: [
          { player: players[0], slot: 'G1' },
          { player: players[1], slot: 'G2' },
          { player: players[2], slot: 'F1' },
          { player: players[3], slot: 'F2' },
          { player: players[0], slot: 'C' },
        ],
      }),
    ).toThrow(/duplicate player version/);
  });

  it('rejects slot-group mismatches', () => {
    expect(() =>
      projectBaseFive({
        lineup: [
          {
            player: buildSimulationPlayer({ playerId: 'p-a', displayName: 'A', positions: ['PG'] }),
            slot: 'G1',
          },
          {
            player: buildSimulationPlayer({ playerId: 'p-b', displayName: 'B', positions: ['SG'] }),
            slot: 'G2',
          },
          {
            player: buildSimulationPlayer({ playerId: 'p-c', displayName: 'C', positions: ['SF'] }),
            slot: 'F1',
          },
          {
            player: buildSimulationPlayer({ playerId: 'p-d', displayName: 'D', positions: ['C'] }),
            slot: 'F2',
          },
          {
            player: buildSimulationPlayer({ playerId: 'p-e', displayName: 'E', positions: ['C'] }),
            slot: 'C',
          },
        ],
        eraProfile: DEFAULT_ERA_SIM_PROFILE,
        model: buildModel(),
      }),
    ).toThrow(/cannot fill F slot/);
  });

  it('keeps ledger accounting exact', () => {
    const projection = buildProjectionLineup();
    const ledger = projection.offense.ledger;
    expect(ledger.turnoverRate).toBeGreaterThan(0);
    expect(ledger.turnoverRate).toBeLessThan(0.3);
    expect(ledger.fieldGoalAttempts).toBeCloseTo(ledger.shotRate * 100, 9);
    expect(ledger.effectiveFieldGoalPct).toBeCloseTo(
      (ledger.fieldGoalMakes + 0.5 * ledger.threePointMakes) / ledger.fieldGoalAttempts,
      10,
    );
    expect(ledger.trueShootingPct).toBeCloseTo(
      ledger.points / (2 * (ledger.fieldGoalAttempts + 0.44 * ledger.freeThrowAttempts)),
      10,
    );
    expect(ledger.freeThrowRate).toBeCloseTo(
      ledger.freeThrowAttempts / ledger.fieldGoalAttempts,
      10,
    );
    expect(ledger.twoPointMakes + ledger.threePointMakes).toBeCloseTo(ledger.fieldGoalMakes, 10);
    expect(ledger.twoPointAttempts + ledger.threePointAttempts).toBeCloseTo(
      ledger.fieldGoalAttempts,
      10,
    );
    const actionTotal = Object.values(projection.offense.actions).reduce((s, v) => s + v, 0);
    expect(actionTotal).toBeCloseTo(1, 6);
    const zoneTotal = Object.values(projection.offense.zones).reduce((s, v) => s + v, 0);
    expect(zoneTotal).toBeCloseTo(1, 6);
    const shooterTotal = Object.values(projection.offense.shooters).reduce((s, v) => s + v, 0);
    expect(shooterTotal).toBeCloseTo(1, 6);
  });

  it('is sensitive to shooting, creation, security, defense, and rebounding', () => {
    const base = buildProjectionLineup();
    const shooters = buildProjectionLineup(
      { threePoint: 95, midrange: 95, insideScoring: 95, freeThrow: 90 },
      { threePointRate: 40 },
    );
    expect(shooters.ratings.offensiveRating).toBeGreaterThan(base.ratings.offensiveRating);
    expect(shooters.offense.ledger.effectiveFieldGoalPct).toBeGreaterThan(
      base.offense.ledger.effectiveFieldGoalPct,
    );

    const creators = buildProjectionLineup(
      { ballHandling: 95, passing: 95, offensiveIq: 95 },
      { usageRate: 34 },
    );
    expect(creators.offense.creation.score).toBeGreaterThan(base.offense.creation.score);

    const secure = buildProjectionLineup({ ballHandling: 95, passing: 95 }, { turnoverRate: 1 });
    expect(secure.offense.ledger.turnoverRate).toBeLessThan(base.offense.ledger.turnoverRate);

    const defense = buildProjectionLineup({
      perimeterDefense: 95,
      interiorDefense: 95,
      defensiveIq: 95,
      steal: 95,
      block: 95,
    });
    expect(defense.ratings.defensiveRatingAllowed).toBeLessThan(
      base.ratings.defensiveRatingAllowed,
    );

    const rebounders = buildProjectionLineup(
      { offensiveRebound: 95, defensiveRebound: 95, vertical: 95 },
      { crashOffensiveGlassRate: 40 },
    );
    expect(rebounders.offense.ledger.offensiveReboundRate).toBeGreaterThan(
      base.offense.ledger.offensiveReboundRate,
    );
  });

  it('records weaknesses from thresholds', () => {
    const weak = projectBaseFive({
      lineup: [
        {
          player: lineupPlayer(
            0,
            { ballHandling: 30, passing: 30, offensiveIq: 30 },
            { usageRate: 5 },
          ),
          slot: 'G1',
        },
        {
          player: lineupPlayer(
            1,
            { ballHandling: 30, passing: 30, offensiveIq: 30 },
            { usageRate: 5 },
          ),
          slot: 'G2',
        },
        {
          player: lineupPlayer(
            2,
            { ballHandling: 30, passing: 30, offensiveIq: 30 },
            { usageRate: 5 },
          ),
          slot: 'F1',
        },
        {
          player: lineupPlayer(
            3,
            { ballHandling: 30, passing: 30, offensiveIq: 30 },
            { usageRate: 5 },
          ),
          slot: 'F2',
        },
        {
          player: lineupPlayer(
            4,
            { ballHandling: 30, passing: 30, offensiveIq: 30 },
            { usageRate: 5 },
          ),
          slot: 'C',
        },
      ],
      eraProfile: DEFAULT_ERA_SIM_PROFILE,
      model: buildModel(),
    });
    expect(weak.weaknesses.length).toBeGreaterThanOrEqual(1);
    expect(weak.weaknesses.some((entry) => entry.code === 'creation')).toBe(true);
  });

  it('supports named references', () => {
    const projection = projectBaseFive({
      lineup: [
        {
          player: buildSimulationPlayer({
            playerId: 'p-l1',
            displayName: 'L 1',
            positions: ['PG'],
          }),
          slot: 'G1',
        },
        {
          player: buildSimulationPlayer({
            playerId: 'p-l2',
            displayName: 'L 2',
            positions: ['SG'],
          }),
          slot: 'G2',
        },
        {
          player: buildSimulationPlayer({
            playerId: 'p-l3',
            displayName: 'L 3',
            positions: ['SF'],
          }),
          slot: 'F1',
        },
        {
          player: buildSimulationPlayer({
            playerId: 'p-l4',
            displayName: 'L 4',
            positions: ['PF'],
          }),
          slot: 'F2',
        },
        {
          player: buildSimulationPlayer({ playerId: 'p-l5', displayName: 'L 5', positions: ['C'] }),
          slot: 'C',
        },
      ],
      eraProfile: DEFAULT_ERA_SIM_PROFILE,
      model: buildModel(),
      referenceId: 'ref-1990s-perimeter',
    });
    expect(projection.referenceId).toBe('ref-1990s-perimeter');
    expect(projection.digest).not.toBe(buildProjectionLineup().digest);
  });
});

describe('projectExpectedLedger', () => {
  it('keeps both directions exact and cross-terms reconciled', () => {
    const team = {
      teamId: 't1',
      displayName: 'T1',
      players: [
        buildSimulationPlayer({ playerId: 'p-a', displayName: 'A', positions: ['PG'] }),
        buildSimulationPlayer({ playerId: 'p-b', displayName: 'B', positions: ['SG'] }),
        buildSimulationPlayer({ playerId: 'p-c', displayName: 'C', positions: ['SF'] }),
        buildSimulationPlayer({ playerId: 'p-d', displayName: 'D', positions: ['PF'] }),
        buildSimulationPlayer({ playerId: 'p-e', displayName: 'E', positions: ['C'] }),
      ],
    };
    const referenceTeam = {
      teamId: 'ref',
      displayName: 'Ref',
      players: [1, 2, 3, 4, 5].map((n) => buildReferencePlayer(n)),
    };
    const prep = prepareTeam(team, DEFAULT_ERA_SIM_PROFILE);
    const referencePrep = prepareTeam(referenceTeam, DEFAULT_ERA_SIM_PROFILE);
    const result = projectExpectedLedger({
      team,
      prep,
      opponent: referenceTeam,
      opponentPrep: referencePrep,
      profile: DEFAULT_ERA_SIM_PROFILE,
    });

    expect(result.offense.ledger.steals).toBeCloseTo(
      result.defense.ledger.turnovers *
        Math.min(0.9, Math.max(0.3, DEFAULT_ERA_SIM_PROFILE.parameters.stealShareOfTurnovers)),
      9,
    );
    expect(result.offense.ledger.possessions).toBe(100);
    for (const side of [result.offense, result.defense]) {
      expect(side.ledger.turnoverRate).toBeGreaterThan(0);
      expect(side.ledger.turnoverRate).toBeLessThan(0.3);
      expect(side.ledger.fieldGoalAttempts).toBeCloseTo(side.ledger.shotRate * 100, 9);
      const actionTotal = Object.values(side.actions).reduce((s, v) => s + v, 0);
      expect(actionTotal).toBeCloseTo(1, 6);
      const zoneTotal = Object.values(side.zones).reduce((s, v) => s + v, 0);
      expect(zoneTotal).toBeCloseTo(1, 6);
      const shooterTotal = side.shooters.reduce((s, v) => s + v, 0);
      expect(shooterTotal).toBeCloseTo(1, 6);
    }
  });
});

describe('ProjectionCache', () => {
  it('hits identical keys and evicts over the budget', () => {
    const cache = new ProjectionCache(2, 1024 * 1024);
    const key = ProjectionCache.key({
      eraId: '1990s',
      modelVersion: 'projection-model-v1',
      referenceId: 'ref-1990s-neutral',
      slots: ['G1', 'G2', 'F1', 'F2', 'C'],
      playerIds: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
      playerVersionIds: [null, null, null, null, null],
    });
    const projection = buildProjectionLineup();
    cache.set(key, projection);
    expect(cache.get(key)?.digest).toBe(projection.digest);
    expect(cache.stats().hits).toBe(1);
    const other = ProjectionCache.key({
      eraId: '1990s',
      modelVersion: 'projection-model-v1',
      referenceId: 'ref-1990s-perimeter',
      slots: ['G1', 'G2', 'F1', 'F2', 'C'],
      playerIds: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
      playerVersionIds: [null, null, null, null, null],
    });
    cache.set(other, projection);
    cache.set(
      ProjectionCache.key({
        eraId: '1990s',
        modelVersion: 'projection-model-v1',
        referenceId: 'ref-1990s-interior',
        slots: ['G1', 'G2', 'F1', 'F2', 'C'],
        playerIds: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
        playerVersionIds: [null, null, null, null, null],
      }),
      projection,
    );
    expect(cache.stats().entries).toBeLessThanOrEqual(2);
    expect(cache.get(key)).toBeUndefined();
  });
});
