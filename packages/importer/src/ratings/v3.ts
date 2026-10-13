import {
  RATING_MODEL_VERSION,
  individualHonorSchema,
  offenseDefenseOf,
  overallForScore,
  type ArchetypeMemberships,
  type CalibratedImpact,
  type NonlinearComponents,
  type ProductionEvidence,
  type RatingArchetype,
  type RatingProfile,
  type RatingsModelArtifact,
  type SimulationRatings,
  type SimulationTendencies,
  type SummaryRatings,
  type IndividualHonor,
} from '@hoop-rush/data-contracts';
import { clamp, clampRating, safeFloat } from '../json.ts';
import type { StatsRow } from './stats.ts';
import type { ProvenanceMap, PostseasonPlayerStats } from '@hoop-rush/data-contracts';
import {
  effectiveTrueShooting,
  observed,
  possessionExposure,
  ratePer100,
  stabilizedRate,
  usageFor,
} from './season-evidence.ts';
import { positionGroupForSource } from '../positions/normalize.ts';
export const RATING_ARCHETYPES: readonly RatingArchetype[] = [
  'primaryCreator',
  'secondaryCreator',
  'scoringGuard',
  'movementSpacer',
  'twoWayWing',
  'connector',
  'interiorFinisher',
  'stretchBig',
  'rebounder',
  'defensiveAnchor',
];
type SkillKey = keyof SimulationRatings;
const POSITION_PRIOR: Readonly<Record<string, Partial<Record<RatingArchetype, number>>>> = {
  PG: { primaryCreator: 0.06, secondaryCreator: 0.03, connector: 0.02 },
  SG: { scoringGuard: 0.05, movementSpacer: 0.03, twoWayWing: 0.02 },
  SF: { twoWayWing: 0.04, connector: 0.03, movementSpacer: 0.02 },
  PF: { stretchBig: 0.04, rebounder: 0.04, defensiveAnchor: 0.02 },
  C: { interiorFinisher: 0.05, rebounder: 0.05, defensiveAnchor: 0.04 },
};
export interface RatingProfileInput {
  season?: string;
  ratings: SimulationRatings;
  tendencies: SimulationTendencies;
  stats: StatsRow;
  abilityProvenance?: ProvenanceMap;
  position: string;
  heightInches: number | null;
  artifact: RatingsModelArtifact;
  playerId?: string;
  teamWinPct?: number | null;
  age?: number | null;
  eraPace?: number | null;
  eraThreeRate?: number | null;
  postseason?: PostseasonPlayerStats;
  postseasonEvidenceAvailable?: boolean;
}
export function spacingWeightForEra(leagueThreePARate?: number | null): number {
  if (leagueThreePARate == null || !Number.isFinite(leagueThreePARate)) return 1;
  return clamp(leagueThreePARate / 0.25, 0.2, 1);
}
export interface DerivedRatingProfile {
  profile: RatingProfile;
  summaryRatings: SummaryRatings;
}
function skill(ratings: SimulationRatings, key: SkillKey): number {
  return clamp(ratings[key], 0, 100);
}
function mean(values: readonly number[]): number {
  return values.length === 0 ? 50 : values.reduce((sum, value) => sum + value, 0) / values.length;
}
function productMean(values: readonly number[]): number {
  if (values.length === 0) return 50;
  return (
    values.reduce((product, value) => product * Math.max(0, value / 100), 1) **
      (1 / values.length) *
    100
  );
}
function softmax(values: readonly number[]): number[] {
  const max = Math.max(...values);
  const exponentials = values.map((value) => Math.exp((value - max) / 14));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / Math.max(1e-9, total));
}
function normalizeMemberships(values: readonly number[]): ArchetypeMemberships {
  const normalized = softmax(values);
  const result = {} as ArchetypeMemberships;
  RATING_ARCHETYPES.forEach((archetype, index) => {
    result[archetype] = Math.round((normalized[index] ?? 0) * 1000000) / 1000000;
  });
  const sum = Object.values(result).reduce((total, value) => total + value, 0);
  const last = RATING_ARCHETYPES.at(-1);
  if (last) result[last] = Math.round((result[last] + 1 - sum) * 1000000) / 1000000;
  return result;
}
export function effectiveUsageFor(stats: StatsRow, eraPace?: number | null): number | null {
  return possessionExposure(stats, eraPace ?? 100) > 0 ? usageFor(stats, eraPace ?? 100) : null;
}
export function productionEvidence(
  stats: StatsRow,
  eraPace?: number | null,
  eraThreeRate?: number | null,
): ProductionEvidence {
  const pace = possessionPaceFor(stats, eraPace);
  const exposure = possessionExposure(stats, pace);
  const games = Math.max(0, Math.trunc(observed(stats, 'gamesPlayed') ?? 0));
  const minutes = Math.max(0, observed(stats, 'minutes') ?? 0);
  const points = stabilizedRate(stats, 'points', 22, pace, 200);
  const assists = stabilizedRate(stats, 'assists', 4.5, pace);
  const secondary = stabilizedRate(stats, 'secondaryAssists', 0, pace);
  const potential = stabilizedRate(stats, 'potentialAssists', assists, pace);
  const creation = assists + 0.3 * secondary + 0.1 * Math.max(0, potential - assists);
  const rebounds = stabilizedRate(stats, 'offensiveRebounds', 2, pace);
  const usage = usageFor(stats, pace);
  const ts = effectiveTrueShooting(stats, eraThreeRate ?? 0.39);
  const shootingAttempts = (observed(stats, 'fga') ?? 0) + 0.44 * (observed(stats, 'fta') ?? 0);
  const shootingConfidence = shootingAttempts / (shootingAttempts + 100);
  const attemptsPer100 = exposure > 0 ? (shootingAttempts * 100) / exposure : 0;
  const scoringSurplus = ts === null ? 0 : 2 * (ts - 0.565) * attemptsPer100 * shootingConfidence;
  const turnovers = ratePer100(stats, 'turnovers', pace);
  const expectedTurnovers = 1.5 + usage * 0.045 + creation * 0.12;
  const security = turnovers === null ? 0 : clamp((expectedTurnovers - turnovers) * 1.5, -5, 5);
  const score = clamp(
    50 +
      (points - 22) * 0.75 +
      (creation - 4.5) * 1.6 +
      (rebounds - 2) * 1 +
      security +
      scoringSurplus * 1.5,
    0,
    100,
  );
  const shrinkage = exposure / (exposure + 400);
  return {
    score,
    pointsPer100: points,
    creationPer100: creation,
    offensiveReboundsPer100: rebounds,
    scoringSurplusPer100: ts === null ? null : scoringSurplus,
    turnoverSecurity: security,
    weight: 0.45 * shrinkage,
    confidence: exposure >= 1500 && ts !== null ? 'high' : exposure >= 400 ? 'medium' : 'low',
    sampleGames: games,
    sampleMinutes: minutes,
    shrinkage,
    creationPer36: (creation * pace * 36) / 4800,
  };
}
export function possessionPaceFor(stats: StatsRow, eraPace?: number | null): number {
  const observed = stats.possessionPace;
  if (
    typeof observed === 'number' &&
    Number.isFinite(observed) &&
    observed >= 70 &&
    observed <= 150
  )
    return observed;
  return eraPace != null && Number.isFinite(eraPace) && eraPace > 0 ? eraPace : 100;
}
export function offensiveAbilityFor(
  ratings: SimulationRatings,
  tendencies: SimulationTendencies,
  eraThreeRate?: number | null,
): number {
  const interiorScoring = 0.8 * ratings.insideScoring + 0.2 * ratings.closeShot;
  const routes = [interiorScoring, ratings.midrange, ratings.threePoint];
  const spacingWeight = spacingWeightForEra(eraThreeRate);
  const routeBreadth =
    (interiorScoring + ratings.midrange + spacingWeight * ratings.threePoint) / (2 + spacingWeight);
  const scoring =
    0.92 * (0.88 * Math.max(...routes) + 0.12 * routeBreadth) + 0.08 * ratings.freeThrow;
  const creation = 0.6 * ratings.passing + 0.4 * ratings.ballHandling;
  const security =
    0.5 * ratings.ballHandling + 0.5 * clamp(100 - (tendencies.turnoverRate - 5) * 5, 0, 100);
  return (
    0.55 * scoring +
    0.24 * creation +
    0.1 * security +
    0.07 * ratings.offensiveIq +
    0.04 * ratings.offensiveRebound
  );
}
export function defensePositionGroup(position?: string | null): 'G' | 'F' | 'C' {
  return positionGroupForSource(position ?? 'SF');
}
const DEFENSE_ABILITY_SHARES: Record<
  'G' | 'F' | 'C',
  {
    perimeter: number;
    interior: number;
    steal: number;
    block: number;
    iq: number;
    rebound: number;
  }
> = {
  // Guard and center weights are mirrors, so an interior anchor and a
  // perimeter stopper with the same skill profile grade the same.
  C: { perimeter: 0.06, interior: 0.56, steal: 0.02, block: 0.06, iq: 0.12, rebound: 0.18 },
  F: { perimeter: 0.31, interior: 0.31, steal: 0.04, block: 0.04, iq: 0.12, rebound: 0.18 },
  G: { perimeter: 0.56, interior: 0.06, steal: 0.06, block: 0.02, iq: 0.12, rebound: 0.18 },
};
export function defensiveAbilityFor(ratings: SimulationRatings, position?: string | null): number {
  const shares = DEFENSE_ABILITY_SHARES[defensePositionGroup(position)];
  return (
    shares.perimeter * ratings.perimeterDefense +
    shares.interior * ratings.interiorDefense +
    shares.steal * ratings.steal +
    shares.block * ratings.block +
    shares.iq * ratings.defensiveIq +
    shares.rebound * ratings.defensiveRebound
  );
}
export function combineDomainValues(
  offense: number,
  defense: number,
): { score: number; offenseWeight: number; defenseWeight: number } {
  const offenseWeight = 0.6;
  const defenseWeight = 0.4 * 0.9;
  return { score: offenseWeight * offense + defenseWeight * defense, offenseWeight, defenseWeight };
}
export function eraAdjustmentFor(
  score: number,
  season: string | undefined,
  artifact: RatingsModelArtifact,
): number {
  if (season === undefined || artifact.eraReference === undefined) return 0;
  const decade = `${String(Math.floor(Number(season.slice(0, 4)) / 10) * 10)}s`;
  const reference = artifact.eraReferences?.[decade];
  if (reference === undefined) return 0;
  const relative =
    artifact.eraReference.mean +
    ((score - reference.mean) * artifact.eraReference.standardDeviation) /
      reference.standardDeviation;
  const confidence = reference.sampleCount / (reference.sampleCount + 100);
  return clamp((relative - score) * 0.45 * confidence, -4, 4);
}
function evidenceCoverage(input: RatingProfileInput, keys: readonly string[]): number {
  return (
    keys.reduce((sum, key) => {
      const evidence = input.abilityProvenance?.[key];
      if (!evidence || evidence.kind === 'estimated' || evidence.kind === 'reconstructed')
        return sum;
      return (
        sum + (evidence.confidence === 'high' ? 1 : evidence.confidence === 'medium' ? 0.5 : 0.25)
      );
    }, 0) / keys.length
  );
}
function deriveNonlinear(
  ratings: SimulationRatings,
  tendencies: SimulationTendencies,
  stats: StatsRow,
  memberships: ArchetypeMemberships,
  spacingWeight = 1,
  position?: string,
  eraThreeRate?: number | null,
): NonlinearComponents {
  const creation = productMean([
    skill(ratings, 'ballHandling'),
    skill(ratings, 'passing'),
    skill(ratings, 'offensiveIq'),
  ]);
  const penetration = productMean([
    skill(ratings, 'ballHandling'),
    skill(ratings, 'speed'),
    skill(ratings, 'insideScoring'),
  ]);
  const shootingGravity = mean([
    skill(ratings, 'threePoint'),
    skill(ratings, 'freeThrow'),
    skill(ratings, 'midrange'),
    50 + tendencies.threePointRate,
  ]);
  const scalableScoring = mean([
    skill(ratings, 'insideScoring'),
    skill(ratings, 'threePoint'),
    skill(ratings, 'offensiveIq'),
  ]);
  const switchability = productMean([
    skill(ratings, 'perimeterDefense'),
    skill(ratings, 'speed'),
    skill(ratings, 'strength'),
  ]);
  const rimProtection = productMean([
    skill(ratings, 'interiorDefense'),
    skill(ratings, 'block'),
    skill(ratings, 'strength'),
    skill(ratings, 'vertical'),
  ]);
  const possessionControl = mean([
    skill(ratings, 'ballHandling'),
    skill(ratings, 'passing'),
    skill(ratings, 'offensiveIq'),
    100 - tendencies.turnoverRate * 2.2,
  ]);
  const creationSynergy = Math.max(0, (creation - 62) / 38) * memberships.primaryCreator;
  const shotSynergy =
    Math.max(0, (shootingGravity - 62) / 38) *
    (memberships.movementSpacer + memberships.stretchBig);
  const twoWaySynergy = Math.max(0, (switchability - 62) / 38) * memberships.twoWayWing;
  const insideSynergy = Math.max(0, (penetration - 62) / 38) * memberships.interiorFinisher;
  const anchorSynergy = Math.max(0, (rimProtection - 62) / 38) * memberships.defensiveAnchor;
  const synergyBonus = clamp(
    (creationSynergy + shotSynergy + twoWaySynergy + insideSynergy + anchorSynergy) * 5,
    0,
    5,
  );
  const usage = safeFloat(stats.usageRate, tendencies.usageRate);
  const ts = effectiveTrueShooting(stats, eraThreeRate ?? 0.39);
  const bigRole =
    memberships.interiorFinisher +
    memberships.stretchBig +
    memberships.rebounder +
    memberships.defensiveAnchor;
  const primaryRole =
    memberships.primaryCreator + memberships.secondaryCreator + memberships.scoringGuard;
  const rebounding = mean([skill(ratings, 'offensiveRebound'), skill(ratings, 'defensiveRebound')]);
  const apg =
    Math.max(0, Math.trunc(safeFloat(stats.gamesPlayed))) > 0
      ? safeFloat(stats.assists) / Math.max(1, Math.trunc(safeFloat(stats.gamesPlayed)))
      : 0;
  const weaknesses = {
    turnoverLiability: clamp(
      (Math.max(0, tendencies.turnoverRate - 12) * (0.7 + 0.8 * primaryRole)) / (1 + apg / 12),
      0,
      6,
    ),
    inefficientUsage:
      ts === null ? 0 : clamp(Math.max(0, usage - 24) * Math.max(0, 0.565 - ts) * 1.3, 0, 6),
    defensiveTargeting: clamp(
      (Math.max(0, 64 - defensiveAbilityFor(ratings, position)) * (0.9 + primaryRole * 0.65)) / 7,
      0,
      6,
    ),
    spacingLimitation:
      clamp(
        ((Math.max(0, 58 - shootingGravity) * (0.8 + primaryRole * 0.8)) / 8) *
          (1 - bigRole * 0.65),
        0,
        6,
      ) * spacingWeight,
    foulRisk: clamp(Math.max(0, tendencies.foulRate - 5) * (0.6 + bigRole * 0.6), 0, 6),
    deficientRebounding: clamp((Math.max(0, 55 - rebounding) * (0.5 + bigRole)) / 8, 0, 6),
    hollowAnchor: 0,
  };
  const weaknessPenalty = -Math.min(
    6,
    Object.values(weaknesses).reduce((sum, value) => sum + value, 0) * 0.34,
  );
  return {
    creation,
    penetration,
    shootingGravity,
    scalableScoring,
    switchability,
    rimProtection,
    possessionControl,
    synergyBonus,
    weaknessPenalty,
    weaknesses,
  };
}
function deriveMemberships(input: RatingProfileInput): ArchetypeMemberships {
  const { tendencies, position, heightInches } = input;
  const group = defensePositionGroup(position);
  const positionSize = group === 'C' ? 90 : group === 'F' ? 60 : 20;
  const size =
    heightInches === null
      ? positionSize
      : 0.75 * positionSize + 0.25 * clamp((heightInches - 72) * 6, 0, 100);
  const prior = POSITION_PRIOR[position] ?? {};
  const raw: Record<RatingArchetype, number> = {
    primaryCreator: tendencies.usageRate * 0.6 + tendencies.passRate * 0.4,
    secondaryCreator: tendencies.passRate * 0.7 + tendencies.usageRate * 0.3,
    scoringGuard: tendencies.usageRate * 0.7 + tendencies.isolationRate * 0.3,
    movementSpacer: tendencies.threePointRate * 0.6 + tendencies.spotUpRate * 0.4,
    twoWayWing: 45,
    connector: tendencies.passRate,
    interiorFinisher: tendencies.rimFrequency * 0.7 + tendencies.postUpRate * 0.3,
    stretchBig: tendencies.threePointRate * 0.6 + size * 0.4,
    rebounder: tendencies.crashOffensiveGlassRate,
    defensiveAnchor: tendencies.blockAttemptRate * 0.4 + size * 0.6,
  };
  for (const archetype of RATING_ARCHETYPES) {
    raw[archetype] += (prior[archetype] ?? 0) * 100;
  }
  return normalizeMemberships(RATING_ARCHETYPES.map((archetype) => raw[archetype]));
}
export function computeOffenseDefense(
  ratings: SimulationRatings,
  tendencies: SimulationTendencies,
  eraThreeRate?: number | null,
  position?: string | null,
): {
  offenseRating: number;
  defenseRating: number;
} {
  const group = defensePositionGroup(position);
  return offenseDefenseOf(ratings, tendencies, eraThreeRate, position == null ? null : group);
}
export function deriveRatingProfile(input: RatingProfileInput): DerivedRatingProfile {
  const production = productionEvidence(input.stats, input.eraPace, input.eraThreeRate);
  const memberships = deriveMemberships(input);
  const spacingWeight = spacingWeightForEra(input.eraThreeRate);
  const nonlinear = deriveNonlinear(
    input.ratings,
    input.tendencies,
    input.stats,
    memberships,
    spacingWeight,
    input.position,
    input.eraThreeRate,
  );
  const calibrated = input.playerId
    ? input.artifact.playerAdjustments?.[input.playerId]
    : undefined;
  const impactSupported =
    input.artifact.impactModelVersion === RATING_MODEL_VERSION &&
    input.artifact.contexts.length > 0 &&
    calibrated?.metrics !== undefined &&
    calibrated.sampleCount >=
      input.artifact.confidenceTargetSamplesPerContext * input.artifact.contexts.length;
  const calibratedImpact: CalibratedImpact = {
    adjustment: impactSupported ? clamp(calibrated.adjustment * calibrated.confidence, -2, 2) : 0,
    confidence: clamp(calibrated?.confidence ?? 0, 0, 1),
    sampleCount: calibrated?.sampleCount ?? 0,
    artifactVersion: input.artifact.impactModelVersion ?? input.artifact.modelVersion,
  };
  const summary = computeOffenseDefense(
    input.ratings,
    input.tendencies,
    input.eraThreeRate,
    input.position,
  );
  const offensiveAbility = offensiveAbilityFor(input.ratings, input.tendencies, input.eraThreeRate);
  const defensiveAbility = defensiveAbilityFor(input.ratings, input.position);
  const defensiveTrackingAdjustment = 0;
  const defensiveValue = defensiveAbility;
  const offensiveValue =
    offensiveAbility * (1 - production.weight) + production.score * production.weight;
  const baseScore = combineDomainValues(offensiveAbility, defensiveValue).score;
  const combined = combineDomainValues(offensiveValue, defensiveValue);
  const rawBeforeRecognition = combined.score;
  const abilityContribution =
    combined.offenseWeight * offensiveAbility * (1 - production.weight) +
    combined.defenseWeight * defensiveValue;
  const productionContribution = combined.offenseWeight * production.score * production.weight;
  const postseasonProduction =
    input.postseason === undefined
      ? null
      : productionEvidence(
          {
            ...input.postseason,
            possessionPace: input.stats.possessionPace,
            leagueTrueShooting: input.stats.leagueTrueShooting,
          },
          input.eraPace,
          input.eraThreeRate,
        );
  const postseasonWeight =
    input.postseason === undefined
      ? 0
      : 0.12 *
        Math.min(
          1,
          possessionExposure(input.postseason, possessionPaceFor(input.stats, input.eraPace)) / 600,
        );
  const postseasonContribution =
    postseasonProduction === null
      ? 0
      : clamp((postseasonProduction.score - production.score) * postseasonWeight, -1.8, 1.8);
  const synergyContribution = nonlinear.synergyBonus * 0.5;
  const weaknessContribution = nonlinear.weaknessPenalty * 0.5;
  const impactContribution = calibratedImpact.adjustment;
  const awardValues: Record<IndividualHonor, number> = {
    'MVP-1': 4,
    NBA1: 3,
    NBA2: 2,
    NBA3: 1,
    DEF1: 1,
    DEF2: 0.5,
  };
  const honors = individualHonorSchema.array().parse(input.stats.honors ?? []);
  const recognitionHonor =
    [...honors].sort((a, b) => awardValues[b] - awardValues[a] || a.localeCompare(b))[0] ?? null;
  const offenseAward = Math.max(
    0,
    ...honors.filter((honor) => !honor.startsWith('DEF')).map((honor) => awardValues[honor]),
  );
  const defenseAward = Math.max(
    0,
    ...honors.filter((honor) => honor.startsWith('DEF')).map((honor) => awardValues[honor]),
  );
  const recognitionWeight = honors.length > 0 ? 0.5 * production.shrinkage : 0;
  const recognitionContribution = (offenseAward + defenseAward) * recognitionWeight;
  const minutesPerGame =
    production.sampleGames > 0 ? production.sampleMinutes / production.sampleGames : 0;
  const teamRecordWeight = Math.min(1, minutesPerGame / 30) * production.shrinkage;
  const teamWinPct = input.teamWinPct;
  const teamRecordContribution =
    teamWinPct != null && Number.isFinite(teamWinPct) && teamWinPct >= 0 && teamWinPct <= 1
      ? clamp((teamWinPct - 0.5) * 4, -1, 1) * teamRecordWeight
      : 0;
  const eraContribution = eraAdjustmentFor(
    rawBeforeRecognition +
      synergyContribution +
      weaknessContribution +
      impactContribution +
      recognitionContribution +
      teamRecordContribution,
    input.season,
    input.artifact,
  );
  const unboundedRaw =
    rawBeforeRecognition +
    eraContribution +
    postseasonContribution +
    synergyContribution +
    weaknessContribution +
    impactContribution +
    recognitionContribution +
    teamRecordContribution;
  const clampContribution = clamp(unboundedRaw, 0, 100) - unboundedRaw;
  const raw = Math.round(clamp(unboundedRaw, 0, 100) * 10000) / 10000;
  const mapped = input.artifact.overallScale
    ? overallForScore(raw, input.artifact.overallScale)
    : { overall: clampRating(raw), percentile: 0.5 };
  const canonicalOverall = mapped.overall;
  const profile: RatingProfile = {
    schemaVersion: 4,
    modelVersion: RATING_MODEL_VERSION,
    overallDiagnostics: {
      schemaVersion: 2,
      abilityBase: baseScore,
      abilityContribution: Math.round(abilityContribution * 100) / 100,
      productionContribution: Math.round(productionContribution * 100) / 100,
      confidenceWeight: production.weight,
      offensiveAbility,
      defensiveAbility,
      defensiveTrackingAdjustment,
      defensiveEvidenceCoverage: evidenceCoverage(input, ['interiorDefense', 'perimeterDefense']),
      offensiveValue,
      defensiveValue,
      rawBeforeRecognition,
      recognitionContribution,
      recognitionWeight,
      recognitionPrior: null,
      recognitionHonor,
      defensiveRecognitionWeight: defenseAward > 0 ? recognitionWeight : 0,
      teamRecordContribution,
      clampContribution,
      postseasonContribution,
      eraContribution,
      synergyContribution,
      weaknessContribution,
      impactContribution,
      postseasonWeight,
      postseasonSourceAvailable:
        input.postseasonEvidenceAvailable ?? input.postseason !== undefined,
      offensiveWeight: combined.offenseWeight,
      ...(input.artifact.replacementReferenceScore === undefined
        ? {}
        : {
            valueAboveReplacement: raw - input.artifact.replacementReferenceScore,
          }),
      paceUsed: possessionPaceFor(input.stats, input.eraPace),
      paceSource:
        typeof input.stats.possessionPace === 'number'
          ? 'team-totals-possession-estimate'
          : 'league-era',
      effectiveDefenseWeight: combined.defenseWeight,
      rawScore: raw,
      mappingVersion: input.artifact.overallScale?.version ?? 'uncalibrated',
    },
    ...(input.artifact.overallScale
      ? {
          overallPercentile: mapped.percentile,
          overallCohortVersion: input.artifact.overallScale.version,
        }
      : {}),
    memberships,
    baseScore: Math.round(baseScore * 100) / 100,
    nonlinear,
    production,
    calibratedImpact,
    canonicalOverall,
    rawOverallScore: raw,
    offenseRating: summary.offenseRating,
    defenseRating: summary.defenseRating,
  };
  return {
    profile,
    summaryRatings: { ...summary, overallRating: canonicalOverall },
  };
}
export function tendenciesForProfile(
  stats: StatsRow,
  ratings: SimulationRatings,
): SimulationTendencies {
  const usageRate = clamp(safeFloat(stats.usageRate, 18), 0, 100);
  const fga = Math.max(1, safeFloat(stats.fga));
  const tpa = Math.max(0, safeFloat(stats.tpa));
  const fta = Math.max(0, safeFloat(stats.fta));
  const turnovers = Math.max(0, safeFloat(stats.turnovers));
  const games = Math.max(1, safeFloat(stats.gamesPlayed));
  const possessions = Math.max(1, fga + 0.44 * fta + turnovers);
  return {
    usageRate,
    passRate: clamp(
      (safeFloat(stats.assists) /
        games /
        Math.max(
          1,
          safeFloat(stats.assists) / games + (safeFloat(stats.points) / games) * 0.5 + 1,
        )) *
        40,
      0,
      100,
    ),
    shotRate: clamp((fga / games / 48) * 100, 0, 100),
    driveRate: 16,
    postUpRate: 12,
    rimFrequency: clamp(ratings.insideScoring * 0.4, 0, 100),
    shortMidFrequency: 15,
    longMidFrequency: 10,
    cornerThreeFrequency: clamp(ratings.threePoint * 0.12, 0, 100),
    aboveBreakThreeFrequency: clamp(ratings.threePoint * 0.2, 0, 100),
    threePointRate: clamp((tpa / fga) * 100, 0, 100),
    freeThrowRate: clamp((fta / fga) * 100, 0, 100),
    turnoverRate: clamp((turnovers / possessions) * 100, 0, 100),
    isolationRate: clamp(usageRate * 0.3, 0, 100),
    pickAndRollBallHandlerRate: 28,
    pickAndRollRollManRate: 18,
    spotUpRate: 20,
    transitionRate: 15,
    cutRate: 10,
    foulRate: clamp((safeFloat(stats.fouls) / Math.max(1, safeFloat(stats.minutes))) * 48, 0, 100),
    stealAttemptRate: clamp(5 + ratings.steal * 0.08, 0, 100),
    blockAttemptRate: clamp(5 + ratings.block * 0.08, 0, 100),
    crashOffensiveGlassRate: clamp(10 + ratings.offensiveRebound * 0.12, 0, 100),
  };
}
