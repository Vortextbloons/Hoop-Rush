import type { ProjectionComponentScale, ProjectionModelArtifact, SeasonProjection, } from '@hoop-rush/data-contracts';
import { weaknessPenalty } from './weaknesses.ts';
import { normalizeValue } from './normalize.ts';
export interface RankingGates {
    legal: boolean;
    legalStartersAndClosers: boolean;
    coverageOk: boolean;
    bandOk: boolean;
    anchorsOk: boolean;
    ownershipOk: boolean;
    rolesOk: boolean;
    feasibilityOk: boolean;
}
export interface RankingVector {
    offense: number;
    inverseDefense: number;
    net: number;
    shooting: number;
    turnoverSecurity: number;
    rebounding: number;
    freeThrowPressure: number;
    spacing: number;
    creation: number;
    defensiveCoverage: number;
    starterQuality: number;
    benchQuality: number;
    closingQuality: number;
    minuteDistribution: number;
    creationContinuity: number;
    spacingContinuity: number;
    balance: number;
    positionalCoverage: number;
    foulResilience: number;
    contingencyDepth: number;
    matchupMean: number;
    matchupWorstCase: number;
    redundancy: number;
}
export interface RankedCandidate {
    candidateId: string;
    projection: SeasonProjection;
    vector: RankingVector;
    basketballMean: number;
    rotationMean: number;
    robustnessMean: number;
    weaknessPenaltyValue: number;
    redundancyPenaltyValue: number;
    finalScore: number;
}
export interface RejectedCandidate {
    candidateId: string;
    reasons: string[];
}
export interface RankingResult {
    ranked: RankedCandidate[];
    rejected: RejectedCandidate[];
    paretoSurvivors: number;
}
const DEFAULT_SCALES: Record<string, {
    baseline: number;
    perPoint: number;
}> = {
    offensiveRating: { baseline: 105, perPoint: 1 },
    defensiveRatingAllowed: { baseline: 105, perPoint: 1 },
    netRating: { baseline: 0, perPoint: 1 },
    effectiveFieldGoalPct: { baseline: 0.5, perPoint: 0.01 },
    turnoverRate: { baseline: 0.14, perPoint: 0.01 },
    rebounding: { baseline: 50, perPoint: 1 },
    freeThrowRate: { baseline: 0.24, perPoint: 0.02 },
    spacing: { baseline: 0.45, perPoint: 0.02 },
    creation: { baseline: 0.55, perPoint: 0.02 },
    defense: { baseline: 55, perPoint: 1 },
    minuteDistribution: { baseline: 40, perPoint: 1 },
    matchup: { baseline: 0, perPoint: 1 },
    redundancy: { baseline: 60, perPoint: 1 },
};
function scaleOf(model: ProjectionModelArtifact, key: string): ProjectionComponentScale | undefined {
    return model.scales[key];
}
export function normalizeComponent(model: ProjectionModelArtifact, key: string, raw: number): number {
    const fallback = DEFAULT_SCALES[key] ?? DEFAULT_SCALES.defense ?? { baseline: 55, perPoint: 1 };
    const scale = scaleOf(model, key);
    const baseline = scale?.baseline ?? fallback.baseline;
    const perPoint = scale?.perPoint ?? fallback.perPoint;
    const min = scale?.min ?? 0;
    const max = scale?.max ?? 100;
    return normalizeValue(raw, baseline, perPoint, min, max);
}
function mean(values: readonly number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
export function rankingVectorOf(model: ProjectionModelArtifact, projection: SeasonProjection): RankingVector {
    const m = projection.metrics;
    const ledger = projection.units.find((unit) => unit.weight > 0)?.base.offense.ledger;
    const efg = ledger?.effectiveFieldGoalPct ?? 0.5;
    const tovRate = ledger?.turnoverRate ?? 0.14;
    const orebRate = ledger?.offensiveReboundRate ?? 0.25;
    const drebRate = ledger?.defensiveReboundRate ?? 0.75;
    const ftr = ledger?.freeThrowRate ?? 0.22;
    const spacingRaw = projection.units.find((unit) => unit.weight > 0)?.base.offense.spacing.raw ?? 0.45;
    const creationRaw = projection.units.find((unit) => unit.weight > 0)?.base.offense.creation.score ?? 55;
    const defenseScore = projection.units.find((unit) => unit.weight > 0)?.base.offense.defense.score ?? 55;
    return {
        offense: normalizeComponent(model, 'offensiveRating', m.offensiveRating),
        inverseDefense: normalizeComponent(model, 'defensiveRatingAllowed', -m.defensiveRatingAllowed),
        net: normalizeComponent(model, 'netRating', m.netRating),
        shooting: normalizeComponent(model, 'effectiveFieldGoalPct', efg),
        turnoverSecurity: normalizeComponent(model, 'turnoverRate', 1 - tovRate),
        rebounding: normalizeComponent(model, 'rebounding', orebRate * 100 * 0.4 + drebRate * 100 * 0.6),
        freeThrowPressure: normalizeComponent(model, 'freeThrowRate', ftr),
        spacing: normalizeComponent(model, 'spacing', spacingRaw),
        creation: normalizeComponent(model, 'creation', creationRaw),
        defensiveCoverage: normalizeComponent(model, 'defense', defenseScore),
        starterQuality: normalizeComponent(model, 'netRating', m.startingQuality),
        benchQuality: normalizeComponent(model, 'netRating', m.benchQuality),
        closingQuality: normalizeComponent(model, 'netRating', m.closingQuality),
        minuteDistribution: normalizeComponent(model, 'minuteDistribution', 48 - m.minuteDeviation),
        creationContinuity: m.creationContinuity,
        spacingContinuity: m.spacingContinuity,
        balance: m.balance,
        positionalCoverage: m.positionalCoverage,
        foulResilience: m.foulResilience,
        contingencyDepth: m.contingencyDepth,
        matchupMean: normalizeComponent(model, 'matchup', m.matchupMean),
        matchupWorstCase: normalizeComponent(model, 'matchup', m.matchupWorstCase),
        redundancy: normalizeComponent(model, 'redundancy', m.redundancy),
    };
}
const BASKETBALL_KEYS: Array<keyof RankingVector> = [
    'offense',
    'inverseDefense',
    'net',
    'shooting',
    'turnoverSecurity',
    'rebounding',
    'freeThrowPressure',
    'spacing',
    'creation',
    'defensiveCoverage',
];
const ROTATION_KEYS: Array<keyof RankingVector> = [
    'starterQuality',
    'benchQuality',
    'closingQuality',
    'minuteDistribution',
    'creationContinuity',
    'spacingContinuity',
    'balance',
    'positionalCoverage',
    'foulResilience',
    'contingencyDepth',
];
const ROBUSTNESS_KEYS: Array<keyof RankingVector> = [
    'matchupMean',
    'matchupWorstCase',
    'redundancy',
];
function subMean(vector: RankingVector, keys: readonly (keyof RankingVector)[]): number {
    return mean(keys.map((key) => vector[key]));
}
export function redundancyPenaltyValue(vector: RankingVector): number {
    const scale = DEFAULT_SCALES.redundancy ?? { baseline: 60, perPoint: 1 };
    const shortfall = Math.max(0, scale.baseline - vector.redundancy);
    return shortfall / 100;
}
export function hardGateReasons(gates: RankingGates, projection: SeasonProjection): string[] {
    const reasons: string[] = [];
    if (!gates.legal)
        reasons.push('roster is not legal');
    if (!gates.legalStartersAndClosers)
        reasons.push('no legal starter or closing five');
    if (!gates.coverageOk)
        reasons.push('positional coverage targets not met');
    if (!gates.bandOk)
        reasons.push('band quota violation');
    if (!gates.anchorsOk)
        reasons.push('anchor guarantee violation');
    if (!gates.ownershipOk)
        reasons.push('ownership violation');
    if (!gates.rolesOk)
        reasons.push('role coverage violation');
    if (!gates.feasibilityOk)
        reasons.push('future feasibility violation');
    if (projection.metrics.positionalCoverage < 100) {
        reasons.push('positional coverage below full legality');
    }
    const critical = projection.weaknesses.filter((weakness) => weakness.severity === 'critical');
    for (const weakness of critical) {
        reasons.push(`critical weakness ${weakness.code}`);
    }
    return reasons;
}
export function paretoFilter(candidates: readonly RankedCandidate[]): RankedCandidate[] {
    const keys = [...BASKETBALL_KEYS, ...ROTATION_KEYS, ...ROBUSTNESS_KEYS];
    const survivors: RankedCandidate[] = [];
    for (const candidate of candidates) {
        let dominated = false;
        for (const other of candidates) {
            if (other === candidate)
                continue;
            let atLeast = true;
            let strictlyBetter = false;
            for (const key of keys) {
                const a = other.vector[key];
                const b = candidate.vector[key];
                if (a < b) {
                    atLeast = false;
                    break;
                }
                if (a > b)
                    strictlyBetter = true;
            }
            if (atLeast && strictlyBetter) {
                dominated = true;
                break;
            }
        }
        if (!dominated)
            survivors.push(candidate);
    }
    return survivors;
}
export function rankCandidates(input: {
    candidates: Array<{
        candidateId: string;
        projection: SeasonProjection;
        gates: RankingGates;
    }>;
    model: ProjectionModelArtifact;
}): RankingResult {
    const { candidates, model } = input;
    const rejected: RejectedCandidate[] = [];
    const passed: RankedCandidate[] = [];
    for (const candidate of candidates) {
        const reasons = hardGateReasons(candidate.gates, candidate.projection);
        if (reasons.length > 0) {
            rejected.push({ candidateId: candidate.candidateId, reasons });
            continue;
        }
        const vector = rankingVectorOf(model, candidate.projection);
        const weaknessPenaltyValue = weaknessPenalty(model, candidate.projection.weaknesses);
        const redundancyValue = redundancyPenaltyValue(vector);
        const basketballMean = subMean(vector, BASKETBALL_KEYS);
        const rotationMean = subMean(vector, ROTATION_KEYS);
        const robustnessMean = subMean(vector, ROBUSTNESS_KEYS);
        const finalScore = model.weights.basketballMean * basketballMean +
            model.weights.rotationMean * rotationMean +
            model.weights.robustnessMean * robustnessMean -
            weaknessPenaltyValue -
            redundancyValue;
        passed.push({
            candidateId: candidate.candidateId,
            projection: candidate.projection,
            vector,
            basketballMean,
            rotationMean,
            robustnessMean,
            weaknessPenaltyValue,
            redundancyPenaltyValue: redundancyValue,
            finalScore,
        });
    }
    const survivors = paretoFilter(passed);
    const ranked = [...survivors].sort((a, b) => b.finalScore - a.finalScore);
    return { ranked, rejected, paretoSurvivors: survivors.length };
}
