import {
  PROJECTION_MODEL_VERSION,
  RATINGS_VERSION,
  playerIdSchema,
  projectionModelArtifactSchema,
  type ProjectionMatchupArchetype,
  type ProjectionModelArtifact,
  type ProjectionSearchPolicy,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { DEFAULT_ERA_SIM_PROFILE, buildSimulationPlayer } from '@hoop-rush/test-fixtures';

function referencePlayer(index: number): SimulationPlayer {
  return buildSimulationPlayer({
    playerId: playerIdSchema.parse(`p-ref-${String(index)}`),
    displayName: `Ref ${String(index)}`,
    positions: index === 4 ? ['C'] : index >= 2 ? ['SF'] : ['PG'],
  });
}

export function buildProjectionModel(
  overrides: {
    eraId?: string;
    search?: Partial<ProjectionSearchPolicy>;
  } = {},
): ProjectionModelArtifact {
  const eraId = overrides.eraId ?? DEFAULT_ERA_SIM_PROFILE.eraId;
  const five = (index: number, archetype: ProjectionMatchupArchetype) => ({
    referenceId: `ref-${eraId}-${archetype}`,
    archetype,
    eraId,
    referenceHash: 'a'.repeat(64),
    players: [1, 2, 3, 4, 5].map(referencePlayer) as [
      SimulationPlayer,
      SimulationPlayer,
      SimulationPlayer,
      SimulationPlayer,
      SimulationPlayer,
    ],
  });
  return projectionModelArtifactSchema.parse({
    schemaVersion: 1,
    modelVersion: PROJECTION_MODEL_VERSION,
    dataVersion: `m10-${RATINGS_VERSION}`,
    ratingsVersion: RATINGS_VERSION,
    engineVersion: 'm3-engine-v21',
    eraProfileVersions: { [eraId]: DEFAULT_ERA_SIM_PROFILE.profileVersion },
    references: {
      [eraId]: {
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
      nodeBudgets: { partial: 100000, complete: 100000, rotation: 50000 },
      closeScenarioWeight: 0.2,
      ...overrides.search,
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
  });
}
