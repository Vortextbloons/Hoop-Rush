import type {
  SeasonAiIdentity,
  SeasonRosterRole,
  SeasonStrengthBand,
  SimulationRatings,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';
import { clamp } from '../domain/math.ts';

export const ROSTER_ROLES: readonly SeasonRosterRole[] = [
  'primary-creation',
  'secondary-creation',
  'perimeter-shooting',
  'rim-finishing-interior-scoring',
  'perimeter-defense',
  'interior-defense',
  'offensive-rebounding',
  'defensive-rebounding',
];

export const ROLE_COVERAGE_THRESHOLD = 35;

export const IDENTITY_ROLE_WEIGHTS: Record<SeasonAiIdentity, Record<SeasonRosterRole, number>> = {
  'star-chaser': {
    'primary-creation': 1.6,
    'secondary-creation': 1.1,
    'perimeter-shooting': 1.3,
    'rim-finishing-interior-scoring': 1.4,
    'perimeter-defense': 0.8,
    'interior-defense': 0.8,
    'offensive-rebounding': 0.7,
    'defensive-rebounding': 0.7,
  },
  'depth-builder': {
    'primary-creation': 1.05,
    'secondary-creation': 1.05,
    'perimeter-shooting': 1.05,
    'rim-finishing-interior-scoring': 1.05,
    'perimeter-defense': 1.05,
    'interior-defense': 1.05,
    'offensive-rebounding': 1.0,
    'defensive-rebounding': 1.0,
  },
  'defense-first': {
    'primary-creation': 0.7,
    'secondary-creation': 0.7,
    'perimeter-shooting': 0.8,
    'rim-finishing-interior-scoring': 0.8,
    'perimeter-defense': 1.7,
    'interior-defense': 1.7,
    'offensive-rebounding': 1.1,
    'defensive-rebounding': 1.3,
  },
  'shooting-first': {
    'primary-creation': 0.9,
    'secondary-creation': 1.1,
    'perimeter-shooting': 1.8,
    'rim-finishing-interior-scoring': 1.0,
    'perimeter-defense': 0.8,
    'interior-defense': 0.8,
    'offensive-rebounding': 0.8,
    'defensive-rebounding': 0.8,
  },
  continuity: {
    'primary-creation': 1.0,
    'secondary-creation': 1.0,
    'perimeter-shooting': 1.0,
    'rim-finishing-interior-scoring': 1.0,
    'perimeter-defense': 1.0,
    'interior-defense': 1.0,
    'offensive-rebounding': 1.0,
    'defensive-rebounding': 1.0,
  },
  'active-trader': {
    'primary-creation': 1.1,
    'secondary-creation': 1.1,
    'perimeter-shooting': 1.05,
    'rim-finishing-interior-scoring': 1.05,
    'perimeter-defense': 1.0,
    'interior-defense': 1.0,
    'offensive-rebounding': 0.95,
    'defensive-rebounding': 0.95,
  },
};

export const BAND_SELECTION_BIAS: Record<SeasonStrengthBand, number> = {
  contender: 10,
  playoff: 4,
  average: 0,
  weaker: -8,
};

export const BAND_SCORE_CEILINGS: Record<SeasonStrengthBand, number> = {
  contender: 100,
  playoff: 92,
  average: 84,
  weaker: 74,
};

export const BAND_CEILING_PENALTY = 1.6;

export interface SeasonScoreMember {
  detailedRatings: SimulationRatings;
  tendencies: SimulationTendencies;

  overall?: number;
}

export function roleScoresOf(member: SeasonScoreMember): Record<SeasonRosterRole, number> {
  const r = member.detailedRatings;
  const t = member.tendencies;
  return {
    'primary-creation': clamp01(0.45 * r.ballHandling + 0.35 * r.passing + 0.2 * r.offensiveIq),
    'secondary-creation': clamp01(0.3 * r.ballHandling + 0.35 * r.passing + 0.35 * r.offensiveIq),
    'perimeter-shooting': clamp01(0.8 * r.threePoint + 0.2 * r.midrange + 0.12 * t.threePointRate),
    'rim-finishing-interior-scoring': clamp01(0.6 * r.insideScoring + 0.4 * r.closeShot),
    'perimeter-defense': clamp01(0.5 * r.perimeterDefense + 0.3 * r.steal + 0.2 * r.defensiveIq),
    'interior-defense': clamp01(0.5 * r.interiorDefense + 0.3 * r.block + 0.2 * r.defensiveIq),
    'offensive-rebounding': clamp01(0.85 * r.offensiveRebound + 0.15 * t.crashOffensiveGlassRate),
    'defensive-rebounding': clamp01(0.9 * r.defensiveRebound + 0.1 * t.crashOffensiveGlassRate),
  };
}

function clamp01(value: number): number {
  return clamp(value, 0, 100);
}

export function identityScore(
  roleScores: Record<SeasonRosterRole, number>,
  identity: SeasonAiIdentity,
): number {
  const weights = IDENTITY_ROLE_WEIGHTS[identity];
  let total = 0;
  let weightTotal = 0;
  for (const role of ROSTER_ROLES) {
    const weight = weights[role];
    total += roleScores[role] * weight;
    weightTotal += weight;
  }
  return total / weightTotal;
}

export function overallReportOf(members: readonly SeasonScoreMember[]): number | null {
  const withOverall = members.filter((member) => member.overall !== undefined);
  if (withOverall.length === 0) return null;
  return withOverall.reduce((sum, member) => sum + (member.overall ?? 0), 0) / withOverall.length;
}

export const TIER_ORDER = ['elite', 'strong', 'useful', 'depth'] as const;
export type PercentileTier = (typeof TIER_ORDER)[number];

export const TIER_PERCENTILES: Record<'elite' | 'strong' | 'useful', number> = {
  elite: 0.9,
  strong: 0.75,
  useful: 0.5,
};

export interface RoleThresholds {
  elite: number;
  strong: number;
  useful: number;
}

export function nearestRankThreshold(sortedAsc: readonly number[], percentile: number): number {
  if (sortedAsc.length === 0) return 0;
  if (percentile <= 0) return sortedAsc[0] ?? 0;
  if (percentile >= 1) return sortedAsc[sortedAsc.length - 1] ?? 0;
  const index = Math.ceil(percentile * sortedAsc.length) - 1;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, index))] ?? 0;
}

export function rolePercentileThresholds(
  canonicalScores: readonly Record<SeasonRosterRole, number>[],
): Record<SeasonRosterRole, RoleThresholds> {
  const byRole: Record<SeasonRosterRole, number[]> = {
    'primary-creation': [],
    'secondary-creation': [],
    'perimeter-shooting': [],
    'rim-finishing-interior-scoring': [],
    'perimeter-defense': [],
    'interior-defense': [],
    'offensive-rebounding': [],
    'defensive-rebounding': [],
  };
  for (const scores of canonicalScores) {
    for (const role of ROSTER_ROLES) {
      const bucket = byRole[role];
      bucket.push(scores[role]);
    }
  }
  const thresholds = {} as Record<SeasonRosterRole, RoleThresholds>;
  for (const role of ROSTER_ROLES) {
    const sorted = [...byRole[role]].sort((a, b) => a - b);
    thresholds[role] = {
      elite: nearestRankThreshold(sorted, TIER_PERCENTILES.elite),
      strong: nearestRankThreshold(sorted, TIER_PERCENTILES.strong),
      useful: nearestRankThreshold(sorted, TIER_PERCENTILES.useful),
    };
  }
  return thresholds;
}

export function percentileTierOf(
  roleScores: Record<SeasonRosterRole, number>,
  thresholds: Record<SeasonRosterRole, RoleThresholds>,
): Record<SeasonRosterRole, PercentileTier> {
  const tiers = {} as Record<SeasonRosterRole, PercentileTier>;
  for (const role of ROSTER_ROLES) {
    const score = roleScores[role];
    const roleThresholds = thresholds[role];
    if (score >= roleThresholds.elite) {
      tiers[role] = 'elite';
    } else if (score >= roleThresholds.strong) {
      tiers[role] = 'strong';
    } else if (score >= roleThresholds.useful) {
      tiers[role] = 'useful';
    } else {
      tiers[role] = 'depth';
    }
  }
  return tiers;
}

export function playerPercentileTier(
  roleTiers: Record<SeasonRosterRole, PercentileTier>,
): PercentileTier {
  const rank = (tier: PercentileTier): number => TIER_ORDER.indexOf(tier);
  let best: PercentileTier = 'depth';
  for (const role of ROSTER_ROLES) {
    const tier = roleTiers[role];
    if (rank(tier) < rank(best)) best = tier;
  }
  return best;
}
