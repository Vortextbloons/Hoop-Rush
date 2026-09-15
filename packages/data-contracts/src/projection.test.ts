import { describe, expect, it } from 'vitest';
import {
  PROJECTION_COMPONENT_HIGHER_IS_BETTER,
  projectionModelArtifactSchema,
} from './projection.ts';
import { PROJECTION_MODEL_VERSION } from './season-versions.ts';

const RATINGS = {
  insideScoring: 70,
  closeShot: 65,
  midrange: 65,
  threePoint: 65,
  freeThrow: 70,
  ballHandling: 70,
  passing: 70,
  offensiveIq: 70,
  offensiveRebound: 55,
  defensiveRebound: 55,
  perimeterDefense: 60,
  interiorDefense: 60,
  steal: 55,
  block: 55,
  defensiveIq: 60,
  speed: 70,
  strength: 60,
  vertical: 65,
};
const TENDENCIES = {
  usageRate: 20,
  passRate: 30,
  shotRate: 25,
  driveRate: 20,
  postUpRate: 5,
  rimFrequency: 30,
  shortMidFrequency: 20,
  longMidFrequency: 15,
  cornerThreeFrequency: 8,
  aboveBreakThreeFrequency: 12,
  threePointRate: 25,
  freeThrowRate: 20,
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
};
function referencePlayer(index: number) {
  return {
    playerId: `ref-g1-s${String(index)}`,
    displayName: `Ref ${String(index)}`,
    positions: index === 0 ? ['PG'] : index === 1 ? ['SG'] : index < 4 ? ['SF'] : ['C'],
    heightInches: 78,
    weightLbs: 210,
    ratings: { ...RATINGS },
    tendencies: { ...TENDENCIES },
  };
}
function referenceFive(eraId: string, archetype: string) {
  return {
    referenceId: `ref-${eraId}-${archetype}`,
    archetype,
    eraId,
    referenceHash: 'a'.repeat(64),
    players: [0, 1, 2, 3, 4].map(referencePlayer),
  };
}
function artifactWith(scales: Record<string, unknown>) {
  const eraId = '1990s';
  return {
    schemaVersion: 1,
    modelVersion: PROJECTION_MODEL_VERSION,
    dataVersion: 'm12-ratings-v3.10',
    ratingsVersion: 'm12-ratings-v3.10',
    engineVersion: 'm3-engine-v21',
    eraProfileVersions: { [eraId]: 'm3-1990s-v2' },
    references: {
      [eraId]: {
        neutral: referenceFive(eraId, 'neutral'),
        archetypes: [
          referenceFive(eraId, 'perimeter'),
          referenceFive(eraId, 'interior'),
          referenceFive(eraId, 'pressure'),
          referenceFive(eraId, 'size-switch'),
        ],
      },
    },
    scales,
    componentWeights: { creation: 1, spacing: 1, defense: 1 },
    weights: { basketballMean: 0.4, rotationMean: 0.35, robustnessMean: 0.25 },
    weaknesses: [],
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
      nodeBudgets: { partial: 100000, complete: 100000, rotation: 50000 },
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
const HIGHER = { baseline: 0.5, perPoint: 0.01, min: 0, max: 100, higherIsBetter: true };
const LOWER = { baseline: 105, perPoint: 1, min: 0, max: 100, higherIsBetter: false };
describe('projectionModelArtifactSchema scale directions', () => {
  it('accepts the shipped higher-is-better scale set', () => {
    expect(PROJECTION_COMPONENT_HIGHER_IS_BETTER.creation).toBe(true);
    expect(PROJECTION_COMPONENT_HIGHER_IS_BETTER.spacing).toBe(true);
    expect(PROJECTION_COMPONENT_HIGHER_IS_BETTER.defense).toBe(true);
    expect(
      projectionModelArtifactSchema.safeParse(
        artifactWith({ creation: HIGHER, spacing: HIGHER, defense: HIGHER }),
      ).success,
    ).toBe(true);
  });
  it('accepts lower-is-better scales that match the known direction', () => {
    expect(PROJECTION_COMPONENT_HIGHER_IS_BETTER.defensiveRatingAllowed).toBe(false);
    expect(PROJECTION_COMPONENT_HIGHER_IS_BETTER.turnoverRate).toBe(false);
    expect(
      projectionModelArtifactSchema.safeParse(
        artifactWith({ defensiveRatingAllowed: LOWER, turnoverRate: LOWER }),
      ).success,
    ).toBe(true);
  });
  it('rejects a scale whose direction contradicts the known direction', () => {
    const parsed = projectionModelArtifactSchema.safeParse(
      artifactWith({ defensiveRatingAllowed: { ...LOWER, higherIsBetter: true } }),
    );
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issue = parsed.error.issues.find(
      (entry) => entry.path.join('.') === 'scales.defensiveRatingAllowed.higherIsBetter',
    );
    expect(issue?.message).toContain('higherIsBetter=false');
  });
  it('rejects an inverted higher-is-better scale', () => {
    const parsed = projectionModelArtifactSchema.safeParse(
      artifactWith({ defense: { ...HIGHER, baseline: 55, perPoint: 1, higherIsBetter: false } }),
    );
    expect(parsed.success).toBe(false);
  });
  it('leaves unknown scale keys unchecked', () => {
    expect(
      projectionModelArtifactSchema.safeParse(
        artifactWith({ mysteryComponent: { ...HIGHER, higherIsBetter: false } }),
      ).success,
    ).toBe(true);
  });
});
