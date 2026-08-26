import { DERIVATION_METHOD_VERSION, SOURCE_VERSION, THREE_POINT_RECONSTRUCTION_VERSION, type Confidence, type ProvenanceKind, type ProvenanceMap, type ReconstructedThreePointProfile, type SimulationAnchors, type SimulationRatings, type SimulationTendencies, type SummaryRatings, type RatingProfile, type RatingsModelArtifact, type ThreePointReconstructionArtifact, } from '@hoop-rush/data-contracts';
import { clamp, clampRating, clampUnitInterval, safeFloat } from '../json.ts';
import { FIELD_AVAILABILITY } from '../config.ts';
import { deriveRatingProfile } from './v3.ts';
import { DEFAULT_RATINGS_MODEL_ARTIFACT } from './artifact.ts';
import { predictReconstructedProfile, ratingFromAccuracy } from '../reconstruction/predict.ts';
import { seasonIndexFor, type ReconstructionRow } from '../reconstruction/rows.ts';
import type { StatsRow } from './stats.ts';
export interface SeasonContext {
    leaguePpg: number;
    league3PARate: number;
    pace: number;
}
export interface DerivationInput {
    season: string;
    playerId?: string;
    position: string;
    heightInches: number | null;
    weightLbs?: number | null;
    age?: number | null;
    stats: StatsRow;
    era: SeasonContext;
    artifact?: RatingsModelArtifact;
    ratePriors?: {
        threePointPctPrior?: number;
        freeThrowPctPrior?: number;
    };
    threePointReconstruction?: ThreePointReconstructionArtifact;
}
export interface DerivedRecord {
    ratings: SimulationRatings;
    tendencies: SimulationTendencies;
    anchors: SimulationAnchors;
    summaryRatings: SummaryRatings;
    ratingProfile: RatingProfile;
    provenance: ProvenanceMap;
    unclamped: Record<string, number>;
    methods: Record<string, ProvenanceKind>;
    reconstructedThreePoint?: ReconstructedThreePointProfile;
}
export interface PriorTable {
    stealsPer36: number;
    blocksPer36: number;
    turnoversPer36: number;
    offensiveReboundsPer36: number;
    defensiveReboundsPer36: number;
    threePointRatePrior: number;
}
const POSITION_PRIORS: Readonly<Record<string, Readonly<PriorTable>>> = {
    G: {
        stealsPer36: 1.5,
        blocksPer36: 0.4,
        turnoversPer36: 2.6,
        offensiveReboundsPer36: 1.1,
        defensiveReboundsPer36: 4.2,
        threePointRatePrior: 0.18,
    },
    F: {
        stealsPer36: 1.2,
        blocksPer36: 0.9,
        turnoversPer36: 2.4,
        offensiveReboundsPer36: 1.8,
        defensiveReboundsPer36: 6.0,
        threePointRatePrior: 0.12,
    },
    C: {
        stealsPer36: 0.8,
        blocksPer36: 1.9,
        turnoversPer36: 2.3,
        offensiveReboundsPer36: 2.9,
        defensiveReboundsPer36: 7.5,
        threePointRatePrior: 0.04,
    },
};
const LEAGUE_RATE_DEFAULTS: Readonly<Record<'G' | 'F' | 'C', Readonly<{
    threePointPctPrior: number;
    freeThrowPctPrior: number;
}>>> = {
    G: { threePointPctPrior: 0.36, freeThrowPctPrior: 0.8 },
    F: { threePointPctPrior: 0.35, freeThrowPctPrior: 0.77 },
    C: { threePointPctPrior: 0.31, freeThrowPctPrior: 0.71 },
};
export function positionGroup(detailPos: string): 'G' | 'F' | 'C' {
    return detailPos === 'PG' || detailPos === 'SG'
        ? 'G'
        : detailPos === 'PF' || detailPos === 'SF'
            ? 'F'
            : 'C';
}
export function fieldPublished(field: string, season: string): boolean {
    const boundary = FIELD_AVAILABILITY[field];
    if (boundary === undefined)
        return true;
    return season >= boundary;
}
function confidenceFor(kind: ProvenanceKind): Confidence {
    switch (kind) {
        case 'observed':
            return 'high';
        case 'derived':
            return 'medium';
        case 'reconstructed':
            return 'low';
        default:
            return 'low';
    }
}
interface SeasonTotals {
    gamesPlayed: number;
    minutes: number;
    points: number | null;
    rebounds: number | null;
    offensiveRebounds: number | null;
    defensiveRebounds: number | null;
    assists: number | null;
    steals: number | null;
    blocks: number | null;
    turnovers: number | null;
    fouls: number | null;
    fieldGoalsMade: number | null;
    fieldGoalsAttempted: number | null;
    threesMade: number | null;
    threesAttempted: number | null;
    freeThrowsMade: number | null;
    freeThrowsAttempted: number | null;
    per: number | null;
    boxPlusMinus: number | null;
    usageRate: number | null;
    tsPct: number | null;
    efgPct: number | null;
}
function seasonTotals(stats: StatsRow): SeasonTotals {
    const maybe = (key: string): number | null => {
        const value = stats[key];
        if (value === null || value === undefined)
            return null;
        const n = safeFloat(value);
        if (!Number.isFinite(n))
            return null;
        return n;
    };
    return {
        gamesPlayed: Math.max(0, Math.trunc(maybe('gamesPlayed') ?? 0)),
        minutes: Math.max(0, maybe('minutes') ?? 0),
        points: maybe('points'),
        rebounds: maybe('rebounds'),
        offensiveRebounds: maybe('offensiveRebounds'),
        defensiveRebounds: maybe('defensiveRebounds'),
        assists: maybe('assists'),
        steals: maybe('steals'),
        blocks: maybe('blocks'),
        turnovers: maybe('turnovers'),
        fouls: maybe('fouls'),
        fieldGoalsMade: maybe('fgm'),
        fieldGoalsAttempted: maybe('fga'),
        threesMade: maybe('tpm'),
        threesAttempted: maybe('tpa'),
        freeThrowsMade: maybe('ftm'),
        freeThrowsAttempted: maybe('fta'),
        per: maybe('per'),
        boxPlusMinus: maybe('boxPlusMinus'),
        usageRate: maybe('usageRate'),
        tsPct: maybe('tsPct'),
        efgPct: maybe('efgPct'),
    };
}
interface Resolved {
    value: number;
    kind: ProvenanceKind;
    fields: string[];
}
function resolveCounting(observed: number | null, published: boolean, priorPer36: number, minutes: number, games: number, fields: string[], relatedPer36?: number | null, share?: number, relatedField?: string): Resolved {
    if (published && observed !== null && games > 0) {
        return { value: observed / games, kind: 'observed', fields };
    }
    const usedRelated = relatedPer36 !== null && relatedPer36 !== undefined && share !== undefined;
    const estimatePer36 = usedRelated ? relatedPer36 * share : priorPer36;
    const evidenceWeight = minutes / Math.max(1, minutes + 1500);
    const valuePer36 = estimatePer36 * evidenceWeight + priorPer36 * (1 - evidenceWeight);
    const mpg = minutes / Math.max(1, games);
    return {
        value: (valuePer36 * mpg) / 36,
        kind: 'estimated',
        fields: [...fields, usedRelated && relatedField !== undefined ? relatedField : 'prior'],
    };
}
function perGame(total: number | null, games: number): number | null {
    if (total === null || games <= 0)
        return null;
    return total / games;
}
export function derivePlayerRecord(input: DerivationInput): DerivedRecord {
    const totals = seasonTotals(input.stats);
    const { gamesPlayed: gp, minutes } = totals;
    const position = positionGroup(input.position);
    const priors = POSITION_PRIORS[position] ??
        POSITION_PRIORS['F'] ??
        POSITION_PRIORS['G'] ?? {
        stealsPer36: 1,
        blocksPer36: 0.8,
        turnoversPer36: 2.4,
        offensiveReboundsPer36: 1.5,
        defensiveReboundsPer36: 5,
        threePointRatePrior: 0.12,
    };
    const unclamped: Record<string, number> = {};
    const methods: Record<string, ProvenanceKind> = {};
    const provenance: ProvenanceMap = {};
    const RATING_SOURCE_FIELD: Readonly<Record<string, string>> = {
        steal: 'steals',
        block: 'blocks',
        offensiveRebound: 'offensiveRebounds',
        defensiveRebound: 'defensiveRebounds',
        threePoint: 'threesAttempted',
        freeThrow: 'freeThrowsAttempted',
    };
    const record = (key: string, value: number, kind: ProvenanceKind, fields: string[]): void => {
        unclamped[key] = value;
        methods[key] = kind;
        const sourceField = RATING_SOURCE_FIELD[key] ?? key;
        provenance[key] = {
            kind,
            confidence: confidenceFor(kind),
            methodVersion: DERIVATION_METHOD_VERSION,
            sourceVersion: SOURCE_VERSION,
            sourceFields: fields,
            sourceStatus: fieldPublished(sourceField, input.season) ? undefined : 'not-applicable',
        };
    };
    const ppg = perGame(totals.points, gp);
    const rpg = perGame(totals.rebounds, gp);
    const apg = perGame(totals.assists, gp);
    const mpg = gp > 0 ? minutes / gp : 0;
    const spg = resolveCounting(totals.steals, fieldPublished('steals', input.season), priors.stealsPer36, minutes, gp, ['steals']);
    const bpg = resolveCounting(totals.blocks, fieldPublished('blocks', input.season), priors.blocksPer36, minutes, gp, ['blocks']);
    const reboundShare = priors.offensiveReboundsPer36 / (priors.offensiveReboundsPer36 + priors.defensiveReboundsPer36);
    const rebsPer36 = rpg !== null && mpg > 0 ? (rpg * 36) / mpg : null;
    const oreb = resolveCounting(totals.offensiveRebounds, fieldPublished('offensiveRebounds', input.season), priors.offensiveReboundsPer36, minutes, gp, ['offensiveRebounds'], rebsPer36, reboundShare, 'rebounds');
    const dreb = resolveCounting(totals.defensiveRebounds, fieldPublished('defensiveRebounds', input.season), priors.defensiveReboundsPer36, minutes, gp, ['defensiveRebounds'], rebsPer36, 1 - reboundShare, 'rebounds');
    const fga = totals.fieldGoalsAttempted;
    const fgm = totals.fieldGoalsMade;
    const fta = totals.freeThrowsAttempted;
    const ftm = totals.freeThrowsMade;
    const tpa = totals.threesAttempted;
    const tpm = totals.threesMade;
    const fgPct = fgm !== null && fga !== null && fga > 0 ? clampUnitInterval(fgm / fga) : null;
    const ftPct = ftm !== null && fta !== null && fta > 0 ? clampUnitInterval(ftm / fta) : null;
    const threePct = tpm !== null && tpa !== null && tpa > 0 ? clampUnitInterval(Math.min(tpm, tpa) / tpa) : null;
    const reconstructionArtifact = input.threePointReconstruction;
    const reconstructionEligible = !fieldPublished('threesAttempted', input.season) || tpa === null;
    let reconstructedThreePoint: ReconstructedThreePointProfile | undefined;
    if (reconstructionEligible && reconstructionArtifact !== undefined) {
        const reconstructionRow: ReconstructionRow = {
            playerExternalId: input.playerId ?? 'unknown',
            season: input.season,
            seasonIndex: seasonIndexFor(input.season),
            positionGroup: position,
            heightInches: input.heightInches,
            weightLbs: input.weightLbs ?? null,
            age: input.age ?? null,
            minutes: totals.minutes,
            fgm,
            fga,
            tpm,
            tpa,
            ftm,
            fta,
            assists: totals.assists,
            statsSource: 'derivation',
        };
        reconstructedThreePoint = predictReconstructedProfile(reconstructionArtifact, reconstructionRow).profile;
    }
    const tsPct = clampUnitInterval(totals.tsPct);
    const efgPct = clampUnitInterval(totals.efgPct);
    const per = totals.per;
    const bpm = totals.boxPlusMinus;
    const usage = totals.usageRate;
    const ppgNorm = ppg !== null ? ppg * (114.7 / Math.max(1, input.era.leaguePpg)) : null;
    const ratePriors = {
        threePointPctPrior: input.ratePriors?.threePointPctPrior ?? LEAGUE_RATE_DEFAULTS[position].threePointPctPrior,
        freeThrowPctPrior: input.ratePriors?.freeThrowPctPrior ?? LEAGUE_RATE_DEFAULTS[position].freeThrowPctPrior,
    };
    const shrunkRate = (made: number | null, attempted: number | null, priorRate: number): number | null => {
        if (made === null || attempted === null || attempted <= 0)
            return null;
        const clampedMade = Math.min(made, attempted);
        return (clampedMade + priorRate * 80) / (attempted + 80);
    };
    const threePctShrunk = shrunkRate(tpm, tpa, ratePriors.threePointPctPrior);
    const ftPctShrunk = shrunkRate(ftm, fta, ratePriors.freeThrowPctPrior);
    const weight = clamp(0.6 * Math.min(1, minutes / 1500) + 0.4 * Math.min(1, gp / 45), 0, 1);
    const blend = (raw: number, mean: number): number => raw * weight + mean * (1 - weight);
    const tsComponent = tsPct !== null ? (tsPct - 0.5) * 60 : 0;
    const ftComponent = ftPctShrunk !== null ? (ftPctShrunk - 0.7) * 15 : 0;
    let threeRaw: number;
    let threeKind: ProvenanceKind;
    let threeFields: string[];
    if (tpa !== null && tpa > 0 && threePctShrunk !== null) {
        threeRaw = 58 + tsComponent + (threePctShrunk - 0.3) * 140 + ftComponent;
        threeKind = 'derived';
        threeFields = ['tpm', 'tpa', 'prior', 'shrink-80-attempts'];
    }
    else if (reconstructedThreePoint !== undefined) {
        threeRaw = ratingFromAccuracy(reconstructionArtifact as ThreePointReconstructionArtifact, reconstructedThreePoint.accuracyConservative);
        threeKind = 'reconstructed';
        threeFields = reconstructedThreePoint.evidence.sourceFields;
    }
    else if (ftPctShrunk !== null) {
        threeRaw = 52 + ftComponent * 1.2 - (position === 'C' ? 8 : 0);
        threeKind = 'estimated';
        threeFields = ['ftm', 'fta', 'prior', 'shrink-80-attempts'];
    }
    else {
        threeRaw = 45;
        threeKind = 'estimated';
        threeFields = ['prior'];
    }
    record('threePoint', blend(threeRaw, 54), threeKind, threeFields);
    if (threeKind === 'reconstructed' && reconstructedThreePoint !== undefined) {
        const entry = provenance['threePoint'];
        if (entry !== undefined) {
            entry.confidence = reconstructedThreePoint.confidence;
            entry.notesCode = THREE_POINT_RECONSTRUCTION_VERSION;
        }
    }
    const freeThrowRaw = ftPctShrunk !== null ? 50 + (ftPctShrunk - 0.5) * 120 : 62;
    record('freeThrow', blend(freeThrowRaw, 69), ftPctShrunk !== null ? 'derived' : 'estimated', ftPctShrunk !== null ? ['ftm', 'fta', 'prior', 'shrink-80-attempts'] : ['prior']);
    const insideRaw = 58 +
        ((ppgNorm ?? 10) - 14) * 1.5 +
        ((tsPct ?? 0.48) - 0.5) * 25 +
        (position === 'C' || position === 'F' ? 3 : -2);
    record('insideScoring', blend(insideRaw, 54), ppg !== null ? 'derived' : 'estimated', [
        'points',
        'tsPct',
    ]);
    record('closeShot', blend(60 + ((ppg ?? 10) - 10) * 1.5, 59), ppg !== null ? 'derived' : 'estimated', ['points']);
    const midPct = efgPct ?? fgPct;
    record('midrange', blend(60 + ((midPct ?? 0.47) - 0.48) * 100, 54), midPct !== null ? 'derived' : 'estimated', ['fgm', 'fga', 'tpm', 'tpa']);
    const passRaw = 60 + ((apg ?? 3) - 3) * 5 + (per ?? 12) * 0.6;
    record('passing', blend(passRaw, 54), apg !== null ? 'derived' : 'estimated', ['assists', 'per']);
    const creationRaw = 60 + ((usage ?? 16) - 16) * 0.6 + ((apg ?? 3) - 3) * 3.0 + (per ?? 12) * 0.15;
    record('ballHandling', blend(creationRaw, 54), apg !== null || usage !== null ? 'derived' : 'estimated', ['assists', 'usageRate', 'per']);
    const reboundEvidence = rpg !== null && (oreb.kind !== 'observed' || dreb.kind !== 'observed');
    const offensiveReboundRaw = 50 + (oreb.value - 1.5) * 8 + Math.max(0, (rpg ?? 4) - 4) * 0.8;
    const defensiveReboundRaw = 55 + (dreb.value - 4) * 5 + Math.max(0, (rpg ?? 4) - 4) * 0.4;
    record('offensiveRebound', blend(offensiveReboundRaw, 45), oreb.kind === 'observed' ? 'derived' : oreb.kind, reboundEvidence && !oreb.fields.includes('rebounds')
        ? ['rebounds', ...oreb.fields]
        : oreb.fields);
    record('defensiveRebound', blend(defensiveReboundRaw, 59), dreb.kind === 'observed' ? 'derived' : dreb.kind, reboundEvidence && !dreb.fields.includes('rebounds')
        ? ['rebounds', ...dreb.fields]
        : dreb.fields);
    const stealSignal = spg.value * 9;
    const blockSignal = bpg.value * 10;
    const defensiveKind: ProvenanceKind = spg.kind === 'observed' && bpg.kind === 'observed' ? 'derived' : 'estimated';
    const perimeterRaw = 55 +
        stealSignal +
        (priors.stealsPer36 - 1.2) * 6 +
        (position === 'G' ? 3 : position === 'C' ? -7 : 0);
    record('perimeterDefense', blend(perimeterRaw, 54), defensiveKind, ['steals', 'position']);
    const interior = 54 +
        blockSignal +
        Math.max(0, (rpg ?? 4) - 4) * 1.2 +
        (priors.blocksPer36 - 0.9) * 4 +
        (position === 'C' ? 7 : position === 'F' ? 2 : -6);
    record('interiorDefense', blend(interior, position === 'C' || position === 'F' ? 59 : 49), defensiveKind, ['blocks', 'rebounds', 'position']);
    record('steal', blend(60 + spg.value * 10, 54), spg.kind === 'observed' ? 'derived' : spg.kind, spg.fields);
    record('block', blend(60 + bpg.value * 12, 49), bpg.kind === 'observed' ? 'derived' : bpg.kind, bpg.fields);
    const reboundDefenseSignal = rpg !== null ? Math.max(0, rpg - 8) * 0.8 : 0;
    const foulDisciplineSignal = totals.fouls !== null && minutes > 0
        ? -Math.max(0, (totals.fouls / minutes) * 48 - 4) * 1.5
        : 0;
    const stockSignal = spg.value * 4 + bpg.value * 3;
    const stockObserved = spg.kind === 'observed' || bpg.kind === 'observed';
    record('defensiveIq', blend(60 + stockSignal + reboundDefenseSignal + foulDisciplineSignal, 59), stockObserved ? 'derived' : 'estimated', stockObserved ? ['steals', 'blocks', 'rebounds', 'fouls'] : ['rebounds', 'prior']);
    const positionSpeedPrior = position === 'G' ? 75 : position === 'F' ? 67 : 59;
    const heightSpeedPenalty = input.heightInches === null ? 0 : Math.max(0, input.heightInches - 78) * 0.7;
    const activity = positionSpeedPrior +
        ((usage ?? 18) - 18) * 0.18 +
        (mpg - 24) * 0.16 +
        (spg.value - 1) * 1.5 -
        heightSpeedPenalty;
    const heightSignal = input.heightInches === null ? 0 : Math.max(0, input.heightInches - 72) * 1.7;
    record('speed', blend(activity + (position === 'G' ? 4 : 0), 59), usage !== null ? 'derived' : 'estimated', ['position', 'heightInches', 'usageRate', 'minutes', 'steals']);
    record('strength', blend(53 + heightSignal + (position === 'C' ? 4 : 0) + (per ?? 12) * 0.2, position === 'C' || position === 'F' ? 64 : 54), input.heightInches !== null ? 'derived' : 'estimated', ['position', 'heightInches', 'per']);
    const verticalRaw = 51 +
        bpg.value * 4 +
        Math.max(0, (oreb.value - 1.5) * 1.8) +
        (position === 'G' ? 5 : position === 'F' ? 3 : 0);
    record('vertical', blend(verticalRaw, 56), bpg.kind === 'observed' || oreb.kind === 'observed' ? 'derived' : 'estimated', ['blocks', 'offensiveRebounds', 'position']);
    record('offensiveIq', blend(60 + (per ?? 12) * 1.0 + (bpm ?? 0) * 2.0, 59), per !== null && bpm !== null ? 'derived' : 'estimated', ['per', 'boxPlusMinus']);
    const ratings = {} as SimulationRatings;
    for (const key of Object.keys(provenance)) {
        const raw = unclamped[key];
        if (raw !== undefined)
            ratings[key as keyof SimulationRatings] = clampRating(raw);
    }
    const tendencies = {} as SimulationTendencies;
    const t = (key: string, raw: number, kind: ProvenanceKind, fields: string[]): void => {
        const value = clamp(raw, 0, 100);
        unclamped[`tendency:${key}`] = raw;
        methods[key] = kind;
        provenance[key] = {
            kind,
            confidence: confidenceFor(kind),
            methodVersion: DERIVATION_METHOD_VERSION,
            sourceVersion: SOURCE_VERSION,
            sourceFields: fields,
            sourceStatus: fieldPublished(key, input.season) ? undefined : 'not-applicable',
        };
        tendencies[key as keyof SimulationTendencies] = Math.round(value * 100) / 100;
    };
    const fgaPerGame = fga !== null ? fga / Math.max(1, gp) : null;
    const usageVal = usage ?? 18;
    t('usageRate', usageVal, usage !== null ? 'observed' : 'estimated', ['usageRate']);
    const passEvidence = apg !== null ? (apg / Math.max(1, apg + (ppg ?? 10) * 0.5 + 1)) * 40 : 18;
    t('passRate', passEvidence, apg !== null ? 'derived' : 'estimated', ['assists', 'points']);
    t('shotRate', fgaPerGame !== null ? (fgaPerGame / 48) * 100 : 18, fgaPerGame !== null ? 'derived' : 'estimated', ['fga']);
    const threeRate = reconstructedThreePoint !== undefined
        ? reconstructedThreePoint.attemptRateConservative
        : tpa !== null && fga !== null && fga > 0
            ? tpa / fga
            : priors.threePointRatePrior;
    const freeThrowPressure = fta !== null && fga !== null && fga > 0 ? fta / fga : usageVal / 100;
    const assistRole = clamp((apg ?? 2) / 8, 0, 1);
    const interiorRole = clamp((oreb.value / 4 + Math.max(0, (rpg ?? 4) - 4) / 12) / 2, 0, 1);
    const guardRole = position === 'G' ? 1 : position === 'F' ? 0.45 : 0.1;
    const driveRate = clamp(6 + guardRole * 10 + freeThrowPressure * 22 + (usageVal - 18) * 0.25, 3, 35);
    const postUpRate = clamp(3 + interiorRole * 18 + (1 - threeRate) * (position === 'C' ? 7 : 2), 2, 32);
    const rimFrequency = clamp(12 + freeThrowPressure * 25 + interiorRole * 16 + guardRole * 2, 8, 48);
    const nonThreeShare = clamp(100 - threeRate * 100 - rimFrequency, 5, 80);
    const longMidShare = clamp(nonThreeShare * (0.34 + guardRole * 0.12), 4, 30);
    const shortMidShare = clamp(nonThreeShare - longMidShare, 5, 35);
    const cornerShare = clamp(threeRate * 100 * (0.28 + (1 - assistRole) * 0.18), 0, 35);
    const aboveBreakShare = clamp(threeRate * 100 - cornerShare, 0, 55);
    t('driveRate', driveRate, fta !== null ? 'derived' : 'estimated', [
        'fta',
        'fga',
        'usageRate',
        'position',
    ]);
    t('postUpRate', postUpRate, oreb.kind === 'observed' ? 'derived' : 'estimated', [
        'offensiveRebounds',
        'rebounds',
        'tpa',
        'fga',
        'position',
    ]);
    t('rimFrequency', rimFrequency, fta !== null ? 'derived' : 'estimated', [
        'fta',
        'fga',
        'offensiveRebounds',
        'position',
    ]);
    t('shortMidFrequency', shortMidShare, fga !== null ? 'derived' : 'estimated', [
        'fga',
        'tpa',
        'fta',
        'position',
    ]);
    t('longMidFrequency', longMidShare, fga !== null ? 'derived' : 'estimated', [
        'fga',
        'tpa',
        'fta',
        'position',
    ]);
    t('cornerThreeFrequency', cornerShare, tpa !== null ? 'derived' : 'estimated', [
        'tpa',
        'fga',
        'assists',
    ]);
    t('aboveBreakThreeFrequency', aboveBreakShare, tpa !== null ? 'derived' : 'estimated', [
        'tpa',
        'fga',
        'assists',
    ]);
    if (reconstructedThreePoint !== undefined) {
        t('threePointRate', reconstructedThreePoint.attemptRateConservative * 100, 'reconstructed', [
            ...reconstructedThreePoint.evidence.sourceFields,
            'model',
        ]);
        const entry = provenance['threePointRate'];
        if (entry !== undefined) {
            entry.confidence = reconstructedThreePoint.confidence;
            entry.notesCode = THREE_POINT_RECONSTRUCTION_VERSION;
        }
    }
    else if (!fieldPublished('threesAttempted', input.season)) {
        t('threePointRate', 0, 'estimated', ['prior']);
    }
    else if (tpa !== null && fga !== null && fga > 0) {
        t('threePointRate', (tpa / fga) * 100, 'derived', ['tpa', 'fga']);
    }
    else {
        t('threePointRate', priors.threePointRatePrior * 100 * Math.min(1, input.era.league3PARate / 0.39), 'estimated', ['prior']);
    }
    if (fta !== null && fga !== null && fga > 0) {
        t('freeThrowRate', (fta / fga) * 100, 'derived', ['fta', 'fga']);
    }
    else if (fta !== null && fgaPerGame !== null && fgaPerGame > 0) {
        t('freeThrowRate', Math.min(50, (fta / Math.max(1, gp) / fgaPerGame) * 100), 'derived', [
            'fta',
            'fga',
        ]);
    }
    else {
        t('freeThrowRate', clamp(usageVal * 1.2, 10, 50), 'estimated', ['usageRate', 'prior']);
    }
    const possessionDenom = (fga ?? 0) + 0.44 * (fta ?? 0) + (totals.turnovers ?? 0);
    if (totals.turnovers !== null && possessionDenom > 0) {
        t('turnoverRate', (totals.turnovers / possessionDenom) * 100, 'derived', [
            'turnovers',
            'fga',
            'fta',
        ]);
    }
    else {
        t('turnoverRate', (usageVal / 20) * 12 + 4, 'estimated', ['usageRate', 'prior']);
    }
    t('isolationRate', clamp((usageVal - 10) * (0.22 + guardRole * 0.12), 1, 18), usage !== null ? 'derived' : 'estimated', ['usageRate', 'position']);
    t('pickAndRollBallHandlerRate', clamp(8 + guardRole * 13 + assistRole * 17 + Math.max(0, usageVal - 20) * 0.45, 5, 45), apg !== null ? 'derived' : 'estimated', ['assists', 'usageRate', 'position']);
    t('pickAndRollRollManRate', clamp(5 + interiorRole * 22 + (position === 'C' ? 5 : 0), 3, 35), oreb.kind === 'observed' ? 'derived' : 'estimated', ['offensiveRebounds', 'rebounds', 'position']);
    t('spotUpRate', clamp(9 + threeRate * 34 + (1 - clamp(usageVal / 32, 0, 1)) * 10, 7, 32), tpa !== null ? 'derived' : 'estimated', ['tpa', 'fga', 'usageRate']);
    t('transitionRate', clamp(7 + (ratings.speed - 50) * 0.3 + spg.value * 1.2, 5, 28), spg.kind === 'observed' ? 'derived' : 'estimated', ['speed', 'steals']);
    t('cutRate', clamp(5 + (1 - clamp(usageVal / 32, 0, 1)) * 8 + interiorRole * 6, 4, 22), usage !== null ? 'derived' : 'estimated', ['usageRate', 'offensiveRebounds', 'rebounds']);
    t('foulRate', 2 + ((totals.fouls ?? 0) / Math.max(1, minutes)) * 48, (totals.fouls ?? 0) > 0 ? 'derived' : 'estimated', ['fouls']);
    t('stealAttemptRate', 5 + ratings.steal * 0.08, 'derived', ['steal']);
    t('blockAttemptRate', 5 + ratings.block * 0.08, 'derived', ['block']);
    t('crashOffensiveGlassRate', 10 + ratings.offensiveRebound * 0.12, 'derived', [
        'offensiveRebound',
    ]);
    const games = Math.max(1, gp);
    const threePointAttemptRate = tpa !== null && fga !== null && fga > 0 ? tpa / fga : null;
    const freeThrowAttemptRate = fta !== null && fga !== null && fga > 0 ? fta / fga : 0;
    unclamped['anchor:freeThrowAttemptRate'] = freeThrowAttemptRate;
    const anchors: SimulationAnchors = {
        gamesPlayed: gp,
        minutesPerGame: Math.min(60, mpg),
        pointsPerGame: ppg ?? 0,
        reboundsPerGame: rpg ?? 0,
        offensiveReboundsPerGame: oreb.value,
        defensiveReboundsPerGame: dreb.value,
        assistsPerGame: apg ?? 0,
        stealsPerGame: spg.value,
        blocksPerGame: bpg.value,
        turnoversPerGame: totals.turnovers !== null ? totals.turnovers / games : (priors.turnoversPer36 * mpg) / 36,
        fieldGoalPct: fgPct ?? 0.45,
        threePointPct: threePct,
        freeThrowPct: ftPct ?? 0.75,
        threePointAttemptRate: clampUnitInterval(threePointAttemptRate) ?? null,
        freeThrowAttemptRate: clampUnitInterval(Math.min(1, freeThrowAttemptRate)) ?? 0,
        threePointPctShrunk: threePctShrunk,
        freeThrowPctShrunk: ftPctShrunk,
        threePointPctPrior: ratePriors.threePointPctPrior,
        freeThrowPctPrior: ratePriors.freeThrowPctPrior,
        rateShrinkAttempts: 80,
    };
    const v3 = deriveRatingProfile({
        ratings,
        tendencies,
        stats: input.stats,
        position: input.position,
        heightInches: input.heightInches,
        playerId: input.playerId ??
            (typeof input.stats.playerExternalId === 'string' ? input.stats.playerExternalId : undefined),
        artifact: input.artifact ?? DEFAULT_RATINGS_MODEL_ARTIFACT,
    });
    const summaryRatings: SummaryRatings = v3.summaryRatings;
    return {
        ratings,
        tendencies,
        anchors,
        summaryRatings,
        ratingProfile: v3.profile,
        provenance,
        unclamped,
        methods,
        ...(reconstructedThreePoint !== undefined ? { reconstructedThreePoint } : {}),
    };
}
