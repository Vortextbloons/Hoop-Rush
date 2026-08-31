import {
  SEASON_AI_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  type SeasonRosterRole,
  type SeasonRosterTargets,
} from '@hoop-rush/data-contracts';
export const ROLES: readonly SeasonRosterRole[] = [
  'primary-creation',
  'secondary-creation',
  'perimeter-shooting',
  'rim-finishing-interior-scoring',
  'perimeter-defense',
  'interior-defense',
  'offensive-rebounding',
  'defensive-rebounding',
];
export function handBuiltTargets(): SeasonRosterTargets {
  const bandRange = (
    range: [number, number],
  ): {
    range: [number, number];
    median: number;
  } => ({
    range,
    median: (range[0] + range[1]) / 2,
  });
  return {
    schemaVersion: 2,
    targetsVersion: SEASON_ROSTER_TARGETS_VERSION,
    policy: {
      bandQuotas: {
        solo: { contender: 4, playoff: 8, average: 10, weaker: 7 },
        duo: { contender: 4, playoff: 8, average: 9, weaker: 7 },
      },
      guaranteedAnchors: { contender: 2, playoff: 1, average: 0, weaker: 0 },
      extraEliteRollProbability: { contender: 0.65, playoff: 0.35, average: 0.2, weaker: 0.08 },
      tierRanges: {
        contender: { elite: [2, 4], strong: [5, 8], useful: [6, 10] },
        playoff: { elite: [1, 2], strong: [4, 7], useful: [7, 10] },
        average: { elite: [0, 1], strong: [3, 6], useful: [8, 11] },
        weaker: { elite: [0, 1], strong: [1, 4], useful: [7, 10] },
      },
      identityPriorityRoles: {
        'star-chaser': ['primary-creation', 'perimeter-shooting', 'rim-finishing-interior-scoring'],
        'shooting-first': ['perimeter-shooting', 'secondary-creation', 'primary-creation'],
        'defense-first': ['perimeter-defense', 'interior-defense', 'defensive-rebounding'],
        'depth-builder': [...ROLES],
        continuity: [...ROLES],
        'active-trader': [...ROLES],
      },
      roleCoverageThreshold: 35,
      completionTargets: { guards: 4, forwards: 4, centers: 3 },
      poolSize: 20,
      rosterSize: 10,
      percentileTiers: { elite: 0.9, strong: 0.75, useful: 0.5 },
      bandPoolScoreCaps: { contender: 100, playoff: 92, average: 84, weaker: 74 },
      maxPoolStrengthOutliers: 4,
      maxRosterStrengthOutliers: 2,
      nodeBudgets: { anchorMatching: 20000, poolRepair: 40000, rosterSelection: 600000 },
    },
    calibration: {
      calibrationSeedCount: 4,
      validationSeedCount: 2,
      generatedAtIso: '2026-01-01T00:00:00.000Z',
      aiVersion: SEASON_AI_VERSION,
      rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
      gates: {
        failureRateMax: 0,
        minBandSeparation: 3,
        anchorFulfillmentMin: 1,
        extraEliteRateTolerance: 0.05,
        heldOutPassShare: 0.95,
        orderInvarianceFailuresMax: 0,
        superTeamIncidenceMax: 0.08,
      },
    },
    measured: {
      bands: {
        contender: { ...bandRange([50, 80]), eliteShare: 0.5, strongShare: 0.5, usefulShare: 0.9 },
        playoff: { ...bandRange([45, 75]), eliteShare: 0.2, strongShare: 0.5, usefulShare: 0.9 },
        average: { ...bandRange([40, 70]), eliteShare: 0.05, strongShare: 0.4, usefulShare: 0.9 },
        weaker: { ...bandRange([35, 65]), eliteShare: 0.05, strongShare: 0.3, usefulShare: 0.85 },
      },
      identities: {
        'star-chaser': bandRange([40, 80]),
        'depth-builder': bandRange([40, 75]),
        'defense-first': bandRange([40, 75]),
        'shooting-first': bandRange([40, 75]),
        continuity: bandRange([40, 75]),
        'active-trader': bandRange([40, 75]),
      },
      anchorFulfillment: 1,
      extraEliteRate: 0.27,
      superTeamIncidence: 0,
      poolLegalityFailures: 0,
      selectionFailures: 0,
      generationFailures: 0,
    },
  };
}
