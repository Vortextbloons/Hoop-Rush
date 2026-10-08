import {
  RATING_MODEL_VERSION,
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
} from '@hoop-rush/data-contracts';
import { clamp, clampRating, safeFloat } from '../json.ts';
import type { StatsRow } from './stats.ts';
import type { IndividualHonor, ProvenanceMap } from '@hoop-rush/data-contracts';
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
}
export function spacingWeightForEra(leagueThreePARate?: number | null): number {
  // Before spacing, three-point skill barely moved winning: judging a 1986
  // 31% shooter by modern spacing weight punishes the era, not the player.
  // Modern volume (rate >= 0.15) keeps full weight; the pre-line era floors
  // at 0.35 so range still matters a little (free-throw touch signal).
  if (leagueThreePARate == null || !Number.isFinite(leagueThreePARate)) return 1;
  return clamp(leagueThreePARate / 0.15, 0.35, 1);
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
function observedTrueShooting(stats: StatsRow): number | null {
  return typeof stats.tsPct === 'number' &&
    Number.isFinite(stats.tsPct) &&
    stats.tsPct >= 0 &&
    stats.tsPct <= 1
    ? stats.tsPct
    : null;
}
function confidenceFor(stats: StatsRow): {
  label: ProductionEvidence['confidence'];
  factor: number;
} {
  const games = Math.max(0, Math.trunc(safeFloat(stats.gamesPlayed)));
  const minutes = Math.max(0, safeFloat(stats.minutes));
  const advanced = observedTrueShooting(stats) !== null;
  if (games >= 50 && minutes >= 1500 && advanced) return { label: 'high', factor: 1 };
  if (games >= 30 && minutes >= 750) return { label: 'medium', factor: 0.75 };
  return { label: 'low', factor: 0.45 };
}
export function effectiveUsageFor(stats: StatsRow, eraPace?: number | null): number | null {
  const games = Math.max(0, Math.trunc(safeFloat(stats.gamesPlayed)));
  const minutes = Math.max(0, safeFloat(stats.minutes));
  const fga = safeFloat(stats.fga, 0);
  const fta = safeFloat(stats.fta, 0);
  const turnovers = safeFloat(stats.turnovers, 0);
  if (games <= 0 || minutes <= 0 || fga <= 0) return null;
  const pace = eraPace != null && Number.isFinite(eraPace) && eraPace > 0 ? eraPace : 100;
  const possessionsPerGame = (fga + 0.44 * fta + turnovers) / games;
  const mpg = minutes / games;
  if (mpg <= 0) return null;
  return clamp((100 * possessionsPerGame) / (pace * (mpg / 48)), 0, 45);
}
export function productionEvidence(
  stats: StatsRow,
  eraPace?: number | null,
  eraThreeRate?: number | null,
): ProductionEvidence {
  const games = Math.max(0, Math.trunc(safeFloat(stats.gamesPlayed)));
  const minutes = Math.max(0, safeFloat(stats.minutes));
  const per36 = (value: unknown, prior: number): number =>
    typeof value === 'number' && Number.isFinite(value) && minutes > 0
      ? (value * 36) / minutes
      : prior;
  const pace = possessionPaceFor(stats, eraPace);
  const pointsPer36 = per36(stats.points, 15) * (100 / pace);
  const offensiveReboundsPer36 = per36(stats.offensiveRebounds, 1.5) * (100 / pace);
  const reportedUsage = stats.usageRate == null ? null : safeFloat(stats.usageRate);
  const impliedUsage = effectiveUsageFor(stats, pace);
  // Stints-derived estimates divide possessions by pace without a minutes
  // share, so low-minute scorers (e.g. 1973-74 Murphy at a reported 14.2%)
  // read as role players. Repair only clear under-reports so modern tracking
  // numbers pass through untouched.
  const usage =
    impliedUsage !== null && (reportedUsage === null || impliedUsage - reportedUsage > 8)
      ? impliedUsage
      : (reportedUsage ?? 18);
  const ts = observedTrueShooting(stats);

  // Cross-era fairness: modern spacing inflates raw efficiency (league TS
  // ~0.58 today vs ~0.53 in 1990), so the efficiency terms measure margin
  // over the era baseline instead of absolute rate. A 0.578 TS leading a
  // title team grades like what it was, not like a modern role season.
  const eraRate = clamp(safeFloat(eraThreeRate, 0.39), 0, 0.45);
  const tsRef =
    typeof stats.leagueTrueShooting === 'number' &&
    stats.leagueTrueShooting > 0 &&
    stats.leagueTrueShooting < 1
      ? stats.leagueTrueShooting
      : 0.52 + eraRate * 0.15;

  // Efficiency without scoring load is not production: a 16% usage finisher
  // dunking at .680 TS did not produce what a 30% usage creator did at .600.
  // Creation already earns its own assist-rate term below; counting it again
  // here let low-usage passers bank star efficiency (Porter 1990-91).
  // Missing usage data never reads as low load.
  const loadFactor =
    stats.usageRate == null && impliedUsage === null ? 1 : clamp((usage - 16) / 14, 0.3, 1);
  // Below 18% usage the efficiency terms taper: standstill shooting is real
  // but must not carry a production score on its own.
  const efficiencyScale = usage < 18 ? clamp(usage / 18, 0.5, 1) : 1;
  const evidence = confidenceFor(stats);
  const astPer36 = per36(stats.assists, 3.5) * (100 / pace);
  const score = clamp(
    50 +
      (pointsPer36 - 15) * 0.9 +
      (offensiveReboundsPer36 - 1.5) * 0.25 +
      (astPer36 - 3.5) * 0.9 +
      (usage - 20) * 0.1 -
      Math.max(0, usage - 30) * 0.22 +
      (ts === null ? 0 : (ts - tsRef) * 85 * loadFactor * efficiencyScale),
    0,
    100,
  );
  const capped = score > 88 ? 88 + (score - 88) * 0.75 : score;
  const shrinkage = clamp(minutes / 1500, 0, 1) * clamp(games / 50, 0, 1);
  return {
    score: capped,
    weight: 0.5 * shrinkage * evidence.factor,
    confidence: evidence.label,
    sampleGames: games,
    sampleMinutes: minutes,
    shrinkage,
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
): number {
  const routes = [ratings.insideScoring, ratings.midrange, ratings.threePoint];
  const scoring =
    0.9 * (0.6 * Math.max(...routes) + (0.4 * routes.reduce((sum, value) => sum + value, 0)) / 3) +
    0.1 * ratings.freeThrow;
  const creation = 0.6 * ratings.passing + 0.4 * ratings.ballHandling;
  const security =
    0.5 * ratings.ballHandling + 0.5 * clamp(100 - (tendencies.turnoverRate - 5) * 5, 0, 100);
  return (
    0.55 * scoring +
    0.25 * creation +
    0.1 * security +
    0.07 * ratings.offensiveIq +
    0.03 * ratings.offensiveRebound
  );
}
export function defensePositionGroup(position?: string | null): 'G' | 'F' | 'C' {
  // Same buckets as positionGroup: only listed wings are forwards. F-C and
  // C-F are centers, matching how interior defense is already derived.
  if (position === 'PG' || position === 'SG' || position === 'G') return 'G';
  if (position === 'PF' || position === 'SF' || position === 'F') return 'F';
  return 'C';
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
  C: { perimeter: 0.03, interior: 0.62, steal: 0.02, block: 0.2, iq: 0.05, rebound: 0.08 },
  F: { perimeter: 0.325, interior: 0.325, steal: 0.11, block: 0.11, iq: 0.05, rebound: 0.08 },
  G: { perimeter: 0.62, interior: 0.03, steal: 0.2, block: 0.02, iq: 0.05, rebound: 0.08 },
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
function recognitionFor(input: RatingProfileInput, domain: 'overall' | 'defense') {
  const order: IndividualHonor[] =
    domain === 'overall' ? ['MVP-1', 'NBA1', 'NBA2', 'NBA3'] : ['DEF1', 'DEF2'];
  const honors = Array.isArray(input.stats.honors) ? input.stats.honors : [];
  const honor = order.find((key) => honors.includes(key));
  const priors = input.artifact.recognitionPriors;
  const prior = honor
    ? priors?.entries[honor]
    : domain === 'overall'
      ? priors?.population
      : undefined;
  if (!prior || !priors) return { honor: null, prior: null, weight: 0 };
  const coverage = evidenceCoverage(
    input,
    domain === 'overall'
      ? ['insideScoring', 'midrange', 'passing', 'interiorDefense', 'perimeterDefense']
      : ['interiorDefense', 'perimeterDefense'],
  );
  const variance =
    (priors.referenceStandardDeviation ** 2 * (1 - coverage)) / Math.max(coverage, 0.05);
  const games = Math.max(0, safeFloat(input.stats.gamesPlayed));
  const minutes = Math.max(0, safeFloat(input.stats.minutes));
  const sample = clamp(games / 50, 0, 1) * clamp(minutes / 1500, 0, 1);
  return {
    honor: honor ?? null,
    prior: prior.mean,
    weight: Math.min(0.2, variance / (variance + prior.variance)) * sample,
  };
}
function deriveNonlinear(
  ratings: SimulationRatings,
  tendencies: SimulationTendencies,
  stats: StatsRow,
  memberships: ArchetypeMemberships,
  teamWinPct?: number | null,
  spacingWeight = 1,
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
  const synergyBonus = clamp(
    (creationSynergy + shotSynergy + twoWaySynergy + insideSynergy) * 5,
    0,
    5,
  );
  const usage = safeFloat(stats.usageRate, tendencies.usageRate);
  const ts = safeFloat(stats.tsPct, 0.52);
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
    inefficientUsage: clamp(Math.max(0, usage - 24) * Math.max(0, 0.58 - ts) * 1.3, 0, 6),
    defensiveTargeting: clamp(
      (Math.max(
        0,
        64 -
          mean([
            skill(ratings, 'perimeterDefense'),
            skill(ratings, 'interiorDefense'),
            skill(ratings, 'defensiveIq'),
          ]),
      ) *
        (0.9 + primaryRole * 0.65)) /
        7,
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
    hollowAnchor: hollowAnchorFor(ratings, creation, teamWinPct),
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
function hollowAnchorFor(
  ratings: SimulationRatings,
  creation: number,
  teamWinPct: number | null | undefined,
): number {
  // Rebound/block piles without creation on a losing team are the classic
  // empty-stats profile: the events are real, but they do not move winning.
  // The team factor is continuous — a .500 team discounts mildly, a sub-.400
  // team fully — and unknown context never penalizes (a champion anchor with
  // missing team data is not hollow by default).
  const anchorTalent = mean([
    skill(ratings, 'block'),
    skill(ratings, 'interiorDefense'),
    skill(ratings, 'defensiveRebound'),
  ]);
  const teamFactor =
    teamWinPct == null || !Number.isFinite(teamWinPct)
      ? 0
      : clamp((0.65 - teamWinPct) / 0.25, 0, 1);
  return clamp((anchorTalent - 72) * 0.55, 0, 4) * clamp((75 - creation) / 30, 0, 1) * teamFactor;
}
function deriveMemberships(
  input: RatingProfileInput,
  confidence: ProductionEvidence['confidence'],
): ArchetypeMemberships {
  const { ratings, tendencies, position, heightInches } = input;
  const creation = mean([
    skill(ratings, 'ballHandling'),
    skill(ratings, 'passing'),
    skill(ratings, 'offensiveIq'),
  ]);
  const scoring = mean([
    skill(ratings, 'insideScoring'),
    skill(ratings, 'threePoint'),
    skill(ratings, 'midrange'),
    skill(ratings, 'freeThrow'),
  ]);
  const defense = mean([
    skill(ratings, 'perimeterDefense'),
    skill(ratings, 'interiorDefense'),
    skill(ratings, 'defensiveIq'),
  ]);
  const size = clamp(((heightInches ?? 78) - 72) * 3 + skill(ratings, 'strength'), 0, 100);
  const shooting = mean([skill(ratings, 'threePoint'), 50 + tendencies.threePointRate]);
  const rebounding = mean([skill(ratings, 'offensiveRebound'), skill(ratings, 'defensiveRebound')]);
  const prior = POSITION_PRIOR[position] ?? {};
  const missingPrior = confidence === 'low' ? 1 : confidence === 'medium' ? 0.35 : 0;
  const raw: Record<RatingArchetype, number> = {
    primaryCreator: creation * 0.62 + tendencies.usageRate * 0.38,
    secondaryCreator: creation * 0.58 + scoring * 0.22 + tendencies.passRate * 0.2,
    scoringGuard: scoring * 0.48 + skill(ratings, 'speed') * 0.25 + tendencies.usageRate * 0.27,
    movementSpacer:
      shooting * 0.62 + skill(ratings, 'speed') * 0.2 + skill(ratings, 'offensiveIq') * 0.18,
    twoWayWing: defense * 0.45 + scoring * 0.22 + skill(ratings, 'speed') * 0.18 + size * 0.15,
    connector:
      mean([skill(ratings, 'passing'), skill(ratings, 'offensiveIq'), defense]) * 0.7 +
      shooting * 0.3,
    interiorFinisher:
      mean([
        skill(ratings, 'insideScoring'),
        skill(ratings, 'closeShot'),
        skill(ratings, 'vertical'),
        size,
      ]) *
        0.8 +
      tendencies.rimFrequency * 0.2,
    stretchBig: shooting * 0.45 + size * 0.25 + rebounding * 0.2 + skill(ratings, 'passing') * 0.1,
    rebounder: rebounding * 0.62 + size * 0.2 + skill(ratings, 'vertical') * 0.18,
    defensiveAnchor:
      defense * 0.36 +
      mean([skill(ratings, 'interiorDefense'), skill(ratings, 'block'), rebounding, size]) * 0.64,
  };
  for (const archetype of RATING_ARCHETYPES) {
    raw[archetype] += (prior[archetype] ?? 0) * 100 * missingPrior;
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
  const memberships = deriveMemberships(input, production.confidence);
  const spacingWeight = spacingWeightForEra(input.eraThreeRate);
  const nonlinear = deriveNonlinear(
    input.ratings,
    input.tendencies,
    input.stats,
    memberships,
    null,
    spacingWeight,
  );
  const calibrated = input.playerId
    ? input.artifact.playerAdjustments?.[input.playerId]
    : undefined;
  const calibratedImpact: CalibratedImpact = {
    adjustment: clamp((calibrated?.adjustment ?? 0) * (calibrated?.confidence ?? 0), -6, 6),
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
  const offensiveAbility = offensiveAbilityFor(input.ratings, input.tendencies);
  const defensiveAbility = defensiveAbilityFor(input.ratings, input.position);
  const defensiveRecognition = recognitionFor(input, 'defense');
  const defensiveValue =
    defensiveAbility * (1 - defensiveRecognition.weight) +
    (defensiveRecognition.prior ?? 0) * defensiveRecognition.weight;
  const offensiveValue =
    offensiveAbility * (1 - production.weight) + production.score * production.weight;
  const baseScore = 0.65 * offensiveAbility + 0.35 * defensiveValue;
  const rawBeforeRecognition = 0.65 * offensiveValue + 0.35 * defensiveValue;
  const recognition = recognitionFor(input, 'overall');
  const abilityContribution =
    (0.65 * offensiveAbility * (1 - production.weight) + 0.35 * defensiveValue) *
    (1 - recognition.weight);
  const productionContribution =
    0.65 * production.score * production.weight * (1 - recognition.weight);
  const recognitionContribution = (recognition.prior ?? 0) * recognition.weight;
  const raw =
    Math.round((abilityContribution + productionContribution + recognitionContribution) * 100) /
    100;
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
      offensiveValue,
      defensiveValue,
      rawBeforeRecognition,
      recognitionContribution: Math.round(recognitionContribution * 100) / 100,
      recognitionWeight: recognition.weight,
      recognitionPrior: recognition.prior,
      recognitionHonor: recognition.honor,
      defensiveRecognitionWeight: defensiveRecognition.weight,
      paceUsed: possessionPaceFor(input.stats, input.eraPace),
      paceSource:
        typeof input.stats.possessionPace === 'number'
          ? 'team-totals-possession-estimate'
          : 'league-era',
      effectiveDefenseWeight: 0.35 * (1 - defensiveRecognition.weight) * (1 - recognition.weight),
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
    rawOverallScore: Math.round(raw * 100) / 100,
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
