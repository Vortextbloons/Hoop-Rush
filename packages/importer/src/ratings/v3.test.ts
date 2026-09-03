import { describe, expect, it } from 'vitest';
import { DEFAULT_RATINGS_MODEL_ARTIFACT } from './artifact.ts';
import { derivePlayerRecord } from './v2.ts';
import { computeSummaryRatings } from './summary.ts';
import { starterStats } from './ratings-test-support.ts';
const stats = starterStats();
function recordFor(statsOver: Record<string, unknown> = {}) {
    return derivePlayerRecord({
        season: '1996-97',
        position: 'SG',
        heightInches: 79,
        stats: { ...stats, ...statsOver },
        era: { leaguePpg: 110, league3PARate: 0.36, pace: 99 },
        artifact: DEFAULT_RATINGS_MODEL_ARTIFACT,
    });
}
describe('Ratings v3 profile', () => {
    it('derives normalized multi-memberships and bounded nonlinear components', () => {
        const record = derivePlayerRecord({
            season: '1996-97',
            position: 'SG',
            heightInches: 79,
            stats,
            era: { leaguePpg: 110, league3PARate: 0.36, pace: 99 },
            artifact: DEFAULT_RATINGS_MODEL_ARTIFACT,
        });
        const memberships = record.ratingProfile.memberships;
        expect(Object.keys(memberships)).toHaveLength(10);
        expect(Object.values(memberships).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
        expect(record.ratingProfile.nonlinear.synergyBonus).toBeGreaterThanOrEqual(0);
        expect(record.ratingProfile.nonlinear.synergyBonus).toBeLessThanOrEqual(5);
        expect(record.ratingProfile.nonlinear.weaknessPenalty).toBeGreaterThanOrEqual(-6);
        expect(record.ratingProfile.nonlinear.weaknessPenalty).toBeLessThanOrEqual(0);
    });
    it('shrinks missing or small-sample production evidence toward the archetype base', () => {
        const record = derivePlayerRecord({
            season: '1970-71',
            position: 'C',
            heightInches: 84,
            stats: { ...stats, gamesPlayed: 8, minutes: 80, per: null, boxPlusMinus: null, tsPct: null },
            era: { leaguePpg: 110, league3PARate: 0.08, pace: 115 },
            artifact: DEFAULT_RATINGS_MODEL_ARTIFACT,
        });
        expect(record.ratingProfile.production.confidence).toBe('low');
        expect(record.ratingProfile.production.weight).toBeLessThan(0.1);
        expect(record.ratingProfile.calibratedImpact.confidence).toBe(0);
    });
    it('keeps a sustained efficient star wing out of the ordinary-starter band', () => {
        const record = derivePlayerRecord({
            season: '2025-26',
            position: 'SF',
            heightInches: 83,
            stats: {
                ...stats,
                points: 2028,
                rebounds: 429,
                assists: 374,
                steals: 78,
                blocks: 86,
                turnovers: 249,
                fgm: 717,
                fga: 1372,
                tpm: 187,
                tpa: 452,
                ftm: 405,
                fta: 468,
                per: 19.2,
                boxPlusMinus: 1.725,
                usageRate: 26.3,
                tsPct: 0.641,
                efgPct: 0.588,
            },
            era: { leaguePpg: 114.7, league3PARate: 0.39, pace: 99 },
            artifact: DEFAULT_RATINGS_MODEL_ARTIFACT,
        });
        expect(record.summaryRatings.overallRating).toBeGreaterThanOrEqual(87);
    });
    it('persists schemaVersion 2 and the pre-percentile raw overall score', () => {
        const record = recordFor();
        const profile = record.ratingProfile;
        expect(profile.schemaVersion).toBe(2);
        const recomputed = profile.baseScore * (1 - profile.production.weight) +
            profile.production.score * profile.production.weight +
            profile.calibratedImpact.adjustment;
        expect(profile.rawOverallScore).toBe(Math.round(recomputed * 100) / 100);
        expect(profile.rawOverallScore).not.toBe(profile.canonicalOverall);
    });
    it('reports the same offense/defense through computeSummaryRatings and the profile', () => {
        const record = recordFor();
        const summary = computeSummaryRatings(record.ratings, record.tendencies);
        expect(summary.offenseRating).toBe(record.ratingProfile.offenseRating);
        expect(summary.defenseRating).toBe(record.ratingProfile.defenseRating);
        expect(summary.offenseRating).toBe(record.summaryRatings.offenseRating);
        expect(summary.defenseRating).toBe(record.summaryRatings.defenseRating);
    });
    it('keeps ratings, tendencies, offense, and defense stable when overall is overwritten', () => {
        const record = recordFor();
        const ratingsBefore = { ...record.ratings };
        const tendenciesBefore = { ...record.tendencies };
        const offenseBefore = record.ratingProfile.offenseRating;
        const defenseBefore = record.ratingProfile.defenseRating;
        record.summaryRatings.overallRating = 42;
        expect(record.summaryRatings.overallRating).toBe(42);
        expect(record.ratings).toEqual(ratingsBefore);
        expect(record.tendencies).toEqual(tendenciesBefore);
        expect(record.ratingProfile.offenseRating).toBe(offenseBefore);
        expect(record.ratingProfile.defenseRating).toBe(defenseBefore);
        expect(record.summaryRatings.offenseRating).toBe(offenseBefore);
        expect(record.summaryRatings.defenseRating).toBe(defenseBefore);
    });
    it('overall is a provisional 55/45 blend while the packaged Overall comes from the profile', () => {
        const record = recordFor();
        const summary = computeSummaryRatings(record.ratings, record.tendencies);
        expect(summary.overallRating).toBe(Math.trunc(0.55 * summary.offenseRating + 0.45 * summary.defenseRating));
        expect(record.summaryRatings.overallRating).toBe(record.ratingProfile.canonicalOverall);
        expect(record.summaryRatings.overallRating).not.toBe(summary.overallRating);
    });
});
