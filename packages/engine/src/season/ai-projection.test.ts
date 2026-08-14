import { describe, expect, it } from 'vitest';
import {
  seasonLeagueGenerationResultSchema,
  type ProjectionModelArtifact,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { DEFAULT_ERA_SIM_PROFILE } from '@hoop-rush/test-fixtures';
import { soloInput } from './ai-test-support.ts';
import { generateAiLeague } from './ai-generation.ts';

function tinyModel(): ProjectionModelArtifact {
  const player = (index: number, positions: string[]): SimulationPlayer => ({
    playerId: `p-ref-${String(index)}`,
    displayName: `Ref ${String(index)}`,
    positions: positions as SimulationPlayer['positions'],
    heightInches: 78,
    weightLbs: 215,
    ratings: {
      insideScoring: 68,
      closeShot: 66,
      midrange: 64,
      threePoint: 60,
      freeThrow: 72,
      ballHandling: 68,
      passing: 68,
      offensiveIq: 68,
      offensiveRebound: 58,
      defensiveRebound: 62,
      perimeterDefense: 60,
      interiorDefense: 60,
      steal: 58,
      block: 58,
      defensiveIq: 60,
      speed: 68,
      strength: 64,
      vertical: 64,
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
  const five = {
    referenceId: 'ref-1990s-neutral',
    archetype: 'neutral' as const,
    eraId: '1990s',
    referenceHash: 'b'.repeat(64),
    players: [
      player(1, ['PG']),
      player(2, ['SG']),
      player(3, ['SF']),
      player(4, ['PF']),
      player(5, ['C']),
    ] as [SimulationPlayer, SimulationPlayer, SimulationPlayer, SimulationPlayer, SimulationPlayer],
  };
  return {
    schemaVersion: 1,
    modelVersion: 'projection-model-v1',
    dataVersion: 'm10-ratings-v3.4',
    ratingsVersion: 'ratings-v3.4',
    eraProfileVersions: { '1990s': DEFAULT_ERA_SIM_PROFILE.profileVersion },
    references: {
      '1990s': { neutral: five, archetypes: [] },
    },
    scales: {
      creation: { baseline: 0.5, perPoint: 0.01, min: 0, max: 100, higherIsBetter: true },
      spacing: { baseline: 0.5, perPoint: 0.01, min: 0, max: 100, higherIsBetter: true },
      defense: { baseline: 55, perPoint: 1, min: 0, max: 100, higherIsBetter: true },
    },
    componentWeights: { creation: 1, spacing: 1, defense: 1 },
    weights: { basketballMean: 0.4, rotationMean: 0.35, robustnessMean: 0.25 },
    weaknesses: [],
    search: {
      seedNamespace: 'season-projection-search',
      partialBeamsPerLens: 4,
      completeCandidates: 2,
      startingFives: 2,
      closingFives: 1,
      benchHierarchies: 1,
      minuteTemplates: 0,
      singleRemovals: 'all',
      pairRemovals: 1,
      nodeBudgets: { partial: 2_000, complete: 2_000, rotation: 8 },
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

const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';

describe('AI projection shadow mode', () => {
  it('records compact summaries without changing selection or the digest', () => {
    const base = generateAiLeague(soloInput(SEED));
    const projected = generateAiLeague({
      ...soloInput(SEED),
      projection: {
        eraProfile: DEFAULT_ERA_SIM_PROFILE,
        model: tinyModel(),
      },
    });

    expect(projected.digest).toBe(base.digest);
    expect(projected.rosters).toEqual(base.rosters);
    expect(projected.aiPools).toEqual(base.aiPools);
    expect(projected.rotations).toEqual(base.rotations);

    const aiEvaluations = projected.evaluations.filter(
      (evaluation) => evaluation.franchiseId !== 'lakers',
    );
    expect(aiEvaluations.length).toBeGreaterThan(0);
    for (const evaluation of aiEvaluations) {
      expect(evaluation.projectionSummary?.modelVersion).toBe('projection-model-v1');
      expect(typeof evaluation.projectionSummary?.searchDigest).toBe('string');
      expect(evaluation.projectionSummary?.searchDigest).toMatch(/^[0-9a-f]{32}$/);
    }

    seasonLeagueGenerationResultSchema.parse(projected);
  });

  it('is deterministic across repeated shadow runs', () => {
    const first = generateAiLeague({
      ...soloInput(SEED),
      projection: { eraProfile: DEFAULT_ERA_SIM_PROFILE, model: tinyModel() },
    });
    const second = generateAiLeague({
      ...soloInput(SEED),
      projection: { eraProfile: DEFAULT_ERA_SIM_PROFILE, model: tinyModel() },
    });
    expect(second.evaluations).toEqual(first.evaluations);
    expect(second.digest).toBe(first.digest);
  });

  it('keeps pools, anchors, and legality intact under projection', () => {
    const projected = generateAiLeague({
      ...soloInput(SEED),
      projection: { eraProfile: DEFAULT_ERA_SIM_PROFILE, model: tinyModel() },
    });
    for (const pool of projected.aiPools) {
      expect(pool.playerVersionIds).toHaveLength(20);
      expect(new Set(pool.playerVersionIds).size).toBe(20);
      for (const selection of pool.selections) {
        expect(pool.playerVersionIds).toContain(selection);
      }
      for (const anchor of pool.anchors) {
        expect(pool.playerVersionIds).toContain(anchor.playerVersionId);
      }
    }
    const humanVersions = new Set(
      projected.rosters
        .find((roster) => roster.franchiseId === 'lakers')
        ?.players.map((player) => player.playerVersionId) ?? [],
    );
    for (const roster of projected.rosters) {
      if (roster.franchiseId === 'lakers') continue;
      for (const player of roster.players) {
        expect(humanVersions.has(player.playerVersionId)).toBe(false);
      }
    }
  });
});
