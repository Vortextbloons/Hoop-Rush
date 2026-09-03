import {
  SEASON_AI_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonLeagueGenerationResult,
  type SeasonRosterTargets,
} from '@hoop-rush/data-contracts';
import { buildSeasonDraftCatalog, buildSeasonLeague } from '@hoop-rush/test-fixtures';
import { ROSTER_ROLES } from './ai-scoring.ts';
import type { SeasonRosterMemberInput } from './roster-rules.ts';
const ALL_ROLES = [...ROSTER_ROLES];
export function buildTestTargets(): SeasonRosterTargets {
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
        'star-chaser': ['primary-creation', 'secondary-creation', 'rim-finishing-interior-scoring'],
        'shooting-first': ['perimeter-shooting'],
        'defense-first': ['perimeter-defense', 'interior-defense'],
        'depth-builder': ALL_ROLES,
        continuity: ALL_ROLES,
        'active-trader': ALL_ROLES,
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
      calibrationSeedCount: 64,
      validationSeedCount: 32,
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
        contender: {
          range: [55, 90],
          median: 70,
          eliteShare: 0.2,
          strongShare: 0.4,
          usefulShare: 0.6,
        },
        playoff: {
          range: [50, 85],
          median: 64,
          eliteShare: 0.15,
          strongShare: 0.35,
          usefulShare: 0.55,
        },
        average: {
          range: [45, 80],
          median: 58,
          eliteShare: 0.1,
          strongShare: 0.3,
          usefulShare: 0.5,
        },
        weaker: {
          range: [40, 74],
          median: 52,
          eliteShare: 0.05,
          strongShare: 0.2,
          usefulShare: 0.45,
        },
      },
      identities: {
        'star-chaser': { range: [40, 90], median: 60 },
        'depth-builder': { range: [40, 90], median: 60 },
        'defense-first': { range: [40, 90], median: 60 },
        'shooting-first': { range: [40, 90], median: 60 },
        continuity: { range: [40, 90], median: 60 },
        'active-trader': { range: [40, 90], median: 60 },
      },
      anchorFulfillment: 1,
      extraEliteRate: 0,
      superTeamIncidence: 0,
      poolLegalityFailures: 0,
      selectionFailures: 0,
      generationFailures: 0,
    },
  };
}
export const CATALOG = buildSeasonDraftCatalog({
  franchiseIds: ['lakers', 'celtics', 'bulls', 'warriors', 'heat', 'knicks', 'spurs', 'jazz'],
  eras: ['1980s', '1990s', '2000s', '2010s'],
  playersPerPool: 20,
});
export const LEAGUE = buildSeasonLeague();
export function humanRoster(
  catalog: SeasonDraftCatalog,
  franchiseId: string,
  eraId: string,
): string[] {
  const pool = catalog.candidates.filter((c) => c.franchiseId === franchiseId && c.eraId === eraId);
  if (pool.length < 10) throw new Error('pool too small for a human roster');
  const indices =
    pool.length >= 20 ? [0, 1, 2, 3, 4, 5, 7, 8, 10, 17] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const picks = indices
    .map((i) => pool[i])
    .filter((c): c is SeasonDraftCandidate => c !== undefined);
  if (picks.length !== 10) throw new Error('human roster incomplete');
  return picks.map((c) => c.playerVersionId);
}
export function soloInput(
  seed: string,
  catalog: SeasonDraftCatalog = CATALOG,
  league = LEAGUE,
  humanFranchiseId = 'lakers',
) {
  return {
    seed,
    catalog,
    league,
    humanFranchiseIds: [humanFranchiseId] as string[],
    humanRosters: [
      {
        franchiseId: humanFranchiseId,
        playerVersionIds: humanRoster(catalog, humanFranchiseId, '1990s'),
      },
    ],
    targets: buildTestTargets(),
  };
}
export function membersOf(
  result: SeasonLeagueGenerationResult,
  franchiseId: string,
  catalog: SeasonDraftCatalog = CATALOG,
): SeasonRosterMemberInput[] {
  const roster = result.rosters.find((r) => r.franchiseId === franchiseId);
  if (!roster) throw new Error(`no roster for ${franchiseId}`);
  return roster.players.map((player) => {
    const candidate = catalog.candidates.find((c) => c.playerVersionId === player.playerVersionId);
    if (!candidate) throw new Error('roster references an unknown candidate');
    return { playerVersionId: player.playerVersionId, playable: candidate.positions.playable };
  });
}
