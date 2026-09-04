import { describe, expect, it } from 'vitest';
import { DERIVATION_METHOD_VERSION, THREE_POINT_RECONSTRUCTION_VERSION, } from '@hoop-rush/data-contracts';
import { derivePlayerRecord, fieldPublished, type DerivationInput } from './v2.ts';
import { computeProductionImpact, computeRealOverall, computeSummaryRatings } from './summary.ts';
import { loadThreePointReconstructionArtifact } from '../reconstruction/artifact.ts';
import { MODERN_ERA, starterStats } from './ratings-test-support.ts';
function input(season: string, stats: Record<string, unknown>, position = 'SG', overrides: Partial<DerivationInput> = {}): DerivationInput {
    return {
        season,
        position,
        heightInches: 79,
        stats: stats,
        era: MODERN_ERA,
        ...overrides,
    };
}
function pre1974Stats(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        gamesPlayed: 78,
        minutes: 2850,
        points: 1680,
        rebounds: 420,
        offensiveRebounds: null,
        defensiveRebounds: null,
        assists: 310,
        steals: null,
        blocks: null,
        turnovers: null,
        fouls: 180,
        fgm: 630,
        fga: 1350,
        tpm: null,
        tpa: null,
        ftm: 260,
        fta: 310,
        per: null,
        boxPlusMinus: null,
        usageRate: null,
        tsPct: null,
        efgPct: null,
        ...over,
    };
}
describe('derivePlayerRecord (field-method registry)', () => {
    it('produces the strict engine contracts with no extra keys', () => {
        const derived = derivePlayerRecord(input('1996-97', starterStats()));
        expect(Object.keys(derived.ratings)).toHaveLength(18);
        expect(Object.keys(derived.tendencies)).toHaveLength(23);
        expect(derived.ratings).not.toHaveProperty('overall');
        expect(derived.ratings).not.toHaveProperty('stamina');
        expect(derived.ratings.threePoint).toBeGreaterThan(50);
        expect(derived.ratings.passing).toBeGreaterThan(60);
        expect(derived.tendencies.threePointRate).toBeCloseTo((410 / 1350) * 100, 0);
        expect(derived.anchors.threePointPct).toBeCloseTo(160 / 410, 6);
    });
    it('is deterministic: no random jitter, same inputs same outputs', () => {
        const stats = starterStats();
        const a = derivePlayerRecord(input('1996-97', stats));
        const b = derivePlayerRecord(input('1996-97', stats));
        expect(a.ratings).toEqual(b.ratings);
        expect(a.tendencies).toEqual(b.tendencies);
        expect(a.anchors).toEqual(b.anchors);
        expect(a.provenance).toEqual(b.provenance);
    });
    it('records provenance on every required field with versions', () => {
        const derived = derivePlayerRecord(input('1996-97', starterStats()));
        for (const field of Object.keys(derived.ratings)) {
            const provenance = derived.provenance[field];
            expect(provenance?.kind).toBeDefined();
            expect(provenance?.methodVersion).toBe(DERIVATION_METHOD_VERSION);
            expect(provenance?.sourceVersion).toBe('source-v1');
            expect(provenance?.sourceFields.length).toBeGreaterThan(0);
        }
        expect(derived.provenance['threePoint']?.kind).toBe('derived');
        expect(derived.provenance['threePoint']?.sourceFields).toContain('tpm');
    });
    it('keeps unclamped diagnostic values alongside final values', () => {
        const derived = derivePlayerRecord(input('1996-97', starterStats({ points: 78 * 40 })));
        expect(derived.ratings.insideScoring).toBeLessThanOrEqual(100);
        expect(typeof derived.unclamped['insideScoring']).toBe('number');
        expect(derived.unclamped['insideScoring']).toBeGreaterThanOrEqual(derived.ratings.insideScoring);
    });
    it('pre-1974 defensive events are estimated with not-applicable provenance', () => {
        const derived = derivePlayerRecord(input('1970-71', pre1974Stats()));
        expect(derived.provenance['steal']?.kind).toBe('estimated');
        expect(derived.provenance['steal']?.sourceStatus).toBe('not-applicable');
        expect(derived.provenance['block']?.kind).toBe('estimated');
        expect(derived.anchors.stealsPerGame).toBeGreaterThan(0);
        expect(derived.anchors.blocksPerGame).toBeGreaterThan(0);
    });
    it('pre-1979 three-point evidence is not-applicable and never an observed zero', () => {
        const derived = derivePlayerRecord(input('1977-78', pre1974Stats()));
        expect(derived.provenance['threePoint']?.sourceStatus).toBe('not-applicable');
        expect(derived.provenance['threePoint']?.kind).toBe('estimated');
        expect(derived.anchors.threePointPct).toBeNull();
        expect(derived.tendencies.threePointRate).toBe(0);
    });
    it('pre-1979 seasons receive conservative reconstructed profiles when the artifact is present', () => {
        const artifact = loadThreePointReconstructionArtifact();
        const derived = derivePlayerRecord(input('1965-66', pre1974Stats({ minutes: 2900, fgm: 700, fga: 1400, ftm: 300, fta: 360, assists: 240 }), 'PG', { threePointReconstruction: artifact, weightLbs: 185, age: 26 }));
        expect(derived.reconstructedThreePoint).toBeDefined();
        const profile = derived.reconstructedThreePoint;
        expect(profile?.modelVersion).toBe(THREE_POINT_RECONSTRUCTION_VERSION);
        expect(profile?.attemptRateConservative).toBeGreaterThan(0);
        expect(profile?.attemptRateConservative).toBeLessThan(1);
        expect(profile?.accuracyConservative).toBeLessThan(profile?.accuracyMean ?? 1);
        expect(derived.anchors.threePointAttemptRate).toBeNull();
        expect(derived.anchors.threePointPct).toBeNull();
        expect(derived.provenance['threePoint']?.kind).toBe('reconstructed');
        expect(derived.provenance['threePoint']?.confidence).toBe(profile?.confidence);
        expect(derived.provenance['threePoint']?.notesCode).toBe(THREE_POINT_RECONSTRUCTION_VERSION);
        expect(derived.provenance['threePointRate']?.kind).toBe('reconstructed');
        expect(derived.tendencies.threePointRate).toBeCloseTo((profile?.attemptRateConservative ?? 0) * 100, 2);
        expect(derived.tendencies.cornerThreeFrequency + derived.tendencies.aboveBreakThreeFrequency).toBeLessThan(derived.tendencies.threePointRate + 1);
    });
    it('validated observed zero-attempt seasons are never reconstructed', () => {
        const artifact = loadThreePointReconstructionArtifact();
        const derived = derivePlayerRecord(input('1985-86', starterStats({ tpm: 0, tpa: 0 }), 'C', {
            threePointReconstruction: artifact,
        }));
        expect(derived.reconstructedThreePoint).toBeUndefined();
        expect(derived.anchors.threePointAttemptRate).toBe(0);
        expect(derived.provenance['threePoint']?.kind).toBe('estimated');
        expect(derived.tendencies.threePointRate).toBe(0);
    });
    it('observed three-point seasons keep the derived path unchanged', () => {
        const artifact = loadThreePointReconstructionArtifact();
        const derived = derivePlayerRecord(input('1985-86', starterStats(), 'SG', { threePointReconstruction: artifact }));
        expect(derived.reconstructedThreePoint).toBeUndefined();
        expect(derived.provenance['threePoint']?.kind).toBe('derived');
        expect(derived.provenance['threePoint']?.sourceFields).toContain('tpm');
        expect(derived.anchors.threePointAttemptRate).toBeCloseTo(410 / 1350, 6);
        expect(derived.ratings.threePoint).toBeGreaterThan(50);
    });
    it('deterministic reconstruction: same inputs produce identical profiles', () => {
        const artifact = loadThreePointReconstructionArtifact();
        const base = {
            season: '1965-66',
            position: 'PG' as const,
            heightInches: 79,
            weightLbs: 185,
            age: 26,
            stats: pre1974Stats(),
            era: MODERN_ERA,
            threePointReconstruction: artifact,
        };
        const a = derivePlayerRecord(base);
        const b = derivePlayerRecord(base);
        expect(a.reconstructedThreePoint).toEqual(b.reconstructedThreePoint);
        expect(a.ratings.threePoint).toBe(b.ratings.threePoint);
        expect(a.tendencies.threePointRate).toBe(b.tendencies.threePointRate);
    });
    it('pre-1978 turnovers are estimated from usage context', () => {
        const derived = derivePlayerRecord(input('1975-76', pre1974Stats()));
        expect(derived.provenance['turnoverRate']?.kind).toBe('estimated');
        expect(derived.anchors.turnoversPerGame).toBeGreaterThan(0);
    });
    it('1973-74+ rebound splits and defensive events are observed and derive ratings', () => {
        const derived = derivePlayerRecord(input('1975-76', pre1974Stats({ steals: 95, blocks: 30, offensiveRebounds: 80, defensiveRebounds: 340 })));
        expect(derived.provenance['steal']?.kind).toBe('derived');
        expect(derived.provenance['defensiveRebound']?.kind).toBe('derived');
        expect(derived.provenance['offensiveRebound']?.kind).toBe('derived');
    });
    it('caps three-point anchor rate when made exceeds attempts', () => {
        const derived = derivePlayerRecord(input('1985-86', starterStats({ tpm: 3, tpa: 2 })));
        expect(derived.anchors.threePointPct).toBe(1);
    });
    it('summary overall uses production-aware real overall, not only the skill blend', () => {
        const derived = derivePlayerRecord(input('1996-97', starterStats({
            points: 2400,
            per: 28,
            boxPlusMinus: 8,
            usageRate: 32,
            tsPct: 0.62,
        }), 'SG'));
        const skillOnly = computeSummaryRatings(derived.ratings, derived.tendencies);
        expect(derived.summaryRatings.overallRating).toBeGreaterThan(skillOnly.overallRating);
    });
    it('keeps elite guard efficiency above ordinary high-volume caps', () => {
        const curryLike = derivePlayerRecord(input('2015-16', starterStats({
            gamesPlayed: 79,
            minutes: 2701.8,
            points: 2377.9,
            rebounds: 426.6,
            assists: 529.3,
            steals: 165.9,
            blocks: 15.8,
            fgm: 805.8,
            fga: 1595.8,
            tpm: 402.9,
            tpa: 884.8,
            ftm: 363.4,
            fta: 402.9,
            per: 23.14,
            boxPlusMinus: 3.592,
            usageRate: 31.4,
            tsPct: 0.669,
        }), 'SG', { heightInches: 75 }));
        expect(curryLike.summaryRatings.overallRating).toBeGreaterThanOrEqual(95);
        expect(curryLike.summaryRatings.overallRating).toBeLessThanOrEqual(99);
        expect(computeProductionImpact(starterStats())).toBeLessThan(99);
    });
    it('recognizes complete elite seasons without requiring 28 points per game', () => {
        const lebronLike = derivePlayerRecord(input('2012-13', starterStats({
            gamesPlayed: 76,
            minutes: 2880,
            points: 2036,
            rebounds: 608,
            offensiveRebounds: 98,
            defensiveRebounds: 516,
            assists: 554,
            steals: 165,
            blocks: 90,
            turnovers: 228,
            fgm: 767,
            fga: 1352,
            tpm: 106,
            tpa: 250,
            ftm: 402,
            fta: 532,
            per: 24.025,
            boxPlusMinus: 4.456,
            usageRate: 29.4,
            tsPct: 0.64,
        }), 'SF', { heightInches: 80 }));
        expect(lebronLike.summaryRatings.overallRating).toBeGreaterThanOrEqual(95);
        expect(lebronLike.summaryRatings.overallRating).toBeLessThanOrEqual(97);
    });
    it('credits exceptional pre-event-stat center defense without a player override', () => {
        const russellLike = derivePlayerRecord(input('1961-62', pre1974Stats({
            gamesPlayed: 76,
            minutes: 2382,
            points: 1436,
            rebounds: 1777,
            assists: 203,
            fgm: 575,
            fga: 828,
            ftm: 286,
            fta: 480,
            per: 25.48,
            boxPlusMinus: 2.31,
            usageRate: 14.39,
            tsPct: 0.691,
            efgPct: 0.694,
        }), 'C', { heightInches: 82 }));
        const ordinaryHistoricalCenter = derivePlayerRecord(input('1961-62', pre1974Stats({ rebounds: 76 * 10, per: 18, boxPlusMinus: 1 }), 'C', {
            heightInches: 82,
        }));
        expect(russellLike.summaryRatings.overallRating).toBeGreaterThanOrEqual(90);
        expect(russellLike.ratingProfile.baseScore).toBeGreaterThan(ordinaryHistoricalCenter.ratingProfile.baseScore);
    });
    it('does not turn a strong center into an automatic 98 overall', () => {
        const townsLike = derivePlayerRecord(input('2016-17', starterStats({
            gamesPlayed: 82,
            minutes: 3034,
            points: 2058.2,
            rebounds: 1008.6,
            offensiveRebounds: 295.2,
            defensiveRebounds: 713.4,
            assists: 221.4,
            steals: 57.4,
            blocks: 106.6,
            turnovers: 213.2,
            fgm: 803.6,
            fga: 1476,
            tpm: 98.4,
            tpa: 278.8,
            ftm: 352.6,
            fta: 426.4,
            per: 22.005,
            boxPlusMinus: 3.177,
            usageRate: 27.1,
            tsPct: 0.618,
        }), 'C', { heightInches: 84 }));
        expect(townsLike.summaryRatings.overallRating).toBeLessThan(95);
        expect(townsLike.summaryRatings.offenseRating).toBeLessThan(85);
        expect(townsLike.summaryRatings.defenseRating).toBeLessThan(85);
        expect(townsLike.ratings.insideScoring).toBeLessThan(95);
        expect(townsLike.ratings.defensiveRebound).toBeLessThan(95);
        expect(townsLike.ratings.speed).toBeLessThan(90);
        expect(townsLike.ratings.strength).toBeLessThan(90);
    });
    it('uses the detailed roster position for overall weights and big detection', () => {
        const duncanLikeStats = starterStats({
            gamesPlayed: 81,
            minutes: 3183.3,
            points: 1887.3,
            rebounds: 1044.9,
            offensiveRebounds: 259.2,
            defensiveRebounds: 785.7,
            assists: 315.9,
            steals: 56.7,
            blocks: 234.9,
            turnovers: 251.1,
            fgm: 712.8,
            fga: 1393.2,
            tpm: 8.1,
            tpa: 24.3,
            ftm: 453.6,
            fta: 631.8,
            per: 23.59,
            boxPlusMinus: 5.821,
            usageRate: 27.6,
            tsPct: 0.564,
        });
        const duncanLike = derivePlayerRecord(input('2002-03', duncanLikeStats, 'SF', { heightInches: 84 }));
        expect(duncanLike.summaryRatings.overallRating).toBe(computeRealOverall(duncanLike.ratings, 'SF', duncanLikeStats, 84));
        expect(duncanLike.summaryRatings.overallRating).toBeGreaterThanOrEqual(computeRealOverall(duncanLike.ratings, 'F', duncanLikeStats, 84));
    });
    it('derives varied athletic ratings and play-style tendencies from evidence', () => {
        const guard = derivePlayerRecord(input('2023-24', starterStats({ assists: 700, steals: 150, fta: 500, tpa: 600 }), 'PG', {
            heightInches: 74,
        }));
        const center = derivePlayerRecord(input('2023-24', starterStats({ assists: 120, rebounds: 950, offensiveRebounds: 260, blocks: 180, tpa: 20 }), 'C', { heightInches: 84 }));
        expect(guard.ratings.speed).toBeGreaterThan(center.ratings.speed);
        expect(center.ratings.strength).toBeGreaterThan(guard.ratings.strength);
        expect(center.tendencies.postUpRate).toBeGreaterThan(guard.tendencies.postUpRate);
        expect(guard.tendencies.pickAndRollBallHandlerRate).toBeGreaterThan(center.tendencies.pickAndRollBallHandlerRate);
    });
    it('records every material athletic-rating input in provenance', () => {
        const derived = derivePlayerRecord(input('2023-24', starterStats(), 'SG'));
        expect(derived.provenance['speed']?.sourceFields).toEqual(expect.arrayContaining(['position', 'heightInches', 'usageRate', 'minutes', 'steals']));
        expect(derived.provenance['strength']?.sourceFields).toEqual(expect.arrayContaining(['position', 'heightInches', 'per']));
        expect(derived.provenance['vertical']?.sourceFields).toEqual(expect.arrayContaining(['blocks', 'offensiveRebounds', 'position']));
    });
    it('smoothly penalizes sustained low-impact bench seasons', () => {
        const derived = derivePlayerRecord(input('2005-06', starterStats({
            gamesPlayed: 71,
            minutes: 937,
            points: 205,
            rebounds: 113,
            offensiveRebounds: 28,
            defensiveRebounds: 85,
            assists: 49,
            steals: 21,
            blocks: 21,
            turnovers: 49,
            fgm: 71,
            fga: 191,
            tpm: 28,
            tpa: 85,
            ftm: 28,
            fta: 35,
            per: 3.01,
            boxPlusMinus: -2.682,
            usageRate: 12.6,
            tsPct: 0.491,
            efgPct: 0.464,
        }), 'SF'));
        expect(derived.summaryRatings.overallRating).toBeLessThan(65);
    });
    it('does not treat unavailable impact metrics as negative impact', () => {
        const unavailable = computeRealOverall({}, 'SG', starterStats({
            gamesPlayed: 71,
            minutes: 937,
            points: 205,
            per: null,
            boxPlusMinus: null,
        }), 79);
        const measured = computeRealOverall({}, 'SG', starterStats({
            gamesPlayed: 71,
            minutes: 937,
            points: 205,
            per: 3.01,
            boxPlusMinus: -2.682,
        }), 79);
        expect(unavailable).toBeGreaterThan(measured);
    });
    it('fieldPublished follows the source availability table (inclusive first season)', () => {
        expect(fieldPublished('steals', '1972-73')).toBe(false);
        expect(fieldPublished('steals', '1973-74')).toBe(true);
        expect(fieldPublished('turnovers', '1976-77')).toBe(false);
        expect(fieldPublished('turnovers', '1977-78')).toBe(true);
        expect(fieldPublished('threesAttempted', '1979-80')).toBe(true);
        expect(fieldPublished('threesAttempted', '1978-79')).toBe(false);
        expect(fieldPublished('points', '1960-61')).toBe(true);
    });
    it('rating kind follows evidence: high-sample observed inputs derive; sparse inputs estimate', () => {
        const full = derivePlayerRecord(input('1996-97', starterStats()));
        expect(full.provenance['perimeterDefense']?.kind).toBe('derived');
        const early = derivePlayerRecord(input('1970-71', pre1974Stats()));
        expect(early.provenance['perimeterDefense']?.kind).toBe('estimated');
    });
    it('shrinks tiny 3P/FT samples far below the large-sample ratings in low-minute seasons', () => {
        const tiny = derivePlayerRecord(input('2005-06', starterStats({ gamesPlayed: 12, minutes: 180, tpm: 1, tpa: 1, ftm: 1, fta: 1 })));
        expect(tiny.anchors.threePointPctShrunk).toBeCloseTo((1 + 0.36 * 80) / 81, 3);
        expect(tiny.anchors.freeThrowPctShrunk).toBeCloseTo((1 + 0.8 * 80) / 81, 3);
        expect(tiny.ratings.threePoint).toBeLessThan(90);
        expect(tiny.ratings.freeThrow).toBeLessThan(90);
        const large = derivePlayerRecord(input('2005-06', starterStats({ tpm: 300, tpa: 600, ftm: 250, fta: 300 })));
        expect(tiny.ratings.threePoint).toBeLessThan(large.ratings.threePoint - 10);
        expect(tiny.ratings.freeThrow).toBeLessThan(large.ratings.freeThrow - 10);
    });
    it('shrinks large samples with exact formula anchors and ratings near the observed rate', () => {
        const large = derivePlayerRecord(input('2005-06', starterStats({ tpm: 300, tpa: 600, ftm: 250, fta: 300 })));
        const shrunkThree = (300 + 0.36 * 80) / 680;
        const shrunkFt = (250 + 0.8 * 80) / 380;
        expect(large.anchors.threePointPctShrunk).toBeCloseTo(shrunkThree, 3);
        expect(large.anchors.freeThrowPctShrunk).toBeCloseTo(shrunkFt, 3);
        expect(Math.abs((large.anchors.threePointPctShrunk ?? 0) - 0.5)).toBeLessThanOrEqual(0.02);
        expect(Math.abs((large.anchors.freeThrowPctShrunk ?? 0) - 250 / 300)).toBeLessThanOrEqual(0.02);
        const unshrunk = derivePlayerRecord(input('2005-06', starterStats({ tpm: 300, tpa: 600, ftm: 250, fta: 300 }), 'SG', {
            ratePriors: { threePointPctPrior: 0.5, freeThrowPctPrior: 250 / 300 },
        }));
        expect(Math.abs(unshrunk.ratings.threePoint - large.ratings.threePoint)).toBeLessThanOrEqual(4);
        expect(Math.abs(unshrunk.ratings.freeThrow - large.ratings.freeThrow)).toBeLessThanOrEqual(4);
    });
    it('honors explicit ratePriors in the shrunk anchors', () => {
        const stats = starterStats({ tpm: 300, tpa: 600, ftm: 250, fta: 300 });
        const explicit = derivePlayerRecord(input('2005-06', stats, 'SG', {
            ratePriors: { threePointPctPrior: 0.45, freeThrowPctPrior: 0.75 },
        }));
        expect(explicit.anchors.threePointPctShrunk).toBeCloseTo((300 + 0.45 * 80) / 680, 3);
        expect(explicit.anchors.freeThrowPctShrunk).toBeCloseTo((250 + 0.75 * 80) / 380, 3);
        expect(explicit.anchors.threePointPctPrior).toBe(0.45);
        expect(explicit.anchors.freeThrowPctPrior).toBe(0.75);
        const defaultPrior = derivePlayerRecord(input('2005-06', stats));
        expect(explicit.anchors.threePointPctShrunk ?? 0).not.toBeCloseTo(defaultPrior.anchors.threePointPctShrunk ?? 0, 6);
        expect(explicit.anchors.freeThrowPctShrunk ?? 0).not.toBeCloseTo(defaultPrior.anchors.freeThrowPctShrunk ?? 0, 6);
    });
    it('records shrink-80-attempts provenance and the prior anchors for shooting rates', () => {
        const derived = derivePlayerRecord(input('2005-06', starterStats()));
        expect(derived.provenance['threePoint']?.sourceFields).toEqual(expect.arrayContaining(['shrink-80-attempts', 'prior']));
        expect(derived.provenance['freeThrow']?.sourceFields).toEqual(expect.arrayContaining(['shrink-80-attempts', 'prior']));
        expect(derived.anchors.threePointPctPrior).toBe(0.36);
        expect(derived.anchors.freeThrowPctPrior).toBe(0.8);
        expect(derived.anchors.rateShrinkAttempts).toBe(80);
    });
    it('keeps perimeter/interior/defensiveIq independent of box plus/minus', () => {
        const highBpm = derivePlayerRecord(input('1996-97', starterStats({ boxPlusMinus: 8 })));
        const lowBpm = derivePlayerRecord(input('1996-97', starterStats({ boxPlusMinus: -2 })));
        for (const field of ['perimeterDefense', 'interiorDefense', 'defensiveIq'] as const) {
            expect(highBpm.provenance[field]?.sourceFields).not.toContain('boxPlusMinus');
            expect(highBpm.ratings[field]).toBe(lowBpm.ratings[field]);
        }
        expect(highBpm.provenance['offensiveIq']?.sourceFields).toContain('boxPlusMinus');
        expect(highBpm.ratings.offensiveIq).not.toBe(lowBpm.ratings.offensiveIq);
    });
    it('defensiveIq is derived when stocks are observed and estimated otherwise', () => {
        const modern = derivePlayerRecord(input('1996-97', starterStats()));
        expect(modern.provenance['defensiveIq']?.kind).toBe('derived');
        const early = derivePlayerRecord(input('1970-71', pre1974Stats()));
        expect(early.provenance['defensiveIq']?.kind).toBe('estimated');
        expect(early.provenance['defensiveIq']?.sourceFields).toEqual(expect.arrayContaining(['rebounds', 'prior']));
    });
    it('resolveCounting uses the position prior: changing G to C changes estimated steals', () => {
        const guard = derivePlayerRecord(input('1970-71', pre1974Stats(), 'SG'));
        const center = derivePlayerRecord(input('1970-71', pre1974Stats(), 'C'));
        const mpg = 2850 / 78;
        expect(guard.anchors.stealsPerGame).toBeCloseTo((1.5 * mpg) / 36, 9);
        expect(center.anchors.stealsPerGame).toBeCloseTo((0.8 * mpg) / 36, 9);
        expect(guard.anchors.stealsPerGame).toBeGreaterThan(center.anchors.stealsPerGame);
        expect(guard.provenance['steal']?.kind).toBe('estimated');
    });
    it('estimated steals per game equal priorPer36 * (mpg / 36) with no related evidence', () => {
        const derived = derivePlayerRecord(input('1970-71', pre1974Stats(), 'SG'));
        const mpg = 2850 / 78;
        expect(derived.anchors.stealsPerGame).toBeCloseTo((1.5 * mpg) / 36, 9);
        expect(derived.provenance['steal']?.sourceFields.at(-1)).toBe('prior');
    });
    it('estimates rebound splits from total rebounds when the split is unpublished', () => {
        const derived = derivePlayerRecord(input('1970-71', pre1974Stats(), 'SG'));
        const reboundsPerGame = 420 / 78;
        const splitTotal = derived.anchors.offensiveReboundsPerGame + derived.anchors.defensiveReboundsPerGame;
        expect(splitTotal).toBeCloseTo(reboundsPerGame, 1);
        expect(derived.provenance['offensiveRebound']?.sourceFields.at(-1)).toBe('rebounds');
        expect(derived.provenance['defensiveRebound']?.sourceFields.at(-1)).toBe('rebounds');
        expect(derived.provenance['offensiveRebound']?.kind).toBe('estimated');
    });
    it('falls back to the pure prior (fields ending in "prior") when rebounds are absent too', () => {
        const derived = derivePlayerRecord(input('1970-71', pre1974Stats({ rebounds: null }), 'SG'));
        const mpg = 2850 / 78;
        expect(derived.anchors.offensiveReboundsPerGame).toBeCloseTo((1.1 * mpg) / 36, 9);
        expect(derived.anchors.defensiveReboundsPerGame).toBeCloseTo((4.2 * mpg) / 36, 9);
        expect(derived.provenance['offensiveRebound']?.sourceFields.at(-1)).toBe('prior');
        expect(derived.provenance['defensiveRebound']?.sourceFields.at(-1)).toBe('prior');
    });
});
