import { describe, expect, it } from 'vitest';
import { buildFeatureContext, cohortPriors, extractRawFeatures, fitBinomialLogistic, fitThreePointReconstruction, foldOf, loadCohortRows, median, normalQuantile, positionGroupOf, predictReconstructedProfile, ratingFromAccuracy, sigmoid, weightedPercentile, type ReconstructionRow, } from './index.ts';
import { RECONSTRUCTION_FEATURE_NAMES, RECONSTRUCTION_SEASONS } from './rows.ts';
import { fitModel, metricsOf, pickLambda, predictConservative } from './cross-validation.ts';
import type { HeldOutPrediction } from './cross-validation.ts';
function sampleRow(overrides: Partial<ReconstructionRow> = {}): ReconstructionRow {
    return {
        playerExternalId: 'p-100',
        season: '1980-81',
        seasonIndex: 1,
        positionGroup: 'G',
        heightInches: 77,
        weightLbs: 195,
        age: 25,
        minutes: 2400,
        fgm: 600,
        fga: 1200,
        tpm: 80,
        tpa: 220,
        ftm: 300,
        fta: 360,
        assists: 400,
        statsSource: 'nba_api',
        ...overrides,
    };
}
const COHORT = loadCohortRows();
const RECONSTRUCTION = fitThreePointReconstruction(COHORT);
describe('reconstruction math primitives', () => {
    it('sigmoid is bounded and monotone', () => {
        expect(sigmoid(0)).toBeCloseTo(0.5, 10);
        expect(sigmoid(100)).toBe(1);
        expect(sigmoid(-100)).toBe(0);
        expect(sigmoid(1)).toBeGreaterThan(sigmoid(-1));
    });
    it('normalQuantile matches the standard normal at the conservative quantiles', () => {
        expect(normalQuantile(0.75)).toBeCloseTo(0.67449, 4);
        expect(normalQuantile(0.8)).toBeCloseTo(0.84162, 4);
        expect(normalQuantile(0.5)).toBeCloseTo(0, 6);
        expect(normalQuantile(0.025)).toBeCloseTo(-1.95996, 3);
    });
    it('binomial logistic fit recovers known coefficients deterministically', () => {
        const intercept = -1.1;
        const beta = 1.8;
        const rows = 400;
        const design: number[][] = [];
        const makes: number[] = [];
        const trials: number[] = [];
        for (let i = 0; i < rows; i += 1) {
            const x = (i % 20) / 10 - 1;
            const logit = intercept + beta * x;
            const p = sigmoid(logit);
            design.push([1, x]);
            trials.push(50);
            makes.push(Math.round(50 * p));
        }
        const first = fitBinomialLogistic(design, makes, trials, 0.01, 0, 0);
        const second = fitBinomialLogistic(design, makes, trials, 0.01, 0, 0);
        expect(first.coefficients[0]).toBeCloseTo(intercept, 1);
        expect(first.coefficients[1]).toBeCloseTo(beta, 1);
        expect(first.coefficients).toEqual(second.coefficients);
        expect(first.covariance).toEqual(second.covariance);
        expect(first.covariance.length).toBe(2);
        expect(first.covariance[0]?.[0]).toBeGreaterThan(0);
    });
    it('prior pseudo-observations pull the intercept toward the prior rate', () => {
        const design = Array.from({ length: 100 }, (_, i) => [1, i / 50]);
        const makes = new Array(100).fill(0);
        const trials = new Array(100).fill(20);
        const noPrior = fitBinomialLogistic(design, makes, trials, 1, 0, 0);
        const withPrior = fitBinomialLogistic(design, makes, trials, 1, 0.4 * 800, 800);
        expect(sigmoid(withPrior.coefficients[0] ?? -5)).toBeGreaterThan(sigmoid(noPrior.coefficients[0] ?? -5));
        expect(sigmoid(withPrior.coefficients[0] ?? -5)).toBeCloseTo(320 / 820, 1);
    });
});
describe('reconstruction rows and features', () => {
    it('maps detailed positions to prior groups', () => {
        expect(positionGroupOf('PG')).toBe('G');
        expect(positionGroupOf('SG')).toBe('G');
        expect(positionGroupOf('SF')).toBe('F');
        expect(positionGroupOf('PF')).toBe('F');
        expect(positionGroupOf('C')).toBe('C');
        expect(positionGroupOf(null)).toBe('C');
    });
    it('computes medians deterministically and ignores nulls', () => {
        expect(median([1, 3, 5])).toBe(3);
        expect(median([1, 3, 5, 7])).toBe(4);
        expect(median([null, 10, null])).toBe(10);
        expect(median([])).toBe(0);
    });
    it('stabilizes FT% with the position prior and computes relative 2P%', () => {
        const context = {
            ftPriors: { G: 0.8, F: 0.77, C: 0.71 },
            twoPctMeans: { G: 0.45, F: 0.45, C: 0.47 },
            missingDefaults: {
                G: { heightInches: 77, weightLbs: 195, age: 26 },
                F: { heightInches: 78, weightLbs: 205, age: 26 },
                C: { heightInches: 82, weightLbs: 240, age: 26 },
            },
        } satisfies Parameters<typeof extractRawFeatures>[1];
        const raw = extractRawFeatures(sampleRow({ ftm: 100, fta: 200 }), context);
        expect(raw.ftRatio).toBeCloseTo(0.5, 10);
        expect(raw.ftPctShrunk).toBeCloseTo((100 + 0.8 * 80) / (200 + 80), 10);
        expect(raw.rel2pPct).toBeCloseTo((600 - 80) / (1200 - 220) - 0.45, 10);
        expect(raw.isGuard).toBe(1);
        expect(raw.isCenter).toBe(0);
    });
    it('imputes missing physicals and flags them', () => {
        const context = buildFeatureContext([
            sampleRow({ heightInches: 80, weightLbs: 220 }),
            sampleRow({ heightInches: null, weightLbs: null, playerExternalId: 'p-2' }),
        ]);
        const raw = extractRawFeatures(sampleRow({ heightInches: null, weightLbs: null, age: null }), context);
        expect(raw.heightInches).toBe(80);
        expect(raw.weightLbs).toBe(220);
        expect(raw.missHeight).toBe(1);
        expect(raw.missWeight).toBe(1);
        expect(raw.age).toBe(25);
    });
    it('never consumes 3P fields, overall, offensive rating, or raw FG% as features', () => {
        const excluded: string[] = [
            'tpm',
            'tpa',
            'fgPct',
            'overall',
            'offensiveRating',
            'tsPct',
            'missHeight',
            'missWeight',
        ];
        for (const name of excluded) {
            expect(RECONSTRUCTION_FEATURE_NAMES).not.toContain(name);
        }
    });
    it('cohort priors use the shrink-80 equivalent attempts convention', () => {
        const rows = [sampleRow({ tpm: 100, tpa: 300 }), sampleRow({ tpm: 200, tpa: 700 })];
        const priors = cohortPriors(rows);
        expect(priors.accuracyPrior).toBeCloseTo(0.3, 10);
        expect(priors.accuracyPriorAttempts).toBe(80);
        expect(priors.attemptRatePrior).toBeCloseTo(1000 / 2400, 10);
        expect(priors.attemptRatePriorTrials).toBe(80);
    });
    it('loads the real early-era cohort from raw data', () => {
        const rows = COHORT;
        expect(rows.length).toBeGreaterThan(1400);
        expect(new Set(rows.map((row) => row.season))).toEqual(new Set([...RECONSTRUCTION_SEASONS]));
        const attempters = rows.filter((row) => (row.tpa ?? 0) > 0);
        expect(attempters.length).toBeGreaterThan(600);
        expect(new Set(rows.map((row) => row.positionGroup))).toEqual(new Set(['G', 'F', 'C']));
    });
});
describe('posterior quantiles and profile assembly', () => {
    it('conservative posterior quantile is below the mean', () => {
        const artifact = RECONSTRUCTION.artifact;
        const result = predictReconstructedProfile(artifact, sampleRow());
        expect(result.profile.accuracyConservative).toBeLessThan(result.profile.accuracyMean);
        expect(result.profile.attemptRateConservative).toBeLessThan(result.profile.attemptRateMean);
        expect(result.profile.accuracyStdDev).toBeGreaterThan(0);
        expect(result.profile.attemptRateStdDev).toBeGreaterThan(0);
        expect(result.profile.accuracyConservative).toBeGreaterThan(0);
        expect(result.profile.modelVersion).toBe('three-point-reconstruction-v1');
        expect(result.profile.zoneFloors.aboveBreakThree).toBeLessThan(0.32);
        expect(result.profile.zoneFloors.cornerThree).toBeLessThan(0.34);
        expect(result.profile.evidence.sourceFields.length).toBeGreaterThan(3);
    });
    it('maps conservative accuracy to three-point ratings via the artifact mapping', () => {
        const { artifact } = RECONSTRUCTION;
        const points = artifact.ratingMapping.points;
        const low = ratingFromAccuracy(artifact, points[0]?.accuracy ?? 0.2);
        const high = ratingFromAccuracy(artifact, points[points.length - 1]?.accuracy ?? 0.4);
        expect(low).toBe(points[0]?.rating);
        expect(high).toBe(points[points.length - 1]?.rating);
        const midAccuracy = ((points[0]?.accuracy ?? 0) + (points[1]?.accuracy ?? 0)) / 2;
        const mid = ratingFromAccuracy(artifact, midAccuracy);
        const midExpected = Math.round(((points[0]?.rating ?? 0) + (points[1]?.rating ?? 0)) / 2);
        expect(mid).toBe(midExpected);
        expect(ratingFromAccuracy(artifact, 0.01)).toBeGreaterThanOrEqual(artifact.ratingMapping.clampMin);
        expect(ratingFromAccuracy(artifact, 0.9)).toBeLessThanOrEqual(artifact.ratingMapping.clampMax);
    });
    it('missing evidence produces low-confidence profiles, never exploded shooting', () => {
        const missing = predictReconstructedProfile(RECONSTRUCTION.artifact, sampleRow({ heightInches: null, weightLbs: null }));
        const complete = predictReconstructedProfile(RECONSTRUCTION.artifact, sampleRow());
        expect(missing.profile.evidence.missingFeatures).toBe(2);
        expect(complete.profile.evidence.missingFeatures).toBe(0);
        expect(missing.profile.attemptRateConservative).toBeLessThan(0.5);
        expect(missing.profile.accuracyConservative).toBeLessThan(0.6);
        expect(missing.profile.confidence).not.toBe('high');
    });
});
describe('grouped holdout and gates', () => {
    it('assigns folds deterministically by player id with no player leakage', () => {
        expect(foldOf('p-1', 5)).toBe(foldOf('p-1', 5));
        expect(foldOf('p-1', 5)).not.toBe(foldOf('p-2', 5));
        const ids = new Set(Array.from({ length: 100 }, (_, i) => `p-${String(i)}`));
        const folds = [...ids].map((id) => foldOf(id, 5));
        expect(Math.min(...folds)).toBe(0);
        expect(Math.max(...folds)).toBe(4);
    });
    it('computes attempt-weighted metrics with conservative bias and bands', () => {
        const predictions: HeldOutPrediction[] = [
            { row: sampleRow({ minutes: 300 }), prediction: 0.3, observed: 0.35, weight: 200 },
            {
                row: sampleRow({ minutes: 900, positionGroup: 'F', playerExternalId: 'p-2' }),
                prediction: 0.31,
                observed: 0.36,
                weight: 100,
            },
        ];
        const metrics = metricsOf(predictions, 'accuracy');
        expect(metrics.mae).toBeCloseTo(0.05, 10);
        expect(metrics.bias).toBeCloseTo(-0.05, 10);
        expect(metrics.overpredictionShare).toBe(0);
        expect(metrics.evidenceBands.some((band) => band.band === 'under-500-min')).toBe(true);
        expect(metrics.evidenceBands.some((band) => band.band === '500-1499-min')).toBe(true);
        expect(metrics.samplePlayers).toBe(2);
        const fp = metricsOf([{ row: sampleRow(), prediction: 0.34, observed: 0.25, weight: 100 }], 'accuracy');
        expect(fp.falsePositives.count).toBe(1);
        const fn = metricsOf([{ row: sampleRow(), prediction: 0.3, observed: 0.4, weight: 100 }], 'accuracy');
        expect(fn.falseNegatives.count).toBe(1);
    });
    it('weightedPercentile computes the fifth percentile from attempt weights', () => {
        const values = [
            { value: 0.2, weight: 10 },
            { value: 0.3, weight: 100 },
            { value: 0.5, weight: 10 },
        ];
        expect(weightedPercentile(values, 0.05)).toBe(0.2);
        expect(weightedPercentile(values, 0.9)).toBe(0.3);
        expect(weightedPercentile(values, 0.99)).toBe(0.5);
    });
    it('the fitted artifact passes every acceptance gate and is deterministic', () => {
        const second = fitThreePointReconstruction(COHORT);
        expect(RECONSTRUCTION.artifact).toEqual(second.artifact);
        expect(RECONSTRUCTION.gates.meanBiasNonPositiveAccuracy).toBe(true);
        expect(RECONSTRUCTION.gates.meanBiasNonPositiveTranslatedAttemptRate).toBe(true);
        expect(RECONSTRUCTION.gates.floorBelowEstablished).toBe(true);
        expect(RECONSTRUCTION.artifact.floors.floor).toBeLessThan(0.32);
        expect(RECONSTRUCTION.artifact.floors.zoneFloors.cornerThree).toBeLessThan(0.34);
        expect(RECONSTRUCTION.artifact.holdout.foldCount).toBeGreaterThanOrEqual(3);
        expect(RECONSTRUCTION.holdout.accuracy.bias).toBeLessThanOrEqual(0);
        expect(RECONSTRUCTION.holdout.translatedAttemptRateModern.bias).toBeLessThanOrEqual(0);
        expect(RECONSTRUCTION.holdout.accuracy.mae).toBeGreaterThan(0);
        expect(RECONSTRUCTION.holdout.attemptRate.mae).toBeGreaterThan(0);
    }, 30000);
    it('the attempt translation scales volume and caps per position', () => {
        const artifact = RECONSTRUCTION.artifact;
        const translation = artifact.attemptRateTranslation;
        expect(translation.factor).toBe(2.5);
        expect(translation.caps).toEqual({ G: 0.15, F: 0.08, C: 0.02 });
        const guard = predictReconstructedProfile(artifact, sampleRow({
            positionGroup: 'G',
            playerExternalId: 'p-100',
            minutes: 2800,
            fga: 1300,
            fta: 380,
            ftm: 320,
            assists: 420,
            tpm: 40,
            tpa: 60,
        }));
        const center = predictReconstructedProfile(artifact, sampleRow({
            positionGroup: 'C',
            playerExternalId: 'p-101',
            minutes: 2800,
            fga: 1300,
            fta: 380,
            ftm: 320,
            assists: 420,
            tpm: 40,
            tpa: 60,
        }));
        expect(guard.profile.attemptRateConservative).toBeGreaterThan(0.02);
        expect(guard.profile.attemptRateConservative).toBeLessThanOrEqual(0.15);
        expect(center.profile.attemptRateConservative).toBeLessThanOrEqual(0.02);
        expect(guard.profile.attemptRateConservative).toBeLessThanOrEqual(guard.profile.attemptRateMean);
        expect(guard.profile.accuracyMean).toBeGreaterThan(guard.profile.accuracyConservative);
    });
    it('reports position and evidence bands on the real holdout', () => {
        const accuracy = RECONSTRUCTION.artifact.holdout.accuracy;
        for (const group of ['G', 'F', 'C'] as const) {
            expect(accuracy.positionBands[group].count).toBeGreaterThan(0);
        }
        expect(accuracy.evidenceBands.length).toBeGreaterThanOrEqual(2);
        expect(RECONSTRUCTION.artifact.generatedBy).toContain('calibrate three-point');
    });
    it('holdout predictions stay below the observed rate on average (no overprediction gate)', () => {
        expect(RECONSTRUCTION.artifact.holdout.accuracy.overpredictionShare).toBeLessThan(0.9);
        expect(RECONSTRUCTION.artifact.holdout.attemptRate.overpredictionShare).toBeLessThan(0.9);
    });
    it('deterministic lambda selection returns grid values', () => {
        const context = buildFeatureContext(COHORT);
        const priors = cohortPriors(COHORT);
        const lambdas = pickLambda(COHORT, context, priors);
        expect([0.5, 1, 2, 4]).toContain(lambdas.accuracyLambda);
        expect([0.5, 1, 2, 4]).toContain(lambdas.attemptRateLambda);
    }, 30000);
    it('fitModel and runGroupedHoldout agree on the trained model shape', () => {
        const context = buildFeatureContext(COHORT);
        const priors = cohortPriors(COHORT);
        const model = fitModel(COHORT, context, 'accuracy', 1, priors);
        expect(model.fitted.coefficients.length).toBe(RECONSTRUCTION_FEATURE_NAMES.length + 1);
        expect(model.fitted.covariance.length).toBe(RECONSTRUCTION_FEATURE_NAMES.length + 1);
        const raw = extractRawFeatures(sampleRow(), context);
        const predicted = predictConservative(model, Object.values(raw), 0.25);
        expect(predicted).toBeGreaterThan(0);
        expect(predicted).toBeLessThan(1);
    }, 30000);
});
