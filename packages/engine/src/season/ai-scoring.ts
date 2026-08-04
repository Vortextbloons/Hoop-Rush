import type {
  SeasonAiIdentity,
  SeasonRosterRole,
  SeasonStrengthBand,
  SimulationRatings,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';

/**
 * AI roster scoring (season-ai-v1, M2.1). Role scores are pure functions of
 * the recorded possession inputs — detailed ratings and tendencies — never of
 * Overall. The six decision identities alter ONLY the weights applied to the
 * eight role scores; franchise identity never changes ratings, odds, or
 * player eligibility, and Overall has no pick authority (it appears only as
 * a report field).
 */

/** The eight basketball roles in canonical order. */
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

/** A role is covered when the roster's best member scores at least this. */
export const ROLE_COVERAGE_THRESHOLD = 35;

/** Versioned identity weight tables (1.0 = balanced). */
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

/** Soft band preference added to selection scores (never a hard filter). */
export const BAND_SELECTION_BIAS: Record<SeasonStrengthBand, number> = {
  contender: 10,
  playoff: 4,
  average: 0,
  weaker: -8,
};

/**
 * Soft per-band score ceilings: candidates above the target pay a penalty so
 * weaker teams gravitate toward mid-pack players while legality and role
 * coverage always stay reachable. The penalty never excludes a candidate.
 */
export const BAND_SCORE_CEILINGS: Record<SeasonStrengthBand, number> = {
  contender: 100,
  playoff: 92,
  average: 84,
  weaker: 74,
};

/** Penalty applied to candidate selection scores above the band ceiling. */
export const BAND_CEILING_PENALTY = 1.6;

export interface SeasonScoreMember {
  detailedRatings: SimulationRatings;
  tendencies: SimulationTendencies;
  /** Packaged summary overall (0-100); report-only, never a pick authority. */
  overall?: number;
}

/** 0-100 role scores for one candidate from possession inputs. */
export function roleScoresOf(member: SeasonScoreMember): Record<SeasonRosterRole, number> {
  const r = member.detailedRatings;
  const t = member.tendencies;
  return {
    'primary-creation': clamp(0.45 * r.ballHandling + 0.35 * r.passing + 0.2 * r.offensiveIq),
    'secondary-creation': clamp(0.3 * r.ballHandling + 0.35 * r.passing + 0.35 * r.offensiveIq),
    'perimeter-shooting': clamp(0.8 * r.threePoint + 0.2 * r.midrange + 0.12 * t.threePointRate),
    'rim-finishing-interior-scoring': clamp(0.6 * r.insideScoring + 0.4 * r.closeShot),
    'perimeter-defense': clamp(0.5 * r.perimeterDefense + 0.3 * r.steal + 0.2 * r.defensiveIq),
    'interior-defense': clamp(0.5 * r.interiorDefense + 0.3 * r.block + 0.2 * r.defensiveIq),
    'offensive-rebounding': clamp(0.85 * r.offensiveRebound + 0.15 * t.crashOffensiveGlassRate),
    'defensive-rebounding': clamp(0.9 * r.defensiveRebound + 0.1 * t.crashOffensiveGlassRate),
  };
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** Weighted identity score for one candidate's role scores. */
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

/** Mean of the packaged summary overall ratings (report-only). */
export function overallReportOf(members: readonly SeasonScoreMember[]): number | null {
  const withOverall = members.filter((member) => member.overall !== undefined);
  if (withOverall.length === 0) return null;
  return withOverall.reduce((sum, member) => sum + (member.overall ?? 0), 0) / withOverall.length;
}
