import type {
  CapRushSourcePlayer,
  Position,
  PlayerVersionId,
  SimulationRatings,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';
import { compareStrings } from '../../domain/math.ts';
import { fullCourtSalaryDollarsOf } from './draft-catalog.ts';

/**
 * War Room reads: free identity and salary for everyone, paid reads that turn catalog
 * tendencies and ratings into a role, a usage tier, and concrete strengths or limits.
 * No projection, comparison, or game result is invented here.
 */

export type FullCourtUsageTier = 'low' | 'balanced' | 'high' | 'heavy';

export type FullCourtScoutRole =
  | 'primary-creator'
  | 'secondary-creator'
  | 'floor-spacer'
  | 'rim-runner'
  | 'post-scorer'
  | 'glass-crasher'
  | 'rim-protector'
  | 'perimeter-stopper'
  | 'connector'
  | 'support';

export type FullCourtScoutField = keyof SimulationRatings | keyof SimulationTendencies;

export interface FullCourtScoutEvidence {
  readonly field: FullCourtScoutField;
  readonly value: number;
}

export type FullCourtPlayerFindingCode =
  | 'elite-spacing'
  | 'plus-spacing'
  | 'rim-pressure'
  | 'post-threat'
  | 'offensive-glass'
  | 'rim-protection'
  | 'perimeter-defense'
  | 'defensive-playmaking'
  | 'low-usage'
  | 'no-three-point-range'
  | 'turnover-risk'
  | 'foul-risk'
  | 'poor-free-throw'
  | 'limited-playmaking';

export interface FullCourtPlayerFinding {
  readonly code: FullCourtPlayerFindingCode;
  readonly evidence: readonly FullCourtScoutEvidence[];
}

export interface FullCourtUsageRead {
  readonly usageRate: number;
  readonly tier: FullCourtUsageTier;
  /** Pick-and-roll handler plus isolation share, on the same 0..100 tendency scale. */
  readonly onBallRate: number;
  readonly passRate: number;
  readonly evidence: readonly FullCourtScoutEvidence[];
}

export interface FullCourtRoleRead {
  readonly role: FullCourtScoutRole;
  /** The role to expect when sharing the floor with a higher-usage creator. */
  readonly complementaryRole: FullCourtScoutRole;
  readonly evidence: readonly FullCourtScoutEvidence[];
}

export type FullCourtShotZone =
  'rim' | 'short-mid' | 'long-mid' | 'corner-three' | 'above-break-three';

export interface FullCourtShotZoneRead {
  readonly zone: FullCourtShotZone;
  readonly frequency: number;
}

export interface FullCourtPlayerReportBase {
  readonly playerVersionId: PlayerVersionId;
  readonly displayName: string;
  readonly franchiseId: string;
  readonly eraId: string;
  readonly seasonKey: string;
  readonly positions: readonly Position[];
  readonly overall: number;
  readonly salaryDollars: number;
  readonly heightInches: number | null;
  readonly weightLbs: number | null;
}

export interface FullCourtFreePlayerReport extends FullCourtPlayerReportBase {
  readonly tier: 'free';
}

export interface FullCourtScoutReport extends FullCourtPlayerReportBase {
  readonly tier: 'paid';
  readonly usage: FullCourtUsageRead;
  readonly role: FullCourtRoleRead;
  readonly shotProfile: readonly FullCourtShotZoneRead[];
  readonly strengths: readonly FullCourtPlayerFinding[];
  readonly limitations: readonly FullCourtPlayerFinding[];
}

export type FullCourtLineupFindingCode =
  | 'multiple-creators'
  | 'spacing-volume'
  | 'playmaking-depth'
  | 'rim-protection'
  | 'perimeter-defense'
  | 'glass-control'
  | 'roster-depth'
  | 'no-primary-creator'
  | 'no-spacing'
  | 'thin-spacing'
  | 'no-rim-protection'
  | 'no-perimeter-stopper'
  | 'weak-defensive-glass'
  | 'turnover-risk'
  | 'thin-depth';

export interface FullCourtLineupEvidence {
  readonly playerVersionId: PlayerVersionId;
  readonly displayName: string;
  readonly field: FullCourtScoutField;
  readonly value: number;
}

export interface FullCourtLineupFinding {
  readonly code: FullCourtLineupFindingCode;
  readonly evidence: readonly FullCourtLineupEvidence[];
}

export interface FullCourtLineupUsageEntry {
  readonly playerVersionId: PlayerVersionId;
  readonly displayName: string;
  readonly usageRate: number;
  readonly tier: FullCourtUsageTier;
}

export interface FullCourtLineupFitReport {
  readonly tier: 'paid';
  readonly rosterVersionIds: readonly PlayerVersionId[];
  readonly rosterSize: number;
  readonly usageHierarchy: readonly FullCourtLineupUsageEntry[];
  readonly strengths: readonly FullCourtLineupFinding[];
  readonly gaps: readonly FullCourtLineupFinding[];
}

export function fullCourtUsageTier(usageRate: number): FullCourtUsageTier {
  if (usageRate < 14) return 'low';
  if (usageRate < 21) return 'balanced';
  if (usageRate < 26) return 'high';
  return 'heavy';
}

function evidence(field: FullCourtScoutField, value: number): FullCourtScoutEvidence {
  return { field, value };
}

function isFloorSpacer(ratings: SimulationRatings, tendencies: SimulationTendencies): boolean {
  return ratings.threePoint >= 62 && tendencies.threePointRate >= 18;
}

function isRimRunner(ratings: SimulationRatings, tendencies: SimulationTendencies): boolean {
  return (
    tendencies.rimFrequency >= 32 &&
    (tendencies.cutRate >= 10 || tendencies.pickAndRollRollManRate >= 15) &&
    ratings.insideScoring >= 60
  );
}

function isPostScorer(ratings: SimulationRatings, tendencies: SimulationTendencies): boolean {
  return tendencies.postUpRate >= 10 && ratings.insideScoring >= 65;
}

function isGlassCrasher(ratings: SimulationRatings, tendencies: SimulationTendencies): boolean {
  return ratings.offensiveRebound >= 62 || tendencies.crashOffensiveGlassRate >= 16.7;
}

function isRimProtector(ratings: SimulationRatings): boolean {
  return ratings.interiorDefense >= 66 && ratings.block >= 62;
}

function isPerimeterStopper(ratings: SimulationRatings): boolean {
  return ratings.perimeterDefense >= 66;
}

function scoutRole(
  ratings: SimulationRatings,
  tendencies: SimulationTendencies,
): FullCourtScoutRole {
  const onBall = tendencies.pickAndRollBallHandlerRate + tendencies.isolationRate;
  if (tendencies.usageRate >= 26 && onBall >= 25) return 'primary-creator';
  if (tendencies.usageRate >= 18 && tendencies.passRate >= 12) return 'secondary-creator';
  if (isFloorSpacer(ratings, tendencies)) return 'floor-spacer';
  if (isRimRunner(ratings, tendencies)) return 'rim-runner';
  if (isPostScorer(ratings, tendencies)) return 'post-scorer';
  if (isGlassCrasher(ratings, tendencies)) return 'glass-crasher';
  if (isRimProtector(ratings)) return 'rim-protector';
  if (isPerimeterStopper(ratings)) return 'perimeter-stopper';
  if (tendencies.passRate >= 10) return 'connector';
  return 'support';
}

function complementaryRole(
  ratings: SimulationRatings,
  tendencies: SimulationTendencies,
): FullCourtScoutRole {
  if (isFloorSpacer(ratings, tendencies)) return 'floor-spacer';
  if (isRimRunner(ratings, tendencies)) return 'rim-runner';
  if (isPostScorer(ratings, tendencies)) return 'post-scorer';
  if (isGlassCrasher(ratings, tendencies)) return 'glass-crasher';
  if (isRimProtector(ratings)) return 'rim-protector';
  if (isPerimeterStopper(ratings)) return 'perimeter-stopper';
  if (tendencies.passRate >= 10) return 'connector';
  return tendencies.usageRate >= 26 ? 'primary-creator' : 'support';
}

function roleEvidence(
  role: FullCourtScoutRole,
  ratings: SimulationRatings,
  tendencies: SimulationTendencies,
): readonly FullCourtScoutEvidence[] {
  switch (role) {
    case 'primary-creator':
      return [
        evidence('usageRate', tendencies.usageRate),
        evidence('pickAndRollBallHandlerRate', tendencies.pickAndRollBallHandlerRate),
        evidence('isolationRate', tendencies.isolationRate),
      ];
    case 'secondary-creator':
    case 'connector':
      return [
        evidence('passRate', tendencies.passRate),
        evidence('usageRate', tendencies.usageRate),
      ];
    case 'floor-spacer':
      return [
        evidence('threePoint', ratings.threePoint),
        evidence('threePointRate', tendencies.threePointRate),
      ];
    case 'rim-runner':
      return [
        evidence('rimFrequency', tendencies.rimFrequency),
        evidence('cutRate', tendencies.cutRate),
        evidence('insideScoring', ratings.insideScoring),
      ];
    case 'post-scorer':
      return [
        evidence('postUpRate', tendencies.postUpRate),
        evidence('insideScoring', ratings.insideScoring),
      ];
    case 'glass-crasher':
      return [
        evidence('offensiveRebound', ratings.offensiveRebound),
        evidence('crashOffensiveGlassRate', tendencies.crashOffensiveGlassRate),
      ];
    case 'rim-protector':
      return [
        evidence('interiorDefense', ratings.interiorDefense),
        evidence('block', ratings.block),
      ];
    case 'perimeter-stopper':
      return [evidence('perimeterDefense', ratings.perimeterDefense)];
    case 'support':
      return [];
  }
}

function playerFindings(
  ratings: SimulationRatings,
  tendencies: SimulationTendencies,
): { strengths: FullCourtPlayerFinding[]; limitations: FullCourtPlayerFinding[] } {
  const strengths: FullCourtPlayerFinding[] = [];
  const limitations: FullCourtPlayerFinding[] = [];
  if (ratings.threePoint >= 70 && tendencies.threePointRate >= 30) {
    strengths.push({
      code: 'elite-spacing',
      evidence: [
        evidence('threePoint', ratings.threePoint),
        evidence('threePointRate', tendencies.threePointRate),
      ],
    });
  } else if (isFloorSpacer(ratings, tendencies)) {
    strengths.push({
      code: 'plus-spacing',
      evidence: [
        evidence('threePoint', ratings.threePoint),
        evidence('threePointRate', tendencies.threePointRate),
      ],
    });
  }
  if (tendencies.rimFrequency >= 35) {
    strengths.push({
      code: 'rim-pressure',
      evidence: [evidence('rimFrequency', tendencies.rimFrequency)],
    });
  }
  if (isPostScorer(ratings, tendencies)) {
    strengths.push({
      code: 'post-threat',
      evidence: [
        evidence('postUpRate', tendencies.postUpRate),
        evidence('insideScoring', ratings.insideScoring),
      ],
    });
  }
  if (isGlassCrasher(ratings, tendencies)) {
    strengths.push({
      code: 'offensive-glass',
      evidence: [
        evidence('offensiveRebound', ratings.offensiveRebound),
        evidence('crashOffensiveGlassRate', tendencies.crashOffensiveGlassRate),
      ],
    });
  }
  if (isRimProtector(ratings)) {
    strengths.push({
      code: 'rim-protection',
      evidence: [
        evidence('interiorDefense', ratings.interiorDefense),
        evidence('block', ratings.block),
      ],
    });
  }
  if (isPerimeterStopper(ratings)) {
    strengths.push({
      code: 'perimeter-defense',
      evidence: [evidence('perimeterDefense', ratings.perimeterDefense)],
    });
  }
  if (ratings.steal >= 72 || ratings.defensiveIq >= 75) {
    strengths.push({
      code: 'defensive-playmaking',
      evidence: [evidence('steal', ratings.steal), evidence('defensiveIq', ratings.defensiveIq)],
    });
  }
  if (tendencies.usageRate <= 12) {
    limitations.push({
      code: 'low-usage',
      evidence: [evidence('usageRate', tendencies.usageRate)],
    });
  }
  if (ratings.threePoint <= 45 && tendencies.threePointRate <= 5) {
    limitations.push({
      code: 'no-three-point-range',
      evidence: [
        evidence('threePoint', ratings.threePoint),
        evidence('threePointRate', tendencies.threePointRate),
      ],
    });
  }
  if (tendencies.turnoverRate >= 18) {
    limitations.push({
      code: 'turnover-risk',
      evidence: [evidence('turnoverRate', tendencies.turnoverRate)],
    });
  }
  if (tendencies.foulRate >= 9) {
    limitations.push({ code: 'foul-risk', evidence: [evidence('foulRate', tendencies.foulRate)] });
  }
  if (ratings.freeThrow <= 65) {
    limitations.push({
      code: 'poor-free-throw',
      evidence: [evidence('freeThrow', ratings.freeThrow)],
    });
  }
  if (tendencies.passRate <= 5 && tendencies.usageRate >= 18) {
    limitations.push({
      code: 'limited-playmaking',
      evidence: [evidence('passRate', tendencies.passRate)],
    });
  }
  return { strengths, limitations };
}

export function fullCourtFreePlayerReport(player: CapRushSourcePlayer): FullCourtFreePlayerReport {
  return {
    tier: 'free',
    playerVersionId: player.playerVersionId,
    displayName: player.displayName,
    franchiseId: player.franchiseId,
    eraId: player.eraId,
    seasonKey: player.seasonKey,
    positions: player.positions,
    overall: player.originalOverall,
    salaryDollars: fullCourtSalaryDollarsOf(player),
    heightInches: player.physical.heightInches,
    weightLbs: player.physical.weightLbs,
  };
}

/** Paid read of the same catalog record; every claim quotes the field that produced it. */
export function fullCourtScoutPlayer(player: CapRushSourcePlayer): FullCourtScoutReport {
  const ratings = player.profile.ratings;
  const tendencies = player.profile.tendencies;
  const role = scoutRole(ratings, tendencies);
  const findings = playerFindings(ratings, tendencies);
  return {
    ...fullCourtFreePlayerReport(player),
    tier: 'paid',
    usage: {
      usageRate: tendencies.usageRate,
      tier: fullCourtUsageTier(tendencies.usageRate),
      onBallRate: tendencies.pickAndRollBallHandlerRate + tendencies.isolationRate,
      passRate: tendencies.passRate,
      evidence: [
        evidence('usageRate', tendencies.usageRate),
        evidence('pickAndRollBallHandlerRate', tendencies.pickAndRollBallHandlerRate),
        evidence('isolationRate', tendencies.isolationRate),
      ],
    },
    role: {
      role,
      complementaryRole: complementaryRole(ratings, tendencies),
      evidence: roleEvidence(role, ratings, tendencies),
    },
    shotProfile: [
      { zone: 'rim', frequency: tendencies.rimFrequency },
      { zone: 'short-mid', frequency: tendencies.shortMidFrequency },
      { zone: 'long-mid', frequency: tendencies.longMidFrequency },
      { zone: 'corner-three', frequency: tendencies.cornerThreeFrequency },
      { zone: 'above-break-three', frequency: tendencies.aboveBreakThreeFrequency },
    ],
    strengths: findings.strengths,
    limitations: findings.limitations,
  };
}

function lineupEvidence(
  players: readonly CapRushSourcePlayer[],
  fieldOf: (player: CapRushSourcePlayer) => { field: FullCourtScoutField; value: number },
): readonly FullCourtLineupEvidence[] {
  return players
    .map((player) => {
      const { field, value } = fieldOf(player);
      return {
        playerVersionId: player.playerVersionId,
        displayName: player.displayName,
        field,
        value,
      };
    })
    .sort(
      (left, right) =>
        right.value - left.value || compareStrings(left.playerVersionId, right.playerVersionId),
    );
}

/**
 * Roster-level fit from the same catalog traits used by player scouting. Findings report
 * counts and the players behind them; they never claim how the five will actually play.
 */
export function fullCourtLineupFitReport(
  roster: readonly CapRushSourcePlayer[],
): FullCourtLineupFitReport {
  const creators = roster.filter((player) => player.profile.tendencies.usageRate >= 24);
  const spacers = roster.filter((player) =>
    isFloorSpacer(player.profile.ratings, player.profile.tendencies),
  );
  const playmakers = roster.filter(
    (player) => player.profile.tendencies.passRate >= 11 || player.profile.ratings.passing >= 68,
  );
  const rimProtectors = roster.filter((player) => isRimProtector(player.profile.ratings));
  const perimeterDefenders = roster.filter((player) => isPerimeterStopper(player.profile.ratings));
  const rebounders = roster.filter((player) => player.profile.ratings.defensiveRebound >= 62);
  const turnoverProne = roster.filter((player) => player.profile.tendencies.turnoverRate >= 17);

  const strengths: FullCourtLineupFinding[] = [];
  const gaps: FullCourtLineupFinding[] = [];
  if (creators.length >= 2) {
    strengths.push({
      code: 'multiple-creators',
      evidence: lineupEvidence(creators, (player) => ({
        field: 'usageRate',
        value: player.profile.tendencies.usageRate,
      })),
    });
  }
  if (spacers.length >= 2) {
    strengths.push({
      code: 'spacing-volume',
      evidence: lineupEvidence(spacers, (player) => ({
        field: 'threePoint',
        value: player.profile.ratings.threePoint,
      })),
    });
  }
  if (playmakers.length >= 2) {
    strengths.push({
      code: 'playmaking-depth',
      evidence: lineupEvidence(playmakers, (player) => ({
        field: 'passRate',
        value: player.profile.tendencies.passRate,
      })),
    });
  }
  if (rimProtectors.length >= 1) {
    strengths.push({
      code: 'rim-protection',
      evidence: lineupEvidence(rimProtectors, (player) => ({
        field: 'interiorDefense',
        value: player.profile.ratings.interiorDefense,
      })),
    });
  }
  if (perimeterDefenders.length >= 2) {
    strengths.push({
      code: 'perimeter-defense',
      evidence: lineupEvidence(perimeterDefenders, (player) => ({
        field: 'perimeterDefense',
        value: player.profile.ratings.perimeterDefense,
      })),
    });
  }
  if (rebounders.length >= 2) {
    strengths.push({
      code: 'glass-control',
      evidence: lineupEvidence(rebounders, (player) => ({
        field: 'defensiveRebound',
        value: player.profile.ratings.defensiveRebound,
      })),
    });
  }
  if (roster.length >= 9) {
    strengths.push({ code: 'roster-depth', evidence: [] });
  }

  if (creators.length === 0) gaps.push({ code: 'no-primary-creator', evidence: [] });
  if (spacers.length === 0) gaps.push({ code: 'no-spacing', evidence: [] });
  else if (spacers.length === 1) {
    gaps.push({
      code: 'thin-spacing',
      evidence: lineupEvidence(spacers, (player) => ({
        field: 'threePoint',
        value: player.profile.ratings.threePoint,
      })),
    });
  }
  if (rimProtectors.length === 0) gaps.push({ code: 'no-rim-protection', evidence: [] });
  if (perimeterDefenders.length === 0) {
    gaps.push({ code: 'no-perimeter-stopper', evidence: [] });
  }
  if (rebounders.length === 0) gaps.push({ code: 'weak-defensive-glass', evidence: [] });
  if (turnoverProne.length >= 2) {
    gaps.push({
      code: 'turnover-risk',
      evidence: lineupEvidence(turnoverProne, (player) => ({
        field: 'turnoverRate',
        value: player.profile.tendencies.turnoverRate,
      })),
    });
  }
  if (roster.length > 0 && roster.length < 8) {
    gaps.push({ code: 'thin-depth', evidence: [] });
  }

  const usageHierarchy = [...roster]
    .sort(
      (left, right) =>
        right.profile.tendencies.usageRate - left.profile.tendencies.usageRate ||
        compareStrings(left.playerVersionId, right.playerVersionId),
    )
    .map((player) => ({
      playerVersionId: player.playerVersionId,
      displayName: player.displayName,
      usageRate: player.profile.tendencies.usageRate,
      tier: fullCourtUsageTier(player.profile.tendencies.usageRate),
    }));

  return {
    tier: 'paid',
    rosterVersionIds: roster.map((player) => player.playerVersionId),
    rosterSize: roster.length,
    usageHierarchy,
    strengths,
    gaps,
  };
}
