import { RATING_MODEL_VERSION, type ArchetypeMemberships, type CalibratedImpact, type NonlinearComponents, type ProductionEvidence, type RatingArchetype, type RatingProfile, type RatingsModelArtifact, type SimulationRatings, type SimulationTendencies, type SummaryRatings, } from '@hoop-rush/data-contracts';
import { clamp, clampRating, safeFloat } from '../json.ts';
import type { StatsRow } from './stats.ts';
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
type SkillWeights = Partial<Record<SkillKey, number>>;
const ARCHETYPE_WEIGHTS: Readonly<Record<RatingArchetype, SkillWeights>> = {
    primaryCreator: {
        ballHandling: 0.28,
        passing: 0.25,
        offensiveIq: 0.2,
        speed: 0.12,
        insideScoring: 0.08,
        threePoint: 0.07,
    },
    secondaryCreator: {
        ballHandling: 0.2,
        passing: 0.18,
        offensiveIq: 0.18,
        threePoint: 0.14,
        midrange: 0.12,
        insideScoring: 0.1,
        perimeterDefense: 0.08,
    },
    scoringGuard: {
        insideScoring: 0.18,
        threePoint: 0.17,
        midrange: 0.16,
        ballHandling: 0.15,
        freeThrow: 0.1,
        speed: 0.1,
        closeShot: 0.08,
        offensiveIq: 0.06,
    },
    movementSpacer: {
        threePoint: 0.32,
        speed: 0.16,
        offensiveIq: 0.16,
        freeThrow: 0.12,
        midrange: 0.1,
        passing: 0.08,
        ballHandling: 0.06,
    },
    twoWayWing: {
        perimeterDefense: 0.2,
        threePoint: 0.15,
        speed: 0.14,
        defensiveIq: 0.14,
        insideScoring: 0.12,
        strength: 0.1,
        ballHandling: 0.08,
        passing: 0.07,
    },
    connector: {
        passing: 0.25,
        offensiveIq: 0.2,
        defensiveIq: 0.16,
        perimeterDefense: 0.12,
        threePoint: 0.1,
        speed: 0.09,
        strength: 0.08,
    },
    interiorFinisher: {
        insideScoring: 0.28,
        closeShot: 0.18,
        strength: 0.16,
        vertical: 0.12,
        offensiveIq: 0.1,
        freeThrow: 0.08,
        offensiveRebound: 0.08,
    },
    stretchBig: {
        threePoint: 0.25,
        insideScoring: 0.14,
        strength: 0.13,
        defensiveRebound: 0.12,
        offensiveIq: 0.12,
        freeThrow: 0.1,
        passing: 0.08,
        interiorDefense: 0.06,
    },
    rebounder: {
        defensiveRebound: 0.32,
        offensiveRebound: 0.24,
        strength: 0.15,
        vertical: 0.12,
        interiorDefense: 0.1,
        defensiveIq: 0.07,
    },
    defensiveAnchor: {
        interiorDefense: 0.24,
        block: 0.18,
        defensiveRebound: 0.15,
        defensiveIq: 0.15,
        strength: 0.12,
        vertical: 0.08,
        perimeterDefense: 0.08,
    },
};
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
    position: string;
    heightInches: number | null;
    artifact: RatingsModelArtifact;
    playerId?: string;
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
    if (values.length === 0)
        return 50;
    return (values.reduce((product, value) => product * Math.max(0, value / 100), 1) **
        (1 / values.length) *
        100);
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
    if (last)
        result[last] = Math.round((result[last] + 1 - sum) * 1000000) / 1000000;
    return result;
}
function confidenceFor(stats: StatsRow): {
    label: ProductionEvidence['confidence'];
    factor: number;
} {
    const games = Math.max(0, Math.trunc(safeFloat(stats.gamesPlayed)));
    const minutes = Math.max(0, safeFloat(stats.minutes));
    const advanced = stats.per != null || stats.boxPlusMinus != null || stats.tsPct != null;
    if (games >= 50 && minutes >= 1500 && advanced)
        return { label: 'high', factor: 1 };
    if (games >= 30 && minutes >= 750)
        return { label: 'medium', factor: 0.75 };
    return { label: 'low', factor: 0.45 };
}
function productionEvidence(stats: StatsRow): ProductionEvidence {
    const games = Math.max(0, Math.trunc(safeFloat(stats.gamesPlayed)));
    const minutes = Math.max(0, safeFloat(stats.minutes));
    const ppg = safeFloat(stats.points) / Math.max(1, games);
    const rpg = safeFloat(stats.rebounds) / Math.max(1, games);
    const apg = safeFloat(stats.assists) / Math.max(1, games);
    const per = safeFloat(stats.per, 15);
    const bpm = safeFloat(stats.boxPlusMinus, 0);
    const usage = safeFloat(stats.usageRate, 18);
    const ts = safeFloat(stats.tsPct, 0.52);
    const evidence = confidenceFor(stats);
    const score = clamp(50 +
        (ppg - 15) * 0.85 +
        (rpg - 5) * 0.32 +
        (apg - 3) * 0.55 +
        (per - 15) * 1.2 +
        bpm * 1.15 +
        (usage - 20) * 0.18 +
        (ts - 0.54) * 70, 0, 100);
    const shrinkage = clamp((minutes / (minutes + 1500)) * (games / (games + 40)), 0, 1);
    return {
        score,
        weight: clamp(0.38 * shrinkage * evidence.factor, 0, 0.38),
        confidence: evidence.label,
        sampleGames: games,
        sampleMinutes: minutes,
        shrinkage,
    };
}
function archetypeScore(archetype: RatingArchetype, memberships: ArchetypeMemberships, ratings: SimulationRatings): number {
    const entries = Object.entries(ARCHETYPE_WEIGHTS[archetype]) as Array<[
        SkillKey,
        number
    ]>;
    const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
    const weighted = entries.reduce((sum, [key, weight]) => sum + skill(ratings, key) * weight, 0);
    return (weighted / Math.max(1e-9, totalWeight)) * (0.95 + 0.05 * memberships[archetype]);
}
function deriveNonlinear(ratings: SimulationRatings, tendencies: SimulationTendencies, stats: StatsRow, memberships: ArchetypeMemberships): NonlinearComponents {
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
    const shotSynergy = Math.max(0, (shootingGravity - 62) / 38) *
        (memberships.movementSpacer + memberships.stretchBig);
    const twoWaySynergy = Math.max(0, (switchability - 62) / 38) * memberships.twoWayWing;
    const insideSynergy = Math.max(0, (penetration - 62) / 38) * memberships.interiorFinisher;
    const synergyBonus = clamp((creationSynergy + shotSynergy + twoWaySynergy + insideSynergy) * 5, 0, 5);
    const usage = safeFloat(stats.usageRate, tendencies.usageRate);
    const ts = safeFloat(stats.tsPct, 0.52);
    const bigRole = memberships.interiorFinisher +
        memberships.stretchBig +
        memberships.rebounder +
        memberships.defensiveAnchor;
    const primaryRole = memberships.primaryCreator + memberships.secondaryCreator + memberships.scoringGuard;
    const rebounding = mean([skill(ratings, 'offensiveRebound'), skill(ratings, 'defensiveRebound')]);
    const weaknesses = {
        turnoverLiability: clamp(Math.max(0, tendencies.turnoverRate - 12) * (0.7 + 0.8 * primaryRole), 0, 6),
        inefficientUsage: clamp(Math.max(0, usage - 24) * Math.max(0, 0.58 - ts) * 1.3, 0, 6),
        defensiveTargeting: clamp((Math.max(0, 64 -
            mean([
                skill(ratings, 'perimeterDefense'),
                skill(ratings, 'interiorDefense'),
                skill(ratings, 'defensiveIq'),
            ])) *
            (0.9 + primaryRole * 0.65)) /
            7, 0, 6),
        spacingLimitation: clamp((Math.max(0, 58 - shootingGravity) * (0.8 + primaryRole * 0.8)) / 8, 0, 6),
        foulRisk: clamp(Math.max(0, tendencies.foulRate - 5) * (0.6 + bigRole * 0.6), 0, 6),
        deficientRebounding: clamp((Math.max(0, 55 - rebounding) * (0.5 + bigRole)) / 8, 0, 6),
    };
    const weaknessPenalty = -Math.min(6, Object.values(weaknesses).reduce((sum, value) => sum + value, 0) * 0.34);
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
function deriveMemberships(input: RatingProfileInput, confidence: ProductionEvidence['confidence']): ArchetypeMemberships {
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
        movementSpacer: shooting * 0.62 + skill(ratings, 'speed') * 0.2 + skill(ratings, 'offensiveIq') * 0.18,
        twoWayWing: defense * 0.45 + scoring * 0.22 + skill(ratings, 'speed') * 0.18 + size * 0.15,
        connector: mean([skill(ratings, 'passing'), skill(ratings, 'offensiveIq'), defense]) * 0.7 +
            shooting * 0.3,
        interiorFinisher: mean([
            skill(ratings, 'insideScoring'),
            skill(ratings, 'closeShot'),
            skill(ratings, 'vertical'),
            size,
        ]) *
            0.8 +
            tendencies.rimFrequency * 0.2,
        stretchBig: shooting * 0.45 + size * 0.25 + rebounding * 0.2 + skill(ratings, 'passing') * 0.1,
        rebounder: rebounding * 0.62 + size * 0.2 + skill(ratings, 'vertical') * 0.18,
        defensiveAnchor: defense * 0.36 +
            mean([skill(ratings, 'interiorDefense'), skill(ratings, 'block'), rebounding, size]) * 0.64,
    };
    for (const archetype of RATING_ARCHETYPES) {
        raw[archetype] += (prior[archetype] ?? 0) * 100 * missingPrior;
    }
    return normalizeMemberships(RATING_ARCHETYPES.map((archetype) => raw[archetype]));
}
function canonicalCurve(raw: number): number {
    if (raw <= 70) {
        return clampRating(50 + (raw - 50) * 1.635);
    }
    const upper = raw - 70;
    return Math.min(99, clampRating(82.7 + upper * 1.27 - upper * upper * 0.018));
}
function historicalDefenseEvidenceLift(input: RatingProfileInput): number {
    if (input.stats.steals != null || input.stats.blocks != null)
        return 0;
    if (input.position !== 'C' && input.position !== 'PF')
        return 0;
    const games = Math.max(1, safeFloat(input.stats.gamesPlayed));
    const minutes = Math.max(0, safeFloat(input.stats.minutes));
    if (games < 50 || minutes < 1500)
        return 0;
    const reboundsPerGame = safeFloat(input.stats.rebounds) / games;
    const reboundLift = clamp((reboundsPerGame - 12) * 0.55, 0, 6);
    const anchorLift = clamp((skill(input.ratings, 'interiorDefense') - 80) / 10, 0, 2);
    return reboundLift + anchorLift;
}
export function computeOffenseDefense(ratings: SimulationRatings, tendencies: SimulationTendencies): {
    offenseRating: number;
    defenseRating: number;
} {
    const turnoverSecurity = 0.5 * ratings.ballHandling + 0.5 * (100 - clamp((tendencies.turnoverRate - 5) * 5, 0, 100));
    const offense = 0.16 * ratings.insideScoring +
        0.16 * ratings.threePoint +
        0.1 * ratings.midrange +
        0.08 * ratings.freeThrow +
        0.15 * ratings.ballHandling +
        0.13 * ratings.passing +
        0.1 * turnoverSecurity +
        0.08 * ratings.offensiveIq +
        0.04 * ratings.offensiveRebound;
    const foulDiscipline = clamp(100 - tendencies.foulRate * 8, 0, 100);
    const defense = 0.24 * ratings.perimeterDefense +
        0.22 * ratings.interiorDefense +
        0.18 * ratings.defensiveIq +
        0.1 * ratings.steal +
        0.1 * ratings.block +
        0.1 * ratings.defensiveRebound +
        0.06 * foulDiscipline;
    return { offenseRating: clampRating(offense), defenseRating: clampRating(defense) };
}
export function deriveRatingProfile(input: RatingProfileInput): DerivedRatingProfile {
    const production = productionEvidence(input.stats);
    const memberships = deriveMemberships(input, production.confidence);
    const nonlinear = deriveNonlinear(input.ratings, input.tendencies, input.stats, memberships);
    const archetypeWeighted = RATING_ARCHETYPES.reduce((sum, archetype) => sum + memberships[archetype] * archetypeScore(archetype, memberships, input.ratings), 0);
    const weakSizePrior = input.position === 'SF' && (input.heightInches ?? 0) >= 82 ? 0.75 : 0;
    const historicalDefenseLift = historicalDefenseEvidenceLift(input);
    const baseScore = clamp(archetypeWeighted +
        nonlinear.synergyBonus +
        nonlinear.weaknessPenalty +
        weakSizePrior +
        historicalDefenseLift, 0, 100);
    const calibrated = input.playerId
        ? input.artifact.playerAdjustments?.[input.playerId]
        : undefined;
    const calibratedImpact: CalibratedImpact = {
        adjustment: clamp((calibrated?.adjustment ?? 0) * (calibrated?.confidence ?? 0), -6, 6),
        confidence: clamp(calibrated?.confidence ?? 0, 0, 1),
        sampleCount: calibrated?.sampleCount ?? 0,
        artifactVersion: input.artifact.modelVersion,
    };
    const eliteScoringEvidence = production.score >= 88 &&
        production.sampleGames >= 55 &&
        safeFloat(input.stats.points) / Math.max(1, production.sampleGames) >= 28 &&
        safeFloat(input.stats.tsPct, 0) >= 0.6 &&
        safeFloat(input.stats.boxPlusMinus, 0) >= 3;
    const completeEliteEvidence = production.score >= 86 &&
        production.sampleGames >= 65 &&
        safeFloat(input.stats.points) / Math.max(1, production.sampleGames) >= 25 &&
        safeFloat(input.stats.tsPct, 0) >= 0.62 &&
        safeFloat(input.stats.boxPlusMinus, 0) >= 4 &&
        nonlinear.creation >= 85 &&
        computeOffenseDefense(input.ratings, input.tendencies).defenseRating >= 72;
    const eliteEvidenceLift = completeEliteEvidence
        ? 4
        : eliteScoringEvidence
            ? 3
            : production.score >= 82 && production.sampleGames >= 50
                ? 1
                : 0;
    const raw = baseScore * (1 - production.weight) +
        production.score * production.weight +
        calibratedImpact.adjustment +
        eliteEvidenceLift;
    const canonicalOverall = canonicalCurve(raw);
    const summary = computeOffenseDefense(input.ratings, input.tendencies);
    const profile: RatingProfile = {
        schemaVersion: 2,
        modelVersion: RATING_MODEL_VERSION,
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
export function tendenciesForProfile(stats: StatsRow, ratings: SimulationRatings): SimulationTendencies {
    const usageRate = clamp(safeFloat(stats.usageRate, 18), 0, 100);
    const fga = Math.max(1, safeFloat(stats.fga));
    const tpa = Math.max(0, safeFloat(stats.tpa));
    const fta = Math.max(0, safeFloat(stats.fta));
    const turnovers = Math.max(0, safeFloat(stats.turnovers));
    const games = Math.max(1, safeFloat(stats.gamesPlayed));
    const possessions = Math.max(1, fga + 0.44 * fta + turnovers);
    return {
        usageRate,
        passRate: clamp((safeFloat(stats.assists) /
            games /
            Math.max(1, safeFloat(stats.assists) / games + (safeFloat(stats.points) / games) * 0.5 + 1)) *
            40, 0, 100),
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
